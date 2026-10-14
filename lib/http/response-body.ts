import { RequestError } from "./errors";
import type { fetch as undiciFetch } from "undici";

export async function readResponseText(response: Pick<Response, "body"> | Pick<Awaited<ReturnType<typeof undiciFetch>>, "body">, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new RequestError("响应超过大小限制，请缩小查询范围", 413);
      if (value.byteLength) chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
