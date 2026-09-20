import type { ClickHouseConnection } from "./types";

type QueryOptions = {
  format?: string;
  timeoutMs?: number;
  maxRows?: number;
};

const PRIVATE_IPV4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export function validateConnection(connection: ClickHouseConnection, requestUrl: string) {
  if (!connection || typeof connection !== "object") throw new Error("缺少连接信息");
  const endpoint = new URL(connection.endpoint);
  if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("仅支持 HTTP 或 HTTPS 地址");

  const requestHost = new URL(requestUrl).hostname;
  const isLocalPreview = requestHost === "localhost" || requestHost === "127.0.0.1";
  const targetHost = endpoint.hostname.toLowerCase();
  const privateTarget = targetHost === "localhost" || targetHost === "::1" || PRIVATE_IPV4.test(targetHost);
  if (!isLocalPreview && endpoint.protocol !== "https:") throw new Error("托管版本仅连接 HTTPS ClickHouse 地址");
  if (!isLocalPreview && privateTarget) throw new Error("托管版本不能访问本机或内网地址");

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
) {
  const endpoint = validateConnection(connection, requestUrl);
  const target = `${quoteIdentifier(database)}.${quoteIdentifier(table)}`;
  endpoint.searchParams.set("query", `INSERT INTO ${target} FORMAT ${format}`);
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
  if (normalized.includes(";") && normalized.replace(/;\s*$/, "").includes(";")) throw new Error("只允许执行一条 SQL");
  const keyword = normalized.match(/^([a-z]+)/i)?.[1]?.toUpperCase();
  if (!["SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "WITH"].includes(keyword ?? "")) {
    throw new Error("只读模式仅允许 SELECT、SHOW、DESCRIBE 或 EXPLAIN");
  }
}

function cleanClickHouseError(message: string, status: number) {
  const compact = message.replace(/\s+/g, " ").trim().slice(0, 900);
  return compact || `ClickHouse 请求失败（HTTP ${status}）`;
}
