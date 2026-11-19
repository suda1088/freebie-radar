import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { config } from "./config.ts";
import { registerSiteAuth } from "./site-auth.ts";
import { getDb, migrate, run } from "./db.ts";
import { registerApi } from "./routes.ts";
import { initAiReviewQueue } from "./enrich/ai-queue.ts";
import { startPushScheduler } from "./push.ts";
import { digestExists, runDaily } from "./digest.ts";
import { startIntervalScheduler, startScheduler } from "./cron.ts";
import { getRetention, runCleanup } from "./retention.ts";
import { ensureSources } from "./collectors/index.ts";
import { releaseFlareSession } from "./flaresolverr.ts";

migrate();
ensureSources();
initAiReviewQueue();
// 上次进程意外退出可能遗留 status='running' 的记录，启动时收口
run(
  "UPDATE runs SET status = 'failed', finished_at = ?, error = COALESCE(error, '进程重启中断') WHERE status = 'running'",
  new Date().toISOString(),
);
const app = new Hono();
registerSiteAuth(app, {
  enabled: config.siteAuthEnabled,
  password: config.sitePassword,
  secureCookie: config.siteCookieSecure,
  origin: config.siteOrigin,
});
// The generic logger includes query strings; private deployments do not log request URLs.
if (!config.siteAuthEnabled) app.use("*", logger());

app.get("/health", (c) => {
  const row = getDb().prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
  return c.json({
    ok: row?.ok === 1,
    version: "0.1.0",
    time: new Date().toISOString(),
    sources: config.enabledSources.length || "all",
  });
});

registerApi(app);

// Hono 的 serveStatic 的 root/path 都相对 process.cwd()，传绝对路径会拼出错误路径；
// 另外带 hash 的 assets 应该长缓存，index.html 必须 no-store，否则发版后用户会拿到旧 HTML 白屏。
const webDistAbs = fileURLToPath(new URL("../../dist/web", import.meta.url));
if (existsSync(webDistAbs)) {
  const relRoot = relative(process.cwd(), webDistAbs).split(sep).join("/") || ".";
  app.use(
    "/assets/*",
    serveStatic({
      root: relRoot,
      onFound: (_path, c) => {
        c.header("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );
  app.use(
    "/*",
    serveStatic({
      root: relRoot,
      // 命中 index.html 的响应必须不缓存，否则发版后浏览器会拿旧 HTML 去请求已删除的旧 JS
      onFound: (p, c) => {
        if (p.endsWith(".html")) c.header("Cache-Control", "no-store, must-revalidate");
      },
    }),
  );
  app.get(
    "*",
    serveStatic({
      path: relRoot + "/index.html",
      onFound: (_path, c) => {
        c.header("Cache-Control", "no-store, must-revalidate");
      },
    }),
  );
} else {
  app.get("/", (c) => c.text("freebie-radar API 已启动。前端未构建，运行 pnpm build 或 pnpm dev:web。"));
}

// Collection is independent of digest, push batching and destructive retention jobs.
if (config.enableCollectionScheduler) startIntervalScheduler();
// Push batching follows its own user switch and destination readiness.
startPushScheduler();
if (config.enableScheduler) {
  // 日报：仍然按 DAILY_CRON 触发
  startScheduler({
    collect: async () => undefined,
    daily: async () => {
      const now = new Date();
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      if (digestExists(day)) return;
      await runDaily({ date: now });
    },
  });

  // 数据清理：每天跑一次，按保留策略删掉过期条目与日志（收藏的永不删）
  const tickCleanup = () => {
    try {
      const cfg = getRetention();
      if (!cfg.auto) return;
      const r = runCleanup(cfg);
      const total = Object.values(r.deleted).reduce((a, b) => a + b, 0);
      if (total > 0) console.log("[cleanup]", JSON.stringify(r.deleted), "剩余", r.remaining);
    } catch (err) {
      console.error("[cleanup] 失败:", err instanceof Error ? err.message : err);
    }
  };
  tickCleanup();
  setInterval(tickCleanup, 12 * 3600_000);
}

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`[radar] listening on http://${config.host}:${info.port}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    Promise.race([releaseFlareSession(), new Promise((r) => setTimeout(r, 800))]).finally(() => {
      process.exit(0);
    });
  });
}
