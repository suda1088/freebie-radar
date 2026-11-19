/**
 * 管理端凭据：只存在 sessionStorage，关掉标签页就没了。
 * 用全局 fetch 包装统一带上 Authorization，避免每个调用点都要改。
 */
const KEY = "radar-admin-token";
let siteSession = false;
export const isSiteSession = () => siteSession;

/** Only server-validated session state; the browser never receives the site password. */
export async function initializeSiteAuth(): Promise<void> {
  const r = await fetch("/api/auth/check", { cache: "no-store" });
  if (r.status === 401) { window.location.replace("/auth/login"); throw new Error("Login required"); }
  if (!r.ok) throw new Error("Authentication unavailable");
  const state = await r.json() as { siteProtected?: boolean; authenticated?: boolean };
  siteSession = Boolean(state.siteProtected && state.authenticated);
  if (siteSession) clearToken();
}

export function getToken(): string {
  if (siteSession) return "";
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string): void {
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    /* 隐私模式下不可用，退化为不保存 */
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* 同上 */
  }
}

let installed = false;

/** 在 main.tsx 里调用一次：所有 fetch 自动附带管理密码。 */
export function installAuthFetch(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const orig = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (url.origin !== window.location.origin) return orig(input, init);
    if (siteSession) {
      const response = await orig(input, init);
      if (response.status === 401) window.location.replace("/auth/login");
      return response;
    }
    const token = getToken();
    if (!token) return orig(input, init);
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : {}));
    if (!headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
    return orig(input, { ...init, headers });
  }) as typeof fetch;
}

/** 验证密码：命中返回 true。 */
export async function verifyToken(token: string): Promise<boolean> {
  const r = await fetch("/api/auth/check", { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) return false;
  // 真正需要密码的接口再探一次，确认有权限
  const probe = await fetch("/api/push", { headers: { authorization: `Bearer ${token}` } });
  if (probe.status === 401) return false;
  return true;
}
