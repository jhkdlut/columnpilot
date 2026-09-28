import { afterEach, describe, expect, it, vi } from "vitest";
import { signTicket, verifyTicket } from "./tickets";

const connection = { endpoint: "http://db:8123", user: "user", password: "secret", database: "demo" };
afterEach(() => vi.unstubAllEnvs());
describe("preview/result receipts", () => {
  it("binds a receipt to kind, connection and expiry without exposing credentials", async () => {
    const { ticket } = await signTicket("plan", connection, { plan: 1 }, 1000);
    expect(await verifyTicket(ticket, "plan", connection, 2000)).toEqual({ plan: 1 });
    const payload = Buffer.from(ticket.split(".")[0], "base64url").toString();
    expect(payload).not.toContain("secret");
    await expect(verifyTicket(ticket, "result", connection, 2000)).rejects.toThrow();
    await expect(verifyTicket(ticket, "plan", { ...connection, database: "other" }, 2000)).rejects.toThrow();
    await expect(verifyTicket(ticket, "plan", { ...connection, password: "wrong" }, 2000)).rejects.toThrow();
    await expect(verifyTicket(ticket, "plan", connection, 601000)).rejects.toThrow();
  });
  it("rejects modification and signing-key rotation", async () => {
    const { ticket } = await signTicket("plan", connection, { plan: 1 });
    await expect(verifyTicket(`A${ticket.slice(1)}`, "plan", connection)).rejects.toThrow();
    vi.stubEnv("COLUMNPILOT_AI_SIGNING_KEY", "rotated-test-key-with-at-least-32-bytes");
    await expect(verifyTicket(ticket, "plan", connection)).rejects.toThrow();
  });
  it("uses a fresh salt for each password binding", async () => {
    const first = await signTicket("plan", connection, {}, 1000);
    const second = await signTicket("plan", connection, {}, 1000);
    const read = (ticket: string) => JSON.parse(Buffer.from(ticket.split(".")[0], "base64url").toString());
    expect(read(first.ticket).binding).not.toBe(read(second.ticket).binding);
    expect(read(first.ticket).salt).not.toBe(read(second.ticket).salt);
    expect(await verifyTicket(second.ticket, "plan", connection, 2000)).toEqual({});
  });
  it("rejects short deployment secrets", async () => {
    vi.stubEnv("COLUMNPILOT_AI_SIGNING_KEY", "short");
    await expect(signTicket("plan", connection, {})).rejects.toThrow("32");
  });
  it("bounds concurrent password derivations and releases capacity", async () => {
    const first = signTicket("plan", connection, {});
    const second = signTicket("plan", connection, {});
    await expect(signTicket("plan", connection, {})).rejects.toMatchObject({ status: 429 });
    await Promise.all([first, second]);
    await expect(signTicket("plan", connection, {})).resolves.toHaveProperty("ticket");
  });
});
