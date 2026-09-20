import { describe, expect, it } from "vitest";
import { createImportPreview, parseCsv, type ImportColumn } from "./import-preview";

const columns: ImportColumn[] = [
  { name: "time", type: "DateTime64(3)", position: 1 },
  { name: "device_id", type: "String", position: 2 },
  { name: "value", type: "Float64", position: 3 },
  { name: "ingested_at", type: "DateTime64(3)", position: 4, default_kind: "DEFAULT", default_expression: "now64(3)" },
];

describe("CSV parsing", () => {
  it("supports quoted commas, escaped quotes, and embedded newlines", () => {
    expect(parseCsv('name,message\r\n"device,1","say ""hello""\nnow"')).toEqual([
      ["name", "message"],
      ["device,1", 'say "hello"\nnow'],
    ]);
  });

  it("previews a matching CSVWithNames file", () => {
    const preview = createImportPreview(
      "time,device_id,value\n2026-01-01 00:00:00,DV-1,42.5\n",
      "CSVWithNames",
      columns,
    );
    expect(preview.errors).toEqual([]);
    expect(preview.rowCount).toBe(1);
    expect(preview.headers).toEqual(["time", "device_id", "value"]);
    expect(preview.warnings[0]).toContain("ingested_at");
  });

  it("rejects unknown columns and inconsistent row widths", () => {
    const preview = createImportPreview("time,unknown\n2026-01-01,value,extra\n", "CSVWithNames", columns);
    expect(preview.errors.join(" ")).toMatch(/unknown/);
    expect(preview.errors.join(" ")).toMatch(/预期 2 列/);
  });
});

describe("JSONEachRow preview", () => {
  it("builds a preview from JSON objects", () => {
    const preview = createImportPreview(
      '{"time":"2026-01-01 00:00:00","device_id":"DV-1","value":42.5}\n',
      "JSONEachRow",
      columns,
    );
    expect(preview.errors).toEqual([]);
    expect(preview.rowCount).toBe(1);
    expect(preview.headers).toEqual(["time", "device_id", "value"]);
  });

  it("reports invalid JSON lines", () => {
    const preview = createImportPreview("not-json\n", "JSONEachRow", columns);
    expect(preview.errors[0]).toContain("第 1 行");
  });
});
