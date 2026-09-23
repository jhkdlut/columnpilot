import { afterEach, describe, expect, it, vi } from "vitest";
import type { LookupAddress } from "node:dns";

const { lookupMock, agentConstructor } = vi.hoisted(() => ({
  lookupMock: vi.fn(async (): Promise<LookupAddress[]> => [{ address: "93.184.216.34", family: 4 }]),
  agentConstructor: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));
vi.mock("undici", async (importOriginal) => ({
  ...await importOriginal<typeof import("undici")>(),
  Agent: agentConstructor,
}));

import { MockAgent } from "undici";
import { clickhouseImport, clickhouseQuery } from "./server";

const realFetch = globalThis.fetch;
const connection = {
  endpoint: "https://clickhouse.example",
  user: "columnpilot",
  password: "test-secret",
  database: "columnpilot",
};
const requestUrl = "https://columnpilot.example/api";
const agents: MockAgent[] = [];
const operations = [
  { name: "query", timeoutMessage: "查询超过时间限制" },
  { name: "import", timeoutMessage: "导入超过时间限制" },
] as const;

function run(name: "query" | "import", timeoutMs = 1_000) {
  return name === "query"
    ? clickhouseQuery(connection, "SELECT 1", requestUrl, { timeoutMs })
    : clickhouseImport(connection, requestUrl, "columnpilot", "events", "CSVWithNames", new TextEncoder().encode("id\n1").buffer, ["id"], { timeoutMs });
}

function createAgent() {
  const agent = new MockAgent();
  agent.disableNetConnect();
  // MockAgent only implements close(); adapt its inherited destroy method to
  // the same lifecycle contract used by the production Agent.
  let closed: Promise<void> | undefined;
  vi.spyOn(agent, "destroy").mockImplementation(() => closed ??= agent.close());
  agents.push(agent);
  agentConstructor.mockImplementation(function () { return agent; });
  return agent;
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(agents.splice(0).map((agent) => agent.destroy()));
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  agentConstructor.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.each(operations)("$name network boundaries", ({ name, timeoutMessage }) => {
  it.each([301, 302, 307, 308].flatMap((status) => [
    { status, destination: "http://127.0.0.1:8123/capture" },
    { status, destination: "http://[::1]:8123/capture" },
  ]))("rejects HTTP $status to $destination without forwarding credentials", async ({ status, destination }) => {
    const agent = createAgent();
    const redirectedRequest = vi.fn(() => ({ statusCode: 200, data: "{}" }));
    const sourceRequest = vi.fn(() => ({ statusCode: status, data: "redirect", responseOptions: { headers: { location: destination } } }));
    agent.get("https://clickhouse.example").intercept({
      path: /.*/,
      method: "POST",
      headers: { "x-clickhouse-key": "test-secret" },
    }).reply(sourceRequest);
    agent.get(new URL(destination).origin).intercept({
      path: "/capture",
      method: /GET|POST/,
    }).reply(redirectedRequest);
    // Exercise the real Fetch redirect implementation through a controlled
    // dispatcher; no test request is permitted onto an external network.
    vi.stubGlobal("fetch", realFetch);

    await expect(run(name)).rejects.toThrow("不允许 HTTP 重定向");

    expect(sourceRequest).toHaveBeenCalledOnce();
    expect(redirectedRequest).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)("times out stalled DNS and ignores its late %s", async (completion) => {
    vi.useFakeTimers();
    let finish!: (addresses: LookupAddress[]) => void;
    let fail!: (error: Error) => void;
    lookupMock.mockReturnValue(new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const assertion = expect(run(name, 25)).rejects.toThrow(timeoutMessage);
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(lookupMock).toHaveBeenCalledOnce();
    expect(agentConstructor).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    if (completion === "resolve") finish([{ address: "93.184.216.34", family: 4 }]);
    else fail(new Error("late DNS failure"));
    await vi.advanceTimersByTimeAsync(100);

    expect(agentConstructor).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses one deadline for DNS and fetching", async () => {
    vi.useFakeTimers();
    const agent = createAgent();
    const destroy = vi.spyOn(agent, "destroy");
    lookupMock.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve([{ address: "93.184.216.34", family: 4 }]), 15);
    }));
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const assertion = expect(run(name, 25)).rejects.toThrow(timeoutMessage);
    await vi.advanceTimersByTimeAsync(15);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10);
    await assertion;

    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the deadline active while reading a stalled response body", async () => {
    vi.useFakeTimers();
    const agent = createAgent();
    const destroy = vi.spyOn(agent, "destroy");
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { body = controller; } }));
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args;
      return response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const assertion = expect(run(name, 25)).rejects.toThrow(timeoutMessage);
    await vi.advanceTimersByTimeAsync(25);
    await assertion;

    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(destroy).toHaveBeenCalledOnce();
    body.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns successful responses and disposes the per-request dispatcher", async () => {
    const agent = createAgent();
    const destroy = vi.spyOn(agent, "destroy");
    const result = name === "query"
      ? { meta: [], data: [{ value: 1 }], rows: 1 }
      : { written_rows: 1, written_bytes: 4 };
    agent.get("https://clickhouse.example").intercept({ path: /.*/, method: "POST" }).reply(
      200,
      name === "query" ? JSON.stringify(result) : "",
      { headers: { "x-clickhouse-summary": JSON.stringify(result) } },
    );
    vi.stubGlobal("fetch", realFetch);

    await expect(run(name)).resolves.toEqual(result);

    expect(destroy).toHaveBeenCalledOnce();
    agent.assertNoPendingInterceptors();
  });
});
