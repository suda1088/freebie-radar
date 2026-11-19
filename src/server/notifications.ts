import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { getDb } from "./db.ts";
import { config } from "./config.ts";

/** Official docs verified 2026-08: access-token.html, api-call-guide.html,
 * server-inter/message/overview.html and autogen/api/v2_groups_group_openid_messages.post.html
 * under https://bot.q.qq.com/wiki/develop/api-v2/ . The current docs specify
 * api.bot.qq.com; older official SDKs use bots.qq.com and api.sgroup.qq.com.
 * QQ permissions, recipient opt-in, quotas and online requirements still apply.
 * Proactive group/C2C messages omit reply context and remain subject to platform
 * quotas and recipient consent; this adapter does not maintain a gateway session.
 * Saving settings never sends and never modifies the application's push policy.
 */
export type NotificationChannel = "none" | "telegram" | "qqbot";
export type QqTargetType = "group" | "channel" | "c2c";
export type SecretAction = { action: "keep" } | { action: "clear" } | { action: "replace"; value: string };
export type NotificationSettingsBody = {
  channel?: NotificationChannel;
  telegram?: { chatId?: string; botToken?: SecretAction };
  qqbot?: { appId?: string; appSecret?: SecretAction; targetType?: QqTargetType; targetId?: string; sandbox?: boolean };
};
export type NotificationSettings = {
  channel: NotificationChannel;
  telegram: { chatId: string; botToken: string };
  qqbot: { appId: string; appSecret: string; targetType: QqTargetType; targetId: string; sandbox: boolean };
};
export type PublicNotificationSettings = {
  channel: NotificationChannel;
  ready: boolean;
  encryptionReady: boolean;
  telegram: { chatId: string; botTokenConfigured: boolean };
  qqbot: { appId: string; targetType: QqTargetType; targetId: string; sandbox: boolean; appSecretConfigured: boolean;
    sendMode: "proactive_with_platform_limits"; deliveryMode: "proactive"; proactiveSupported: true; limitations: string; warnings: string[] };
};
export type ReplyContext = { messageId?: string; eventId?: string; expiresAt: number; messageSequence?: number };
export type NotificationSendOptions = { purpose?: string; replyContext?: ReplyContext };
type Transport = (url: string, init: RequestInit) => Promise<Response>;
type Dependencies = { transport?: Transport; env?: Record<string, string | undefined>; now?: () => number; timeoutMs?: number };

export class NotificationError extends Error {
  readonly code: string;
  readonly timeoutUnknown: boolean;
  readonly deliveryUnknown: boolean;
  constructor(code: string, message: string, deliveryUnknown = false) {
    super(message);
    this.name = "NotificationError";
    this.code = code;
    this.timeoutUnknown = code === "timeout_unknown";
    this.deliveryUnknown = deliveryUnknown;
  }
}
const fail = (code: string, message: string): never => { throw new NotificationError(code, message); };
const TOKEN_URL = "https://api.bot.qq.com/app/getAppAccessToken";
const QQ_BASE = "https://api.bot.qq.com";
const QQ_SANDBOX_BASE = "https://sandbox.api.sgroup.qq.com";
const TG_BASE = "https://api.telegram.org";
const QQ_CAPABILITY = { sendMode: "proactive_with_platform_limits" as const, proactiveSupported: true as const,
  deliveryMode: "proactive" as const,
  warnings: ["Provider permissions, recipient consent, membership and quotas are not verified by configuration readiness.",
    "Channel delivery may require a separately maintained online gateway; sandbox compatibility has not been verified."],
  limitations: "Delivery requires provider permissions, recipient consent, membership and available quota. Channel sends may require a separately maintained online gateway. Sandbox compatibility is unverified." };
