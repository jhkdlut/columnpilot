import { NextRequest, NextResponse } from "next/server";
import {
  createImportPreview,
  MAX_IMPORT_BYTES,
  type ImportColumn,
  type ImportFormat,
} from "@/lib/clickhouse/import-preview";
import { clickhouseImport, clickhouseQuery, sqlString } from "@/lib/clickhouse/server";
import type { ClickHouseConnection } from "@/lib/clickhouse/types";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("请选择导入文件");
    if (file.size > MAX_IMPORT_BYTES) throw new Error("当前版本单次上传最大 8 MB");

    const connection = JSON.parse(String(form.get("connection") || "{}")) as ClickHouseConnection;
    const database = String(form.get("database") || connection.database || "default");
    const table = String(form.get("table") || "");
    const requestedFormat = String(form.get("format") || "CSVWithNames");
    if (!["CSV", "CSVWithNames", "JSONEachRow"].includes(requestedFormat)) throw new Error("不支持的文件格式");
    if (!table) throw new Error("请输入目标表名");

    const schemaResult = await clickhouseQuery(
      connection,
      `SELECT name, type, position, default_kind, default_expression
        FROM system.columns
        WHERE database = ${sqlString(database)} AND table = ${sqlString(table)}
        ORDER BY position`,
      request.url,
      { timeoutMs: 15_000, maxRows: 1_000 },
    );
    const columns = (schemaResult.data ?? []) as ImportColumn[];
    if (!columns.length) throw new Error("目标表不存在或没有可导入字段");

    const bytes = await file.arrayBuffer();
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("导入文件必须使用 UTF-8 编码");
    }
    const preview = createImportPreview(text, requestedFormat as ImportFormat, columns);
    if (preview.errors.length) throw new Error(preview.errors.join("；"));

    const summary = await clickhouseImport(
      connection,
      request.url,
      database,
      table,
      requestedFormat as ImportFormat,
      bytes,
      preview.headers,
      { timeoutMs: 30_000 },
    );
    return NextResponse.json({ ok: true, summary, warnings: preview.warnings });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "导入失败" },
      { status: 400 },
    );
  }
}
