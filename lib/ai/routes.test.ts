import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { query, providerPlan, providerExplain } = vi.hoisted(() => ({ query: vi.fn(), providerPlan: vi.fn(), providerExplain: vi.fn() }));
vi.mock("../clickhouse/server", async (original) => ({ ...await original<typeof import("../clickhouse/server")>(), clickhouseQuery: query }));
vi.mock("./provider", () => ({
  requireProvider: () => ({ plan: providerPlan, explain: providerExplain }),
  getProvider: () => ({ mode: "mock", model: "fixtures" }),
}));
import { GET, POST } from "../../app/api/ai/route";
import { mockPlan } from "./mock-provider";
import { verifyTicket } from "./tickets";
import type { ResultSample } from "./types";

const connection = { endpoint: "http://clickhouse:8123", user: "test", password: "secret-db", database: "test" };
const columns = [{ name: "device_id", type: "String", comment: "" }, { name: "value", type: "Float64", comment: "" }, { name: "time", type: "DateTime64(3, 'UTC')", comment: "" }];
let engine = "MergeTree";
let data: Record<string, unknown>[] = [];
let resultColumns = columns;
async function post(body: Record<string, unknown>) {
  const response = await POST(new NextRequest("http://localhost/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connection, ...body }) }));
  return { status: response.status, body: await response.json() };
}
async function preview(question = "查看前 20 条记录") {
  const response = await post({ action: "plan", table: "readings", question });
  expect(response.status).toBe(200);
  return response.body.result;
}
beforeEach(() => {
  engine = "MergeTree"; data = []; resultColumns = columns;
  query.mockReset().mockImplementation(async (_connection, sql: string) => {
    if (sql.includes("SELECT engine FROM")) return { data: [{ engine }] };
    if (sql.includes("FROM system.columns")) return { data: resultColumns };
    if (sql.includes("LIMIT 0")) return { data: [], meta: [] };
    return { data, meta: columns, statistics: { elapsed: 0.01 } };
  });
  providerPlan.mockReset().mockImplementation(mockPlan);
  providerExplain.mockReset().mockResolvedValue("基于已执行查询的解释");
});
afterEach(() => vi.restoreAllMocks());

describe("AI route boundaries", () => {
  it("exposes status without credentials and never caches it", async () => {
    const response = GET();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("secret");
  });
  it("generates then executes only on request, sharing no result rows during planning", async () => {
    const planned = await preview();
    expect(query.mock.calls.every((call) => /system\.|LIMIT 0/.test(call[1]))).toBe(true);
    const modelInput = JSON.stringify(providerPlan.mock.calls[0]);
    expect(modelInput).not.toContain("secret-db");
    expect(modelInput).not.toContain("endpoint");
    data = [{ device_id: "a", value: 4 }];
    const executed = await post({ action: "execute", ticket: planned.ticket });
    expect(executed.status).toBe(200);
    expect(executed.body.result.result.data).toEqual(data);
    expect(providerExplain).not.toHaveBeenCalled();
    expect(query.mock.calls.at(-1)?.[3]).toMatchObject({ maxResponseBytes: 2 * 1024 * 1024, maxRows: 21 });
  });
  it("rejects raw SQL, provider address overrides and unknown actions", async () => {
    for (const body of [{ action: "execute", sql: "DELETE FROM readings" }, { action: "plan", endpoint: "http://internal" }, { action: "delete" }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects tampered receipts before database access", async () => {
    const planned = await preview(); query.mockClear();
    expect((await post({ action: "execute", ticket: `A${planned.ticket.slice(1)}` })).status).toBe(409);
    expect(query).not.toHaveBeenCalled();
  });
  it("requires a new preview when schema changes", async () => {
    const planned = await preview();
    resultColumns = [...columns, { name: "new_field", type: "String", comment: "" }];
    expect((await post({ action: "execute", ticket: planned.ticket })).status).toBe(409);
  });
  it.each(["URL", "Distributed", "View", "MaterializedView", "Dictionary"])("rejects %s engine before provider invocation", async (name) => {
    engine = name;
    expect((await post({ action: "plan", table: "external", question: "统计记录总数" })).status).toBe(400);
    expect(providerPlan).not.toHaveBeenCalled();
  });
  it("checks database permissions before sharing schema", async () => {
    query.mockImplementation(async (_connection, sql: string) => {
      if (sql.includes("SELECT engine")) return { data: [{ engine }] };
      throw new Error("permission denied, secret-db");
    });
    const response = await post({ action: "plan", table: "readings", question: "统计记录总数" });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain("secret-db");
    expect(providerPlan).not.toHaveBeenCalled();
  });
  it("marks row truncation accurately using the extra row", async () => {
    const planned = await preview("查看前 2 条记录");
    data = [{ value: 1 }, { value: 2 }, { value: 3 }];
    const response = await post({ action: "execute", ticket: planned.ticket });
    expect(response.body.result.truncated).toBe(true);
    expect(response.body.result.result.data).toHaveLength(2);
    expect(response.body.result.result.rows).toBe(2);
  });
  it("binds explanations to real results, consent and bounded samples", async () => {
    const planned = await preview("查看前 100 条记录");
    data = Array.from({ length: 100 }, () => ({ device_id: "a".repeat(8000), value: 1 }));
    const executed = (await post({ action: "execute", ticket: planned.ticket })).body.result;
    const sample = await verifyTicket<ResultSample>(executed.explanationTicket, "result", connection);
    expect(sample.rows.length).toBeLessThanOrEqual(20);
    expect(Buffer.byteLength(JSON.stringify(sample))).toBeLessThanOrEqual(64 * 1024);
    expect(sample.sampleTruncated).toBe(true);
    expect((await post({ action: "explain", ticket: executed.explanationTicket })).status).toBe(400);
    expect(providerExplain).not.toHaveBeenCalled();
    expect((await post({ action: "explain", ticket: planned.ticket, consent: true })).status).toBe(409);
    expect((await post({ action: "explain", ticket: executed.explanationTicket, consent: true })).status).toBe(200);
    expect(providerExplain).toHaveBeenCalledWith(sample);
  });
  it("rejects large request bodies before parsing or DB access", async () => {
    expect((await post({ action: "plan", question: "a".repeat(256 * 1024) })).status).toBe(413);
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects malformed model output and cross-table history", async () => {
    providerPlan.mockResolvedValueOnce({ kind: "plan", plan: { sql: "SELECT 1" } });
    expect((await post({ action: "plan", table: "readings", question: "统计记录总数" })).status).toBe(400);
    const planned = await preview();
    expect((await post({ action: "plan", table: "readings", question: "改为最近 30 天", history: [{ question: "previous", plan: { ...planned.plan, table: "other" } }] })).status).toBe(400);
  });
});
