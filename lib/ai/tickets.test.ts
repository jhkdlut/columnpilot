import { afterEach, describe, expect, it, vi } from "vitest";
import { signTicket, verifyTicket } from "./tickets";

const connection = { endpoint: "http://db:8123", user: "user", password: "secret", database: "demo" };
afterEach(() => vi.unstubAllEnvs());
describe("preview/result receipts", () => {
  it("binds a receipt to kind, connection and expiry without exposing credentials", () => {
    const { ticket } = signTicket("plan", connection, { plan: 1 }, 1000);
    expect(verifyTicket(ticket, "plan", connection, 2000)).toEqual({ plan: 1 });
    const payload = Buffer.from(ticket.split(".")[0], "base64url").toString();
    expect(payload).not.toContain("secret");
    expect(() => verifyTicket(ticket, "result", connection, 2000)).toThrow();
    expect(() => verifyTicket(ticket, "plan", { ...connection, database: "other" }, 2000)).toThrow();
    expect(() => verifyTicket(ticket, "plan", { ...connection, password: "wrong" }, 2000)).toThrow();
    expect(() => verifyTicket(ticket, "plan", connection, 601000)).toThrow();
  });
  it("rejects modification and signing-key rotation", () => {
    const { ticket } = signTicket("plan", connection, { plan: 1 });
    expect(() => verifyTicket(`A${ticket.slice(1)}`, "plan", connection)).toThrow();
    vi.stubEnv("COLUMNPILOT_AI_SIGNING_KEY", "rotated");
    expect(() => verifyTicket(ticket, "plan", connection)).toThrow();
  });
});
