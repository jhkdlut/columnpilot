import { createHash } from "node:crypto";
import { clickhouseQuery, sqlString } from "../clickhouse/server";
import { RequestError } from "../http/errors";
import type { ClickHouseConnection, ClickHouseQueryResult } from "../clickhouse/types";
import type { AiSchema } from "./types";
import { identifier } from "./plan";
import { object, text } from "./validation";

export const RESULT_BYTES = 2 * 1024 * 1024;
const engines = new Set(["MergeTree", "ReplacingMergeTree", "SummingMergeTree", "AggregatingMergeTree", "CollapsingMergeTree", "VersionedCollapsingMergeTree", "ReplicatedMergeTree", "ReplicatedReplacingMergeTree", "Memory", "Log", "TinyLog", "StripeLog"]);

export function readConnection(value: unknown): ClickHouseConnection {
  const raw = object(value, ["endpoint", "user", "password", "database"]);
  const connection = { endpoint: text(raw.endpoint, 2048), user: text(raw.user, 128), database: text(raw.database), password: raw.password === undefined || raw.password === "" ? "" : text(raw.password, 4096) };
  const endpoint = new URL(connection.endpoint);
  if (endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw new RequestError("智能问数连接地址不能包含查询参数、片段或凭据", 400);
  return connection;
}

export async function aiQuery(connection: ClickHouseConnection, sql: string, requestUrl: string, parameters?: Record<string, string>, maxRows = 501): Promise<ClickHouseQueryResult> {
  return clickhouseQuery(connection, sql, requestUrl, { timeoutMs: 30_000, maxRows, maxResponseBytes: RESULT_BYTES, parameters });
}

export async function catalog(connection: ClickHouseConnection, requestUrl: string, action: "databases" | "tables") {
  const sql = action === "databases"
    ? "SELECT name FROM system.databases WHERE name NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema') ORDER BY name LIMIT 101"
    : `SELECT name, engine FROM system.tables WHERE database = ${sqlString(connection.database)} ORDER BY name LIMIT 501`;
  const result = await aiQuery(connection, sql, requestUrl);
  const limit = action === "databases" ? 100 : 500;
  return { items: result.data.slice(0, limit), truncated: result.data.length > limit };
}

export async function loadSchema(connection: ClickHouseConnection, table: string, requestUrl: string): Promise<AiSchema> {
  if (["system", "INFORMATION_SCHEMA", "information_schema"].includes(connection.database)) throw new RequestError("智能问数不支持系统数据库", 400);
  const where = `database = ${sqlString(connection.database)} AND name = ${sqlString(table)}`;
  const tables = await aiQuery(connection, `SELECT engine FROM system.tables WHERE ${where} LIMIT 1`, requestUrl);
  const engine = String(tables.data[0]?.engine ?? "");
  if (!engines.has(engine)) throw new RequestError("该表不存在或引擎不在首版支持范围内（不支持视图、分布式或外部数据源）", 400);
  // Check SELECT authorization before exposing the schema to a provider.
  await aiQuery(connection, `SELECT * FROM ${identifier(connection.database)}.${identifier(table)} LIMIT 0`, requestUrl);
  const columns = await aiQuery(connection, `SELECT name, type, comment FROM system.columns WHERE database = ${sqlString(connection.database)} AND table = ${sqlString(table)} ORDER BY position LIMIT 201`, requestUrl);
  if (!columns.data.length || columns.data.length > 200) throw new RequestError("当前表无字段或超过 200 个字段，请缩小数据范围", 400);
  const schema: AiSchema = { database: connection.database, table, engine, columns: columns.data.map((row) => ({ name: text(row.name), type: text(row.type, 512), comment: typeof row.comment === "string" ? row.comment.slice(0, 500) : "" })) };
  if (Buffer.byteLength(JSON.stringify(schema)) > 48 * 1024) throw new RequestError("表结构超过上下文大小限制", 413);
  return schema;
}

export function schemaFingerprint(schema: AiSchema) { return createHash("sha256").update(JSON.stringify(schema)).digest("hex"); }
