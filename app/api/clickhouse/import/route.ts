import { NextRequest, NextResponse } from "next/server";
import { clickhouseImport } from "@/lib/clickhouse/server";
import type { ClickHouseConnection } from "@/lib/clickhouse/types";

export const runtime = "edge";
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("请选择导入文件");
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("当前版本单次上传最大 8 MB");

    const connection = JSON.parse(String(form.get("connection") || "{}")) as ClickHouseConnection;
    const database = String(form.get("database") || connection.database || "default");
    const table = String(form.get("table") || "");
    const requestedFormat = String(form.get("format") || "CSVWithNames");
    if (!["CSV", "CSVWithNames", "JSONEachRow"].includes(requestedFormat)) throw new Error("不支持的文件格式");
    if (!table) throw new Error("请输入目标表名");

    const summary = await clickhouseImport(
      connection,
      request.url,
      database,
      table,
      requestedFormat as "CSV" | "CSVWithNames" | "JSONEachRow",
      await file.arrayBuffer(),
    );
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "导入失败" },
      { status: 400 },
    );
  }
}
