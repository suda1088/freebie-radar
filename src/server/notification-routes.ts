import type { Hono, Context } from "hono";
import { NotificationError, publicNotificationSettings, saveNotificationSettings, notificationChannel, notificationReady, sendNotification } from "./notifications.ts";
import { startPushScheduler } from "./push.ts";

async function boundedBody(c: Context): Promise<unknown> {
  if (!c.req.header("content-type")?.startsWith("application/json")) throw new NotificationError("invalid_settings", "请使用 JSON 请求");
  const reader = c.req.raw.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  if (reader) try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 8192) { await reader.cancel(); throw new NotificationError("invalid_settings", "请求过大"); } chunks.push(part.value); } } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new NotificationError("invalid_settings", "无效的 JSON 请求"); }
}
export function registerNotificationRoutes(app: Hono) {
  const failure = (c: Context, error: unknown) => {
    if (error instanceof NotificationError) return c.json({ error: error.message, code: error.code, deliveryUnknown: error.deliveryUnknown }, error.deliveryUnknown ? 502 : 400);
    return c.json({ error: "通知操作失败，请检查配置后重试" }, 500);
  };
  app.get("/api/notifications", c => { try { return c.json(publicNotificationSettings()); } catch (e) { return failure(c, e); } });
  app.patch("/api/notifications", async c => { try { const saved = saveNotificationSettings(await boundedBody(c)); startPushScheduler(); return c.json(saved); } catch (e) { return failure(c, e); } });
  let testing = false;
  let lastTest = 0;
  const test = async (c: Context) => {
    try {
      const body = await boundedBody(c) as { confirmed?: boolean; channel?: string };
      if (!body || typeof body !== "object" || Object.keys(body).some(key => !["channel", "confirmed"].includes(key)) || body.confirmed !== true || body.channel !== notificationChannel()) return c.json({ error: "请确认已保存的渠道与接收目标后再发送" }, 400);
      if (!notificationReady()) return c.json({ error: "发送目标尚未就绪" }, 400);
      if (testing || Date.now() - lastTest < 30_000) return c.json({ error: "测试发送过于频繁，请稍后再试" }, 429);
      testing = true; lastTest = Date.now();
      try { await sendNotification("苏打小窝 · 机器人连接测试 · " + new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }), { purpose: "test" }); }
      finally { testing = false; }
      return c.json({ ok: true });
    } catch (e) { return failure(c, e); }
  };
  app.post("/api/notifications/test", test);
  app.post("/api/push/test", test);
}