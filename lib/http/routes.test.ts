import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MAX_IMPORT_BYTES } from "../clickhouse/import-preview";
import { MAX_JSON_BODY_BYTES, MULTIPART_OVERHEAD_BYTES } from "./request-body";

const { query, write } = vi.hoisted(() => ({ query: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/clickhouse/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("../clickhouse/server")>(),
  clickhouseQuery: query,
  clickhouseImport: write,
}));
import { POST as queryRoute } from "../../app/api/clickhouse/route";
import { POST as importRoute } from "../../app/api/clickhouse/import/route";

const connection = { endpoint: "http://clickhouse:8123", user: "test", password: "test", database: "test" };

beforeEach(() => {
  query.mockReset().mockResolvedValue({ data: [{ name: "id", type: "UInt32", position: 1 }] });
  write.mockReset().mockResolvedValue({ written_rows: 1 });
});

function jsonRequest(sql: string) {
  return new NextRequest("http://localhost/api/clickhouse", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "query", connection, sql }),
  });
}

function upload(size?: number) {
  const form = new FormData();
  form.set("connection", JSON.stringify(connection));
  form.set("table", "events");
  form.set("file", new File([size ? new Uint8Array(size) : "id\n1\n"], "sample.csv"));
  return new NextRequest("http://localhost/api/clickhouse/import", { method: "POST", body: form });
}

describe("API request limits", () => {
  it("returns 413 for oversized SQL without contacting ClickHouse", async () => {
    const response = await queryRoute(jsonRequest(`SELECT '${"a".repeat(64 * 1024)}'`));
    expect(response.status).toBe(413);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 413 before JSON parsing for a large request envelope", async () => {
    const response = await queryRoute(jsonRequest(" ".repeat(MAX_JSON_BODY_BYTES + 1)));
    expect(response.status).toBe(413);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([undefined, "1"])("rejects an oversized streamed upload with declared length %s", async (length) => {
    const cancel = vi.fn();
    let pulls = 0;
    const request = new NextRequest("http://localhost/api/clickhouse/import", {
      method: "POST", duplex: "half",
      headers: length ? { "content-length": length } : {},
      body: new ReadableStream({
        pull(controller) {
          pulls++;
          controller.enqueue(new Uint8Array(MAX_IMPORT_BYTES + MULTIPART_OVERHEAD_BYTES + 1));
        }, cancel,
      }, { highWaterMark: 0 }),
    } as ConstructorParameters<typeof NextRequest>[1]);
    expect((await importRoute(request)).status).toBe(413);
    expect(pulls).toBe(1);
    expect(cancel).toHaveBeenCalledOnce();
    expect(query).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("rejects files over 8 MiB even when the envelope is within its allowance", async () => {
    expect((await importRoute(upload(MAX_IMPORT_BYTES + 1))).status).toBe(413);
    expect(query).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("accepts a file exactly 8 MiB within the multipart envelope allowance", async () => {
    const contents = JSON.stringify({ id: "a".repeat(MAX_IMPORT_BYTES - 9) });
    expect(new TextEncoder().encode(contents).byteLength).toBe(MAX_IMPORT_BYTES);
    const form = new FormData();
    form.set("connection", JSON.stringify(connection));
    form.set("table", "events");
    form.set("format", "JSONEachRow");
    form.set("file", new File([contents], "sample.jsonl"));
    expect((await importRoute(new NextRequest("http://localhost/api/clickhouse/import", { method: "POST", body: form }))).status).toBe(200);
    expect(write).toHaveBeenCalledOnce();
  });

  it("keeps valid query and CSV import behavior", async () => {
    expect((await queryRoute(jsonRequest("SELECT 1"))).status).toBe(200);
    const response = await importRoute(upload());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, summary: { written_rows: 1 } });
    expect(write).toHaveBeenCalledOnce();
  });

  it("returns a controlled error for malformed JSON", async () => {
    const request = new NextRequest("http://localhost/api/clickhouse", { method: "POST", body: "{" });
    expect((await queryRoute(request)).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});
