import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Hono } from "hono";
import { registerSiteAuth, type SiteAuthOptions } from "../src/server/site-auth.ts";

process.env.DATABASE_PATH = ":memory:";
process.env.SITE_AUTH_ENABLED = "true";
process.env.ADMIN_TOKEN = "legacy-admin-not-site-password";
process.env.PUSH_CHANNEL = "none";
const { registerApi } = await import("../src/server/routes.ts");
const { migrate, closeDb } = await import("../src/server/db.ts");
migrate();
after(closeDb);

const password = "test-only-password-not-for-deployment";
function fixture(overrides: Partial<SiteAuthOptions> = {}) {
  const app = new Hono();
  registerSiteAuth(app, { enabled: true, password, ...overrides });
  registerApi(app);
  app.get("/assets/app.js", (c) => { c.header("Cache-Control", "public, immutable"); return c.text("secret-js"); });
  app.get("/favicon.svg", (c) => c.text("secret-icon"));
  app.get("/", (c) => c.html("private-app"));
  return app;
}
function login(app: Hono, value = password, extra: Record<string, string> = {}) {
  return app.request("/auth/login", { method: "POST", headers: {
    origin: "http://localhost", "content-type": "application/x-www-form-urlencoded", ...extra,
  }, body: new URLSearchParams({ password: value }).toString() });
}
function cookie(response: Response) {
  const value = response.headers.get("set-cookie");
  assert.ok(value);
  return value.split(";")[0]!;
}

test("whole site denies HTML, APIs, static assets and bearer/query bypasses", async () => {
  const app = fixture();
  const html = await app.request("/", { headers: { accept: "text/html" } });
  assert.equal(html.status, 401);
  assert.match(await html.text(), /访问密码/);
  for (const path of ["/api/items", "/api/auth/check", "/api/push", "/api/ingest/keywords", "/assets/app.js", "/favicon.svg", "/?token=" + password]) {
    const response = await app.request(path, { headers: { authorization: "Bearer legacy-admin-not-site-password" } });
    assert.equal(response.status, 401, path);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.doesNotMatch(await response.text(), /private-app|secret-js|secret-icon/);
  }
  assert.deepEqual(await (await app.request("/health")).json(), { ok: true });
});

test("wrong password, bounded request body, correct login, native admin read/write and logout revocation", async () => {
  const app = fixture();
  assert.equal((await login(app, "wrong")).status, 401);
  assert.equal((await login(app, "x".repeat(5000))).status, 413);
  const response = await login(app);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/");
  const set = response.headers.get("set-cookie")!;
  assert.match(set, /HttpOnly/i);
  assert.match(set, /SameSite=Strict/i);
  assert.match(set, /Max-Age=43200/i);
  assert.doesNotMatch(set, /Secure|test-only/);
  const session = cookie(response);
  assert.match(session, /^radar_session=[a-f0-9]{64}$/);
  const headers = { cookie: session };
  assert.equal(await (await app.request("/", { headers })).text(), "private-app");
  const asset = await app.request("/assets/app.js", { headers });
  assert.equal(await asset.text(), "secret-js");
  assert.match(asset.headers.get("cache-control")!, /private, no-store/);
  assert.equal((await app.request("/api/push", { headers })).status, 200);
  assert.equal((await app.request("/api/auth/check", { headers })).status, 200);
  assert.deepEqual(await (await app.request("/api/auth/check", { headers })).json(), {
    ok: true, protected: true, siteProtected: true, authenticated: true,
  });
  // Real native admin write route: validation runs only after successful session authentication.
  const write = await app.request("/api/push/test", { method: "POST", headers: { ...headers, origin: "http://localhost" } });
  assert.equal(write.status, 400); // Telegram is intentionally not configured in this test.
  const logout = await app.request("/auth/logout", { method: "POST", headers: { ...headers, origin: "http://localhost" } });
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get("set-cookie")!, /Max-Age=0/i);
  assert.equal((await app.request("/api/push", { headers })).status, 401);
});

test("login, logout and all session writes reject absent/cross-site origins", async () => {
  const app = fixture();
  for (const origin of ["", "null", "https://evil.example", "http://localhost.evil.example"]) {
    assert.equal((await login(app, password, { origin })).status, 403);
  }
  const headers = { cookie: cookie(await login(app)) };
  for (const path of ["/auth/logout", "/api/push/test", "/api/items/1", "/unknown-future-endpoint"]) {
    for (const origin of ["", "https://evil.example"]) {
      assert.equal((await app.request(path, { method: "POST", headers: { ...headers, origin } })).status, 403);
    }
  }
  assert.equal((await login(app, password, { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await app.request("/api/push", { headers })).status, 200); // failed logout didn't revoke
});

test("expiry, rotation, forged cookies and restart", async () => {
  let time = 1000;
  const app = fixture({ now: () => time, sessionTtlMs: 1000 });
  const old = cookie(await login(app));
  const rotated = cookie(await login(app, password, { cookie: old }));
  assert.notEqual(old, rotated);
  for (const value of [old, "radar_session=" + "a".repeat(64), "radar_session=%ZZ", "radar_session=" + password]) {
    assert.equal((await app.request("/api/items", { headers: { cookie: value } })).status, 401);
  }
  assert.equal((await fixture().request("/api/items", { headers: { cookie: rotated } })).status, 401);
  time += 1000;
  assert.equal((await app.request("/api/items", { headers: { cookie: rotated } })).status, 401);
});

test("session storage evicts oldest session at its fixed capacity", async () => {
  let time = 0;
  const app = fixture({ now: () => time, sessionTtlMs: 7 * 86400_000 });
  const first = cookie(await login(app));
  let latest = first;
  for (let i = 1; i <= 256; i++) {
    if (i % 10 === 0) time += 900_000;
    latest = cookie(await login(app));
  }
  assert.equal((await app.request("/api/auth/check", { headers: { cookie: first } })).status, 401);
  assert.equal((await app.request("/api/auth/check", { headers: { cookie: latest } })).status, 200);
});

test("global throttle ignores spoofed proxy headers and resets after its window", async () => {
  let time = 0;
  const app = fixture({ now: () => time });
  for (let i = 0; i < 10; i++) {
    assert.equal((await login(app, "wrong", { "x-forwarded-for": `192.0.2.${i}`, "cf-connecting-ip": `192.0.2.${i}` })).status, 401);
  }
  const limited = await login(app);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "900");
  time += 900_000;
  assert.equal((await login(app)).status, 303);
});

test("explicit external HTTPS origin and secure cookies; forwarded headers cannot change origin", async () => {
  const app = fixture({ origin: "https://future.example.com", secureCookie: true });
  assert.equal((await login(app)).status, 403);
  const response = await login(app, password, { origin: "https://future.example.com" });
  assert.equal(response.status, 303);
  assert.match(response.headers.get("set-cookie")!, /; Secure/i);
  assert.equal((await login(fixture(), password, { origin: "https://evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" })).status, 403);
});

test("missing password or malformed origin fails closed, including login; disabled middleware is inert", async () => {
  for (const app of [fixture({ password: "" }), fixture({ origin: "https://example.com/path" })]) {
    for (const path of ["/", "/auth/login", "/api/items", "/assets/app.js"]) {
      assert.equal((await app.request(path)).status, 503);
    }
    assert.equal((await login(app)).status, 503);
    assert.equal((await app.request("/health")).status, 200);
  }
  const app = new Hono();
  registerSiteAuth(app, { enabled: false, password: "" });
  app.get("/", (c) => c.text("original"));
  assert.equal(await (await app.request("/")).text(), "original");
});
