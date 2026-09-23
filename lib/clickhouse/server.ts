import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, type Dispatcher } from "undici";
import type { ClickHouseConnection } from "./types";

type QueryOptions = {
  format?: string;
  timeoutMs?: number;
  maxRows?: number;
};

type PreparedTarget = {
  endpoint: URL;
  dispatcher?: Dispatcher;
};

export function validateConnection(connection: ClickHouseConnection, requestUrl: string) {
  if (!connection || typeof connection !== "object") throw new Error("缺少连接信息");
  const endpoint = new URL(connection.endpoint);
  if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("仅支持 HTTP 或 HTTPS 地址");

  const allowPrivateTargets = privateTargetsAllowed(requestUrl);
  const targetHost = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateTarget = isPrivateTarget(targetHost);
  if (!allowPrivateTargets && endpoint.protocol !== "https:") throw new Error("托管版本仅连接 HTTPS ClickHouse 地址");
  if (!allowPrivateTargets && privateTarget) throw new Error("托管版本不能访问本机或内网地址");

  if ((connection.user ?? "").length > 128 || (connection.database ?? "").length > 256) {
    throw new Error("连接字段过长");
  }
  return endpoint;
}

export async function clickhouseQuery(
  connection: ClickHouseConnection,
  sql: string,
  requestUrl: string,
  options: QueryOptions = {},
) {
  return withTarget(connection, requestUrl, options.timeoutMs ?? 30_000, "查询超过时间限制", async ({ endpoint, dispatcher }, signal) => {
    endpoint.searchParams.set("max_execution_time", String(Math.ceil((options.timeoutMs ?? 30_000) / 1000)));
    endpoint.searchParams.set("max_result_rows", String(options.maxRows ?? 500));
    endpoint.searchParams.set("result_overflow_mode", "break");
    endpoint.searchParams.set("wait_end_of_query", "1");
    endpoint.searchParams.set("readonly", "1");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-clickhouse-user": connection.user || "default",
        "x-clickhouse-key": connection.password || "",
        "x-clickhouse-database": connection.database || "default",
        "x-clickhouse-format": options.format ?? "JSON",
      },
      body: sql,
      dispatcher,
      signal,
      redirect: "manual",
    } as RequestInit & { dispatcher?: Dispatcher });
    await rejectRedirect(response);
    const text = await response.text();
    if (!response.ok) throw new Error(cleanClickHouseError(text, response.status));
    if ((options.format ?? "JSON") === "JSON") {
      return text ? JSON.parse(text) : { meta: [], data: [], rows: 0 };
    }
    return text;
  });
}

export async function clickhouseImport(
  connection: ClickHouseConnection,
  requestUrl: string,
  database: string,
  table: string,
  format: "CSV" | "CSVWithNames" | "JSONEachRow",
  bytes: ArrayBuffer,
  columns: string[],
  options: Pick<QueryOptions, "timeoutMs"> = {},
) {
  const target = `${quoteIdentifier(database)}.${quoteIdentifier(table)}`;
  const columnList = columns.map(quoteIdentifier).join(", ");
  if (!columnList) throw new Error("导入文件没有可写入字段");
  return withTarget(connection, requestUrl, options.timeoutMs ?? 30_000, "导入超过时间限制", async ({ endpoint, dispatcher }, signal) => {
    endpoint.searchParams.set("query", `INSERT INTO ${target} (${columnList}) FORMAT ${format}`);
    endpoint.searchParams.set("max_execution_time", String(Math.ceil((options.timeoutMs ?? 30_000) / 1000)));
    endpoint.searchParams.set("wait_end_of_query", "1");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-clickhouse-user": connection.user || "default",
        "x-clickhouse-key": connection.password || "",
        "x-clickhouse-database": database,
      },
      body: bytes,
      dispatcher,
      signal,
      redirect: "manual",
    } as RequestInit & { dispatcher?: Dispatcher });
    await rejectRedirect(response);
    const text = await response.text();
    if (!response.ok) throw new Error(cleanClickHouseError(text, response.status));
    const summary = response.headers.get("x-clickhouse-summary");
    return summary ? JSON.parse(summary) : { written_rows: null, written_bytes: bytes.byteLength };
  });
}

async function rejectRedirect(response: Response) {
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error("ClickHouse 地址不允许 HTTP 重定向，请填写最终服务地址");
  }
}

async function withTarget<T>(
  connection: ClickHouseConnection,
  requestUrl: string,
  timeoutMs: number,
  timeoutMessage: string,
  operation: (target: PreparedTarget, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let dispatcher: Dispatcher | undefined;
  try {
    const target = await prepareTarget(connection, requestUrl, controller.signal);
    dispatcher = target.dispatcher;
    controller.signal.throwIfAborted();
    return await abortable(operation(target, controller.signal), controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(timeoutMessage);
    throw error;
  } finally {
    clearTimeout(timeout);
    // A timed-out request or a rejected redirect must not keep a socket alive.
    await dispatcher?.destroy();
  }
}

function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
    if (signal.aborted) {
      signal.removeEventListener("abort", abort);
      abort();
    }
  });
}

