import { NextRequest, NextResponse } from "next/server";
import {
  assertReadOnly,
  clickhouseQuery,
  quoteIdentifier,
  sqlString,
  type ClickHouseConnection,
} from "@/lib/clickhouse";

export const runtime = "edge";

type RequestBody = {
  action: "ping" | "overview" | "tables" | "columns" | "preview" | "query";
  connection: ClickHouseConnection;
  database?: string;
  table?: string;
  sql?: string;
  allowWrite?: boolean;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const { connection, action } = body;
    let sql = "";

    switch (action) {
      case "ping":
        sql = "SELECT version() AS version, currentUser() AS user, currentDatabase() AS database, uptime() AS uptime";
        break;
      case "overview":
        sql = `SELECT
          (SELECT count() FROM system.databases WHERE name NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')) AS databases,
          (SELECT count() FROM system.tables WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')) AS tables,
          (SELECT sum(total_rows) FROM system.tables WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')) AS total_rows,
          (SELECT sum(total_bytes) FROM system.tables WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')) AS total_bytes,
          version() AS version, currentUser() AS user, uptime() AS uptime`;
        break;
      case "tables": {
        const database = body.database || connection.database || "default";
        sql = `SELECT database, name, engine, total_rows, total_bytes, metadata_modification_time
          FROM system.tables WHERE database = ${sqlString(database)} ORDER BY total_bytes DESC LIMIT 500`;
        break;
      }
      case "columns": {
        if (!body.database || !body.table) throw new Error("请选择数据表");
        sql = `SELECT name, type, position, default_kind, default_expression, compression_codec
          FROM system.columns WHERE database = ${sqlString(body.database)} AND table = ${sqlString(body.table)} ORDER BY position`;
        break;
      }
      case "preview": {
        if (!body.database || !body.table) throw new Error("请选择数据表");
        sql = `SELECT * FROM ${quoteIdentifier(body.database)}.${quoteIdentifier(body.table)} LIMIT 100`;
        break;
      }
      case "query":
        sql = body.sql || "";
        if (!body.allowWrite) assertReadOnly(sql);
        break;
      default:
        throw new Error("不支持的操作");
    }

    const result = await clickhouseQuery(connection, sql, request.url, {
      timeoutMs: action === "query" ? 30_000 : 15_000,
      maxRows: action === "columns" ? 1_000 : 500,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "ClickHouse 请求失败" },
      { status: 400 },
    );
  }
}