const SCHEMA = `CREATE TABLE IF NOT EXISTS notification_destinations (
  id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL,
  metadata TEXT NOT NULL, secrets TEXT NOT NULL, updated_at TEXT NOT NULL
)`;
const defaults = (): NotificationSettings => ({ channel: "none", telegram: { chatId: "", botToken: "" }, qqbot: { appId: "", appSecret: "", targetType: "group", targetId: "", sandbox: false } });
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("invalid_settings", "Expected an object");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail("unknown_field", "Unknown notification settings field");
}
function string(value: unknown, label: string, max = 256): string {
  if (typeof value !== "string" || value.length > max || /[\x00-\x1f\x7f]/.test(value)) return fail("invalid_settings", `${label} is invalid`);
  return value.trim();
}
function secret(value: unknown, previous: string, label: string): string {
  if (value === undefined) return previous;
  const action = record(value);
  keys(action, ["action", "value"]);
  if (action.action === "keep" || action.action === "clear") {
    if (Object.hasOwn(action, "value")) fail("invalid_settings", `${label} value is only allowed with replace`);
    return action.action === "keep" ? previous : "";
  }
  if (action.action !== "replace") return fail("invalid_settings", `${label} requires keep, replace, or clear`);
  const next = string(action.value, label, 512);
  if (!next) return fail("invalid_settings", `${label} replacement is empty`);
  return next;
}
function validate(settings: NotificationSettings): void {
  const { telegram: tg, qqbot: qq } = settings;
  if (tg.botToken && !/^\d{5,20}:[A-Za-z0-9_-]{20,256}$/.test(tg.botToken)) fail("invalid_settings", "Telegram bot token format is invalid");
  if (tg.chatId && !/^(?:-?\d{1,24}|@[A-Za-z][A-Za-z0-9_]{4,63})$/.test(tg.chatId)) fail("invalid_settings", "Telegram chat ID format is invalid");
  if (qq.appId && !/^\d{1,32}$/.test(qq.appId)) fail("invalid_settings", "QQ AppID format is invalid");
  if (qq.targetId && !/^[A-Za-z0-9_-]{1,256}$/.test(qq.targetId)) fail("invalid_settings", "QQ destination ID format is invalid");
  if (qq.targetId && qq.targetType !== "channel" && /^\d+$/.test(qq.targetId)) fail("invalid_settings", "QQ group/C2C targets require an app-specific openid, not a numeric QQ number");
}

/** Factory permits in-process fixture transport, clock, and environment injection.
 * It still uses this application's SQLite connection (DATABASE_PATH=:memory: in tests).
 */
