import { afterEach, describe, expect, it, vi } from "vitest";

const dnsLookupMock = vi.hoisted(() => vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]));

vi.mock("node:dns/promises", () => ({ lookup: dnsLookupMock }));

import {
  assertReadOnly,
  clickhouseImport,
  clickhouseQuery,
  quoteIdentifier,
  sqlString,
  validateConnection,
} from "./server";

const connection = {
  endpoint: "http://localhost:8123",
  user: "columnpilot",
  password: "test",
  database: "columnpilot",
};

afterEach(() => {
  vi.useRealTimers();
  dnsLookupMock.mockReset();
  dnsLookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("validateConnection", () => {
  it("allows a local ClickHouse endpoint from local development", () => {
    expect(validateConnection(connection, "http://localhost:3000/api").hostname).toBe("localhost");
  });

  it.each([
    "https://127.0.0.1:8443",
    "https://10.0.0.2:8443",
    "https://100.64.0.1:8443",
    "https://[::1]:8443",
    "https://[::ffff:7f00:1]:8443",
    "https://[fd00::1]:8443",
  ])("rejects private targets from a non-local deployment: %s", (endpoint) => {
    expect(() => validateConnection({ ...connection, endpoint }, "https://columnpilot.example/api")).toThrow(/不能访问本机或内网/);
  });

  it("requires HTTPS for a public non-local endpoint", () => {
    expect(() => validateConnection({ ...connection, endpoint: "http://clickhouse.example" }, "https://columnpilot.example/api")).toThrow(/仅连接 HTTPS/);
  });

  it("does not trust a loopback Host header in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => validateConnection(connection, "http://localhost:3000/api")).toThrow(/仅连接 HTTPS/);
  });

  it("allows an explicitly configured private target in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COLUMNPILOT_ALLOW_PRIVATE_TARGETS", "true");
    expect(validateConnection(connection, "http://columnpilot.internal/api").hostname).toBe("localhost");
  });

  it.each([
    "https://192.0.2.1:8443",
    "https://198.51.100.2:8443",
    "https://203.0.113.3:8443",
    "https://[2001:db8::1]:8443",
  ])("rejects reserved targets from a non-local deployment: %s", (endpoint) => {
    expect(() => validateConnection({ ...connection, endpoint }, "https://columnpilot.example/api")).toThrow(/不能访问本机或内网/);
  });
});

describe("SQL safety helpers", () => {
  it.each([
    "SELECT 1",
    "-- comment\nSELECT ';' AS value;",
    "WITH source AS (SELECT 1 AS value) SELECT value FROM source",
    "SHOW TABLES",
    "DESCRIBE TABLE columnpilot.sensor_readings",
    "EXPLAIN SELECT 1",
  ])("accepts a read-only statement: %s", (sql) => {
    expect(() => assertReadOnly(sql)).not.toThrow();
  });

  it.each([
    "INSERT INTO events VALUES (1)",
    "WITH source AS (SELECT 1) DELETE FROM events WHERE id = 1",
    "SELECT 1; DROP TABLE events",
    "SELECT 1 INTO OUTFILE '/tmp/result.csv'",
  ])("rejects a write-capable statement: %s", (sql) => {
    expect(() => assertReadOnly(sql)).toThrow();
  });

  it("escapes identifiers and string literals", () => {
    expect(quoteIdentifier("events`archive")).toBe("`events``archive`");
    expect(sqlString("owner's \\ path")).toBe("'owner\\'s \\\\ path'");
  });
});

describe("clickhouseQuery", () => {
  it("enforces ClickHouse readonly mode", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return new Response(JSON.stringify({ meta: [], data: [], rows: 0 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await clickhouseQuery(connection, "SELECT 1", "http://localhost:3000/api");

    const endpoint = fetchMock.mock.calls[0][0] as URL;
    expect(endpoint.searchParams.get("readonly")).toBe("1");
    expect(endpoint.searchParams.get("max_result_rows")).toBe("500");
  });

  it("rejects a public hostname when DNS includes a private address", async () => {
    dnsLookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(clickhouseQuery(
      { ...connection, endpoint: "https://clickhouse.example" },
      "SELECT 1",
      "https://columnpilot.example/api",
    )).rejects.toThrow(/解析到本机或内网/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pins a public hostname to its validated DNS results", async () => {
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args;
      return new Response(JSON.stringify({ meta: [], data: [], rows: 0 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await clickhouseQuery(
      { ...connection, endpoint: "https://clickhouse.example" },
      "SELECT 1",
      "https://columnpilot.example/api",
    );

    expect(dnsLookupMock).toHaveBeenCalledWith("clickhouse.example", { all: true, verbatim: true });
    const requestOptions = fetchMock.mock.calls[0][1] as RequestInit & { dispatcher?: unknown };
    expect(requestOptions.dispatcher).toBeDefined();
  });
});

describe("clickhouseImport", () => {
  it("aborts imports that exceed the configured timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })
    ));
    vi.stubGlobal("fetch", fetchMock);

    const importPromise = clickhouseImport(
      connection,
      "http://localhost:3000/api",
      "columnpilot",
      "events",
      "CSVWithNames",
      new TextEncoder().encode("id\n1").buffer,
      ["id"],
      { timeoutMs: 25 },
    );
    const assertion = expect(importPromise).rejects.toThrow("导入超过时间限制");

    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
