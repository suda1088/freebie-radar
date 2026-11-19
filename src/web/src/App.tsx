import { useApi } from "./hooks/useApi.ts";
import { useFeedFilters } from "./hooks/useFeedFilters.ts";
import { buildFeedQuery } from "./lib/feed-query.ts";
import { SOURCE_LABEL, sourceName, updateSourceNames } from "./lib/source-labels.ts";
import { FeedPage } from "./pages/FeedPage.tsx";
import { ADMIN_TABS, PageHeading, workspaceTitle, type WorkspacePage } from "./pages/PageHeading.tsx";
import { SettingsRoute } from "./pages/SettingsRoute.tsx";
import { LoadingCards, LoadFailure } from "./components/AsyncState.tsx";
import { savedRoute, feedHash } from "./lib/feed-scope.ts";
import { WorkspaceRail, WorkspaceBar, SourceLibrary } from "./components/WorkspaceChrome.tsx";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, RefreshCw, ShieldBan, Wrench, Zap } from "lucide-react";
import { ItemDetailDrawer, QuickBlockModal } from "./components/ItemView.tsx";
import { AdminGate } from "./components/AdminGate.tsx";
import { getToken, isSiteSession } from "./lib/auth.ts";
import { formatInterval } from "./lib/sources.ts";
import type {
  BlockPreset,
  BlockRule,
  HotReport,
  HotScope,
  Item,
  PushLogItem,
  AiPayload,
  PushPayload,
  PushPreview,
  PushSettings,
  Run,
  Source,
  Stats,
  Subscription,
} from "./types.ts";

const DigestPanel = lazy(() => import("./components/DigestPanel.tsx").then(module => ({ default: module.DigestPanel })));
const AiPanel = lazy(() => import("./components/AiPanel.tsx").then(module => ({ default: module.AiPanel })));
const RulesPanel = lazy(() => import("./components/RulesPanel.tsx").then(module => ({ default: module.RulesPanel })));
const OpsPanel = lazy(() => import("./components/OpsPanel.tsx").then(module => ({ default: module.OpsPanel })));
const PushPanel = lazy(() => import("./components/PushPanel.tsx").then(module => ({ default: module.PushPanel })));
const HotPanel = lazy(() => import("./components/HotPanel.tsx").then(module => ({ default: module.HotPanel })));

type Tab = WorkspacePage;

function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="toast-enter fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-lg border border-ink-800 bg-ink-950 px-3.5 py-2 text-[12.5px] font-medium text-white shadow-lg">
      <Check size={14} className="text-emerald-400" />
      {message}
    </div>
  );
}

