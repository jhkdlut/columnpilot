import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { RequestError } from "../http/errors";
import { object } from "./validation";
import type { ClickHouseConnection } from "../clickhouse/types";

const processKey = randomBytes(32);
function key() {
  const configured = process.env.COLUMNPILOT_AI_SIGNING_KEY;
  if (configured && Buffer.byteLength(configured) < 32) throw new RequestError("AI 签名密钥至少需要 32 字节", 503);
  return configured || processKey;
}
function mac(value: string) { return createHmac("sha256", key()).update(value).digest("base64url"); }
let activeBindings = 0;
async function binding(connection: ClickHouseConnection, salt: string) {
  if (activeBindings >= 2) throw new RequestError("查询凭据服务繁忙，请稍后重试", 429);
  const context = mac(JSON.stringify([connection.endpoint, connection.user, connection.database, salt]));
  activeBindings++;
  try {
    return await new Promise<string>((resolve, reject) => {
      scrypt(connection.password ?? "", context, 32, { N: 16384, r: 8, p: 1 }, (error, derived) => {
        if (error) reject(error); else resolve(derived.toString("base64url"));
      });
    });
  } finally { activeBindings--; }
}

export async function signTicket(kind: "plan" | "result", connection: ClickHouseConnection, data: unknown, now = Date.now()) {
  const expires = now + 10 * 60_000;
  const salt = randomBytes(16).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ kind, salt, binding: await binding(connection, salt), expires, data })).toString("base64url");
  if (payload.length > 160 * 1024) throw new RequestError("查询凭据过大，请缩小上下文", 413);
  return { ticket: `${payload}.${mac(payload)}`, expiresAt: new Date(expires).toISOString() };
}

export async function verifyTicket<T>(ticket: unknown, kind: "plan" | "result", connection: ClickHouseConnection, now = Date.now()): Promise<T> {
  const invalid = () => new RequestError("查询凭据无效或已过期，请重新生成方案", 409);
  if (typeof ticket !== "string" || ticket.length > 165 * 1024) throw invalid();
  const pieces = ticket.split(".");
  if (pieces.length !== 2) throw invalid();
  const expected = Buffer.from(mac(pieces[0]));
  const actual = Buffer.from(pieces[1]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalid();
  const payload = object(JSON.parse(Buffer.from(pieces[0], "base64url").toString()));
  if (payload.kind !== kind || typeof payload.expires !== "number" || payload.expires <= now || typeof payload.salt !== "string" || payload.salt.length !== 22 || typeof payload.binding !== "string") throw invalid();
  const expectedBinding = Buffer.from(await binding(connection, payload.salt));
  const actualBinding = Buffer.from(payload.binding);
  if (expectedBinding.length !== actualBinding.length || !timingSafeEqual(expectedBinding, actualBinding)) throw invalid();
  return payload.data as T;
}
