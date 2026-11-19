import { loginPage } from "./login-page.ts";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";

export type SiteAuthOptions = {
  enabled: boolean;
  password: string;
  secureCookie?: boolean;
  /** Exact external origin behind HTTPS proxies; never trust forwarded headers. */
  origin?: string;
  sessionTtlMs?: number;
  now?: () => number;
};

const COOKIE = "radar_session";
const MAX_SESSIONS = 256;
const LOGIN_WINDOW_MS = 15 * 60_000;
const MAX_LOGIN_ATTEMPTS = 10;
const verified = new WeakSet<Context>();
export const hasSiteSession = (c: Context) => verified.has(c);
const digest = (s: string) => createHash("sha256").update(s).digest();

/** Mount before every logger, API and static-file handler. Single-process, restart revokes all sessions. */
export function registerSiteAuth(app: Hono, options: SiteAuthOptions) {
  if (!options.enabled) return;
  const now = options.now ?? Date.now;
  const ttl = Math.min(Math.max(options.sessionTtlMs || 12 * 3600_000, 1000), 7 * 86400_000);
  const sessions = new Map<string, number>();
  const passwordHash = digest(options.password);
  let origin: string | undefined;
  let validConfig = Boolean(options.password);
  if (options.origin) {
    try {
      const url = new URL(options.origin);
      if (!/^https?:$/.test(url.protocol) || url.origin !== options.origin) throw new Error("invalid origin");
      origin = url.origin;
    } catch { validConfig = false; }
  }
  // Global fixed-size throttle intentionally ignores XFF/CF headers. Also bounds distributed attacks.
  let windowStart = now();
  let attempts = 0;
  const cookieOptions = { httpOnly: true, sameSite: "Strict" as const, secure: Boolean(options.secureCookie), path: "/" };
  const clearCookie = (c: Context) => setCookie(c, COOKIE, "", { ...cookieOptions, maxAge: 0 });
  const sameOrigin = (c: Context) => {
    const supplied = c.req.header("origin");
    return supplied === (origin ?? new URL(c.req.url).origin)
      && c.req.header("sec-fetch-site") !== "cross-site";
  };
  const page = (c: Context, message?: string, status: 200 | 401 | 429 = 200) => {
    c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    return c.html(loginPage(message), status);
  };

  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store, max-age=0");
    c.header("Referrer-Policy", "same-origin");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    const path = c.req.path;
    const method = c.req.method;
    if (path === "/health" && (method === "GET" || method === "HEAD")) return c.json({ ok: true });
    if (!validConfig) return c.json({ error: "站点登录配置不可用" }, 503);

    const time = now();
    for (const [key, expires] of sessions) if (expires <= time) sessions.delete(key);
    let token = "";
    try { token = getCookie(c, COOKIE) ?? ""; } catch { /* malformed cookie is unauthenticated */ }
    const key = /^[a-f0-9]{64}$/.test(token) ? digest(token).toString("hex") : "";
    const authenticated = Boolean(key && sessions.has(key));

    if (path === "/auth/login" && method === "POST") {
      if (!sameOrigin(c)) return c.json({ error: "请求来源不合法" }, 403);
      if (time - windowStart >= LOGIN_WINDOW_MS) { windowStart = time; attempts = 0; }
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        c.header("Retry-After", String(Math.ceil((LOGIN_WINDOW_MS - (time - windowStart)) / 1000)));
        return page(c, "尝试次数过多，请稍后再试。", 429);
      }
      attempts++;
      if (c.req.header("content-type")?.split(";")[0]?.trim() !== "application/x-www-form-urlencoded") {
        return c.json({ error: "请求格式不合法" }, 415);
      }
      // Bound the body even for chunked requests (Content-Length alone is not sufficient).
      const reader = c.req.raw.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 4096) { await reader.cancel(); return c.json({ error: "请求过大" }, 413); }
            chunks.push(part.value);
          }
        } catch { return c.json({ error: "请求格式不合法" }, 400); }
        finally { reader.releaseLock(); }
      }
      const given = new URLSearchParams(Buffer.concat(chunks).toString("utf8")).get("password") ?? "";
      if (!timingSafeEqual(digest(given), passwordHash)) return page(c, "密码不正确，请重试。", 401);
      // Rotate an existing session, and evict the oldest session when full.
      sessions.delete(key);
      if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
      const fresh = randomBytes(32).toString("hex");
      sessions.set(digest(fresh).toString("hex"), time + ttl);
      setCookie(c, COOKIE, fresh, { ...cookieOptions, maxAge: Math.floor(ttl / 1000) });
      return c.redirect("/", 303);
    }
    if (path === "/auth/logout" && method === "POST") {
      if (!sameOrigin(c)) return c.json({ error: "请求来源不合法" }, 403);
      sessions.delete(key);
      clearCookie(c);
      return c.redirect("/auth/login", 303);
    }
    if (path === "/auth/login" && method === "GET") return authenticated ? c.redirect("/", 303) : page(c);
    if (!authenticated) {
      if ((method === "GET" || method === "HEAD") && !path.startsWith("/api/") && path !== "/api"
        && !path.startsWith("/assets/") && !/\.[^/]+$/.test(path)
        && (path === "/" || c.req.header("accept")?.includes("text/html"))) return page(c, undefined, 401);
      return c.json({ error: "请先登录", needAuth: true }, 401);
    }
    // All cookie-authenticated writes require Origin, including unknown/new endpoints.
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && !sameOrigin(c)) {
      return c.json({ error: "请求来源不合法" }, 403);
    }
    verified.add(c);
    await next();
    // Override static handlers' public/immutable cache settings, including authenticated assets.
    c.header("Cache-Control", "private, no-store, max-age=0");
  });
}