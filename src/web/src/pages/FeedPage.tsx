import { Fragment } from "react";
import { AlignJustify, Bell, ChevronDown, Code, EyeOff, Flame, LayoutGrid, Newspaper, Radar, SlidersHorizontal, Sparkles, Tag, TrendingUp, X, Zap } from "lucide-react";
import { LoadingCards, LoadFailure } from "../components/AsyncState.tsx";
import { CompactRow, ItemCard } from "../components/ItemView.tsx";
import { ReadingNote } from "../components/WorkspaceChrome.tsx";
import { categoriesForPreset, categoryLabelForPreset } from "../lib/sources.ts";
import { sourceName } from "../lib/source-labels.ts";
import { FeedFilters } from "./FeedFilters.tsx";
import type { FeedFilterModel } from "../hooks/useFeedFilters.ts";
import type { ApiResult } from "../hooks/useApi.ts";
import type { Item, Source, Stats } from "../types.ts";

type Preset = { key: string; label: string; icon: typeof Sparkles };

const PRIMARY_CHANNELS: Preset[] = [
  { key: "verified", label: "真福利精选", icon: Sparkles },
  { key: "free", label: "完全白嫖", icon: Tag },
  { key: "deal", label: "黑五/好价", icon: Flame },
  { key: "opensource", label: "开源项目", icon: Code },
  { key: "news", label: "重要新闻", icon: Newspaper },
  { key: "info", label: "行业资讯", icon: TrendingUp },
];

const SECONDARY_VIEWS: Preset[] = [
  { key: "codes", label: "含兑换码", icon: Zap },
  { key: "urgent", label: "今日截止", icon: Bell },
  { key: "all", label: "全部收录", icon: AlignJustify },
  { key: "hidden", label: "已关闭", icon: EyeOff },
];

const PRESETS: Preset[] = [...PRIMARY_CHANNELS, ...SECONDARY_VIEWS];

interface FeedPageProps {
  filters: FeedFilterModel;
  items: ApiResult<{ total: number; items: Item[] }>;
  stats: ApiResult<Stats>;
  sources: ApiResult<{ sources: Source[] }>;
  reader: {
    selectedId?: number;
    onPatch: (id: number, body: Record<string, unknown>) => Promise<void>;
    onOpen: (item: Item) => void;
    onQuickBlock: (item: Item) => void;
    onCopyCode: (code: string) => void;
  };
  related: {
    open: number | null;
    map: Record<number, (Item & { sourceName?: string })[]>;
    onToggle: (id: number) => void;
  };
  onMarkVisibleRead: () => Promise<void>;
  onSaved: () => void;
  onSources: () => void;
  onDiscover: () => void;
}