export function createNotificationAdapter(deps: Dependencies = {}) {
  const env = deps.env ?? process.env;
  const clock = deps.now ?? Date.now;
  const transport: Transport = deps.transport ?? ((url, init) => fetch(url, init));
  const timeoutMs = Math.min(60_000, Math.max(1, deps.timeoutMs ?? 15_000));
  let tokenCache: { fingerprint: string; value: string; expiresAt: number } | undefined;
  let tokenPending: { fingerprint: string; value: Promise<string> } | undefined;
  function db() { const db = getDb(); db.exec(SCHEMA); return db; }
  function encryptionKey(): Buffer {
    try {
      const raw = env.NOTIFICATION_ENCRYPTION_KEY;
      const path = env.NOTIFICATION_SECRET_KEY_FILE ?? env.NOTIFICATION_ENCRYPTION_KEY_FILE ?? env.NOTIFICATION_KEYFILE;
      let encoded = raw;
      if (!encoded && path) {
        const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        let file: Buffer;
        try {
          const stat = fstatSync(fd);
          if (!stat.isFile() || stat.size > 1024 || (stat.mode & 0o7777) !== 0o600) throw new Error();
          const bounded = Buffer.alloc(1025);
          let length = 0;
          while (length < bounded.length) {
            const count = readSync(fd, bounded, length, bounded.length - length, null);
            if (!count) break;
            length += count;
          }
          if (length > 1024) throw new Error();
          file = bounded.subarray(0, length);
        } finally { closeSync(fd); }
        if (file.length === 32) return file;
        encoded = file.toString("utf8").trim();
      }
      if (encoded && /^[a-f0-9]{64}$/i.test(encoded)) return Buffer.from(encoded, "hex");
      if (encoded && /^(?:[A-Za-z0-9+/]{43}=|[A-Za-z0-9+/]{44})$/.test(encoded)) {
        const key = Buffer.from(encoded, "base64");
        if (key.length === 32) return key;
      }
    } catch { /* Never expose key paths or filesystem error details. */ }
    return fail("encryption_key_unavailable", "Configure a 32-byte notification encryption key or key file before saving credentials");
  }
  function seal(secrets: object): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
    cipher.setAAD(Buffer.from("freebie-radar.notifications.v1"));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(secrets), "utf8"), cipher.final()]);
    return JSON.stringify({ v: 1, iv: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: ciphertext.toString("base64") });
  }
  function unseal(envelope: string): Record<string, string> {
    const key = encryptionKey();
    try {
      const e = JSON.parse(envelope);
      if (e.v !== 1) throw new Error();
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(e.iv, "base64"));
      decipher.setAAD(Buffer.from("freebie-radar.notifications.v1"));
      decipher.setAuthTag(Buffer.from(e.tag, "base64"));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(e.data, "base64")), decipher.final()]).toString("utf8"));
    } catch { return fail("secret_unavailable", "Stored notification credentials cannot be decrypted; restore the original key"); }
  }
  function environmentSettings(): NotificationSettings {
    const result = defaults();
    // Legacy Telegram is only used when no web configuration record exists.
    const tgToken = (env.TELEGRAM_BOT_TOKEN ?? config.telegramBotToken).trim();
    const tgChat = (env.TELEGRAM_CHAT_ID ?? config.telegramChatId).trim();
    result.telegram = { botToken: tgToken, chatId: tgChat };
    // Legacy credentials may prefill private runtime settings, but selecting a
    // channel requires an explicit web save. Never auto-enable from the environment.
    try { validate(result); } catch { result.telegram = { botToken: "", chatId: "" }; }
    return result;
  }
  /** Private server-only API. Contains credentials: never serialize into HTTP/logs. */
  function getNotificationSettings(): NotificationSettings {
    const row = db().prepare("SELECT version, metadata, secrets FROM notification_destinations WHERE id=1").get() as { version: number; metadata: string; secrets: string } | undefined;
    if (!row) return environmentSettings();
    try {
      if (row.version !== 1) throw new Error();
      const metadata = JSON.parse(row.metadata);
      const secrets = row.secrets ? unseal(row.secrets) : {};
      const value = { channel: metadata.channel, telegram: { ...metadata.telegram, botToken: secrets.botToken ?? "" }, qqbot: { ...metadata.qqbot, appSecret: secrets.appSecret ?? "" } } as NotificationSettings;
      validate(value);
      return value;
    } catch (error) {
      if (error instanceof NotificationError) throw error;
      return fail("settings_corrupt", "Stored notification settings are invalid");
    }
  }
  function ready(s: NotificationSettings): boolean {
    if (s.channel === "telegram") return Boolean(s.telegram.botToken && s.telegram.chatId);
    if (s.channel === "qqbot") return Boolean(s.qqbot.appId && s.qqbot.appSecret && s.qqbot.targetId && ["group", "channel", "c2c"].includes(s.qqbot.targetType));
    return false;
  }
  function publicNotificationSettings(): PublicNotificationSettings {
    let encryptionReady = false;
    try { encryptionKey(); encryptionReady = true; } catch { /* Status only; GET remains usable before provisioning. */ }
    let s: NotificationSettings;
    try { s = getNotificationSettings(); }
    catch (error) {
      if (!(error instanceof NotificationError) || !["encryption_key_unavailable", "secret_unavailable"].includes(error.code)) throw error;
      encryptionReady = false;
      const row = db().prepare("SELECT metadata FROM notification_destinations WHERE id=1").get() as { metadata: string };
      const metadata = JSON.parse(row.metadata);
      return { channel: metadata.channel, ready: false, encryptionReady,
        telegram: { chatId: metadata.telegram.chatId, botTokenConfigured: metadata.telegram.botTokenConfigured === true },
        qqbot: { ...QQ_CAPABILITY, appId: metadata.qqbot.appId, targetType: metadata.qqbot.targetType, targetId: metadata.qqbot.targetId, sandbox: metadata.qqbot.sandbox, appSecretConfigured: metadata.qqbot.appSecretConfigured === true } };
    }
    return { channel: s.channel, ready: ready(s), encryptionReady, telegram: { chatId: s.telegram.chatId, botTokenConfigured: Boolean(s.telegram.botToken) }, qqbot: { ...QQ_CAPABILITY, appId: s.qqbot.appId, targetType: s.qqbot.targetType, targetId: s.qqbot.targetId, sandbox: s.qqbot.sandbox, appSecretConfigured: Boolean(s.qqbot.appSecret) } };
  }
  function saveNotificationSettings(body: unknown) {
    const input = record(body);
    keys(input, ["channel", "telegram", "qqbot"]);
    if (JSON.stringify(input).length > 8192) fail("invalid_settings", "Notification settings exceed size limit");
    // Always permit disabling even if the deployment key has become unavailable.
    if (input.channel === "none" && Object.keys(input).length === 1) {
      const row = db().prepare("SELECT metadata FROM notification_destinations WHERE id=1").get() as { metadata: string } | undefined;
      if (row) {
        const metadata = JSON.parse(row.metadata);
        metadata.channel = "none";
        db().prepare("UPDATE notification_destinations SET metadata=?,updated_at=? WHERE id=1").run(JSON.stringify(metadata), new Date(clock()).toISOString());
        tokenCache = undefined;
        return publicNotificationSettings();
      }
    }
    // Validate all sections before touching persisted state; absent values mean keep.
    const next = structuredClone(getNotificationSettings());
    if (input.channel !== undefined) {
      if (!["none", "telegram", "qqbot"].includes(input.channel as string)) fail("invalid_settings", "Notification channel is invalid");
      next.channel = input.channel as NotificationChannel;
    }
    if (input.telegram !== undefined) {
      const tg = record(input.telegram); keys(tg, ["chatId", "botToken"]);
      if (tg.chatId !== undefined) next.telegram.chatId = string(tg.chatId, "Telegram chat ID");
      next.telegram.botToken = secret(tg.botToken, next.telegram.botToken, "Telegram bot token");
    }
    if (input.qqbot !== undefined) {
      const qq = record(input.qqbot); keys(qq, ["appId", "appSecret", "targetType", "targetId", "sandbox"]);
      if (qq.appId !== undefined) next.qqbot.appId = string(qq.appId, "QQ AppID", 32);
      if (qq.targetId !== undefined) next.qqbot.targetId = string(qq.targetId, "QQ target ID");
      if (qq.targetType !== undefined) {
        if (!["group", "channel", "c2c"].includes(qq.targetType as string)) fail("invalid_settings", "QQ target type is invalid");
        next.qqbot.targetType = qq.targetType as QqTargetType;
      }
      if (qq.sandbox !== undefined) {
        if (typeof qq.sandbox !== "boolean") fail("invalid_settings", "QQ sandbox must be a boolean");
        next.qqbot.sandbox = qq.sandbox as boolean;
      }
      next.qqbot.appSecret = secret(qq.appSecret, next.qqbot.appSecret, "QQ AppSecret");
    }
    validate(next);
    const { botToken, ...tgMetadata } = next.telegram;
    const { appSecret, ...qqMetadata } = next.qqbot;
    const encrypted = botToken || appSecret ? seal({ botToken, appSecret }) : "";
    // One SQLite statement atomically replaces both metadata and encrypted credentials.
    db().prepare(`INSERT INTO notification_destinations(id,version,metadata,secrets,updated_at) VALUES(1,1,?,?,?)
      ON CONFLICT(id) DO UPDATE SET version=1,metadata=excluded.metadata,secrets=excluded.secrets,updated_at=excluded.updated_at`)
      .run(JSON.stringify({ channel: next.channel, telegram: { ...tgMetadata, botTokenConfigured: Boolean(botToken) }, qqbot: { ...qqMetadata, appSecretConfigured: Boolean(appSecret) } }), encrypted, new Date(clock()).toISOString());
    tokenCache = undefined;
    return publicNotificationSettings();
  }
  function notificationChannel(): NotificationChannel { return publicNotificationSettings().channel; }
  function notificationReady(): boolean { try { return ready(getNotificationSettings()); } catch { return false; } }

  async function request(url: string, body: object, headers: Record<string, string>, sending: boolean): Promise<{ status: number; ok: boolean; data: Record<string, unknown> }> {
    // Callers cannot supply an endpoint. Redirects are forbidden to protect credentials.
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized) > 32768) return fail("invalid_message", "Notification request exceeds size limit");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await transport(url, { method: "POST", redirect: "error", headers: { "content-type": "application/json", ...headers }, body: serialized, signal: controller.signal });
      let total = 0;
      const chunks: Buffer[] = [];
      if (!response.body) throw new Error();
      const reader = response.body.getReader();
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          total += part.value.byteLength;
          if (total > 65536) { await reader.cancel(); throw new Error(); }
          chunks.push(Buffer.from(part.value));
        }
      } finally { reader.releaseLock(); }
      const data = record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      return { status: response.status, ok: response.ok, data };
    } catch {
      // Never attach upstream errors: fetch URLs include Telegram credentials.
      if (sending) throw new NotificationError(controller.signal.aborted ? "timeout_unknown" : "delivery_unknown", "Notification delivery status is unknown; inspect the destination before any manual retry", true);
      throw new NotificationError("token_request_failed", "QQ token request failed; check connectivity and application credentials");
    } finally { clearTimeout(timer); }
  }
  function businessCode(data: Record<string, unknown>): number | undefined {
    for (const field of ["code", "err_code", "error_code"]) {
      if (data[field] !== undefined && data[field] !== 0 && data[field] !== "0") {
        const code = Number(data[field]);
        return Number.isSafeInteger(code) ? code : -1;
      }
    }
    return undefined;
  }
  async function accessToken(s: NotificationSettings): Promise<string> {
    const { appId, appSecret } = s.qqbot;
    const fingerprint = createHash("sha256").update(JSON.stringify([appId, appSecret])).digest("hex");
    if (tokenCache?.fingerprint === fingerprint && tokenCache.expiresAt > clock()) return tokenCache.value;
    if (tokenPending?.fingerprint === fingerprint) return tokenPending.value;
    const pending = (async () => {
      const { ok, data } = await request(TOKEN_URL, { appId, clientSecret: appSecret }, {}, false);
      const code = businessCode(data);
      const ttl = Number(data.expires_in);
      if (!ok || code !== undefined || typeof data.access_token !== "string" || !/^[A-Za-z0-9._~-]{1,4096}$/.test(data.access_token) || !Number.isFinite(ttl) || ttl <= 0) {
        throw new NotificationError("qq_token_failed", "QQ token rejected; verify AppID, AppSecret and bot status");
      }
      tokenCache = { fingerprint, value: data.access_token, expiresAt: clock() + Math.max(0, Math.min(ttl, 7200) - 60) * 1000 };
      return tokenCache.value;
    })();
    tokenPending = { fingerprint, value: pending };
    try { return await pending; } finally { if (tokenPending?.value === pending) tokenPending = undefined; }
  }
  function replyBody(context: ReplyContext | undefined, type: QqTargetType): Record<string, unknown> {
    if (!context) return {}; // Official proactive API: no fabricated msg_id/event_id.
    const c = record(context); keys(c, ["messageId", "eventId", "expiresAt", "messageSequence"]);
    if (Boolean(c.messageId) === Boolean(c.eventId)) fail("invalid_reply_context", "Provide exactly one QQ message ID or event ID");
    if (typeof c.expiresAt !== "number" || !Number.isFinite(c.expiresAt) || c.expiresAt <= clock() || c.expiresAt > clock() + (type === "c2c" ? 3600_000 : 300_000)) fail("qq_reply_context_expired", "QQ reply context must be fresh and within the platform reply window");
    if (c.messageSequence !== undefined && (!Number.isInteger(c.messageSequence) || Number(c.messageSequence) < 1 || Number(c.messageSequence) > (type === "c2c" ? 4 : 5))) fail("invalid_reply_context", "QQ reply sequence is invalid");
    return { ...(c.messageId ? { msg_id: string(c.messageId, "QQ message ID") } : { event_id: string(c.eventId, "QQ event ID") }), ...(c.messageSequence === undefined || type === "channel" ? {} : { msg_seq: c.messageSequence }) };
  }
  /** Explicit send operation only. Callers must apply existing push/digest policy first.
   * No automatic retries, including expired tokens, rate limits and ambiguous delivery.
   */
  async function sendNotification(text: string, options: NotificationSendOptions = {}): Promise<void> {
    if (typeof text !== "string" || !text.trim() || text.length > 4096) fail("invalid_message", "Notification text must contain 1–4096 characters");
    if (notificationChannel() === "none") fail("notifications_disabled", "Notifications are disabled");
    const s = getNotificationSettings();
    if (s.channel === "none") fail("notifications_disabled", "Notifications are disabled");
    if (!ready(s)) fail("notifications_unconfigured", "Selected notification destination needs credentials and a destination");
    if (s.channel === "telegram") {
      const { ok, status, data } = await request(`${TG_BASE}/bot${s.telegram.botToken}/sendMessage`, { chat_id: s.telegram.chatId, text, disable_web_page_preview: true }, {}, true);
      if (!ok || data.ok !== true) throw new NotificationError("telegram_send_failed", "Telegram rejected the message; check bot permissions and chat ID");
      return;
    }
    const qq = s.qqbot;
    const context = replyBody(options.replyContext, qq.targetType); // Before any network activity.
    const token = await accessToken(s);
    const path = qq.targetType === "channel" ? `/channels/${qq.targetId}/messages` : `/v2/${qq.targetType === "group" ? "groups" : "users"}/${qq.targetId}/messages`;
    const { ok, data } = await request((qq.sandbox ? QQ_SANDBOX_BASE : QQ_BASE) + path, { content: text, ...(qq.targetType === "channel" ? {} : { msg_type: 0 }), ...context }, { Authorization: `QQBot ${token}` }, true);
    const code = businessCode(data);
    if (!ok || code !== undefined) {
      // Audit-pending messages can be delivered later: never resubmit automatically.
      const audit = code === 304023 || code === 304024;
      throw new NotificationError(audit ? "delivery_unknown" : "qq_send_failed", `QQ message ${audit ? "is under audit; inspect delivery before retrying" : "was rejected; verify permissions, recipient opt-in, reply window and quotas"}`, audit);
    }
    if (typeof data.id !== "string" || !data.id) throw new NotificationError("delivery_unknown", "QQ response did not confirm delivery; inspect the destination before retrying", true);
  }
  return { getNotificationSettings, publicNotificationSettings, saveNotificationSettings, notificationReady, notificationChannel, sendNotification };
}
const adapter = createNotificationAdapter();
export const getNotificationSettings = adapter.getNotificationSettings;
export const publicNotificationSettings = adapter.publicNotificationSettings;
export const saveNotificationSettings = adapter.saveNotificationSettings;
export const notificationReady = adapter.notificationReady;
export const notificationChannel = adapter.notificationChannel;
export const sendNotification = adapter.sendNotification;
