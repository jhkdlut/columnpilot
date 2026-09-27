import { afterEach, describe, expect, it, vi } from "vitest";
import { readBoundedBody, readBoundedFormData, readBoundedJson, REQUEST_BODY_TIMEOUT_MS } from "./request-body";

function streamed(chunks: Uint8Array[], headers: HeadersInit = {}, signal?: AbortSignal) {
  let index = 0;
  const cancel = vi.fn();
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (index < chunks.length) controller.enqueue(chunks[index++]);
    else controller.close();
  });
  const body = new ReadableStream({ pull, cancel }, { highWaterMark: 0 });
  const request = new Request("http://localhost/api", {
    method: "POST", body, headers, signal, duplex: "half",
  } as RequestInit);
  return { request, cancel, pull };
}

afterEach(() => vi.useRealTimers());

describe("bounded request bodies", () => {
  it("accepts the exact byte limit across chunks, including empty chunks", async () => {
    const { request } = streamed([new Uint8Array(0), new Uint8Array([1, 2]), new Uint8Array([3, 4])]);
    expect(await readBoundedBody(request, 4)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(request.body?.locked).toBe(false);
  });

  it.each([{}, { "content-length": "1" }] as HeadersInit[])("rejects actual streamed overflow even with headers %j", async (headers) => {
    const { request, cancel, pull } = streamed([new Uint8Array(4), new Uint8Array(1), new Uint8Array(100)], headers);
    await expect(readBoundedBody(request, 4)).rejects.toMatchObject({ status: 413 });
    expect(pull).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(request.body?.locked).toBe(false);
  });

  it.each(["5", "99999999999999999999999999"])("rejects declared overflow %s before reading", async (length) => {
    const { request, cancel, pull } = streamed([new Uint8Array(1)], { "content-length": length });
    await expect(readBoundedBody(request, 4)).rejects.toMatchObject({ status: 413 });
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(["-1", "1.5", "invalid"])("rejects malformed declared length %s", async (length) => {
    const { request, pull } = streamed([], { "content-length": length });
    await expect(readBoundedBody(request, 4)).rejects.toMatchObject({ status: 400 });
    expect(pull).not.toHaveBeenCalled();
  });

  it("times out stalled bodies even if cancellation never settles", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const request = new Request("http://localhost/api", {
      method: "POST", body: new ReadableStream({ cancel }), duplex: "half",
    } as RequestInit);
    const assertion = expect(readBoundedBody(request, 4)).rejects.toMatchObject({ status: 408 });
    await vi.advanceTimersByTimeAsync(REQUEST_BODY_TIMEOUT_MS);
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
    expect(request.body?.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops reading when the client disconnects", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const request = new Request("http://localhost/api", {
      method: "POST", body: new ReadableStream({ cancel }), signal: controller.signal, duplex: "half",
    } as RequestInit);
    const assertion = expect(readBoundedBody(request, 4)).rejects.toMatchObject({ status: 408 });
    controller.abort();
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("counts UTF-8 bytes rather than characters", async () => {
    const { request } = streamed([new TextEncoder().encode("汉字")]);
    await expect(readBoundedBody(request, 5)).rejects.toMatchObject({ status: 413 });
  });

  it("parses valid bounded JSON and rejects malformed input", async () => {
    expect(await readBoundedJson(new Request("http://localhost", { method: "POST", body: '{"action":"ping"}' }))).toEqual({ action: "ping" });
    await expect(readBoundedJson(new Request("http://localhost", { method: "POST", body: "{" }))).rejects.toThrow();
  });

  it("preserves multipart boundaries and file contents", async () => {
    const form = new FormData();
    form.set("file", new File(["id\n1\n"], "sample.csv"));
    form.set("table", "events");
    const parsed = await readBoundedFormData(new Request("http://localhost", { method: "POST", body: form }), 8);
    expect(parsed.get("table")).toBe("events");
    expect(await (parsed.get("file") as File).text()).toBe("id\n1\n");
  });
});
