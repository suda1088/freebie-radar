import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NotificationError as NotificationErrorType } from "../src/server/notifications.ts";

process.env.DATABASE_PATH = ":memory:";
const { closeDb, getDb } = await import("../src/server/db.ts");
const { createNotificationAdapter, NotificationError } = await import("../src/server/notifications.ts");
const directory = mkdtempSync(join(tmpdir(), "radar-notification-test-"));
const keyfile = join(directory, "test.key");
writeFileSync(keyfile, Buffer.alloc(32, 17), { mode: 0o600 });
const env = { NOTIFICATION_SECRET_KEY_FILE: keyfile, PUSH_CHANNEL: "none", TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "" };
const tgToken = "123456789:" + "a".repeat(32);
const secret = "test-qq-secret";
const tg = { channel: "telegram", telegram: { chatId: "-100123456", botToken: { action: "replace", value: tgToken } } };
const qq = { channel: "qqbot", qqbot: { appId: "123456789", appSecret: { action: "replace", value: secret }, targetType: "channel", targetId: "123456789123" } };
const TOKEN_URL = "https://api.bot.qq.com/app/getAppAccessToken";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let calls: { url: string; init: RequestInit }[];
let response: (url: string, init: RequestInit) => Promise<Response>;
function fixture(extra: Parameters<typeof createNotificationAdapter>[0] = {}) {
  return createNotificationAdapter({ env, transport: async (url, init) => { calls.push({ url, init }); return response(url, init); }, ...extra });
}
beforeEach(() => {
  getDb().exec("DROP TABLE IF EXISTS notification_destinations");
  calls = [];
  response = async (url) => url === TOKEN_URL ? json({ code: 0, access_token: "fixture-access-token", expires_in: "7200" }) : json({ ok: true, id: "confirmed-message" });
});
after(() => { closeDb(); rmSync(directory, { recursive: true, force: true }); });
function code(error: unknown, expected: string) {
  assert.ok(error instanceof NotificationError);
  assert.equal(error.code, expected);
  assert.doesNotMatch(error.message, new RegExp(`${tgToken}|${secret}|upstream-secret`));
  return true;
}

test("default disabled, save never sends, incomplete configuration is not ready", async () => {
  const a = fixture();
  assert.equal(a.notificationChannel(), "none");
  assert.equal(a.notificationReady(), false);
  await assert.rejects(a.sendNotification("hello"), (e) => code(e, "notifications_disabled"));
  a.saveNotificationSettings({ channel: "qqbot" });
  assert.equal(a.notificationReady(), false);
  assert.equal(calls.length, 0);
  await assert.rejects(a.sendNotification("hello"), (e) => code(e, "notifications_unconfigured"));
});

test("AES GCM storage, masked public values, keep, replace and clear semantics", async () => {
  const a = fixture();
  a.saveNotificationSettings(tg);
  a.saveNotificationSettings(qq);
  const row = getDb().prepare("SELECT metadata,secrets FROM notification_destinations").get() as { metadata: string; secrets: string };
  assert.doesNotMatch(row.metadata + row.secrets, new RegExp(`${tgToken}|${secret}`));
  const publicSettings = a.publicNotificationSettings();
  assert.doesNotMatch(JSON.stringify(publicSettings), new RegExp(`${tgToken}|${secret}`));
  assert.equal(publicSettings.telegram.botTokenConfigured, true);
  assert.equal(publicSettings.qqbot.appSecretConfigured, true);
  a.saveNotificationSettings({ telegram: { botToken: { action: "keep" } }, qqbot: { appSecret: { action: "keep" } } });
  assert.equal(a.getNotificationSettings().telegram.botToken, tgToken);
  assert.equal(a.getNotificationSettings().qqbot.appSecret, secret);
  a.saveNotificationSettings({ qqbot: { appSecret: { action: "clear" } } });
  assert.equal(a.getNotificationSettings().telegram.botToken, tgToken);
  assert.equal(a.getNotificationSettings().qqbot.appSecret, "");
  assert.equal(a.notificationReady(), false);
  a.saveNotificationSettings({ channel: "telegram" });
  await a.sendNotification("plain text");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, `https://api.telegram.org/bot${tgToken}/sendMessage`);
  assert.equal(calls[0]!.init.redirect, "error");
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { chat_id: "-100123456", text: "plain text", disable_web_page_preview: true });
});

