#!/usr/bin/env python3
"""
Freebie Radar VPS 按需无头 Cookie 执行器（平时 0 MB 浏览器内存）：
- 监听内网/网桥地址（默认 127.0.0.1:18790），不对外暴露
- 收到 /collect 请求时加锁串行拉起无头 Chrome，注入前端托管的 Cookie（小红书可选走国内代理）
- 抓取完成后在 finally 里立即关闭 browser 释放全部内存
"""

import json
import os
import re
import threading
import time
import urllib.parse
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

HOST = os.environ.get("RUNNER_HOST", "192.0.2.1")
PORT = int(os.environ.get("RUNNER_PORT", "18790"))
TOKEN = os.environ.get("INGEST_TOKEN", "").strip()
CHROME_PATH = os.environ.get("CHROME_EXECUTABLE", "/usr/bin/google-chrome")

LOCK = threading.Lock()


def launch_browser(pw, proxy_url: str = ""):
    kwargs = {
        "headless": True,
        "args": [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-blink-features=AutomationControlled",
            "--blink-settings=imagesEnabled=false",
        ],
    }
    if CHROME_PATH and os.path.exists(CHROME_PATH):
        kwargs["executable_path"] = CHROME_PATH
    if proxy_url:
        kwargs["proxy"] = {"server": proxy_url}
    return pw.chromium.launch(**kwargs)


def normalize_cookies(raw_cookies, default_domain: str):
    out = []
    for c in raw_cookies or []:
        if not isinstance(c, dict):
            continue
        name = str(c.get("name", "")).strip()
        value = str(c.get("value", ""))
        domain = str(c.get("domain", default_domain) or default_domain).strip()
        path = str(c.get("path", "/") or "/").strip()
        if not name or not value:
            continue
        out.append({"name": name, "value": value, "domain": domain, "path": path})
    return out


CHATTER_RE = re.compile(
    r"^(?:怎么看待|如何评价|怎样做才|为什么|为何|男生|女生|请问|有人知道)|被白嫖|白嫖怪|相亲|考研|骑手|求推荐|求一个|求个|求购"
)


def _clean_text(text: str, limit: int = 3500) -> str:
    return re.sub(r"\s+", " ", text or "").strip()[:limit]


def collect_zhihu(page, keywords):
    seen = {}
    for kw in keywords:
        if len(seen) >= 45:
            break
        url = "https://www.zhihu.com/search?type=content&q=" + urllib.parse.quote(str(kw))
        page.goto(url, wait_until="domcontentloaded", timeout=25000)
        page.wait_for_timeout(2000)
        state = page.evaluate(
            """() => {
              const text = document.body?.innerText || '';
              const needLogin = /登录\\/注册|扫码登录|安全验证/.test(text) && location.pathname.includes('/signin');
              const cards = Array.from(document.querySelectorAll('.SearchResult-Card, .List-item'));
              const items = cards.map((c) => {
                const a = c.querySelector('h2 a, .ContentItem-title a');
                const t = c.querySelector('.RichText');
                return {
                  title: ((a && a.textContent) || '').trim(),
                  url: (a && a.href) || '',
                  summary: ((t && t.textContent) || '').trim().slice(0, 300),
                };
              }).filter((x) => x.title && x.url);
              return { needLogin, items };
            }"""
        )
        if state.get("needLogin") and not state.get("items"):
            raise PermissionError("知乎登录态已失效或触发安全验证")
        for it in state.get("items", []):
            seen.setdefault(it["url"], it)

    candidates = [u for u, it in seen.items() if not CHATTER_RE.search(it["title"])][:18]
    if candidates:
        try:
            details = page.evaluate(
                """async (urls) => {
                  const out = {};
                  for (const u of urls) {
                    const mAns = u.match(/answer\\/(\\d+)/);
                    const mArt = u.match(/zhuanlan\\.zhihu\\.com\\/p\\/(\\d+)/);
                    const api = mAns
                      ? `https://www.zhihu.com/api/v4/answers/${mAns[1]}?include=content`
                      : (mArt ? `https://zhuanlan.zhihu.com/api/articles/${mArt[1]}` : '');
                    if (!api) continue;
                    try {
                      const r = await fetch(api, { credentials: 'include' });
                      if (!r.ok) continue;
                      const j = await r.json();
                      const txt = String(j.content || '')
                        .replace(/<br\\s*\\/?>/gi, '\\n')
                        .replace(/<\\/p>/gi, '\\n')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\\s+/g, ' ')
                        .trim();
                      const ts = Number(j.updated_time || j.created_time || 0);
                      if (txt) out[u] = { content: txt.slice(0, 3500), ts: Number.isFinite(ts) && ts > 0 ? ts : 0 };
                    } catch {}
                  }
                  return out;
                }""",
                candidates,
            )
            for u, d in (details or {}).items():
                if u in seen and d.get("content"):
                    seen[u]["content"] = d["content"]
                    seen[u]["summary"] = _clean_text(d["content"], 380)
                    if d.get("ts"):
                        seen[u]["publishedAt"] = datetime.fromtimestamp(d["ts"], tz=timezone.utc).isoformat()
        except Exception:
            pass

    return [
        {
            "externalId": it["url"],
            "url": it["url"],
            "title": it["title"],
            "summary": it.get("summary", ""),
            "content": it.get("content") or None,
            "publishedAt": it.get("publishedAt") or None,
            "tags": ["zhihu", "cookie-vps"],
        }
        for it in seen.values()
    ]


