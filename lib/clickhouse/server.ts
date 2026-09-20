import type { ClickHouseConnection } from "./types";

type QueryOptions = {
  format?: string;
  timeoutMs?: number;
  maxRows?: number;
};

const PRIVATE_IPV4 = /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

export function validateConnection(connection: ClickHouseConnection, requestUrl: string) {
  if (!connection || typeof connection !== "object") throw new Error("缺少连接信息");
  const endpoint = new URL(connection.endpoint);
  if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("仅支持 HTTP 或 HTTPS 地址");

  const requestHost = new URL(requestUrl).hostname;
  const localDevelopment = process.env.NODE_ENV !== "production" && isLoopbackTarget(requestHost);
  const privateTargetsAllowed = localDevelopment || process.env.COLUMNPILOT_ALLOW_PRIVATE_TARGETS === "true";
  const targetHost = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateTarget = isPrivateTarget(targetHost);
  if (!privateTargetsAllowed && endpoint.protocol !== "https:") throw new Error("托管版本仅连接 HTTPS ClickHouse 地址");
  if (!privateTargetsAllowed && privateTarget) throw new Error("托管版本不能访问本机或内网地址");

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
  const endpoint = validateConnection(connection, requestUrl);
  endpoint.searchParams.set("max_execution_time", String(Math.ceil((options.timeoutMs ?? 30_000) / 1000)));
  endpoint.searchParams.set("max_result_rows", String(options.maxRows ?? 500));
  endpoint.searchParams.set("result_overflow_mode", "break");
  endpoint.searchParams.set("wait_end_of_query", "1");
  endpoint.searchParams.set("readonly", "1");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
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
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(cleanClickHouseError(text, response.status));
    if ((options.format ?? "JSON") === "JSON") {
      return text ? JSON.parse(text) : { meta: [], data: [], rows: 0 };
    }
    return text;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("查询超过时间限制");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function clickhouseImport(
  connection: ClickHouseConnection,
  requestUrl: string,
  database: string,
  table: string,
  format: "CSV" | "CSVWithNames" | "JSONEachRow",
  bytes: ArrayBuffer,
  columns: string[],
) {
  const endpoint = validateConnection(connection, requestUrl);
  const target = `${quoteIdentifier(database)}.${quoteIdentifier(table)}`;
  const columnList = columns.map(quoteIdentifier).join(", ");
  if (!columnList) throw new Error("导入文件没有可写入字段");
  endpoint.searchParams.set("query", `INSERT INTO ${target} (${columnList}) FORMAT ${format}`);
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
  });
  const text = await response.text();
  if (!response.ok) throw new Error(cleanClickHouseError(text, response.status));
  const summary = response.headers.get("x-clickhouse-summary");
  return summary ? JSON.parse(summary) : { written_rows: null, written_bytes: bytes.byteLength };
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
  if (isLoopbackTarget(hostname) || hostname.endsWith(".localhost")) return true;
  if (PRIVATE_IPV4.test(hostname)) return true;
  if (hostname === "::" || hostname === "::1") return true;
  if (/^(?:fc|fd|fe[89ab])/i.test(hostname)) return true;
  if (hostname.startsWith("::ffff:")) {
    return PRIVATE_IPV4.test(hostname.slice("::ffff:".length));
  }
  return false;
}

function isLoopbackTarget(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
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