test("unknown fields, invalid secrets, URLs, numeric QQ IDs rejected atomically", () => {
  const a = fixture(); a.saveNotificationSettings(tg);
  for (const body of [
    { channel: "onebot" }, { apiBase: "http://localhost" },
    { telegram: { apiBase: "https://evil.example" } },
    { qqbot: { appSecret: { action: "replace", value: "upstream-secret" }, targetType: "group", targetId: "12345" } },
    { qqbot: { targetId: "https://evil.example/path" } },
    { telegram: { botToken: "upstream-secret" } },
    { telegram: { botToken: { action: "keep", value: "upstream-secret" } } },
    { telegram: { botToken: { action: "replace", value: "upstream-secret" } } },
    { qqbot: { sandbox: "yes" } },
    { qqbot: { messageId: "stale-message-id" } },
  ]) assert.throws(() => a.saveNotificationSettings(body), (e) => { assert.ok(e instanceof NotificationError); assert.doesNotMatch(e.message, /upstream-secret|evil.example/); return true; });
  assert.equal(a.getNotificationSettings().telegram.botToken, tgToken);
  assert.equal(a.notificationChannel(), "telegram");
  assert.equal(calls.length, 0);
});

test("key required independently of SITE_PASSWORD; key files and authenticated encryption fail closed", () => {
  const noKey = fixture({ env: { ...env, NOTIFICATION_SECRET_KEY_FILE: "", SITE_PASSWORD: "not-an-encryption-key" } });
  assert.equal(noKey.publicNotificationSettings().encryptionReady, false);
  assert.equal(noKey.publicNotificationSettings().channel, "none");
  assert.throws(() => noKey.saveNotificationSettings(tg), (e) => code(e, "encryption_key_unavailable"));
  const a = fixture(); a.saveNotificationSettings(tg);
  const unavailable = noKey.publicNotificationSettings();
  assert.equal(unavailable.encryptionReady, false);
  assert.equal(unavailable.ready, false);
  assert.equal(unavailable.telegram.botTokenConfigured, true);
  assert.equal(unavailable.telegram.chatId, "-100123456");
  noKey.saveNotificationSettings({ channel: "none" });
  assert.equal(noKey.notificationChannel(), "none");
  const wrongKey = fixture({ env: { ...env, NOTIFICATION_ENCRYPTION_KEY: "22".repeat(32) } });
  assert.throws(() => wrongKey.getNotificationSettings(), (e) => code(e, "secret_unavailable"));
  assert.equal(wrongKey.notificationReady(), false);
  assert.equal(wrongKey.publicNotificationSettings().encryptionReady, false);
  assert.equal(wrongKey.publicNotificationSettings().ready, false);
  getDb().prepare("UPDATE notification_destinations SET secrets='{}'").run();
  assert.throws(() => a.getNotificationSettings(), (e) => code(e, "secret_unavailable"));
});

test("legacy environment credentials stay private and never select a channel before save", () => {
  const a = fixture({ env: { ...env, PUSH_CHANNEL: "telegram", TELEGRAM_BOT_TOKEN: tgToken, TELEGRAM_CHAT_ID: "123456" } });
  assert.equal(a.notificationReady(), false);
  assert.equal(a.notificationChannel(), "none");
  assert.equal(a.getNotificationSettings().telegram.botToken, tgToken);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM notification_destinations").get()!.n, 0);
  a.saveNotificationSettings({ channel: "none" });
  assert.equal(a.notificationReady(), false);
  assert.equal(a.notificationChannel(), "none");
});

test("keyfile reads reject symlinks and modes other than 0600 without leaking paths", () => {
  const link = join(directory, "symlink.key");
  symlinkSync(keyfile, link);
  const linked = fixture({ env: { ...env, NOTIFICATION_SECRET_KEY_FILE: link } });
  assert.equal(linked.publicNotificationSettings().encryptionReady, false);
  assert.throws(() => linked.saveNotificationSettings(tg), (e) => code(e, "encryption_key_unavailable"));
  const permissive = join(directory, "permissive.key");
  writeFileSync(permissive, Buffer.alloc(32, 18));
  chmodSync(permissive, 0o644);
  const broad = fixture({ env: { ...env, NOTIFICATION_SECRET_KEY_FILE: permissive } });
  assert.equal(broad.publicNotificationSettings().encryptionReady, false);
  assert.throws(() => broad.saveNotificationSettings(tg), (e) => code(e, "encryption_key_unavailable"));
});

test("official QQ token JSON, Authorization header, endpoint and TTL cache", async () => {
  let time = 1000;
  const a = fixture({ now: () => time }); a.saveNotificationSettings(qq);
  await a.sendNotification("first"); await a.sendNotification("second");
  assert.equal(calls.filter((c) => c.url === TOKEN_URL).length, 1);
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { appId: "123456789", clientSecret: secret });
  assert.equal(calls[1]!.url, "https://api.bot.qq.com/channels/123456789123/messages");
  assert.equal((calls[1]!.init.headers as Record<string, string>).Authorization, "QQBot fixture-access-token");
  time += 7200_000;
  await a.sendNotification("after expiration");
  assert.equal(calls.filter((c) => c.url === TOKEN_URL).length, 2);
});

