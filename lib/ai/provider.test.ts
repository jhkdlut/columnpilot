import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProvider, requireProvider } from "./provider";
import type { PlanInput, ResultSample } from "./types";

const input: PlanInput = { question: "统计记录总数", schema: { database: "demo", table: "readings", engine: "MergeTree", columns: [{ name: "value", type: "Float64", comment: "" }] }, history: [], now: "2026-09-28T00:00:00Z", timezone: "UTC" };
const servers: Server[] = [];
afterEach(async () => {
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

describe("provider configuration and transport", () => {
  it("is disabled by default and labels deterministic simulation", () => {
    vi.stubEnv("COLUMNPILOT_AI_MODE", "disabled");
    expect(getProvider()).toBeNull();
    expect(() => requireProvider()).toThrow(/尚未启用/);
    vi.stubEnv("COLUMNPILOT_AI_MODE", "mock");
    expect(getProvider()?.mode).toBe("mock");
  });
  it.each(["http://local/model", "https://user:pass@example.com/", "https://example.com/?key=secret", "https://example.com/#fragment", "file:///tmp/model"])("rejects unsafe/unapproved configuration %s", (endpoint) => {
    vi.stubEnv("COLUMNPILOT_AI_MODE", "http"); vi.stubEnv("COLUMNPILOT_AI_ENDPOINT", endpoint); vi.stubEnv("COLUMNPILOT_AI_ALLOW_HTTP", "false");
    expect(() => requireProvider()).toThrow();
  });
  it("round-trips the provider-neutral protocol over a real local HTTP connection", async () => {
    const received: { body: Record<string, unknown>; authorization: string | undefined }[] = [];
    const server = createServer(async (request, response) => {
      let text = "";
      for await (const chunk of request) text += chunk;
      const body = JSON.parse(text);
      received.push({ body, authorization: request.headers.authorization });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(body.operation === "plan" ? { kind: "clarification", message: "Which metric?" } : { text: "One returned row." }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server port");
    vi.stubEnv("COLUMNPILOT_AI_MODE", "http"); vi.stubEnv("COLUMNPILOT_AI_ENDPOINT", `http://127.0.0.1:${address.port}/model`);
    vi.stubEnv("COLUMNPILOT_AI_ALLOW_HTTP", "true"); vi.stubEnv("COLUMNPILOT_AI_MODEL", "contract-fixture"); vi.stubEnv("COLUMNPILOT_AI_API_KEY", "test-key");
    const provider = requireProvider();
    expect(await provider.plan(input)).toEqual({ kind: "clarification", message: "Which metric?" });
    const sample: ResultSample = { question: "count", sql: "SELECT count()", parameters: {}, meta: [], rows: [{ metric_1: 1 }], returnedRows: 1, queryTruncated: false, sampleTruncated: false };
    expect(await provider.explain(sample)).toBe("One returned row.");
    expect(received[0].body).toMatchObject({ protocol: "columnpilot.ai.v1", operation: "plan", model: "contract-fixture", input });
    expect(JSON.stringify(received[0].body)).not.toContain("test-key");
    expect(received[0].authorization).toBe("Bearer test-key");
    expect(received[1].body.input).toEqual(sample);
  });
  it.each(["status", "oversize", "malformed"])("bounds and sanitizes %s responses", async (failure) => {
    vi.stubEnv("COLUMNPILOT_AI_MODE", "http"); vi.stubEnv("COLUMNPILOT_AI_ENDPOINT", "https://provider.example/"); vi.stubEnv("COLUMNPILOT_AI_MODEL", "test");
    const fake = vi.fn(async () => failure === "status" ? new Response("secret-provider-message", { status: 401 }) : new Response(failure === "oversize" ? "a".repeat(65537) : "not JSON"));
    vi.stubGlobal("fetch", fake);
    await expect(requireProvider().plan(input)).rejects.toThrow(failure === "status" ? /HTTP 401/ : failure === "oversize" ? /大小限制/ : /格式无效/);
    expect(fake.mock.calls[0]).toBeDefined();
  });
  it("aborts a stalled provider after one bounded attempt", async () => {
    vi.useFakeTimers();
    vi.stubEnv("COLUMNPILOT_AI_MODE", "http"); vi.stubEnv("COLUMNPILOT_AI_ENDPOINT", "https://provider.example/"); vi.stubEnv("COLUMNPILOT_AI_MODEL", "test");
    const fake = vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    vi.stubGlobal("fetch", fake);
    const pending = expect(requireProvider().plan(input)).rejects.toThrow(/30 秒/);
    await vi.advanceTimersByTimeAsync(30_001);
    await pending;
    expect(fake).toHaveBeenCalledOnce();
  });
});
