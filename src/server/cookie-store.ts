import { config } from "./config.ts";
import { get, run } from "./db.ts";

export type CookieSiteKey = "zhihu" | "xhs" | "xiaoheihe";

export type ParsedCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
};

type SiteCookieEntry = {
  raw: string;
  cookies: ParsedCookie[];
  updatedAt: string;
};

export type StoredCookieSettings = {
  runnerUrl: string;
  xhsProxy: string;
  sites: Partial<Record<CookieSiteKey, SiteCookieEntry>>;
};

export type PublicSiteCookieStatus = {
  site: CookieSiteKey;
  configured: boolean;
  count: number;
  keyNames: string[];
  hasAuthHint: boolean;
  updatedAt: string | null;
};

export type PublicCookieStatus = {
  runnerUrl: string;
  xhsProxy: string;
  sites: Record<CookieSiteKey, PublicSiteCookieStatus>;
};

const SETTINGS_KEY = "cookies";

const SITE_DOMAINS: Record<CookieSiteKey, string> = {
  zhihu: ".zhihu.com",
  xhs: ".xiaohongshu.com",
  xiaoheihe: ".xiaoheihe.cn",
};

const SITE_AUTH_HINTS: Record<CookieSiteKey, RegExp> = {
  zhihu: /^(z_c0|d_c0|sessionid)$/i,
  xhs: /^(web_session|a1|gid)$/i,
  xiaoheihe: /^(user_token|heybox_id|x_app_id|x_os_type)$/i,
};

export const SITE_BY_SOURCE: Record<string, CookieSiteKey> = {
  "zhihu-search": "zhihu",
  "xhs-search": "xhs",
  "xiaoheihe-search": "xiaoheihe",
};

export const BASE_SITE_KEYWORDS: Record<CookieSiteKey, string[]> = {
  zhihu: ["免费领取", "免费额度", "白嫖", "免费积分", "白嫖算力", "开发者福利"],
  xhs: ["免费领取", "白嫖", "免费会员", "白嫖额度", "免费积分", "免费算力", "开发者福利"],
  xiaoheihe: ["免费"],
};

export function siteKeyOfSource(sourceId: string): CookieSiteKey | null {
  return SITE_BY_SOURCE[sourceId] ?? null;
}

/**
 * 兼容解析两种常见浏览器导出格式：
 * 1. Request Header 字符串（可带 `Cookie:` 前缀）：`a=1; b=2; z_c0="..."`
 * 2. Cookie-Editor / Playwright JSON 数组：`[{"name":"z_c0","value":"...","domain":".zhihu.com"}]`
 */
export function parseCookieInput(rawInput: string, site: CookieSiteKey): ParsedCookie[] {
  const defaultDomain = SITE_DOMAINS[site];
  const trimmed = rawInput
    .trim()
    .replace(/^cookie\s*:\s*/i, "")
    .trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed) as unknown;
      if (Array.isArray(arr)) {
        const seen = new Map<string, ParsedCookie>();
        for (const item of arr) {
          if (!item || typeof item !== "object") continue;
          const obj = item as { name?: unknown; value?: unknown; domain?: unknown; path?: unknown };
          const name = typeof obj.name === "string" ? obj.name.trim() : "";
          const value = typeof obj.value === "string" ? obj.value : "";
          if (!name || !value) continue;
          const domain = typeof obj.domain === "string" && obj.domain.trim() ? obj.domain.trim() : defaultDomain;
          const path = typeof obj.path === "string" && obj.path.trim() ? obj.path.trim() : "/";
          seen.set(name, { name, value, domain, path });
        }
        return [...seen.values()];
      }
    } catch {
      /* 若不是合法 JSON，回退按 k=v; 解析 */
    }
  }

  const seen = new Map<string, ParsedCookie>();
  for (const seg of trimmed.split(/;+/)) {
    const part = seg.trim();
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
      value = value.slice(1, -1);
    }
    if (!name || !value) continue;
    seen.set(name, { name, value, domain: defaultDomain, path: "/" });
  }
  return [...seen.values()];
}

export function getCookieSettings(): StoredCookieSettings {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", SETTINGS_KEY);
  const defaults: StoredCookieSettings = {
    runnerUrl: config.cookieRunnerUrl || "http://127.0.0.1:18790",
    xhsProxy: config.xhsProxyUrl || "",
    sites: {},
  };
  if (!row?.value) return defaults;
  try {
    const parsed = JSON.parse(row.value) as Partial<StoredCookieSettings>;
    return {
      runnerUrl: typeof parsed.runnerUrl === "string" ? parsed.runnerUrl.trim() : defaults.runnerUrl,
      xhsProxy: typeof parsed.xhsProxy === "string" ? parsed.xhsProxy.trim() : defaults.xhsProxy,
      sites: parsed.sites && typeof parsed.sites === "object" ? parsed.sites : {},
    };
  } catch {
    return defaults;
  }
}

function saveCookieSettings(next: StoredCookieSettings): void {
  run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    SETTINGS_KEY,
    JSON.stringify(next),
    new Date().toISOString(),
  );
}

export function updateCookieSettings(patch: {
  runnerUrl?: string;
  xhsProxy?: string;
  cookies?: Partial<Record<CookieSiteKey, string>>;
}): PublicCookieStatus {
  const cur = getCookieSettings();
  const next: StoredCookieSettings = {
    runnerUrl: patch.runnerUrl !== undefined ? patch.runnerUrl.trim() : cur.runnerUrl,
    xhsProxy: patch.xhsProxy !== undefined ? patch.xhsProxy.trim() : cur.xhsProxy,
    sites: { ...cur.sites },
  };

  if (patch.cookies) {
    const now = new Date().toISOString();
    for (const site of ["zhihu", "xhs", "xiaoheihe"] as const) {
      if (!(site in patch.cookies)) continue;
      const raw = String(patch.cookies[site] ?? "").trim();
      if (!raw) {
        delete next.sites[site];
        continue;
      }
      const parsed = parseCookieInput(raw, site);
      if (!parsed.length) {
        throw new Error(`${site} Cookie 格式无法识别，请粘贴浏览器 Cookie 字符串或 Cookie-Editor JSON`);
      }
      next.sites[site] = { raw, cookies: parsed, updatedAt: now };
    }
  }

  saveCookieSettings(next);
  return toPublicCookieStatus(next);
}

export function toPublicCookieStatus(settings: StoredCookieSettings = getCookieSettings()): PublicCookieStatus {
  const sites = {} as Record<CookieSiteKey, PublicSiteCookieStatus>;
  for (const site of ["zhihu", "xhs", "xiaoheihe"] as const) {
    const entry = settings.sites[site];
    const cookies = entry?.cookies ?? [];
    const keyNames = cookies.map((c) => c.name);
    sites[site] = {
      site,
      configured: cookies.length > 0,
      count: cookies.length,
      keyNames: keyNames.slice(0, 12),
      hasAuthHint: keyNames.some((k) => SITE_AUTH_HINTS[site].test(k)),
      updatedAt: entry?.updatedAt ?? null,
    };
  }
  return {
    runnerUrl: settings.runnerUrl,
    xhsProxy: settings.xhsProxy,
    sites,
  };
}

export function hasCookieConfiguredForSource(sourceId: string): boolean {
  const site = siteKeyOfSource(sourceId);
  if (!site) return false;
  const s = getCookieSettings();
  return Boolean(s.runnerUrl && (s.sites[site]?.cookies?.length ?? 0) > 0);
}
