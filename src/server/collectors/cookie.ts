import { config } from "../config.ts";
import { all } from "../db.ts";
import { BASE_SITE_KEYWORDS, getCookieSettings, siteKeyOfSource, type CookieSiteKey } from "../cookie-store.ts";
import type { Collector, RawItem } from "./types.ts";

function keywordsForSite(site: CookieSiteKey, maxKeywords = 4): string[] {
  const base = BASE_SITE_KEYWORDS[site];
  if (site === "xiaoheihe") return base;
  const extra = all<{ keyword: string }>("SELECT keyword FROM subscriptions ORDER BY keyword").map((r) => r.keyword.trim()).filter(Boolean);
  const pool = [...new Set([...base, ...extra])].slice(0, maxKeywords);
  // 小红书需走国内代理逐页渲染：每轮保底搜核心词 + 1 个轮换词（2 词约 35-55 秒完赛），避免 4 词连抓超 3 分钟
  if (site === "xhs" && pool.length > 2) {
    const rot = pool.slice(1);
    const idx = Math.floor(Date.now() / 3_600_000) % rot.length;
    return [pool[0]!, rot[idx]!];
  }
  return pool;
}

type RunnerItem = {
  externalId?: string;
  url?: string;
  title?: string;
  summary?: string;
  content?: string | null;
  author?: string | null;
  publishedAt?: string | null;
  imageUrl?: string | null;
  tags?: string[];
  raw?: Record<string, unknown>;
};

type RunnerResponse = {
  ok?: boolean;
  error?: string;
  needLogin?: boolean;
  items?: RunnerItem[];
};

/**
 * 服务端 Cookie 托管采集器：
 * - 对知乎 / 小红书 / 小黑盒按需向 VPS 上的轻量无头执行器（vps-cookie-runner）发请求
 * - 执行器拉起无头 Chrome 注入托管 Cookie（小红书自动走国内代理）、抓完立即退出，平时 0 MB 浏览器内存
 * - 未配置 Cookie 或 runnerUrl 时明确提示，仍保留本机回环/油猴回传路径（POST /api/ingest）
 */
export const cookieIngestCollector: Collector = {
  kind: "ingest",
  label: "Cookie 托管采集",
  defaults: { config: {} },
  async collect(ctx) {
    const site = siteKeyOfSource(ctx.sourceId);
    if (!site) throw new Error(`未知登录态数据源: ${ctx.sourceId}`);

    const settings = getCookieSettings();
    const cookies = settings.sites[site]?.cookies ?? [];
    if (!cookies.length) {
      throw new Error(`未配置 ${site} Cookie，请先在「数据源运维 → Cookie 托管」粘贴 Cookie，或使用本机回环/油猴回传`);
    }
    const runnerUrl = settings.runnerUrl.replace(/\/+$/, "");
    if (!runnerUrl) {
      throw new Error("未配置 VPS Cookie 执行器地址（COOKIE_RUNNER_URL）");
    }

    const keywords = keywordsForSite(site);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (config.ingestToken) headers.authorization = `Bearer ${config.ingestToken}`;

    const res = await fetch(`${runnerUrl}/collect`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        site,
        cookies,
        keywords,
        proxy: site === "xhs" && settings.xhsProxy ? settings.xhsProxy : "",
      }),
      signal: AbortSignal.timeout(240_000),
    });

    const data = (await res.json().catch(() => ({}))) as RunnerResponse;
    if (!res.ok || !data.ok) {
      const msg = data.error || `Cookie 执行器异常 (HTTP ${res.status})`;
      throw new Error(data.needLogin ? `Cookie 已失效，请重新粘贴更新: ${msg}` : msg);
    }

    const rawItems = Array.isArray(data.items) ? data.items : [];
    const items: RawItem[] = [];
    for (const it of rawItems.slice(0, ctx.maxItems)) {
      const title = String(it.title ?? "").trim();
      const url = String(it.url ?? "").trim();
      if (!title || !url) continue;
      items.push({
        externalId: String(it.externalId ?? url),
        url,
        title,
        summary: String(it.summary ?? ""),
        content: typeof it.content === "string" && it.content.trim() ? it.content.trim().slice(0, 4000) : null,
        author: it.author ?? null,
        publishedAt: it.publishedAt ?? null,
        imageUrl: it.imageUrl ?? null,
        tags: Array.isArray(it.tags) ? it.tags : [site, "cookie-vps"],
        raw: it.raw ?? { site, via: "vps-cookie-runner" },
      });
    }
    ctx.log(`${site}: 通过托管 Cookie 抓取 ${items.length} 条`);
    return { items, cursor: null, degraded: null };
  },
};
