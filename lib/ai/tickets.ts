import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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
function binding(connection: ClickHouseConnection) { return mac(JSON.stringify([connection.endpoint, connection.user, connection.password ?? "", connection.database])); }

export function signTicket(kind: "plan" | "result", connection: ClickHouseConnection, data: unknown, now = Date.now()) {
  const expires = now + 10 * 60_000;
  const payload = Buffer.from(JSON.stringify({ kind, binding: binding(connection), expires, data })).toString("base64url");
  if (payload.length > 160 * 1024) throw new RequestError("查询凭据过大，请缩小上下文", 413);
  return { ticket: `${payload}.${mac(payload)}`, expiresAt: new Date(expires).toISOString() };
}

export function verifyTicket<T>(ticket: unknown, kind: "plan" | "result", connection: ClickHouseConnection, now = Date.now()): T {
  const invalid = () => new RequestError("查询凭据无效或已过期，请重新生成方案", 409);
  if (typeof ticket !== "string" || ticket.length > 165 * 1024) throw invalid();
  const pieces = ticket.split(".");
  if (pieces.length !== 2) throw invalid();
  const expected = Buffer.from(mac(pieces[0]));
  const actual = Buffer.from(pieces[1]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalid();
  const payload = object(JSON.parse(Buffer.from(pieces[0], "base64url").toString()));
  if (payload.kind !== kind || payload.binding !== binding(connection) || typeof payload.expires !== "number" || payload.expires <= now) throw invalid();
  return payload.data as T;
}
