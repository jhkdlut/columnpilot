import { describe, expect, it } from "vitest";
import { updateQueryHistory, type QueryHistoryItem } from "./query-history";

function entry(id: string, sql = `SELECT ${id}`): QueryHistoryItem {
  return { id, sql, executedAt: "2026-09-20T00:00:00.000Z", elapsedMs: 12, rows: 1 };
}

describe("updateQueryHistory", () => {
  it("places the latest query first and trims whitespace", () => {
    expect(updateQueryHistory([entry("1")], entry("2", "  SELECT 2\n"))).toEqual([
      entry("2", "SELECT 2"),
      entry("1"),
    ]);
  });

  it("deduplicates matching SQL and keeps the latest metadata", () => {
    const previous = entry("old", "SELECT 1");
    const latest = { ...entry("new", "SELECT 1"), rows: 42 };
    expect(updateQueryHistory([previous, entry("2")], latest)).toEqual([latest, entry("2")]);
  });

  it("enforces the configured history limit", () => {
    const current = [entry("1"), entry("2"), entry("3")];
    expect(updateQueryHistory(current, entry("4"), 3).map((item) => item.id)).toEqual(["4", "1", "2"]);
  });

  it("ignores empty SQL", () => {
    const current = [entry("1")];
    expect(updateQueryHistory(current, entry("empty", "   "))).toBe(current);
  });
});