def collect_xhs(page, keywords):
    seen = {}
    detail_budget = 6
    last_err = None

    for kw in keywords:
        if len(seen) >= 45:
            break
        url = (
            "https://www.xiaohongshu.com/search_result?keyword="
            + urllib.parse.quote(str(kw))
            + "&source=web_search_result_notes"
        )
        try:
            page.goto(url, wait_until="commit", timeout=25000)
            for _ in range(20):
                if page.locator("section.note-item").count() > 0:
                    break
                page.wait_for_timeout(450)
            page.wait_for_timeout(800)
        except Exception as err:
            last_err = err
            continue
        try:
            page.locator("text=最新").first.click(timeout=1500)
            page.wait_for_timeout(800)
        except Exception:
            pass
        page.mouse.wheel(0, 1600)
        page.wait_for_timeout(700)
        state = page.evaluate(
            """() => {
              const text = document.body?.innerText || '';
              const needLogin = /登录后查看搜索结果|扫码登录|手机号登录/.test(text);
              const items = Array.from(document.querySelectorAll('section.note-item')).map((c) => {
                const a = c.querySelector('a.cover') || c.querySelector('a[href*="/search_result/"]') || c.querySelector('a[href*="/explore/"]');
                const t = c.querySelector('.title span, .footer .title, .title');
                const au = c.querySelector('.author .name, .name');
                const img = c.querySelector('img');
                const rawHref = (a && a.href) || '';
                const m = rawHref.match(/\\/(?:explore|search_result)\\/([0-9a-zA-Z]+)/);
                const canonical = m ? `https://www.xiaohongshu.com/explore/${m[1]}` : rawHref;
                return {
                  title: ((t && t.textContent) || '').trim(),
                  url: canonical,
                  fetchUrl: rawHref,
                  author: ((au && au.textContent) || '').trim(),
                  imageUrl: img ? (img.getAttribute('src') || '') : '',
                };
              }).filter((x) => x.title && x.url);
              return { needLogin, items };
            }"""
        )
        if state.get("needLogin") and not state.get("items"):
            raise PermissionError("小红书 Cookie 已失效或被跳转国际版/验证")

        batch_targets = []
        for it in state.get("items", []):
            seen.setdefault(it["url"], it)
            if (
                detail_budget > 0
                and len(batch_targets) < 3
                and not seen[it["url"]].get("content")
                and not CHATTER_RE.search(it["title"])
                and it.get("fetchUrl")
            ):
                batch_targets.append({"url": it["url"], "fetchUrl": it["fetchUrl"]})
                detail_budget -= 1

        # 并发 fetch 笔记 SSR HTML（精确按 URL 一一对应，彻底无弹窗错位）
        if batch_targets:
            try:
                details = page.evaluate(
                    """async (targets) => {
                      const out = {};
                      await Promise.all(targets.map(async ({ url, fetchUrl }) => {
                        try {
                          const r = await fetch(fetchUrl, { credentials: 'include', signal: AbortSignal.timeout(8000) });
                          if (!r.ok) return;
                          const html = await r.text();
                          const dMatch = html.match(/"desc":"((?:\\\\.|[^"])*)"/);
                          let desc = '';
                          if (dMatch) {
                            try { desc = JSON.parse('"' + dMatch[1] + '"'); } catch { desc = dMatch[1]; }
                          }
                          if (!desc) {
                            const m = html.match(/<meta\\s+name="description"\\s+content="([^"]*)"/i)
                              || html.match(/<meta\\s+content="([^"]*)"\\s+name="description"/i);
                            if (m) desc = m[1];
                          }
                          const tMatch = html.match(/"time":(\\d{10,13})/);
                          const ts = tMatch ? Number(tMatch[1]) : 0;
                          if (desc && desc.trim()) {
                            out[url] = { desc: desc.trim().slice(0, 3500), ts: Number.isFinite(ts) ? ts : 0 };
                          }
                        } catch {}
                      }));
                      return out;
                    }""",
                    batch_targets,
                )
                for u, d in (details or {}).items():
                    if u in seen and d.get("desc"):
                        seen[u]["content"] = d["desc"]
                        seen[u]["summary"] = _clean_text(d["desc"], 380)
                        ts = d.get("ts") or 0
                        if ts > 0:
                            sec = ts / 1000.0 if ts > 1e12 else float(ts)
                            seen[u]["publishedAt"] = datetime.fromtimestamp(sec, tz=timezone.utc).isoformat()
            except Exception:
                pass

    if not seen and last_err is not None:
        raise last_err

    return [
        {
            "externalId": it["url"],
            "url": it["url"],
            "title": it["title"],
            "summary": it.get("summary", ""),
            "content": it.get("content") or None,
            "author": it.get("author") or None,
            "publishedAt": it.get("publishedAt") or None,
            "imageUrl": it.get("imageUrl") or None,
            "tags": ["xiaohongshu", "cookie-vps"],
        }
        for it in seen.values()
    ]