export function App() {
  const initialTab = (): Tab => {
    if (typeof location === "undefined") return "feed";
    const h = location.hash.replace("#", "");
    return h === "hot" || h === "digest" || h === "rules" || h === "push" || h === "ai" || h === "ops" ? (h as Tab) : "feed";
  };

  const [tab, setTab] = useState<Tab>(initialTab);
  const [detail, setDetail] = useState<Item | null>(null);
  // A closed or replaced reader must never be restored by a late mutation response.
  const detailVersion = useRef(0);
  const openDetail = useCallback((item: Item) => { detailVersion.current++; setDetail(item); }, []);
  const closeDetail = useCallback(() => { detailVersion.current++; setDetail(null); }, []);
  const [quickBlock, setQuickBlock] = useState<Item | null>(null);
  // 合并组展开：记录展开的条目 id 与其同福利的其他来源
  const [relatedOpen, setRelatedOpen] = useState<number | null>(null);
  const [relatedMap, setRelatedMap] = useState<Record<number, (Item & { sourceName?: string })[]>>({});
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  // 展开合并组时按需拉取其他来源报道（同一 title_key 的兄弟条目）
  useEffect(() => {
    const id = relatedOpen;
    if (!id || relatedMap[id]) return;
    let alive = true;
    fetch(`/api/items/${id}/related`, { headers: { accept: "application/json" } })
      .then((r) => r.json())
      .then((d: { items?: (Item & { sourceName?: string })[] }) => {
        if (alive && Array.isArray(d.items)) setRelatedMap((m) => ({ ...m, [id]: d.items! }));
      })
      .catch(() => {
        if (alive) setRelatedMap((m) => ({ ...m, [id]: [] }));
      });
    return () => {
      alive = false;
    };
  }, [relatedOpen, relatedMap]);
  // 服务端是否启用管理密码（决定是否拦截管理区）
  const [authChecked, setAuthChecked] = useState(false);
  const [protectedMode, setProtectedMode] = useState(false);
  const [adminAuthed, setAdminAuthed] = useState(() => isSiteSession() || Boolean(getToken()));
  useEffect(() => {
    fetch("/api/auth/check")
      .then((r) => r.json())
      .then((j: { protected?: boolean }) => {
        const prot = Boolean(j.protected);
        setProtectedMode(prot);
        if (!prot) setAdminAuthed(true);
      })
      .catch(() => undefined)
      .finally(() => setAuthChecked(true));
  }, []);
  const adminReady = authChecked && (!protectedMode || adminAuthed);

  const filters = useFeedFilters();
  const {
    search, setSearch, debounced, setDebounced, source, setSource, categories, setCategories, lang, sort,
    range, priceCap, minScore, obtain, kindFilter, savedOnly, setSavedOnly, preset, setPreset,
    unreadOnly, switchPreset, resetFilters,
  } = filters;
  const [showAllSources, setShowAllSources] = useState(false);
  const [mobileFilters, setMobileFilters] = useState(false);
  const closeSources = useCallback(() => setMobileFilters(false), []);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const modalActive = Boolean(detail || quickBlock || mobileFilters);

  useEffect(() => {
    document.title = workspaceTitle(tab, savedOnly);
  }, [tab, savedOnly]);

  // Keep the rail's existing flex position and class hooks, without a layout wrapper.
  useLayoutEffect(() => {
    const rail = workspaceRef.current?.querySelector<HTMLElement>(":scope > .v3-rail");
    if (!rail) return;
    rail.inert = modalActive;
    return () => { rail.inert = false; };
  }, [modalActive]);

  useEffect(() => {
    const onSlash = (e: KeyboardEvent) => {
      if (modalActive) return;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement | null)?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onSlash);
    return () => window.removeEventListener("keydown", onSlash);
  }, [modalActive]);
  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1900);
  }, []);

  const copyCode = useCallback(
    (code: string) => {
      void navigator.clipboard?.writeText(code);
      notify("已复制兑换码 " + code);
    },
    [notify],
  );

  useEffect(() => {
    if (typeof location === "undefined") return;
    if (tab === "feed") history.replaceState(null, "", location.pathname + location.search + feedHash(savedOnly, preset));
    else history.replaceState(null, "", "#" + tab);
  }, [tab, savedOnly, preset]);

  useEffect(() => {
    const onHash = () => {
      const h = location.hash.replace("#", "");
      const scope = savedRoute(location.hash);
      setSavedOnly(scope.saved);
      if (scope.saved) setPreset(scope.preset);
      setTab(h === "hot" || h === "digest" || h === "rules" || h === "push" || h === "ai" || h === "ops" ? (h as Tab) : "feed");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (typeof location === "undefined") return;
    const sp = new URLSearchParams(location.search);
    const site = sp.get("login_ok");
    if (!site) return;
    sp.delete("login_ok");
    const nextSearch = sp.toString();
    history.replaceState(null, "", location.pathname + (nextSearch ? "?" + nextSearch : "") + "#ops");
    setTab("ops");
    notify(`已完成 ${site} 登录并回传公开福利（Cookie 仅留本机）`);
  }, [notify]);

  const [, bumpNames] = useState(0);
  useEffect(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then((d: { sources: { id: string; name: string }[] }) => {
        const m: Record<string, string> = { ...SOURCE_LABEL };
        for (const s of d.sources) if (s.name) m[s.id] = s.name;
        updateSourceNames(m);
        bumpNames((n) => n + 1);
      })
      .catch(() => {});
  }, []);

  const query = useMemo(() => buildFeedQuery({ debounced, source, categories, lang, sort,
    range, priceCap, preset, kindFilter, obtain, minScore, unreadOnly, savedOnly }, Date.now()),
    [debounced, source, categories, lang, sort, range, priceCap, preset, kindFilter, obtain, minScore, unreadOnly, savedOnly]);

  const statsQuery = useMemo(() => {
    const p = new URLSearchParams(query);
    p.delete("category");
    p.delete("sort");
    p.delete("limit");
    return p.toString();
  }, [query]);

  const enterSaved = useCallback(() => {
    resetFilters(); setSavedOnly(true); setPreset("all"); setTab("feed");
  }, [resetFilters]);
  const goToPage = useCallback((page: Tab) => {
    if (page === "feed") { if (savedOnly) { resetFilters(); setPreset("verified"); } setSavedOnly(false); }
    setTab(page);
  }, [savedOnly, resetFilters]);
  const stats = useApi<Stats>(statsQuery ? `/api/stats?${statsQuery}` : "/api/stats");
  const items = useApi<{ total: number; items: Item[] }>(`/api/items?${query}`);
  const subs = useApi<{ subscriptions: Subscription[] }>(adminReady ? "/api/subscriptions" : null);
  const sources = useApi<{ sources: Source[] }>("/api/sources");
  const runs = useApi<{ runs: Run[] }>(adminReady ? "/api/runs?limit=40" : null);
  const blockRules = useApi<{ rules: BlockRule[]; totalBlocked: number; presets: BlockPreset[] }>(
    adminReady ? "/api/block-rules" : null,
  );
  const digests = useApi<{ digests: { date: string; created_at: string; pushed_at: string | null; kind: string; count: number }[] }>(
    "/api/digests",
  );
  const [hotHours, setHotHours] = useState(24);
  const [hotScope, setHotScope] = useState<HotScope>("all");
  const hot = useApi<HotReport>(tab === "hot" ? `/api/hot?hours=${hotHours}&scope=${hotScope}` : null);
  // 管理接口只在就绪后请求，避免公开区刷出一堆 401，也避免无密码模式卡住加载
  const push = useApi<PushPayload>(adminReady ? "/api/push" : null);
  const ai = useApi<AiPayload>(adminReady && tab === "ai" ? "/api/ai" : null);
  const pushLogs = useApi<{ logs: PushLogItem[] }>(adminReady && tab === "push" ? "/api/push/log?limit=40" : null);
  const [pushPreview, setPushPreview] = useState<PushPreview | null>(null);
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const activeDate = pickedDate ?? digests.data?.digests?.[0]?.date ?? null;
  const digestDetail = useApi<{
    date: string;
    text: string;
    count: number;
    created_at: string;
    pushed_at: string | null;
    items: Item[];
  }>(activeDate && tab === "digest" ? "/api/digests/" + activeDate : null);

  const [blockedPreview, setBlockedPreview] = useState<Item[] | null>(null);

  const patch = useCallback(
    async (id: number, body: Record<string, unknown>) => {
      const version = detailVersion.current;
      const response = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) { notify("操作未成功，请稍后重试"); return; }
      items.reload();
      stats.reload();
      if (detail && detail.id === id && detailVersion.current === version) {
        const refreshed = await fetch(`/api/items/${id}`);
        if (!refreshed.ok) return;
        const next = await refreshed.json() as Item;
        if (detailVersion.current === version) setDetail(current => current?.id === id ? next : current);
      }
    },
    [items, stats, detail, notify],
  );

  const addRule = useCallback(
    async (pattern: string, mode: "keyword" | "regex", scope: string) => {
      const res = await fetch("/api/block-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pattern, mode, scope }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "添加失败");
      }
      notify("已屏蔽「" + pattern + "」");
      blockRules.reload();
      items.reload();
      stats.reload();
      setBlockedPreview(null);
      setRelatedMap({});
    },
    [blockRules, items, stats, notify],
  );

  const quickBlockAdd = useCallback(
    async (pattern: string, scope: string) => {
      await addRule(pattern, "keyword", scope);
    },
    [addRule],
  );

  const addSubscription = useCallback(
    async (kw: string) => {
      const response = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyword: kw }),
      });
      if (!response.ok) throw new Error("关注词未保存");
      subs.reload();
      items.reload();
      notify("已订阅「" + kw + "」");
    },
    [subs, items, notify],
  );

  const removeSubscription = useCallback(
    async (id: number) => {
      const response = await fetch("/api/subscriptions/" + id, { method: "DELETE" });
      if (!response.ok) throw new Error("关注词未删除");
      subs.reload();
      items.reload();
    },
    [subs, items],
  );

  const refreshAll = useCallback(() => {
    items.reload();
    stats.reload();
    sources.reload();
    runs.reload();
    blockRules.reload();
    setRelatedMap({});
  }, [items, stats, sources, runs, blockRules]);

  useEffect(() => {
    const completed = () => refreshAll();
    window.addEventListener("radar:collection-completed", completed);
    return () => window.removeEventListener("radar:collection-completed", completed);
  }, [refreshAll]);

  const markVisibleRead = useCallback(async () => {
    const unreadIds = (items.data?.items ?? []).filter((i) => !i.read).map((i) => i.id);
    if (!unreadIds.length) return;
    await fetch("/api/items/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: unreadIds, action: "read" }),
    });
    notify(`已将本页 ${unreadIds.length} 条标为已读`);
    items.reload();
    stats.reload();
  }, [items, stats, notify]);

  const visible = items.data?.items ?? [];
  const currentIndex = detail ? visible.findIndex((i) => i.id === detail.id) : -1;

  const exportUrl = "/api/export?format=md&" + query.replace(/limit=\d+/, "limit=300");

  return (
    <div ref={workspaceRef} className="soda-workspace flex min-h-screen flex-col bg-surface lg:flex-row">
      <a href="#main-heading" inert={modalActive}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:text-ink-950 focus:shadow-lg"
        onClick={event => {
          event.preventDefault();
          const heading = workspaceRef.current?.querySelector<HTMLElement>("#main-heading");
          heading?.focus({ preventScroll: true });
          heading?.scrollIntoView({ block: "start" });
        }}>跳到主要内容</a>
      <WorkspaceRail page={tab} saved={tab === "feed" && savedOnly} session={isSiteSession()} onPage={goToPage} onSaved={enterSaved} />
      <SourceLibrary open={mobileFilters} onClose={closeSources} sources={sources.data?.sources??[]} value={source} onSelect={id=>{setSource(id);setTab("feed");}} showAll={showAllSources} onShowAll={()=>setShowAllSources(x=>!x)} />
      {/* 右侧纯白主工作区 */}
      <div inert={modalActive} className="soda-main flex min-w-0 flex-1 flex-col bg-surface">
        <WorkspaceBar page={tab} saved={tab === "feed" && savedOnly} search={search} onSearch={v=>{setSearch(v);if(tab!=="feed"){setTab("feed");switchPreset("all");}}} searchRef={searchRef} onSources={()=>setMobileFilters(true)} sourceCount={(sources.data?.sources??[]).filter(x=>x.enabled).length} exportUrl={exportUrl} refresh={<button type="button" onClick={refreshAll} title="刷新数据" aria-label="刷新数据"><RefreshCw size={17} className={items.loading?"animate-spin":""}/></button>} />
        {/* 主内容区 */}
        <main className={tab === "feed" ? "soda-feed usability-feed min-w-0 flex-1" : "soda-admin min-w-0 flex-1 px-3.5 py-3.5 sm:px-6 sm:py-5"}>
          <PageHeading page={tab} saved={savedOnly} last24h={stats.data?.totals.last24h} />
          {ADMIN_TABS.has(tab) && <SettingsRoute page={tab} onPage={setTab} />}
          {((tab as string) === "admin" || (ADMIN_TABS.has(tab) && !adminReady)) && (
            <AdminGate protectedMode={protectedMode} onAuthChange={setAdminAuthed}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { key: "rules" as Tab, label: "订阅与屏蔽", desc: "关键词订阅、屏蔽词防火墙", icon: ShieldBan },
                  { key: "push" as Tab, label: "推送规则", desc: "推送时机、阈值、格式与免打扰", icon: Zap },
                  { key: "ai" as Tab, label: "AI 引擎", desc: "规则初筛、审核模型、提示词与补审", icon: Bot },
                  { key: "ops" as Tab, label: "数据源运维", desc: "采集开关、间隔、数据清理", icon: Wrench },
                ].map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => setTab(entry.key)}
                    className="panel flex flex-col items-start gap-1.5 p-4 text-left transition-colors hover:border-ink-400"
                  >
                    <entry.icon size={16} className="text-accent" />
                    <span className="text-[13.5px] font-semibold text-ink-950">{entry.label}</span>
                    <span className="text-[12px] leading-relaxed text-ink-500">{entry.desc}</span>
                  </button>
                ))}
              </div>
            </AdminGate>
          )}

          {tab === "feed" && (
            <FeedPage filters={filters} items={items} stats={stats} sources={sources}
              reader={{ selectedId: detail?.id, onPatch: patch, onOpen: openDetail, onQuickBlock: setQuickBlock, onCopyCode: copyCode }}
              related={{ open: relatedOpen, map: relatedMap, onToggle: id => setRelatedOpen(cur => cur === id ? null : id) }}
              onMarkVisibleRead={markVisibleRead} onSaved={enterSaved} onSources={() => setMobileFilters(true)}
              onDiscover={() => goToPage("feed")} />
          )}

          <Suspense fallback={<LoadingCards label="正在读取页面"/>}>
          {tab === "hot" && (
            <HotPanel
              report={hot.data}
              loading={hot.loading}
              error={hot.error}
              hours={hotHours}
              scope={hotScope}
              onHours={setHotHours}
              onScope={setHotScope}
              onReload={hot.reload}
              onSearchWord={(w) => {
                setSavedOnly(false);
                setSearch(w);
                switchPreset(hotScope === "news" ? "news" : hotScope === "info" ? "info" : hotScope === "deals" ? "verified" : "all");
                setTab("feed");
              }}
              onJumpCategory={(cat) => {
                setSavedOnly(false);
                const targetPreset =
                  hotScope === "news" || cat === "headline" || cat === "world"
                    ? "news"
                    : hotScope === "info" || cat === "stock" || cat === "tech" || cat === "finance"
                      ? "info"
                      : "all";
                switchPreset(targetPreset);
                setCategories([cat]);
                setTab("feed");
              }}
              onOpenItem={async (id) => {
                const found = items.data?.items?.find((it) => it.id === id);
                if (found) {
                  openDetail(found);
                  return;
                }
                const version = ++detailVersion.current;
                try {
                  const res = await fetch("/api/items/" + id);
                  if (res.ok) {
                    const item = (await res.json()) as Item;
                    if (detailVersion.current === version) openDetail(item);
                    return;
                  }
                } catch {
                  /* 回退到资源流 */
                }
                setTab("feed");
              }}
              sourceName={sourceName}
            />
          )}

          {tab === "digest" && (
            <DigestPanel
              digests={digests.data?.digests ?? []}
              detail={digestDetail}
              pickedDate={pickedDate}
              onPickDate={setPickedDate}
              canAdmin={adminReady}
              onRunDaily={async () => {
                notify("正在生成今日精选…");
                const res = await fetch("/api/digests/run", { method: "POST" });
                const data = (await res.json().catch(() => ({}))) as { date?: string; count?: number; error?: string };
                if (!res.ok) notify(data.error ?? "生成失败");
                else notify(`已生成 ${data.count ?? 0} 条精选`);
                digests.reload();
                setPickedDate(res.ok && data.date ? data.date : null);
                digestDetail.reload();
              }}
              sourceName={sourceName}
              onPatch={patch}
              onOpen={openDetail}
              onQuickBlock={setQuickBlock}
              onCopyCode={copyCode}
              onRunWeekly={async () => {
                notify("正在汇总本周精选…");
                const res = await fetch("/api/digests/weekly", { method: "POST" });
                const data = (await res.json().catch(() => ({}))) as { date?: string; count?: number; error?: string; pushed?: boolean };
                if (!res.ok) notify(data.error ?? "生成失败");
                else notify(`周报已生成 ${data.count ?? 0} 条${data.pushed ? "，已发 Telegram" : ""}`);
                digests.reload();
                setPickedDate(res.ok && data.date ? data.date : null);
                digestDetail.reload();
              }}
            />
          )}

          {adminReady && tab === "rules" && (
            <RulesPanel
              subscriptions={subs.data?.subscriptions ?? []}
              rules={blockRules.data?.rules ?? []}
              presets={blockRules.data?.presets ?? []}
              totalBlocked={blockRules.data?.totalBlocked ?? 0}
              sources={sources.data?.sources ?? []}
              blockedPreview={blockedPreview}
              sourceName={sourceName}
              onAddSub={addSubscription}
              onRemoveSub={removeSubscription}
              onJumpToSubscribed={(kw) => {
                setSavedOnly(false);
                setSearch(kw);
                setPreset("all");
                setTab("feed");
              }}
              onAddRule={addRule}
              onImportPresets={async () => {
                const response = await fetch("/api/block-rules", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ presets: true }),
                });
                if (!response.ok) throw new Error("规则未导入");
                blockRules.reload();
                items.reload();
                stats.reload();
                notify("已导入常见噪音屏蔽词");
              }}
              onToggleRule={async (id, enabled) => {
                const response = await fetch("/api/block-rules/" + id, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ enabled }),
                });
                if (!response.ok) throw new Error("规则未保存");
                blockRules.reload();
                items.reload();
                setBlockedPreview(null);
              }}
              onDeleteRule={async (id) => {
                const response = await fetch("/api/block-rules/" + id, { method: "DELETE" });
                if (!response.ok) throw new Error("规则未删除");
                blockRules.reload();
                items.reload();
                stats.reload();
                setBlockedPreview(null);
                notify("规则已删除，相关条目已恢复显示");
              }}
              onLoadBlockedPreview={async () => {
                const res = await fetch("/api/items?includeBlocked=1&limit=80&sort=newest");
                const data = (await res.json()) as { items: Item[] };
                setBlockedPreview(data.items);
              }}
            />
          )}

          {adminReady && tab === "push" && push.error && <LoadFailure message={push.error} onRetry={push.reload}/>}
          {adminReady && tab === "push" && !push.data && !push.error && <LoadingCards label="正在读取通知设置"/>}
          {adminReady && tab === "push" && push.data && !push.error && (
            <PushPanel
              payload={push.data}
              preview={pushPreview}
              logs={pushLogs.data?.logs ?? []}
              sources={sources.data?.sources ?? []}
              onSave={async (p: Partial<PushSettings>) => {
                const res = await fetch("/api/push", {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(p),
                });
                if (!res.ok) {
                  throw new Error("保存失败，请重试");
                }
                push.reload();
                setPushPreview(null);
                notify("推送规则已保存");
              }}
              onPreview={async () => {
                const res = await fetch("/api/push/preview?limit=6");
                setPushPreview((await res.json()) as PushPreview);
              }}
              onFlush={async () => {
                const res = await fetch("/api/push/flush", { method: "POST" });
                const data = (await res.json().catch(() => ({}))) as { sent?: number; queued?: number };
                notify(`已发送 ${data.sent ?? 0} 条，队列剩 ${data.queued ?? 0} 条`);
                push.reload();
                pushLogs.reload();
                setPushPreview(null);
              }}
              onDestinationSaved={() => push.reload()}
            />
          )}

          {adminReady && tab === "ai" && ai.error && <LoadFailure message={ai.error} onRetry={ai.reload}/>}
          {adminReady && tab === "ai" && !ai.data && !ai.error && <LoadingCards label="正在读取智能整理设置"/>}
          {adminReady && tab === "ai" && ai.data && !ai.error && (
            <AiPanel
              data={ai.data}
              sources={sources.data?.sources ?? []}
              reload={ai.reload}
              onNotify={notify}
              sourceName={sourceName}
              onOpenItem={async (id) => {
                const found = items.data?.items?.find((it) => it.id === id);
                if (found) {
                  openDetail(found);
                  return;
                }
                const version = ++detailVersion.current;
                try {
                  const res = await fetch("/api/items/" + id);
                  if (res.ok) {
                    const item = (await res.json()) as Item;
                    if (detailVersion.current === version) openDetail(item);
                  }
                } catch {
                  /* ignore */
                }
              }}
            />
          )}

          {adminReady && tab === "ops" && sources.error && <LoadFailure message={sources.error} onRetry={sources.reload}/>}
          {adminReady && tab === "ops" && !sources.data && !sources.error && <LoadingCards label="正在读取来源"/>}
          {adminReady && tab === "ops" && sources.data && !sources.error && (
            <OpsPanel
              sources={sources.data?.sources ?? []}
              runs={runs.data?.runs ?? []}
              sourceName={sourceName}
              onCollectSource={async (id) => {
                const isCookieSite = id === "zhihu-search" || id === "xhs-search" || id === "xiaoheihe-search";
                notify(isCookieSite ? "正在通过 VPS Cookie 采集（约 15-40 秒）…" : "正在采集…");
                const res = await fetch(`/api/sources/${id}/collect`, { method: "POST" });
                const data = (await res.json().catch(() => ({}))) as {
                  ok?: boolean;
                  error?: string;
                  summary?: { inserted: number; fetched: number; status: string };
                };
                if (!res.ok || data.ok === false || data.summary?.status === "failed") {
                  throw new Error(data.error ?? "采集失败");
                } else {
                  notify(`完成：抓取 ${data.summary?.fetched ?? 0}，新增 ${data.summary?.inserted ?? 0}`);
                }
                refreshAll();
              }}
              onToggleSource={async (id, enabled) => {
                const response = await fetch("/api/sources/" + id, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ enabled }),
                });
                if (!response.ok) throw new Error("来源状态未保存");
                sources.reload();
                notify(enabled ? "已启用该源" : "已禁用该源");
              }}
              onChangeInterval={async (id, sec) => {
                const response = await fetch("/api/sources/" + id, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ interval_sec: sec }),
                });
                if (!response.ok) throw new Error("采集周期未保存");
                sources.reload();
                notify("采集周期已改为 " + formatInterval(sec));
              }}
              onAddRss={async (name, url, intervalSec, kindHint, categoryHint) => {
                notify("正在添加并试采…");
                const res = await fetch("/api/sources", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ name, url, intervalSec, kindHint, categoryHint }),
                });
                const data = (await res.json().catch(() => ({}))) as {
                  error?: string;
                  summary?: { fetched: number; inserted: number; status: string; error?: string };
                };
                if (!res.ok) notify(data.error ?? "添加失败");
                else if (data.summary?.status === "failed") notify("已添加，但首次采集失败：" + (data.summary.error ?? ""));
                else notify(`已添加，抓取 ${data.summary?.fetched ?? 0} 条，新增 ${data.summary?.inserted ?? 0}`);
                refreshAll();
              }}
              onUpdateSource={async (id, patch) => {
                const res = await fetch("/api/sources/" + id, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(patch),
                });
                const data = (await res.json().catch(() => ({}))) as { error?: string };
                if (!res.ok) {
                  notify(data.error ?? "保存失败");
                  return false;
                }
                sources.reload();
                notify("数据源配置已更新");
                return true;
              }}
              onDeleteSource={async (id) => {
                const res = await fetch("/api/sources/" + id, { method: "DELETE" });
                const data = (await res.json().catch(() => ({}))) as { error?: string };
                if (!res.ok) {
                  notify(data.error ?? "删除失败");
                  return false;
                }
                refreshAll();
                notify("已删除自定义数据源");
                return true;
              }}
              onNotify={notify}
            />
          )}
          </Suspense>
        </main>

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-ink-200 px-3.5 py-3 text-[11.5px] text-ink-400 sm:px-6">
          <span>苏打小窝 · 把发现留给自己</span>
          <span className="font-mono tabular-nums">
            {stats.data?.totals.active ?? 0} 条在库 · {stats.data?.totals.unread ?? 0} 条未读
          </span>
        </footer>
      </div>

      {detail && (
        <ItemDetailDrawer
          item={detail}
          sourceName={sourceName}
          hasPrev={currentIndex > 0}
          hasNext={currentIndex >= 0 && currentIndex < visible.length - 1}
          onPrev={() => { const item = visible[currentIndex - 1]; if (currentIndex > 0 && item) openDetail(item); }}
          onNext={() => { const item = visible[currentIndex + 1]; if (currentIndex >= 0 && item) openDetail(item); }}
          onClose={closeDetail}
          overlayActive={Boolean(quickBlock)}
          onPatch={patch}
          onQuickBlock={setQuickBlock}
          onCopyCode={copyCode}
        />
      )}

      {quickBlock && (
        <QuickBlockModal
          item={quickBlock}
          sourceName={sourceName}
          onClose={() => setQuickBlock(null)}
          onIgnoreOne={(id) => patch(id, { status: "ignored" })}
          onAddRule={quickBlockAdd}
        />
      )}

      <Toast message={toast} />
    </div>
  );
}
