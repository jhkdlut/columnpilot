import type { ClickHouseQueryResult } from "./types";

export type ExportFormat = "csv" | "json";

export function serializeQueryResult(result: ClickHouseQueryResult, format: ExportFormat) {
  const headers = result.meta?.map((column) => column.name) ?? [];
  if (format === "json") return `${JSON.stringify(result.data ?? [], null, 2)}\n`;

  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of result.data ?? []) {
    lines.push(headers.map((header) => escapeCsvCell(row[header])).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function buildExportFilename(database: string, format: ExportFormat, now = new Date()) {
  const safeDatabase = database.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "query";
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  return `${safeDatabase}-${timestamp}.${format}`;
}

export function downloadQueryResult(
  result: ClickHouseQueryResult,
  database: string,
  format: ExportFormat,
) {
  const content = serializeQueryResult(result, format);
  const mime = format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = buildExportFilename(database, format);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function escapeCsvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
