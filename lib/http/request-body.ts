import { RequestError } from "./errors";

export const MAX_JSON_BODY_BYTES = 256 * 1024;
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
export const REQUEST_BODY_TIMEOUT_MS = 30_000;

// Count bytes before JSON/multipart parsing. Content-Length is only an early
// rejection hint: missing or understated lengths never bypass the stream cap.
export async function readBoundedBody(request: Request, maxBytes: number) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)) {
    void request.body?.cancel().catch(() => {});
    throw new RequestError("请求体超过允许大小或 Content-Length 无效", /^\d+$/.test(declaredLength) ? 413 : 400);
  }
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const deadline = Date.now() + REQUEST_BODY_TIMEOUT_MS;
  let rejectStopped!: (error: RequestError) => void;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
  const stop = (error: RequestError) => {
    rejectStopped(error);
    // Do not wait for an uncooperative producer's cancel() promise.
    void reader.cancel(error).catch(() => {});
  };
  const aborted = () => stop(new RequestError("请求已取消", 408));
  const timeout = setTimeout(() => stop(new RequestError("读取请求体超时", 408)), REQUEST_BODY_TIMEOUT_MS);
  request.signal.addEventListener("abort", aborted, { once: true });
  if (request.signal.aborted) aborted();

  const consume = async () => {
    let buffer = new Uint8Array(Math.min(maxBytes, 64 * 1024));
    let size = 0;
    while (true) {
      if (Date.now() >= deadline) throw new RequestError("读取请求体超时", 408);
      const { done, value } = await reader.read();
      if (done) break;
      const nextSize = size + value.byteLength;
      if (nextSize > maxBytes) throw new RequestError("请求体超过允许大小", 413);
      if (nextSize > buffer.byteLength) {
        const expanded = new Uint8Array(Math.min(maxBytes, Math.max(nextSize, buffer.byteLength * 2)));
        expanded.set(buffer.subarray(0, size));
        buffer = expanded;
      }
      buffer.set(value, size);
      size = nextSize;
    }
    return buffer.subarray(0, size);
  };

  try {
    return await Promise.race([stopped, consume()]);
  } catch (error) {
    void reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", aborted);
    reader.releaseLock();
  }
}

export async function readBoundedJson(request: Request) {
  const body = await readBoundedBody(request, MAX_JSON_BODY_BYTES);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
}

export async function readBoundedFormData(request: Request, maxFileBytes: number) {
  const body = await readBoundedBody(request, maxFileBytes + MULTIPART_OVERHEAD_BYTES);
  return new Response(body, {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  }).formData();
}
