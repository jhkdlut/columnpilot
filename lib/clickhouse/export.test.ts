import { describe, expect, it } from "vitest";
import { buildExportFilename, serializeQueryResult } from "./export";
import type { ClickHouseQueryResult } from "./types";

const result: ClickHouseQueryResult = {
  meta: [
    { name: "device", type: "String" },
    { name: "message", type: "String" },
    { name: "value", type: "Nullable(Float64)" },
  ],
  data: [
    { device: "DV-1", message: 'comma, quote " and\nnewline', value: null },
  ],
  rows: 1,
};

describe("query result export", () => {
  it("serializes an Excel-friendly CSV", () => {
    const csv = serializeQueryResult(result, "csv");
    expect(csv.startsWith("\uFEFFdevice,message,value\r\n")).toBe(true);
    expect(csv).toContain('DV-1,"comma, quote "" and\nnewline",');
  });

  it("serializes JSON with a trailing newline", () => {
    const json = serializeQueryResult(result, "json");
    expect(JSON.parse(json)).toEqual(result.data);
    expect(json.endsWith("\n")).toBe(true);
  });

  it("builds a filesystem-safe filename", () => {
    expect(buildExportFilename("analytics/prod", "csv", new Date("2026-09-20T08:00:00.000Z")))
      .toBe("analytics-prod-2026-09-20T08-00-00-000Z.csv");
  });
});
