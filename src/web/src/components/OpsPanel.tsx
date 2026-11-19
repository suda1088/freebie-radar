import { SaveStatus, type SaveState } from "./SaveStatus.tsx";
import { SourceCatalog } from "./SourceCatalog.tsx";
import type { SourceView } from "../lib/source-status.ts";
import { CollectionControl } from "./CollectionControl.tsx";
import { FailureNote } from "./FailureNote.tsx";
import { Select } from "./Select.tsx";
import { Fragment, useEffect, useState } from "react";
import { Activity, Check, Copy, Database, ExternalLink, Gauge, KeyRound, Loader2, Pencil, Play, Plus, Rss, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { formatInterval, timeAgo } from "../lib/sources.ts";
import type { RetentionSettings, Run, Source, SourceQuality } from "../types.ts";

const INTERVAL_OPTIONS = [
  { label: "60 秒", sec: 60 },
  { label: "90 秒", sec: 90 },
  { label: "2 分钟", sec: 120 },
  { label: "5 分钟", sec: 300 },
  { label: "15 分钟", sec: 900 },
  { label: "30 分钟", sec: 1800 },
  { label: "1 小时", sec: 3600 },
  { label: "6 小时", sec: 21600 },
];

const KIND_HINT_OPTIONS = [
  { value: "", label: "用途：自动识别" },
  { value: "news", label: "用途：重要新闻（直入重要新闻频道）" },
  { value: "info", label: "用途：行业资讯（经济/股票/科技）" },
  { value: "freebie", label: "用途：白嫖福利" },
  { value: "deal", label: "用途：特价好价" },
  { value: "opensource", label: "用途：开源项目" },
];

const CATEGORY_HINT_OPTIONS = [
  { value: "", label: "分类：自动识别" },
  { value: "headline", label: "时政要闻" },
  { value: "world", label: "国际要闻" },
  { value: "finance", label: "经济/商业" },
  { value: "stock", label: "股票/市场" },
  { value: "tech", label: "科技前沿" },
  { value: "ai", label: "AI 额度/前沿" },
  { value: "cloud", label: "云服务" },
  { value: "vps", label: "VPS/主机" },
  { value: "software", label: "软件授权" },
  { value: "game", label: "游戏" },
  { value: "opensource", label: "开源项目" },
  { value: "news", label: "综合资讯" },
];

type OpsTab = "sources" | "runs" | "quality" | "retention";

function SourceInlineEditor({
  source,
  onSave,
  onDelete,
  onCancel,
}: {
  source: Source;
  onSave: (patch: { name: string; interval_sec: number; config: Record<string, unknown> }) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
  onCancel: () => void;
}) {
  const cfg = source.config ?? {};
  const feeds = Array.isArray(cfg.feeds) ? (cfg.feeds as Array<Record<string, unknown>>) : [];
  const firstFeed = feeds[0] ?? {};
  const channels = Array.isArray(cfg.channels) ? (cfg.channels as unknown[]).filter((c) => typeof c === "string") : [];

  const [name, setName] = useState(source.name);
  const [intervalSec, setIntervalSec] = useState(source.interval_sec);
  const [kindHint, setKindHint] = useState(typeof cfg.kindHint === "string" ? cfg.kindHint : "");
  const [categoryHint, setCategoryHint] = useState(
    typeof cfg.categoryHint === "string"
      ? cfg.categoryHint
      : typeof firstFeed.categoryHint === "string"
        ? firstFeed.categoryHint
        : "",
  );
  const [rssUrl, setRssUrl] = useState(typeof firstFeed.url === "string" ? firstFeed.url : "");
  const [rssLimit, setRssLimit] = useState(typeof firstFeed.limit === "number" ? String(firstFeed.limit) : "30");
  const [rssKeywords, setRssKeywords] = useState(
    Array.isArray(firstFeed.titleKeywords) ? (firstFeed.titleKeywords as string[]).join(", ") : "",
  );
  const [tgChannels, setTgChannels] = useState(channels.join(", "));
  const [showJson, setShowJson] = useState(source.kind !== "rss" && source.kind !== "telegram");
  const [rawJson, setRawJson] = useState(() => JSON.stringify(cfg, null, 2));
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [saveState,setSaveState] = useState<SaveState>("idle");

  const buildNextConfig = (): Record<string, unknown> | null => {
    setJsonErr(null);
    let base: Record<string, unknown>;
    if (showJson) {
      try {
        const parsed = JSON.parse(rawJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setJsonErr("JSON 必须是对象 {}");
          return null;
        }
        base = parsed as Record<string, unknown>;
      } catch (e) {
        setJsonErr(e instanceof Error ? e.message : "JSON 语法错误");
        return null;
      }
    } else {
      base = { ...cfg };
    }

    if (kindHint.trim()) base.kindHint = kindHint.trim();
    else delete base.kindHint;

    if (categoryHint.trim()) base.categoryHint = categoryHint.trim();
    else delete base.categoryHint;

    if (!showJson && source.kind === "rss") {
      const nextFeed: Record<string, unknown> = {
        ...firstFeed,
        id: typeof firstFeed.id === "string" && firstFeed.id ? firstFeed.id : source.id.replace(/^rss-/, ""),
        url: rssUrl.trim(),
        limit: Math.max(1, Math.min(100, Number(rssLimit) || 30)),
      };
      if (categoryHint.trim()) nextFeed.categoryHint = categoryHint.trim();
      else delete nextFeed.categoryHint;
      const kws = rssKeywords
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (kws.length) nextFeed.titleKeywords = kws;
      else delete nextFeed.titleKeywords;
      base.feeds = [nextFeed, ...feeds.slice(1)];
    }

    if (!showJson && source.kind === "telegram") {
      base.channels = tgChannels
        .split(/[,，\s]+/)
        .map((s) => s.replace(/^@/, "").trim())
        .filter(Boolean);
    }

    return base;
  };

  const handleSave = async () => {
    const nextConfig = buildNextConfig();
    if (!nextConfig || !name.trim()) return;
    setSaving(true);setSaveState("saving");
    try {
      const ok = await onSave({ name: name.trim(), interval_sec: intervalSec, config: nextConfig });
      setSaveState(ok ? "saved" : "error");
    } catch { setSaveState("error"); } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-ink-200 bg-surface p-3.5 text-[12.5px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium text-ink-950">
          编辑数据源 <span className="font-mono text-[11px] text-ink-400">{source.id}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!showJson) {
              const built = buildNextConfig();
              if (built) setRawJson(JSON.stringify(built, null, 2));
            }
            setShowJson((v) => !v);
          }}
          className="text-[11.5px] font-medium text-brand hover:underline"
        >
          {showJson ? "切回表单编辑" : "高级 JSON 配置"}
        </button>
      </div>

      <SaveStatus state={saveState}/>
      <div className="grid gap-2.5 sm:grid-cols-12">
        <label className="space-y-1 sm:col-span-4">
          <span className="text-[11px] text-ink-500">显示名称</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-950 outline-none focus:border-brand"
          />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-[11px] text-ink-500">采集周期</span>
          <Select aria-label="采集间隔"
            value={intervalSec}
            onValueChange={(value) => setIntervalSec(Number(value))}
            className="w-full rounded-lg border border-ink-200 bg-surface px-2 py-1.5 text-[12px] text-ink-800 outline-none focus:border-brand"
          >
            {!INTERVAL_OPTIONS.some((o) => o.sec === intervalSec) && (
              <option value={intervalSec}>{formatInterval(intervalSec)}</option>
            )}
            {INTERVAL_OPTIONS.map((o) => (
              <option key={o.sec} value={o.sec}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 sm:col-span-3">
          <span className="text-[11px] text-ink-500">用途频道（新抓取条目生效）</span>
          <Select aria-label="内容用途"
            value={kindHint}
            onValueChange={(value) => setKindHint(value)}
            className="w-full rounded-lg border border-ink-200 bg-surface px-2 py-1.5 text-[12px] text-ink-800 outline-none focus:border-brand"
          >
            {KIND_HINT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 sm:col-span-3">
          <span className="text-[11px] text-ink-500">默认兜底分类</span>
          <Select aria-label="默认分类"
            value={categoryHint}
            onValueChange={(value) => setCategoryHint(value)}
            className="w-full rounded-lg border border-ink-200 bg-surface px-2 py-1.5 text-[12px] text-ink-800 outline-none focus:border-brand"
          >
            {CATEGORY_HINT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {!showJson && source.kind === "rss" && (
        <div className="grid gap-2.5 sm:grid-cols-12">
          <label className="space-y-1 sm:col-span-6">
            <span className="text-[11px] text-ink-500">RSS / Atom 订阅地址</span>
            <input
              value={rssUrl}
              onChange={(e) => setRssUrl(e.target.value)}
              placeholder="https://example.com/rss.xml"
              className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink-950 outline-none focus:border-brand"
            />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-[11px] text-ink-500">每次条数</span>
            <input
              type="number"
              min={1}
              max={100}
              value={rssLimit}
              onChange={(e) => setRssLimit(e.target.value)}
              className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink-950 outline-none focus:border-brand"
            />
          </label>
          <label className="space-y-1 sm:col-span-4">
            <span className="text-[11px] text-ink-500">标题必含关键词（逗号分隔，留空全收）</span>
            <input
              value={rssKeywords}
              onChange={(e) => setRssKeywords(e.target.value)}
              placeholder="如：免费, 限免, free"
              className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 text-[12px] text-ink-950 outline-none focus:border-brand"
            />
          </label>
        </div>
      )}

      {!showJson && source.kind === "telegram" && (
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-500">Telegram 公开频道名（逗号或空格分隔）</span>
          <input
            value={tgChannels}
            onChange={(e) => setTgChannels(e.target.value)}
            placeholder="zaihuapd, vps_offers"
            className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink-950 outline-none focus:border-brand"
          />
        </label>
      )}

      {showJson && (
        <div className="space-y-1">
          <span className="text-[11px] text-ink-500">源 config JSON（可直接增删栏目 / feeds / 过滤参数）</span>
          <textarea
            rows={5}
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            className="w-full rounded-lg border border-ink-200 bg-surface p-2 font-mono text-[11.5px] text-ink-900 outline-none focus:border-brand"
          />
          {jsonErr && <div className="text-[11.5px] text-alert">{jsonErr}</div>}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div>
          {!source.builtIn && onDelete && (
            <button
              type="button"
              onClick={async () => {
                if (!confirmDel) {
                  setConfirmDel(true);
                  return;
                }
                const ok = await onDelete();
                if (ok) onCancel();
              }}
              className={
                "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-colors " +
                (confirmDel
                  ? "border-alert bg-alert text-white"
                  : "border-ink-200 bg-surface text-alert hover:border-alert/40 hover:bg-alert-subtle")
              }
            >
              <Trash2 size={12} /> {confirmDel ? "再点一次确认删除" : "删除自定义源"}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-surface px-3 py-1 text-[12px] text-ink-600 hover:bg-ink-100"
          >
            <X size={12} /> 取消
          </button>
          <button
            type="button"
            disabled={saving || !name.trim() || (!showJson && source.kind === "rss" && !/^https?:\/\//i.test(rssUrl.trim()))}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-1 text-[12px] font-medium text-white hover:bg-brand-hover disabled:opacity-40"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} 保存配置
          </button>
        </div>
      </div>
    </div>
  );
}

export function OpsPanel({
  sources,
  runs,
  sourceName,
  onCollectSource,
  onToggleSource,
  onChangeInterval,
  onAddRss,
  onUpdateSource,
  onDeleteSource,
  onNotify,
}: {
  sources: Source[];
  runs: Run[];
  sourceName: (id: string) => string;
  onCollectSource: (id: string) => Promise<void>;
  onToggleSource: (id: string, enabled: boolean) => Promise<void>;
  onChangeInterval: (id: string, sec: number) => Promise<void>;
  onAddRss: (name: string, url: string, intervalSec: number, kindHint?: string, categoryHint?: string) => Promise<void>;
  onUpdateSource: (id: string, patch: { name?: string; interval_sec?: number; config?: Record<string, unknown> }) => Promise<boolean>;
  onDeleteSource: (id: string) => Promise<boolean>;
  onNotify?: (msg: string) => void;
}) {
  const [subTab, setSubTab] = useState<OpsTab>("sources");
  const [filterText, setFilterText] = useState("");
  const [statusFilter, setStatusFilter] = useState<SourceView>("all");
  const [runningIds, setRunningIds] = useState<string[]>([]);
  const isRunning = (id: string) => runningIds.includes(id);
  const runSourceWithLock = async (id: string) => {
    setRunningIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    try {
      await onCollectSource(id);
    } finally {
      setRunningIds((prev) => prev.filter((x) => x !== id));
    }
  };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddRss, setShowAddRss] = useState(false);
  const [rssName, setRssName] = useState("");
  const [rssUrl, setRssUrl] = useState("");
  const [rssInterval, setRssInterval] = useState(1800);
  const [rssKindHint, setRssKindHint] = useState("");
  const [rssCategoryHint, setRssCategoryHint] = useState("");
  const [addingRss, setAddingRss] = useState(false);
  const [showIngestGuide, setShowIngestGuide] = useState(false);
  const [cookieStatus, setCookieStatus] = useState<{
    runnerUrl: string;
    xhsProxy: string;
    sites: Record<
      "zhihu" | "xhs" | "xiaoheihe",
      { site: "zhihu" | "xhs" | "xiaoheihe"; configured: boolean; count: number; keyNames: string[]; hasAuthHint: boolean; updatedAt: string | null }
    >;
  } | null>(null);
  const [cookieInputs, setCookieInputs] = useState<Record<"zhihu" | "xhs" | "xiaoheihe", string>>({
    zhihu: "",
    xhs: "",
    xiaoheihe: "",
  });
  const [runnerUrlInput, setRunnerUrlInput] = useState("http://127.0.0.1:18790");
  const [xhsProxyInput, setXhsProxyInput] = useState("");
  const [cookieBusy, setCookieBusy] = useState<string | null>(null);
  const [runnerTest, setRunnerTest] = useState<{ ok?: boolean; busy?: boolean; chrome?: boolean; error?: string } | null>(null);

  const loadCookieStatus = async () => {
    try {
      const r = await fetch("/api/cookies");
      if (!r.ok) return;
      const d = (await r.json()) as NonNullable<typeof cookieStatus>;
      setCookieStatus(d);
      setRunnerUrlInput(d.runnerUrl || "http://127.0.0.1:18790");
      setXhsProxyInput(d.xhsProxy || "");
    } catch { /* ignore */ }
  };

  useEffect(() => {
    void loadCookieStatus();
  }, []);

  const saveCookiePatch = async (
    patch: { runnerUrl?: string; xhsProxy?: string; cookies?: Partial<Record<"zhihu" | "xhs" | "xiaoheihe", string>> },
    busyKey: string,
    clearKey?: "zhihu" | "xhs" | "xiaoheihe",
  ): Promise<boolean> => {
    setCookieBusy(busyKey);
    try {
      const r = await fetch("/api/cookies", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = (await r.json().catch(() => ({}))) as NonNullable<typeof cookieStatus> & { error?: string };
      if (!r.ok) {
        onNotify?.(d.error ?? "保存失败");
        return false;
      }
      setCookieStatus(d);
      setRunnerUrlInput(d.runnerUrl || "");
      setXhsProxyInput(d.xhsProxy || "");
      if (clearKey) setCookieInputs((prev) => ({ ...prev, [clearKey]: "" }));
      onNotify?.("Cookie 托管配置已保存");
      return true;
    } finally {
      setCookieBusy(null);
    }
  };

  const testCookieRunner = async () => {
    setCookieBusy("test-runner");
    try {
      const r = await fetch("/api/cookies/test-runner", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runnerUrl: runnerUrlInput }),
      });
      const d = (await r.json().catch(() => ({}))) as NonNullable<typeof runnerTest>;
      setRunnerTest(d);
      onNotify?.(d.ok ? "VPS Cookie 执行器在线且已就绪" : "执行器未连接：" + (d.error ?? "检查端口/服务"));
    } finally {
      setCookieBusy(null);
    }
  };
  const [helperUrl, setHelperUrl] = useState(() => {
    try {
      return localStorage.getItem("radar_loopback_helper") || "http://127.0.0.1:18789";
    } catch {
      return "http://127.0.0.1:18789";
    }
  });
  const [ingestTokenInput, setIngestTokenInput] = useState("");

  const siteKeyOf = (id: string) => (id.startsWith("zhihu") ? "zhihu" : id.startsWith("xhs") ? "xhs" : "xiaoheihe");

  const startLoopbackLogin = async (sourceId: string) => {
    const base = helperUrl.replace(/\/+$/, "");
    const site = siteKeyOf(sourceId);
    try {
      const probe = await fetch(base + "/status", { signal: AbortSignal.timeout(1500) });
      if (!probe.ok) throw new Error("not ok");
    } catch {
      setShowIngestGuide(true);
      onNotify?.("未检测到本机回环助手（请按下方指引先启动，Cookie 绝不上传）");
      return;
    }
    const target = new URL(base + "/login");
    target.searchParams.set("site", site);
    target.searchParams.set("server", window.location.origin);
    target.searchParams.set("return_to", window.location.href.split("#")[0] ?? window.location.origin);
    if (ingestTokenInput.trim()) target.searchParams.set("token", ingestTokenInput.trim());
    window.open(target.toString(), "_blank", "noopener");
  };

  const buildUserscript = () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:8788";
    const tok = ingestTokenInput.trim() || "请替换为你的 INGEST_TOKEN";
    return `// ==UserScript==
// @name         Freebie Radar 零 Cookie 上传采集助手
// @namespace    https://github.com/ZiChuanLan/freebie-radar
// @version      0.1.0
// @description  仅读取当前搜索页公开帖子标题与链接发送到你自己的 Freebie Radar，Cookie 绝不离开浏览器
// @match        https://www.xiaohongshu.com/search_result*
// @match        https://www.zhihu.com/search*
// @match        https://www.xiaoheihe.cn/app/bbs/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==
(function () {
  const SERVER = ${JSON.stringify(origin)};
  const TOKEN = ${JSON.stringify(tok)};
  function push(sourceId, items) {
    if (!items.length) return;
    GM_xmlhttpRequest({
      method: "POST",
      url: SERVER + "/api/ingest",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
      data: JSON.stringify({ sourceId, items }),
      onload: (r) => console.log("[FreebieRadar]", sourceId, r.status, r.responseText),
    });
  }
  setTimeout(() => {
    const h = location.hostname;
    if (h.includes("xiaohongshu")) {
      const items = [...document.querySelectorAll("section.note-item")].map((c) => {
        const a = c.querySelector('a.cover, a[href*="/explore/"], a[href*="/search_result/"]');
        const t = c.querySelector(".title span, .footer .title, .title");
        const img = c.querySelector("img");
        return a && t ? { externalId: a.href, url: a.href, title: t.textContent.trim(), summary: "", imageUrl: img?.src || "" } : null;
      }).filter((x) => x && x.title && x.url);
      push("xhs-search", items);
    } else if (h.includes("zhihu")) {
      const items = [...document.querySelectorAll(".SearchResult-Card, .List-item")].map((c) => {
        const a = c.querySelector("h2 a, .ContentItem-title a");
        const t = c.querySelector(".RichText");
        const img = c.querySelector("img");
        return a ? { externalId: a.href, url: a.href, title: a.textContent.trim(), summary: (t?.textContent || "").trim().slice(0, 300), imageUrl: img?.getAttribute("data-original") || img?.src || "" } : null;
      }).filter((x) => x && x.title && x.url);
      push("zhihu-search", items);
    }
  }, 3500);
})();`;
  };

  const visibleSources = sources.filter((s) => {
    if (filterText && !(s.name + " " + s.id + " " + s.kind).toLowerCase().includes(filterText.toLowerCase())) {
      return false;
    }
    if (statusFilter === "disabled") return !s.enabled;
    if (statusFilter === "error") return s.last_status === "failed" || s.last_status === "degraded";
    if (statusFilter === "ok") return s.enabled && s.last_status === "ok";
    return true;
  });

  const enabledCount = sources.filter((s) => s.enabled).length;
  // Only loaded run history is available; do not imply this covers all historical success.
  const recentSuccess = new Map<string, string>();
  for (const r of runs) if (r.status === "ok" && r.finished_at) {
    const old = recentSuccess.get(r.source_id);
    if (!old || r.finished_at > old) recentSuccess.set(r.source_id, r.finished_at);
  }
  const errorCount = sources.filter((s) => s.enabled && (s.last_status === "failed" || s.last_status === "degraded")).length;

  const [retention, setRetention] = useState<RetentionSettings | null>(null);
  const [retCounts, setRetCounts] = useState<{ total: number; active: number; ignored: number; starred: number } | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanPreview, setCleanPreview] = useState<Record<string, number> | null>(null);


  // 来源质量榜：按源的 AI 留存率看谁在浪费采集与 AI 额度
  const [qualityDays, setQualityDays] = useState(7);
  const [quality, setQuality] = useState<SourceQuality[] | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);
  useEffect(() => {
    setQualityLoading(true);
    fetch("/api/source-quality?days=" + qualityDays)
      .then((r) => r.json())
      .then((j: { sources: SourceQuality[] }) => setQuality(j.sources))
      .catch(() => setQuality(null))
      .finally(() => setQualityLoading(false));
  }, [qualityDays, sources]);
  useEffect(() => {
    fetch("/api/retention")
      .then((r) => r.json())
      .then((j: { settings: RetentionSettings; counts: typeof retCounts }) => {
        setRetention(j.settings);
        setRetCounts(j.counts);
      })
      .catch(() => undefined);
  }, []);

  const saveRetentionField = async (patch: Partial<RetentionSettings>) => {
    if (!retention) return;
    setRetention({ ...retention, ...patch });
    const r = await fetch("/api/retention", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (r.ok) {
      const j = (await r.json()) as { settings: RetentionSettings; counts: typeof retCounts };
      setRetention(j.settings);
      setRetCounts(j.counts);
      onNotify?.("保留策略已保存");
    } else {
      onNotify?.("保存失败");
    }
  };

  const previewCleanup = async () => {
    const r = await fetch("/api/retention/preview", { method: "POST" });
    if (r.ok) setCleanPreview(((await r.json()) as { deleted: Record<string, number> }).deleted);
  };

  const doCleanup = async () => {
    setCleaning(true);
    try {
      const r = await fetch("/api/retention/run", { method: "POST" });
      if (r.ok) {
        const j = (await r.json()) as { deleted: Record<string, number>; counts: typeof retCounts };
        setCleanPreview(j.deleted);
        setRetCounts(j.counts);
        onNotify?.("清理完成");
      }
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="v3-operations space-y-4">
      {/* 顶部概览 + 子页签 */}
      <div className="soda-settings-toolbar panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { key: "sources" as OpsTab, label: `数据源 (${enabledCount}/${sources.length})`, icon: Rss },
            { key: "runs" as OpsTab, label: `采集记录 (${runs.length})`, icon: Activity },
            { key: "quality" as OpsTab, label: "来源质量榜", icon: Gauge },
            { key: "retention" as OpsTab, label: "数据保留与清理", icon: Database },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSubTab(t.key)}
              aria-pressed={subTab === t.key}
              className={
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors " +
                (subTab === t.key ? "bg-brand text-white" : "text-ink-600 hover:bg-ink-100")
              }
            >
              <t.icon size={13} />
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[12px] text-ink-500">
          <span>
            异常源{" "}
            <span className={`font-mono font-semibold ${errorCount > 0 ? "text-alert" : "text-deal"}`}>{errorCount}</span>
          </span>
          {retCounts && (
            <span>
              在库 <span className="font-mono font-semibold text-ink-800">{retCounts.total}</span>
            </span>
          )}
        </div>
      </div>

      {subTab === "sources" && (
        <div className="space-y-4">
          <CollectionControl sources={sources} onNotify={onNotify}/>
          <div className="panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="搜源名称 / 类型…"
                  className="rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 text-[12px] text-ink-900 outline-none focus:border-brand"
                />
                {(["all", "ok", "running", "missing", "error", "disabled"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setStatusFilter(k)}
                    className={
                      "rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors " +
                      (statusFilter === k ? "bg-brand-subtle text-brand" : "text-ink-600 hover:bg-ink-100")
                    }
                  >
                    {k === "all" ? `全部 (${sources.length})` : k === "ok" ? "正常" : k === "error" ? `异常 (${errorCount})` : k === "running" ? "正在采集" : k === "missing" ? "缺配置" : "已禁用"}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowIngestGuide((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-surface px-3 py-1.5 text-[12px] font-medium text-ink-700 hover:border-brand-border hover:text-brand"
                >
                  <KeyRound size={13} /> {showIngestGuide ? "收起 Cookie 托管" : "Cookie 托管（知乎/小红书/小黑盒）"}
                </button>
              <button
                type="button"
                onClick={() => setShowAddRss((v) => !v)}
                className="inline-flex items-center gap-1 rounded-lg border border-brand-border bg-brand-subtle px-3 py-1.5 text-[12px] font-medium text-brand hover:bg-ink-200/70"
              >
                <Plus size={13} /> {showAddRss ? "收起" : "添加 RSS / Atom"}
              </button>
            </div>
              </div>

            {showIngestGuide && (
              <div className="space-y-3.5 border-b border-ink-100 bg-brand-subtle/50 px-4 py-3.5 text-[12.5px] text-ink-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-medium text-ink-950">
                    <KeyRound size={14} className="text-brand" />
                    VPS Cookie 托管采集（按需拉起无头 Chrome，抓完立即释放，平时 0 MB 内存）
                  </div>
                  {runnerTest && (
                    <span
                      className={
                        "rounded px-2 py-0.5 text-[11px] font-medium " +
                        (runnerTest.ok ? "bg-deal-subtle text-deal" : "bg-alert-subtle text-alert")
                      }
                    >
                      {runnerTest.ok ? `执行器在线${runnerTest.chrome ? " · Chrome 就绪" : ""}` : `未连通：${runnerTest.error ?? "离线"}`}
                    </span>
                  )}
                </div>

                {/* 执行器地址与小红书代理 */}
                <div className="grid gap-2 sm:grid-cols-12">
                  <label className="space-y-1 sm:col-span-5">
                    <span className="text-[11px] text-ink-500">VPS 执行器地址（仅内网/Docker 网桥监听）</span>
                    <input
                      value={runnerUrlInput}
                      onChange={(e) => setRunnerUrlInput(e.target.value)}
                      placeholder="http://127.0.0.1:18790"
                      className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink-900 outline-none focus:border-brand"
                    />
                  </label>
                  <label className="space-y-1 sm:col-span-4">
                    <span className="text-[11px] text-ink-500">小红书国内代理出口（海外 VPS 必填，如 http://192.0.2.20:8888）</span>
                    <input
                      value={xhsProxyInput}
                      onChange={(e) => setXhsProxyInput(e.target.value)}
                      placeholder="http://192.0.2.20:8888"
                      className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink-900 outline-none focus:border-brand"
                    />
                  </label>
                  <div className="flex items-end gap-1.5 sm:col-span-3">
                    <button
                      type="button"
                      disabled={cookieBusy !== null}
                      onClick={() => void saveCookiePatch({ runnerUrl: runnerUrlInput, xhsProxy: xhsProxyInput }, "save-net")}
                      className="inline-flex h-8 flex-1 items-center justify-center rounded-lg bg-ink-950 px-2.5 text-[12px] font-medium text-white hover:bg-ink-800 disabled:opacity-40"
                    >
                      {cookieBusy === "save-net" ? <Loader2 size={12} className="animate-spin" /> : "保存线路"}
                    </button>
                    <button
                      type="button"
                      disabled={cookieBusy !== null}
                      onClick={() => void testCookieRunner()}
                      className="inline-flex h-8 items-center justify-center rounded-lg border border-ink-200 bg-surface px-2.5 text-[12px] font-medium text-ink-700 hover:border-brand-border hover:text-brand disabled:opacity-40"
                    >
                      {cookieBusy === "test-runner" ? <Loader2 size={12} className="animate-spin" /> : "测连通"}
                    </button>
                  </div>
                </div>

                {/* 三站 Cookie 粘贴卡 */}
                <div className="grid gap-2.5 lg:grid-cols-3">
                  {(
                    [
                      { key: "zhihu" as const, sourceId: "zhihu-search", title: "知乎（zhihu.com）", hint: "关键字段：z_c0 / d_c0" },
                      { key: "xhs" as const, sourceId: "xhs-search", title: "小红书（xiaohongshu.com）", hint: "关键字段：web_session / a1" },
                      { key: "xiaoheihe" as const, sourceId: "xiaoheihe-search", title: "小黑盒（xiaoheihe.cn）", hint: "关键字段：user_token / x_app_id" },
                    ] as const
                  ).map((site) => {
                    const st = cookieStatus?.sites[site.key];
                    const draft = cookieInputs[site.key];
                    return (
                      <div key={site.key} className="space-y-2 rounded-lg border border-ink-200 bg-surface p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-ink-950">{site.title}</span>
                          {st?.configured ? (
                            <span
                              className={
                                "rounded px-1.5 py-0.5 text-[10.5px] font-medium " +
                                (st.hasAuthHint ? "bg-deal-subtle text-deal" : "bg-code-subtle text-amber-800")
                              }
                              title={`已保存字段：${st.keyNames.join(", ")}`}
                            >
                              已托管 {st.count} 项{st.hasAuthHint ? " · 含登录态" : " · 待核对"}
                            </span>
                          ) : (
                            <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10.5px] text-ink-500">未配置</span>
                          )}
                        </div>
                        <div className="text-[11px] text-ink-400">
                          {st?.configured && st.updatedAt ? `更新于 ${timeAgo(st.updatedAt)} · ${st.keyNames.slice(0, 4).join(", ")}` : site.hint}
                        </div>
                        <textarea
                          rows={2}
                          value={draft}
                          onChange={(e) => setCookieInputs((prev) => ({ ...prev, [site.key]: e.target.value }))}
                          placeholder="粘贴 Request Cookie 字符串（a=1; b=2）或 Cookie-Editor 导出的 JSON 数组（保存后不回显明文）"
                          className="w-full rounded-md border border-ink-200 bg-canvas/50 p-2 font-mono text-[11px] text-ink-900 outline-none focus:border-brand"
                        />
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={!draft.trim() || cookieBusy !== null}
                              onClick={() => void saveCookiePatch({ cookies: { [site.key]: draft } }, `save-${site.key}`, site.key)}
                              className="inline-flex h-7 items-center gap-1 rounded-md bg-brand px-2.5 text-[11.5px] font-medium text-white hover:bg-brand-hover disabled:opacity-40"
                            >
                              {cookieBusy === `save-${site.key}` ? <Loader2 size={11} className="animate-spin" /> : "保存"}
                            </button>
                            <button
                              type="button"
                              disabled={(!draft.trim() && !st?.configured) || cookieBusy !== null || isRunning(site.sourceId)}
                              onClick={async () => {
                                if (draft.trim()) {
                                  const ok = await saveCookiePatch({ cookies: { [site.key]: draft } }, `run-${site.key}`, site.key);
                                  if (!ok) return;
                                }
                                await runSourceWithLock(site.sourceId);
                              }}
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-ink-200 bg-surface px-2.5 text-[11.5px] font-medium text-ink-800 hover:border-brand-border hover:text-brand disabled:opacity-40"
                            >
                              {isRunning(site.sourceId) ? <Loader2 size={11} className="animate-spin" /> : <Play size={10} />}
                              立即采集
                            </button>
                          </div>
                          {st?.configured && (
                            <button
                              type="button"
                              disabled={cookieBusy !== null}
                              onClick={() => void saveCookiePatch({ cookies: { [site.key]: "" } }, `del-${site.key}`, site.key)}
                              className="text-[11px] text-alert hover:underline"
                            >
                              清空
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <details className="rounded-lg border border-ink-200/80 bg-surface/80 px-3 py-2 text-[11.5px] text-ink-600">
                  <summary className="cursor-pointer font-medium text-ink-700">
                    备用：本机回环助手 / 油猴脚本（Cookie 留在本机时使用）
                  </summary>
                  <div className="mt-2 space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[11.5px] text-ink-500">本机回环助手地址</span>
                    <input
                      value={helperUrl}
                      onChange={(e) => {
                        setHelperUrl(e.target.value);
                        try {
                          localStorage.setItem("radar_loopback_helper", e.target.value);
                        } catch { /* ignore */ }
                      }}
                      className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink-900 outline-none focus:border-brand"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11.5px] text-ink-500">可选回传 INGEST_TOKEN（留空则用本机助手 .env）</span>
                    <input
                      type="password"
                      value={ingestTokenInput}
                      onChange={(e) => setIngestTokenInput(e.target.value)}
                      placeholder="若本机 .env 已配 INGEST_TOKEN 可留空"
                      className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink-900 outline-none focus:border-brand"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  <span className="text-ink-500">方式 A（本机回环服务，平时无常驻浏览器）：</span>
                  <code className="rounded bg-surface px-2 py-1 font-mono text-[11.5px] text-ink-900">
                    SERVER_URL={typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:8788"} node scripts/pw-collect.mjs serve
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(
                        `SERVER_URL=${window.location.origin} node scripts/pw-collect.mjs serve`,
                      );
                      onNotify?.("已复制回环助手启动命令");
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-surface px-2 py-1 text-[11.5px] hover:border-brand-border hover:text-brand"
                  >
                    <Copy size={11} /> 复制命令
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(buildUserscript());
                      onNotify?.("已复制 Tampermonkey 油猴脚本（免装 Playwright）");
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-brand-border bg-surface px-2 py-1 text-[11.5px] text-brand hover:bg-brand-subtle"
                  >
                    <Copy size={11} /> 复制油猴脚本（方式 B · 免装 Node）
                  </button>
                </div>
                  </div>
                </details>
              </div>
            )}
            {showAddRss && (
              <div className="space-y-2 border-b border-ink-100 bg-surface-hover px-4 py-3">
                <div className="grid gap-2 sm:grid-cols-12">
                  <input
                    value={rssName}
                    onChange={(e) => setRssName(e.target.value)}
                    placeholder="源名称（如 财联社电报 / 某博客）"
                    className="rounded-lg border border-ink-200 bg-surface px-3 py-2 text-[12.5px] text-ink-950 outline-none focus:border-brand sm:col-span-3"
                  />
                  <input
                    value={rssUrl}
                    onChange={(e) => setRssUrl(e.target.value)}
                    placeholder="https://example.com/feed"
                    className="rounded-lg border border-ink-200 bg-surface px-3 py-2 text-[12.5px] text-ink-950 outline-none focus:border-brand sm:col-span-4"
                  />
                  <Select aria-label="RSS 内容用途"
                    value={rssKindHint}
                    onValueChange={(value) => setRssKindHint(value)}
                    className="rounded-lg border border-ink-200 bg-surface px-2 py-2 text-[12px] text-ink-800 outline-none focus:border-brand sm:col-span-3"
                  >
                    {KIND_HINT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                  <Select aria-label="RSS 默认分类"
                    value={rssCategoryHint}
                    onValueChange={(value) => setRssCategoryHint(value)}
                    className="rounded-lg border border-ink-200 bg-surface px-2 py-2 text-[12px] text-ink-800 outline-none focus:border-brand sm:col-span-2"
                  >
                    {CATEGORY_HINT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[12px] text-ink-500">
                    <span>采集周期：</span>
                    <Select aria-label="RSS 采集间隔"
                      value={rssInterval}
                      onValueChange={(value) => setRssInterval(Number(value))}
                      className="rounded-lg border border-ink-200 bg-surface px-2 py-1 text-[12px] text-ink-800 outline-none focus:border-brand"
                    >
                      {INTERVAL_OPTIONS.map((o) => (
                        <option key={o.sec} value={o.sec}>
                          每 {o.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <button
                    type="button"
                    disabled={!rssName.trim() || !/^https?:\/\//i.test(rssUrl.trim()) || addingRss}
                    onClick={async () => {
                      setAddingRss(true);
                      try {
                        await onAddRss(
                          rssName.trim(),
                          rssUrl.trim(),
                          rssInterval,
                          rssKindHint || undefined,
                          rssCategoryHint || undefined,
                        );
                        setRssName("");
                        setRssUrl("");
                        setRssKindHint("");
                        setRssCategoryHint("");
                        setShowAddRss(false);
                      } finally {
                        setAddingRss(false);
                      }
                    }}
                    className="inline-flex items-center justify-center gap-1 rounded-lg bg-brand px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-40"
                  >
                    {addingRss ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
                    加入并采集
                  </button>
                </div>
              </div>
            )}

            <SourceCatalog sources={sources} runs={runs} filter={filterText} view={statusFilter}
              cookieReady={source=>source.kind === "ingest" ? cookieStatus ? Boolean(cookieStatus.sites[siteKeyOf(source.id)]?.configured) : undefined : undefined}
              onToggle={onToggleSource} onInterval={onChangeInterval} onCollect={onCollectSource}
              onConfigure={()=>setShowIngestGuide(true)}
              renderEditor={(source,onDone)=><SourceInlineEditor key={source.id} source={source} onSave={patch=>onUpdateSource(source.id,patch)} onDelete={!source.builtIn?()=>onDeleteSource(source.id):undefined} onCancel={onDone}/>}/>

          </div>
        </div>
      )}


      {subTab === "quality" && (
        <div className="space-y-4">
          <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="flex items-center gap-2 text-[14px] font-semibold text-ink-950">
                <Gauge size={15} className="text-brand" /> 来源质量榜
              </div>
              <p className="mt-0.5 text-[12px] text-ink-500">
                留存率 = AI 判为有效 ÷ 已审条数。留存率低、条数又多的源，基本是在白烧采集与 AI 额度。
              </p>
            </div>
            <div className="flex items-center gap-0.5 rounded-md border border-ink-200 bg-surface p-0.5">
              {[
                { d: 1, label: "今天" },
                { d: 7, label: "7 天" },
                { d: 30, label: "30 天" },
              ].map((w) => (
                <button
                  key={w.d}
                  type="button"
                  onClick={() => setQualityDays(w.d)}
                  className={
                    "rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors " +
                    (qualityDays === w.d ? "bg-ink-950 text-white" : "text-ink-500 hover:text-ink-950")
                  }
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          <div className="panel overflow-hidden">
            {qualityLoading && !quality && (
              <div className="flex items-center gap-2 px-4 py-8 text-[13px] text-ink-500">
                <Loader2 size={13} className="animate-spin" /> 统计中…
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead className="bg-surface-hover text-[11px] tracking-wide text-ink-500 uppercase">
                  <tr className="border-b border-ink-200">
                    <th className="px-4 py-2 font-medium">源</th>
                    <th className="px-2 py-2 text-right font-medium">入库</th>
                    <th className="px-2 py-2 text-right font-medium">已审</th>
                    <th className="px-2 py-2 text-right font-medium">留存</th>
                    <th className="px-2 py-2 font-medium">留存率</th>
                    <th className="px-2 py-2 text-right font-medium">平均质量</th>
                    <th className="px-2 py-2 text-right font-medium">已推</th>
                  </tr>
                </thead>
                <tbody>
                  {(quality ?? [])
                    .filter((q) => q.total > 0)
                    .sort((a, b) => (a.keepRate ?? 2) - (b.keepRate ?? 2) || b.total - a.total)
                    .map((q) => {
                      const rate = q.keepRate;
                      const pct = rate === null ? null : Math.round(rate * 100);
                      const tone = pct === null ? "text-ink-400" : pct >= 60 ? "text-deal" : pct >= 30 ? "text-ink-700" : "text-alert";
                      return (
                        <tr key={q.id} className="border-b border-ink-100 last:border-0 hover:bg-surface-hover">
                          <td className="px-4 py-2">
                            <div className="text-[12.5px] font-medium text-ink-900">{q.name}</div>
                            <div className="font-mono text-[11px] text-ink-400">{q.id}</div>
                          </td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-700">{q.total}</td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-500">{q.reviewed}</td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-700">{q.kept}</td>
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-100">
                                <div
                                  className={"h-full rounded-full " + (pct !== null && pct >= 60 ? "bg-deal" : pct !== null && pct >= 30 ? "bg-brand" : "bg-alert")}
                                  style={{ width: (pct ?? 0) + "%" }}
                                />
                              </div>
                              <span className={"font-mono text-[11.5px] tabular-nums " + tone}>
                                {pct === null ? "未审" : pct + "%"}
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-700">
                            {q.avgQuality === null ? "—" : q.avgQuality}
                          </td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-500">{q.pushed}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            {quality && quality.filter((q) => q.total > 0).length === 0 && (
              <div className="px-4 py-10 text-center text-[12.5px] text-ink-500">这个时间范围内没有采集到条目</div>
            )}
          </div>
        </div>
      )}
      {subTab === "runs" && (
        <div className="panel overflow-hidden">
          <div className="border-b border-ink-100 px-4 py-3 text-[13.5px] font-semibold text-ink-950">
            最近采集记录（{runs.length}）
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead className="bg-surface-hover text-[11px] tracking-wide text-ink-500 uppercase">
                <tr className="border-b border-ink-200">
                  <th className="px-4 py-2 font-medium">时间</th>
                  <th className="px-2 py-2 font-medium">源</th>
                  <th className="px-2 py-2 font-medium">抓取</th>
                  <th className="px-2 py-2 font-medium">新增</th>
                  <th className="px-2 py-2 font-medium">耗时</th>
                  <th className="px-4 py-2 font-medium">结果</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {runs.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-hover">
                    <td className="px-4 py-2 font-mono text-[12px] text-ink-500">
                      {r.started_at.replace("T", " ").slice(5, 19)}
                    </td>
                    <td className="px-2 py-2 text-ink-800">{sourceName(r.source_id)}</td>
                    <td className="px-2 py-2 font-mono tabular-nums text-ink-700">{r.fetched}</td>
                    <td className="px-2 py-2 font-mono font-medium tabular-nums text-deal">{r.inserted}</td>
                    <td className="px-2 py-2 font-mono tabular-nums text-ink-500">
                      {r.duration_ms ? (r.duration_ms / 1000).toFixed(1) + "s" : "—"}
                    </td>
                    <td className="max-w-[360px] px-4 py-2 text-[12px] text-ink-500">
                      {r.error ? <FailureNote error={r.error} sourceId={r.source_id} compact /> : r.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === "retention" && (
        <div className="panel space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 text-[14.5px] font-semibold text-ink-950">
                <Trash2 size={15} className="text-brand" /> 数据保留与自动清理
              </div>
              <p className="mt-0.5 text-[12px] text-ink-500">
                修改天数后失焦即保存；收藏条目永久保留不删除。
              </p>
            </div>
            {retCounts && (
              <span className="text-[12px] text-ink-500">
                在库 <span className="font-mono font-medium text-ink-800">{retCounts.total}</span> · 收藏{" "}
                <span className="font-mono font-medium text-amber-700">{retCounts.starred}</span> · 已关闭{" "}
                <span className="font-mono font-medium">{retCounts.ignored}</span>
              </span>
            )}
          </div>

          {retention && (
            <div className="grid gap-3 sm:grid-cols-5">
              {[
                { key: "itemDays" as const, label: "非福利条目", hint: "天" },
                { key: "keptDays" as const, label: "AI 判福利", hint: "天" },
                { key: "ignoredDays" as const, label: "手动关闭", hint: "天" },
                { key: "pushLogDays" as const, label: "推送日志", hint: "天" },
                { key: "digestDays" as const, label: "每日精选", hint: "天" },
              ].map((f) => (
                <label key={f.key} className="block rounded-lg border border-ink-200 bg-surface-hover p-3">
                  <span className="mb-1.5 block text-[12px] font-medium text-ink-700">{f.label}</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      value={retention[f.key]}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setRetention({ ...retention, [f.key]: Number.isFinite(v) ? v : 0 });
                      }}
                      onBlur={(e) => {
                        const raw = Number(e.target.value);
                        const clamped = Math.min(Math.max(Number.isFinite(raw) ? Math.round(raw) : 1, 1), 3650);
                        void saveRetentionField({ [f.key]: clamped } as Partial<RetentionSettings>);
                      }}
                      className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 font-mono text-[13px] text-ink-900 outline-none focus:border-brand"
                    />
                    <span className="text-[11.5px] text-ink-500">{f.hint}</span>
                  </div>
                </label>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <label className="flex items-center gap-2 text-[12.5px] text-ink-700">
              <input
                type="checkbox"
                checked={retention?.auto ?? true}
                onChange={(e) => void saveRetentionField({ auto: e.target.checked })}
                className="h-4 w-4 accent-brand"
              />
              每天自动清理过期数据
            </label>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={previewCleanup}
                className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-surface px-3.5 py-1.5 text-[12.5px] font-medium text-ink-700 hover:bg-ink-100"
              >
                <Search size={13} /> 预演清理量
              </button>
              <button
                type="button"
                disabled={cleaning}
                onClick={doCleanup}
                className="inline-flex items-center gap-1.5 rounded-lg border border-alert-border bg-alert-subtle px-3.5 py-1.5 text-[12.5px] font-medium text-alert hover:bg-red-100/80 disabled:opacity-60"
              >
                {cleaning ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} 立即清理
              </button>
            </div>
          </div>

          {cleanPreview && (
            <div className="rounded-lg border border-ink-200 bg-surface-hover p-3 text-[12.5px] text-ink-700">
              将清理：
              {Object.entries(cleanPreview)
                .filter(([, n]) => n > 0)
                .map(([k, n]) => `${k} ${n} 条`)
                .join(" · ") || "没有需要清理的条目"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