def collect_xiaoheihe(page, keywords):
    seen = {}
    captured = []
    feed_captured = []

    def on_response(resp):
        if resp.request.method == "OPTIONS" or resp.status != 200:
            return
        if "general/search" in resp.url:
            try:
                captured.append(resp.text())
            except Exception:
                pass
        elif "/bbs/app/feeds?" in resp.url:
            try:
                feed_captured.append(resp.text())
            except Exception:
                pass
    page.on("response", on_response)
    try:
        for kw in keywords:
            if len(seen) >= 40:
                break
            captured.clear()
            page.goto(f"https://www.xiaoheihe.cn/app/bbs/home?t={int(time.time())}", wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(2400)
            try:
                page.fill(".el-input__inner", str(kw), timeout=8000)
                page.press(".el-input__inner", "Enter")
            except Exception:
                continue
            for _ in range(12):
                if captured:
                    break
                page.wait_for_timeout(1000)
            for txt in list(captured):
                try:
                    parsed = json.loads(txt)
                    for it in (parsed.get("result") or {}).get("items") or []:
                        if it.get("type") != "link" or not isinstance(it.get("info"), dict):
                            continue
                        n = it["info"]
                        linkid = str(n.get("linkid") or "").strip()
                        if not linkid:
                            continue
                        title = re.sub(r"<[^>]+>", "", str(n.get("title") or "")).strip()
                        summary = re.sub(r"<[^>]+>", "", str(n.get("description") or "")).strip()[:300]
                        created_at = n.get("create_at")
                        published_at = None
                        if isinstance(created_at, (int, float)) and created_at > 0:
                            published_at = datetime.fromtimestamp(created_at, tz=timezone.utc).isoformat()
                        topics = [t.get("name") for t in (n.get("topics") or []) if isinstance(t, dict) and t.get("name")]
                        seen.setdefault(
                            linkid,
                            {
                                "externalId": linkid,
                                "url": f"https://www.xiaoheihe.cn/app/bbs/link/{linkid}",
                                "title": title,
                                "summary": summary,
                                "content": None,
                                "publishedAt": published_at,
                                "tags": ["xiaoheihe", *topics[:2]],
                            },
                        )
                except Exception:
                    pass
    finally:
        try:
            page.remove_listener("response", on_response)
        except Exception:
            pass

    if not seen and feed_captured:
        for txt in list(feed_captured):
            try:
                parsed = json.loads(txt)
                for n in (parsed.get("result") or {}).get("links") or []:
                    if not isinstance(n, dict):
                        continue
                    linkid = str(n.get("linkid") or "").strip()
                    title = re.sub(r"<[^>]+>", "", str(n.get("title") or "")).strip()
                    if not linkid or not title or not re.search(r"免费|白嫖|喜加一|限免|领取|福利|优惠", title):
                        continue
                    summary = re.sub(r"<[^>]+>", "", str(n.get("description") or "")).strip()[:300]
                    created_at = n.get("create_at")
                    published_at = datetime.fromtimestamp(created_at, tz=timezone.utc).isoformat() if isinstance(created_at, (int, float)) and created_at > 0 else None
                    seen.setdefault(
                        linkid,
                        {
                            "externalId": linkid,
                            "url": f"https://www.xiaoheihe.cn/app/bbs/link/{linkid}",
                            "title": title,
                            "summary": summary,
                            "content": None,
                            "publishedAt": published_at,
                            "tags": ["xiaoheihe"],
                        },
                    )
            except Exception:
                pass
    if not seen:
        need_login = page.evaluate("() => /登录\\/注册/.test(document.body?.innerText || '') && !document.querySelector('.user-info, .avatar, .el-avatar')")
        if need_login:
            raise PermissionError("小黑盒 Cookie 已失效或未抓取到搜索响应")
    items = list(seen.values())
    detail_targets = [it for it in items if not CHATTER_RE.search(it.get("title", ""))][:8]
    for it in detail_targets:
        try:
            page.goto(it["url"], wait_until="domcontentloaded", timeout=20000)
            body = ""
            for _ in range(14):
                page.wait_for_timeout(350)
                body = page.evaluate(
                    """() => {
                      const el = document.querySelector('.article-content, .link-content, .post-content, article, main');
                      const txt = el ? el.innerText.trim() : '';
                      return txt;
                    }"""
                )
                if len(body or "") > 350 and "京ICP备" not in (body or "")[:180]:
                    break
            if not body or len(body) <= 260 or "京ICP备" in body[:180]:
                continue
            trimmed = re.sub(r"^返回[\s\S]*?Lv\.\d+[\s\S]*?关注\s*", "", body)
            trimmed = re.sub(r"^返回\s+.*?关注\s+", "", trimmed)
            cleaned = _clean_text(trimmed, 3500)
            if len(cleaned) > len(it.get("summary") or ""):
                it["content"] = cleaned
                it["summary"] = cleaned[:380]
        except Exception:
            pass
    return items


def run_collect(site: str, raw_cookies, keywords, proxy_url: str):
    domain_map = {"zhihu": ".zhihu.com", "xhs": ".xiaohongshu.com", "xiaoheihe": ".xiaoheihe.cn"}
    cookies = normalize_cookies(raw_cookies, domain_map[site])
    if not cookies:
        raise ValueError("Cookie 为空")

    with LOCK:
        with sync_playwright() as pw:
            browser = launch_browser(pw, proxy_url if site == "xhs" else "")
            try:
                ctx = browser.new_context(
                    viewport={"width": 1280, "height": 860},
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                )
                ctx.add_cookies(cookies)
                page = ctx.new_page()
                page.set_default_timeout(35000)
                if site == "zhihu":
                    return collect_zhihu(page, keywords)
                if site == "xhs":
                    return collect_xhs(page, keywords)
                if site == "xiaoheihe":
                    return collect_xiaoheihe(page, keywords)
                raise ValueError(f"Unsupported site: {site}")
            finally:
                try:
                    browser.close()
                except Exception:
                    pass


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[cookie-runner] {self.address_string()} - {fmt % args}", flush=True)

    def _send_json(self, code: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"ok": True, "busy": LOCK.locked(), "chrome": os.path.exists(CHROME_PATH)})
            return
        self._send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path != "/collect":
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        if TOKEN:
            auth = self.headers.get("Authorization", "")
            given = auth[7:].strip() if auth.startswith("Bearer ") else ""
            if given != TOKEN:
                self._send_json(401, {"ok": False, "error": "unauthorized"})
                return
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            self._send_json(400, {"ok": False, "error": "invalid json"})
            return
        site = str(body.get("site", "")).strip()
        if site not in ("zhihu", "xhs", "xiaoheihe"):
            self._send_json(400, {"ok": False, "error": f"unsupported site: {site}"})
            return
        keywords = body.get("keywords") or ["免费领取"]
        cookies = body.get("cookies") or []
        proxy = str(body.get("proxy", "") or "").strip()
        try:
            items = run_collect(site, cookies, keywords, proxy)
            self._send_json(200, {"ok": True, "items": items})
        except PermissionError as err:
            self._send_json(200, {"ok": False, "needLogin": True, "error": str(err)})
        except Exception as err:
            self._send_json(500, {"ok": False, "error": str(err)[:300]})


if __name__ == "__main__":
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[cookie-runner] listening on http://{HOST}:{PORT} chrome={CHROME_PATH}", flush=True)
    srv.serve_forever()
