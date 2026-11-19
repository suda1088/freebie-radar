import { existsSync } from "node:fs";
import { resolve } from "node:path";

// 只加载一次；容器里通常直接用真实环境变量
for (const file of [".env.local", ".env"]) {
  const p = resolve(process.cwd(), file);
  if (existsSync(p)) {
    try {
      process.loadEnvFile(p);
    } catch {
      /* 忽略损坏的 env 文件 */
    }
  }
}

const str = (key: string, fallback = "") => (process.env[key] ?? fallback).trim();
const num = (key: string, fallback: number) => {
  const raw = Number(str(key));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};
const bool = (key: string, fallback: boolean) => {
  const raw = str(key).toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

export const config = {
  port: num("PORT", 8788),
  host: str("HOST", "0.0.0.0"),
  databasePath: str("DATABASE_PATH", "./data/radar.db"),
  databaseDir: str("DATABASE_DIR", ""),

  httpProxy: str("HTTP_PROXY"),
  httpsProxy: str("HTTPS_PROXY"),
  fetchTimeoutMs: num("FETCH_TIMEOUT_MS", 20_000),
  minRequestGapMs: num("MIN_REQUEST_GAP_MS", 2_000),
  /** 源与源之间的间隔，避免 Reddit 一类站点因同 IP 连续请求返回 429 */
  sourceGapMs: num("SOURCE_GAP_MS", 3_000),

  flaresolverrUrl: str("FLARESOLVERR_URL"),
  flaresolverrTimeoutMs: num("FLARESOLVERR_TIMEOUT_MS", 60_000),

  enabledSources: str("ENABLED_SOURCES")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  maxItemsPerRun: num("MAX_ITEMS_PER_RUN", 50),

  githubToken: str("GITHUB_TOKEN"),

  collectCron: str("COLLECT_CRON", "0 */2 * * *"),
  dailyCron: str("DAILY_CRON", "30 8 * * *"),
  enableScheduler: bool("ENABLE_SCHEDULER", true),
  enableCollectionScheduler: bool("ENABLE_COLLECTION_SCHEDULER", bool("ENABLE_SCHEDULER", true)),

  dailyTopN: num("DAILY_TOP_N", 12),
  publicBaseUrl: str("PUBLIC_BASE_URL"),
  pushChannel: str("PUSH_CHANNEL", "none"),
  telegramBotToken: str("TELEGRAM_BOT_TOKEN"),
  telegramChatId: str("TELEGRAM_CHAT_ID"),
  telegramApiBase: str("TELEGRAM_API_BASE", "https://api.telegram.org"),
  telegramProxy: str("TELEGRAM_PROXY"),

  aiBaseUrl: str("AI_BASE_URL"),
  aiApiKey: str("AI_API_KEY"),
  aiModel: str("AI_MODEL"),
  aiMaxItems: num("AI_MAX_ITEMS", 60),

  ingestToken: str("INGEST_TOKEN"),
  /** VPS 按需无头 Cookie 执行器地址（仅内网/网桥监听，平时 0 MB 浏览器内存） */
  cookieRunnerUrl: str("COOKIE_RUNNER_URL", "http://127.0.0.1:18790"),
  /** 小红书国内代理出口（如 http://192.0.2.20:8888），供香港/海外 VPS 绕开国际版跳转 */
  xhsProxyUrl: str("XHS_PROXY_URL"),
  /** 管理端密码；留空则管理接口全部开放（向后兼容） */
  adminToken: str("ADMIN_TOKEN"),
  /** 全站登录：缺少 SITE_PASSWORD 时拒绝所有站点请求（/health 除外）。 */
  siteAuthEnabled: bool("SITE_AUTH_ENABLED", false),
  sitePassword: process.env.SITE_PASSWORD ?? "",
  siteCookieSecure: bool("SITE_COOKIE_SECURE", false),
  /** 反向代理下设置精确外部 origin，例如 https://radar.example.com（无尾部斜线）。 */
  siteOrigin: str("SITE_ORIGIN"),
} as const;

export const aiEnabled = Boolean(config.aiBaseUrl && config.aiModel);
export const pushEnabled = config.pushChannel !== "none" && Boolean(config.telegramBotToken && config.telegramChatId);
