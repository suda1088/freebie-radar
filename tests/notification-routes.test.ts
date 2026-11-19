import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Hono } from "hono";
process.env.DATABASE_PATH = ":memory:";
process.env.SITE_AUTH_ENABLED = "true";
process.env.SITE_PASSWORD = "fixture-only-password";
process.env.SITE_ORIGIN = "https://example.test";
const { migrate, closeDb } = await import("../src/server/db.ts");
const { registerSiteAuth } = await import("../src/server/site-auth.ts");
const { registerApi } = await import("../src/server/routes.ts");
migrate();
const app = new Hono();
registerSiteAuth(app, { enabled: true, password: "fixture-only-password", origin: "https://example.test" });
registerApi(app);
after(() => closeDb());
test("notification routes require session/origin, explicit saved-channel confirmation and bounded bodies without sending", async () => {
  const originalFetch = globalThis.fetch;
  let network = 0;
  globalThis.fetch = (async () => { network++; throw new Error("network forbidden"); }) as typeof fetch;
  try {
    assert.equal((await app.request("https://example.test/api/notifications")).status, 401);
    const login = await app.request("https://example.test/auth/login", { method: "POST", headers: { origin: "https://example.test", "content-type": "application/x-www-form-urlencoded" }, body: "password=fixture-only-password" });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const headers = { cookie, origin: "https://example.test", "content-type": "application/json" };
    const current = await app.request("https://example.test/api/notifications", { headers });
    assert.equal(current.status, 200);
    const dto = await current.json();
    assert.equal(dto.channel, "none"); assert.equal(dto.encryptionReady, false);
    assert.equal(dto.telegram.botTokenConfigured, false);
    assert.equal(current.headers.get("cache-control")?.includes("no-store"), true);
    assert.equal((await app.request("https://example.test/api/notifications", { method: "PATCH", headers: { ...headers, origin: "https://evil.test" }, body: '{"channel":"none"}' })).status, 403);
    assert.equal((await app.request("https://example.test/api/notifications", { method: "PATCH", headers, body: '{"channel":"none"}' })).status, 200);
    assert.equal((await app.request("https://example.test/api/notifications", { method: "PATCH", headers, body: JSON.stringify({ arbitrary: "x".repeat(9000) }) })).status, 400);
    assert.equal((await app.request("https://example.test/api/notifications", { method: "PATCH", headers, body: '{"apiBase":"http://127.0.0.1"}' })).status, 400);
    for (const body of [{}, { confirmed: true, channel: "qqbot" }, { confirmed: true, channel: "none", unknown: true }]) {
      assert.equal((await app.request("https://example.test/api/notifications/test", { method: "POST", headers, body: JSON.stringify(body) })).status, 400);
    }
    assert.equal((await app.request("https://example.test/api/ai/backfill", { method: "POST", headers, body: '{"limit":20}' })).status, 400);
    assert.equal((await app.request("https://example.test/api/ai/backfill", { method: "POST", headers, body: '{"limit":500,"confirmed":true}' })).status, 400);
    assert.equal(network, 0);
  } finally { globalThis.fetch = originalFetch; }
});