export function FeedPage({ filters, items, stats, sources, reader, related,
  onMarkVisibleRead: markVisibleRead, onSaved: enterSaved, onSources, onDiscover }: FeedPageProps) {
  const {
    source, categories, preset, savedOnly, viewMode, mobileFilterBar, activeFilterCount, setSource,
    setCategories, setPreset, setMobileFilterBar, switchPreset, updateViewMode, resetFilters,
  } = filters;
  const { selectedId, onPatch: patch, onOpen: openDetail, onQuickBlock: setQuickBlock, onCopyCode: copyCode } = reader;
  const { open: relatedOpen, map: relatedMap, onToggle: toggleRelated } = related;
  const visible = items.data?.items ?? [];
  return (
    <div className="v3-reading-layout"><div className="v3-reading-stream">
      <section className="soda-channel-deck" aria-label="资源频道">
        {PRIMARY_CHANNELS.map((p,i) => <button type="button" key={p.key} aria-pressed={preset === p.key} onClick={() => switchPreset(p.key)}>
          <span className="soda-channel-symbol"><p.icon size={20} /></span><span><strong>{p.label}</strong><small>{["经过审核的值得关注","无需付费的小惊喜","挑选实用好价","工具与代码灵感","看看世界发生了什么","行业变化与新发现"][i]}</small></span>
        </button>)}
      </section>
      <div className="v3-reading-toolbar"><div><span className="v3-section-number">01</span><h3>{savedOnly ? (preset === "all" ? "全部收藏" : `收藏 · ${PRESETS.find(x=>x.key===preset)?.label ?? "筛选结果"}`) : PRESETS.find(x=>x.key===preset)?.label ?? "发现"}</h3><small>{items.loading?"正在整理…":`${items.data?.total??0} 条内容`}</small></div><div><button type="button" aria-expanded={mobileFilterBar} onClick={()=>setMobileFilterBar(x=>!x)}><SlidersHorizontal size={15}/>筛选条件{activeFilterCount>0&&<b>{activeFilterCount}</b>}<ChevronDown size={13}/></button><button type="button" onClick={()=>updateViewMode(viewMode==="compact"?"grid2":"compact")} title={viewMode==="compact"?"切换为卡片":"切换为列表"} aria-label={viewMode==="compact"?"切换为卡片":"切换为列表"}>{viewMode==="compact"?<LayoutGrid size={16}/>:<AlignJustify size={16}/>}</button></div></div>
      <div className="v3-quick-views" aria-label="快捷视图">{SECONDARY_VIEWS.map(x=><button type="button" key={x.key} aria-pressed={preset===x.key} onClick={()=>switchPreset(x.key)}><x.icon size={13}/>{savedOnly && x.key === "all" ? "全部收藏" : x.label}</button>)}{source&&<button type="button" onClick={()=>setSource("")}>{sourceName(source)}<X size={12}/></button>}</div>
      {/* 快捷子分类胶囊条：当前频道热门子类目一键直达，不用再进二级下拉找 */}
      {(() => {
        const countMap = new Map((stats.data?.byCategory ?? []).map((c) => [c.category ?? "other", c.n]));
        const allowed = categoriesForPreset(preset);
        const ordered = [...allowed].sort((a, b) => (countMap.get(b) ?? 0) - (countMap.get(a) ?? 0));
        const quickCats = ordered.slice(0, 8);
        return (
          <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto border-b border-ink-100 bg-surface px-3.5 py-1.5 sm:px-6">
            <button
              type="button"
              onClick={() => setCategories([])}
              className={
                "shrink-0 rounded-md px-2 py-0.5 text-[11.5px] font-medium transition-colors active:scale-[0.97] " +
                (categories.length === 0
                  ? "bg-brand-subtle font-semibold text-accent"
                  : "text-ink-500 hover:bg-ink-100 hover:text-ink-900")
              }
            >
              全部{preset === "news" ? "要闻" : preset === "info" ? "资讯" : "分类"}
            </button>
            {quickCats.map((key) => {
              const n = countMap.get(key) ?? 0;
              const active = categories.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    setCategories((cur) =>
                      cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key],
                    )
                  }
                  className={
                    "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] transition-colors active:scale-[0.97] " +
                    (active
                      ? "bg-ink-950 font-medium text-white"
                      : n > 0
                        ? "text-ink-600 hover:bg-ink-100 hover:text-ink-950"
                        : "text-ink-400 hover:bg-ink-100")
                  }
                >
                  <span>{categoryLabelForPreset(key, preset)}</span>
                  {n > 0 && (
                    <span className={"font-mono text-[10.5px] tabular-nums " + (active ? "text-white/75" : "text-ink-400")}>
                      {n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })()}

      <FeedFilters filters={filters} items={items} stats={stats} onMarkVisibleRead={markVisibleRead} />

      {/* 移动端统计一行 */}
      <div className="flex items-center justify-between border-b border-ink-100 px-3.5 py-1.5 text-[12px] text-ink-500 sm:hidden">
        <span>
          共 <strong className="font-mono font-semibold text-ink-900">{items.data?.total ?? 0}</strong> 条
          {preset === "verified" && <span className="ml-1.5 font-medium text-deal">· AI 验真</span>}
        </span>
        {(stats.data?.totals.aiRejected ?? 0) > 0 && (
          <span className="text-ink-400">已滤 {stats.data?.totals.aiRejected} 条</span>
        )}
      </div>

      {items.error && <LoadFailure message={items.error} onRetry={items.reload}/>}
      {items.loading && !items.data && !items.error && <LoadingCards label={savedOnly ? "正在读取收藏" : "正在读取发现"}/>}
      {items.loading && items.data && <p className="soda-updating-state" role="status">正在更新，暂时保留上次读取的内容…</p>}

      {viewMode === "compact" ? (
        <div key={`compact-${preset}`} className="soda-results-list list-enter">
          {visible.map((item) => (
            <Fragment key={item.id}>
              <CompactRow
                item={item}
                sourceName={sourceName}
                selected={selectedId === item.id}
                onPatch={patch}
                onOpen={openDetail}
                onQuickBlock={setQuickBlock}
                onCopyCode={copyCode}
                expanded={relatedOpen === item.id}
                onToggleRelated={toggleRelated}
              />
              {relatedOpen === item.id && relatedMap[item.id] ? (
                <div className="pop-enter border-b border-ink-100 bg-surface-hover px-3.5 py-2 sm:px-6">
                  <div className="mb-1 text-[11px] font-medium text-ink-500">
                    同一事件 / 福利的其他 {relatedMap[item.id]!.length} 条来源报道
                  </div>
                  <ul className="space-y-1">
                    {relatedMap[item.id]!.map((r) => (
                      <li key={r.id} className="flex items-center gap-2 text-[12px]">
                        <span className="w-20 shrink-0 truncate text-ink-500 sm:w-28">{r.sourceName ?? r.source_id}</span>
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate text-ink-700 hover:text-accent hover:underline"
                        >
                          {r.title}
                        </a>
                        <span className="shrink-0 font-mono text-[11px] text-ink-400">
                          {String(r.first_seen_at).slice(5, 16).replace("T", " ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Fragment>
          ))}
        </div>
      ) : (
        <div
          key={`grid-${preset}-${viewMode}`}
          className={
            "soda-results-grid journal-layout list-enter " + (viewMode === "grid3" ? "journal-dense" : "")
          }
        >
          {visible.map((item, index) => (
            <ItemCard
              key={item.id}
              item={item}
              priority={index === 0}
              sourceName={sourceName}
              onPatch={patch}
              onOpen={openDetail}
              onQuickBlock={setQuickBlock}
              onCopyCode={copyCode}
              expanded={relatedOpen === item.id}
              relatedItems={relatedOpen === item.id ? relatedMap[item.id] : undefined}
              onToggleRelated={toggleRelated}
            />
          ))}
        </div>
      )}

      {!items.loading && !items.error && !visible.length && (
        <div className="soda-empty flex flex-col items-center gap-3 px-6 py-20 text-center">
          <Radar size={28} className="text-ink-300" />
          <div className="text-[15px] font-medium text-ink-900">{savedOnly && preset === "all" && activeFilterCount === 0 ? "收藏夹还没有内容" : "这里暂时没有匹配的内容"}</div>
          <p className="max-w-md text-[12.5px] leading-relaxed text-ink-500">
            {savedOnly ? (preset === "all" && activeFilterCount === 0 ? "在发现页遇到喜欢的内容，点击收藏，就能留在这里慢慢看。" : "当前收藏范围内没有匹配结果。清除筛选后仍会留在收藏夹，不会跳到首页。") : "可以放宽筛选条件，或切换到「全部收录」看看。精选频道只展示通过审核的内容。"}
          </p>
          <button
            type="button"
            onClick={() => {
              resetFilters();
              setPreset("all");
            }}
            className="mt-1 rounded-md bg-brand px-4 py-2 text-[12.5px] font-medium text-white hover:bg-brand-hover"
          >
            {savedOnly ? "查看全部收藏" : "查看全部收录"}
          </button>{savedOnly && preset === "all" && activeFilterCount === 0 && <button type="button" className="soda-empty-discover" onClick={onDiscover}>去发现内容</button>}
        </div>
      )}
    </div><ReadingNote stats={stats.data} sources={sources.data?.sources??[]} onSaved={enterSaved} onSources={onSources}/></div>
  );
}