test("QQ group/C2C support proactive sends and optional fresh transient replies", async () => {
  const a = fixture(); a.saveNotificationSettings(qq);
  a.saveNotificationSettings({ qqbot: { targetType: "group", targetId: "official_GROUP_openid" } });
  await assert.rejects(a.sendNotification("hello", { replyContext: { messageId: "old", expiresAt: 1 } }), (e) => code(e, "qq_reply_context_expired"));
  assert.equal(calls.length, 0);
  await a.sendNotification("hello", { replyContext: { messageId: "fresh-message-id", expiresAt: Date.now() + 30_000, messageSequence: 2 } });
  assert.equal(calls[1]!.url, "https://api.bot.qq.com/v2/groups/official_GROUP_openid/messages");
  assert.deepEqual(JSON.parse(String(calls[1]!.init.body)), { content: "hello", msg_type: 0, msg_id: "fresh-message-id", msg_seq: 2 });
  assert.doesNotMatch(JSON.stringify(a.getNotificationSettings()), /fresh-message-id/);
  a.saveNotificationSettings({ qqbot: { targetType: "c2c", targetId: "official_USER_openid", sandbox: true } });
  await a.sendNotification("hello", { replyContext: { eventId: "fresh-event-id", expiresAt: Date.now() + 30_000 } });
  assert.equal(calls.at(-1)!.url, "https://sandbox.api.sgroup.qq.com/v2/users/official_USER_openid/messages");
  await a.sendNotification("proactive");
  assert.deepEqual(JSON.parse(String(calls.at(-1)!.init.body)), { content: "proactive", msg_type: 0 });
  assert.equal(a.publicNotificationSettings().qqbot.sendMode, "proactive_with_platform_limits");
  assert.equal(a.publicNotificationSettings().qqbot.deliveryMode, "proactive");
  assert.ok(a.publicNotificationSettings().qqbot.warnings.length > 0);
  a.saveNotificationSettings({ qqbot: { targetType: "group", targetId: "official_GROUP_openid", sandbox: false } });
  await a.sendNotification("proactive group");
  assert.equal(calls.at(-1)!.url, "https://api.bot.qq.com/v2/groups/official_GROUP_openid/messages");
  assert.deepEqual(JSON.parse(String(calls.at(-1)!.init.body)), { content: "proactive group", msg_type: 0 });
});

test("QQ HTTP-200 logical token/send errors and Telegram logical errors never expose upstream messages", async () => {
  const a = fixture(); a.saveNotificationSettings(qq);
  response = async () => json({ code: 100016, message: "upstream-secret" });
  await assert.rejects(a.sendNotification("hello"), (e) => code(e, "qq_token_failed"));
  assert.equal(calls.length, 1);
  response = async (url) => url === TOKEN_URL ? json({ access_token: "fixture-token", expires_in: 7200 }) : json({ err_code: 40034005, message: "upstream-secret" });
  await assert.rejects(a.sendNotification("hello"), (e) => code(e, "qq_send_failed"));
  a.saveNotificationSettings(tg);
  response = async () => json({ ok: false, error_code: 403, description: "upstream-secret" });
  await assert.rejects(a.sendNotification("hello"), (e) => code(e, "telegram_send_failed"));
});

test("bounded responses, safe network errors, audit uncertainty, timeoutUnknown and no blind retry", async () => {
  const a = fixture(); a.saveNotificationSettings(tg);
  response = async () => { throw new Error(`fetch ${tgToken} upstream-secret`); };
  await assert.rejects(a.sendNotification("hello"), (e) => code(e, "delivery_unknown"));
  assert.equal(calls.length, 1);
  response = async () => new Response("x".repeat(65537));
  await assert.rejects(a.sendNotification("hello"), (e) => code(e, "delivery_unknown"));
  response = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(new Error("upstream-secret")), { once: true });
  });
  const timed = fixture({ timeoutMs: 5 });
  await assert.rejects(timed.sendNotification("hello"), (e) => { code(e, "timeout_unknown"); assert.equal((e as NotificationErrorType).timeoutUnknown, true); return true; });
  a.saveNotificationSettings(qq);
  response = async (url) => url === TOKEN_URL ? json({ access_token: "fixture-token", expires_in: 7200 }) : json({ code: 304023, message: "upstream-secret" });
  await assert.rejects(a.sendNotification("hello"), (e) => { code(e, "delivery_unknown"); assert.equal((e as NotificationErrorType).deliveryUnknown, true); return true; });
});