async function prepareTarget(connection: ClickHouseConnection, requestUrl: string, signal: AbortSignal): Promise<PreparedTarget> {
  signal.throwIfAborted();
  const endpoint = validateConnection(connection, requestUrl);
  if (privateTargetsAllowed(requestUrl)) return { endpoint };

  let addresses: LookupAddress[];
  try {
    // lookup() itself cannot be cancelled. Stop awaiting it at the deadline,
    // and never create a dispatcher or send a request if it finishes later.
    addresses = await abortable(lookup(endpoint.hostname, { all: true, verbatim: true }), signal);
  } catch {
    signal.throwIfAborted();
    throw new Error("无法解析 ClickHouse 地址");
  }
  signal.throwIfAborted();
  if (!addresses.length) throw new Error("无法解析 ClickHouse 地址");
  if (addresses.some(({ address }) => isPrivateTarget(address))) {
    throw new Error("托管版本不能访问解析到本机或内网的地址");
  }

  return {
    endpoint,
    dispatcher: new Agent({ connect: { lookup: pinnedLookup(addresses) } }),
  };
}

function pinnedLookup(addresses: LookupAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const requestedFamily = options.family;
    const candidates = requestedFamily
      ? addresses.filter(({ family }) => family === requestedFamily)
      : addresses;
    if (!candidates.length) {
      const error = new Error("没有可用的公网 ClickHouse 地址") as NodeJS.ErrnoException;
      error.code = "ENOTFOUND";
      callback(error, "", 0);
      return;
    }
    if (options.all) callback(null, candidates);
    else callback(null, candidates[0].address, candidates[0].family);
  };
}

export function quoteIdentifier(value: string) {
  if (!value || value.length > 256) throw new Error("数据库或表名无效");
  return `\`${value.replaceAll("`", "``")}\``;
}

export function sqlString(value: string) {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

export function assertReadOnly(sql: string) {
  const normalized = sql.replace(/^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/g, "").trim();
  if (!normalized) throw new Error("请输入 SQL");
  const tokens = topLevelTokens(normalized);
  const keyword = tokens[0];
  const effectiveKeyword = keyword === "WITH"
    ? tokens.find((token) => ["SELECT", "INSERT", "UPDATE", "DELETE", "ALTER", "CREATE", "DROP", "TRUNCATE"].includes(token))
    : keyword;
  if (!["SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN"].includes(effectiveKeyword ?? "")) {
    throw new Error("只读模式仅允许 SELECT、SHOW、DESCRIBE 或 EXPLAIN");
  }
  if (tokens.some((token, index) => token === "INTO" && ["OUTFILE", "DUMPFILE"].includes(tokens[index + 1]))) {
    throw new Error("只读模式不允许写入文件");
  }
}

function isPrivateTarget(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isLoopbackTarget(normalized) || normalized.endsWith(".localhost")) return true;
  if (!ipaddr.isValid(normalized)) return false;

  const address = ipaddr.parse(normalized);
  if (address.kind() === "ipv6") {
    const ipv6Address = address as ipaddr.IPv6;
    if (ipv6Address.isIPv4MappedAddress()) {
      return ipv6Address.toIPv4Address().range() !== "unicast";
    }
  }
  return address.range() !== "unicast";
}

function isLoopbackTarget(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function privateTargetsAllowed(requestUrl: string) {
  const requestHost = new URL(requestUrl).hostname;
  const localDevelopment = process.env.NODE_ENV !== "production" && isLoopbackTarget(requestHost);
  return localDevelopment || process.env.COLUMNPILOT_ALLOW_PRIVATE_TARGETS === "true";
}

function topLevelTokens(sql: string) {
  const tokens: string[] = [];
  let token = "";
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;
  let statementEnded = false;

  const flush = () => {
    if (token && depth === 0) tokens.push(token.toUpperCase());
    token = "";
  };

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];

    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        if (next === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (character === "-" && next === "-") {
      flush();
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      flush();
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      flush();
      quote = character;
      continue;
    }
    if (character === "(") {
      flush();
      depth += 1;
      continue;
    }
    if (character === ")") {
      flush();
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (character === ";" && depth === 0) {
      flush();
      statementEnded = true;
      continue;
    }
    if (statementEnded && !/\s/.test(character)) throw new Error("只允许执行一条 SQL");
    if (/[a-z0-9_]/i.test(character)) token += character;
    else flush();
  }
  flush();
  return tokens;
}

function cleanClickHouseError(message: string, status: number) {
  const compact = message.replace(/\s+/g, " ").trim().slice(0, 900);
  return compact || `ClickHouse 请求失败（HTTP ${status}）`;
}
