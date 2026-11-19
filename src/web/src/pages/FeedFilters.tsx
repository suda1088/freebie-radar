import { AlignJustify, CheckCheck, ChevronDown, LayoutGrid, Loader2, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Select } from "../components/Select.tsx";
import { KIND_LABEL, KIND_ORDER, OBTAIN_HINT, OBTAIN_LABEL, categoriesForPreset, categoryLabelForPreset } from "../lib/sources.ts";
import { sourceName } from "../lib/source-labels.ts";
import type { FeedFilterModel } from "../hooks/useFeedFilters.ts";
import type { ApiResult } from "../hooks/useApi.ts";
import type { Item, Stats } from "../types.ts";

interface FeedFiltersProps {
  filters: FeedFilterModel;
  items: ApiResult<{ total: number; items: Item[] }>;
  stats: ApiResult<Stats>;
  onMarkVisibleRead: () => Promise<void>;
}

export function FeedFilters({ filters, items, stats, onMarkVisibleRead: markVisibleRead }: FeedFiltersProps) {
  const {
    catOpen, setCatOpen, catRef, debounced, source, categories, lang, sort, range, priceCap, minScore,
    obtain, kindFilter, preset, viewMode, unreadOnly, mobileFilterBar, activeFilterCount, setSearch,
    setDebounced, setSource, setCategories, setLang, setSort, setRange, setPriceCap, setMinScore,
    setObtain, setKindFilter, setUnreadOnly, updateViewMode, resetFilters,
  } = filters;
  const visible = items.data?.items ?? [];
  return (

    <div
      className={
        "soda-filterbar border-b border-ink-200 bg-[#FCFCFD] px-3.5 py-2.5 sm:px-6 sm:py-2 " +
        (mobileFilterBar ? "block" : "hidden")
      }
    >
      <div className="soda-filter-title"><div><SlidersHorizontal size={17} /><strong>挑选你感兴趣的</strong><span>按内容、时间和获取方式缩小范围</span></div><span>{activeFilterCount ? `${activeFilterCount} 项条件` : "不限条件"}</span></div>
      <div className="soda-filter-controls flex flex-wrap items-center gap-1">
        {/* 分类多选浮层（展开查看全部分类） */}
        <div className="relative" ref={catRef}>
          <button
            type="button"
            onClick={() => setCatOpen((v) => !v)}
            className={
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition-colors " +
              (categories.length
                ? "border-ink-950 bg-ink-950 font-medium text-white"
                : "border-ink-200 bg-surface text-ink-700 hover:border-ink-300")
            }
          >
            <span>
              {categories.length === 0
                ? "分类"
                : categories.length === 1
                  ? `分类：${categoryLabelForPreset(categories[0]!, preset)}`
                  : `分类：已选 ${categories.length} 项`}
            </span>
            <ChevronDown size={12} />
          </button>
          {catOpen && (
            <div className="pop-enter panel absolute top-full left-0 z-40 mt-1.5 w-[260px] p-2.5 shadow-lg">
              <div className="mb-2 flex items-center justify-between text-[11px] text-ink-500">
                <span>{preset === "news" ? "要闻栏目（支持多选）" : preset === "info" ? "行业资讯栏目（支持多选）" : preset === "deal" ? "好价分类（支持多选）" : preset === "opensource" ? "开源方向（支持多选）" : "福利分类（支持多选）"}</span>
                {categories.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCategories([])}
                    className="font-medium text-accent hover:underline"
                  >
                    清空
                  </button>
                )}
              </div>
              <div className="grid max-h-[240px] grid-cols-2 gap-1 overflow-auto">
                {(() => {
                  const countMap = new Map((stats.data?.byCategory ?? []).map((c) => [c.category ?? "other", c.n]));
                  const allowed = categoriesForPreset(preset);
                  const ordered = [...allowed].sort((a, b) => (countMap.get(b) ?? 0) - (countMap.get(a) ?? 0));
                  return ordered.map((key) => {
                    const n = countMap.get(key) ?? 0;
                    const checked = categories.includes(key);
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
                          "flex items-center justify-between rounded border px-2 py-1 text-left text-[11.5px] transition-colors " +
                          (checked
                            ? "border-ink-950 bg-ink-950 font-medium text-white"
                            : n > 0
                              ? "border-ink-200 bg-surface text-ink-700 hover:bg-ink-100"
                              : "border-ink-100 bg-canvas/70 text-ink-400 hover:bg-ink-100")
                        }
                      >
                        <span className="truncate">{categoryLabelForPreset(key, preset)}</span>
                        <span className={"ml-1 font-mono text-[10.5px] " + (checked ? "text-white/70" : "text-ink-400")}>
                          {n}
                        </span>
                      </button>
                    );
                  });
                })()}
              </div>
            </div>
          )}
        </div>

        {/* 内容形态筛选 */}
        <Select
          value={kindFilter}
          onValueChange={(value) => setKindFilter(value)}
          className="h-7 rounded-md border border-ink-200 bg-surface px-1.5 text-[11.5px] text-ink-700 outline-none focus:border-accent"
          title="内容形态"
        >
          <option value="auto">形态：{preset === "verified" ? "真福利" : preset === "free" ? "白嫖" : preset === "deal" ? "好价" : preset === "opensource" ? "开源" : preset === "news" ? "要闻" : preset === "info" ? "资讯" : "全部"}</option>
          <option value="all">形态：全部（含其它）</option>
          {KIND_ORDER.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </Select>

        {/* 语言筛选 */}
        <Select
          value={lang}
          onValueChange={(value) => setLang(value as "all" | "zh" | "en")}
          className="h-7 rounded-md border border-ink-200 bg-surface px-1.5 text-[11.5px] text-ink-700 outline-none focus:border-accent"
          title="按标题语言筛选"
        >
          <option value="all">语言：全部</option>
          <option value="zh">仅看中文</option>
          <option value="en">仅看英文</option>
        </Select>

        {preset !== "news" && preset !== "info" && preset !== "opensource" && (
          <>
            <Select
              value={priceCap}
              onValueChange={(value) => setPriceCap(value)}
              className="h-7 rounded-md border border-ink-200 bg-surface px-1.5 text-[11.5px] text-ink-700 outline-none focus:border-accent"
              title="价格上限"
            >
              <option value="auto">
                价格：{preset === "free" ? "白嫖" : "不限"}
              </option>
              <option value="all">价格：不限</option>
              <option value="free">仅白嫖 (0 元)</option>
              <option value="5">≤ 5 元</option>
              <option value="10">≤ 10 元</option>
              <option value="30">≤ 30 元</option>
              <option value="100">≤ 100 元</option>
            </Select>

            <Select
              value={obtain}
              onValueChange={(value) => setObtain(value)}
              className="h-7 rounded-md border border-ink-200 bg-surface px-1.5 text-[11.5px] text-ink-700 outline-none focus:border-accent"
              title={OBTAIN_HINT[obtain] ?? "获取方式"}
            >
              <option value="auto">
                方式：{preset === "verified" ? "白嫖+条件" : preset === "free" ? "直领" : "不限"}
              </option>
              <option value="all">方式：全部（含抽奖/试用）</option>
              <option value="free">仅直接白嫖</option>
              <option value="conditional">有条件领取</option>
              <option value="lottery">抽奖/开奖</option>
              <option value="trial">免费试用</option>
              <option value="promo">推广/引流</option>
            </Select>
          </>
        )}

        <Select
          value={range}
          onValueChange={(value) => setRange(value)}
          className="h-7 rounded-md border border-ink-200 bg-surface px-1.5 text-[11.5px] text-ink-700 outline-none focus:border-accent"
          title="发布时间窗口"
        >
          <option value="auto">
            时间：{preset === "verified" ? "7天内" : preset === "free" ? "14天内" : "不限"}
          </option>
          <option value="all">时间：不限</option>
          <option value="1d">24 小时内</option>
          <option value="3d">3 天内</option>
          <option value="7d">一周内</option>
          <option value="30d">一个月内</option>
        </Select>

        <Select
          value={minScore}
          onValueChange={(value) => setMinScore(value)}
          className="h-7 rounded-md border border-ink-200 bg-surface px-1.5 text-[11.5px] text-ink-700 outline-none focus:border-accent"
          title="最低评分"
        >
          <option value="all">评分：不限</option>
          <option value="50">≥ 50 分</option>
          <option value="60">≥ 60 分</option>
          <option value="70">≥ 70 分</option>
        </Select>

        <Select
          value={sort}
          onValueChange={(value) => setSort(value)}
          className="h-7 rounded-md border border-ink-200 bg-surface px-1.5 text-[11.5px] text-ink-700 outline-none focus:border-accent"
          title="排序方式"
        >
          <option value="newest">最新</option>
          <option value="score">高分</option>
          <option value="oldest">最早</option>
          <option value="expiring">快截止</option>
          {preset !== "news" && preset !== "info" && <option value="price_asc">低价</option>}
        </Select>

        <button
          type="button"
          onClick={() => setUnreadOnly((v) => !v)}
          className={
            "h-7 rounded-md border px-2.5 text-[12px] font-medium transition-colors active:scale-[0.97] " +
            (unreadOnly
              ? "border-ink-950 bg-ink-950 text-white"
              : "border-ink-200 bg-surface text-ink-600 hover:border-ink-300")
          }
        >
          未读
        </button>

        {visible.some((i) => !i.read) && (
          <button
            type="button"
            onClick={() => void markVisibleRead()}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-ink-200 bg-surface px-2 text-[12px] font-medium text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-950 active:scale-[0.97]"
            title="把当前列表里的未读条目一次性标为已读"
          >
            <CheckCheck size={12} /> 标已读
          </button>
        )}

        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-accent hover:bg-brand-subtle"
          >
            <RotateCcw size={11} /> 重置 ({activeFilterCount})
          </button>
        )}

        {/* 右端统计与视图切换 */}
        <div className="ml-auto hidden shrink-0 items-center gap-2 sm:flex">
          <span className="text-[12px] text-ink-500">
            {items.loading ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 size={11} className="animate-spin" /> 加载中…
              </span>
            ) : (
              <>
                共 <strong className="font-mono font-semibold tabular-nums text-ink-900">{items.data?.total ?? 0}</strong> 条
              </>
            )}
          </span>
          <div className="flex items-center gap-0.5 rounded-md border border-ink-200 bg-surface p-0.5">
            {[
              { key: "compact" as const, icon: AlignJustify, label: "单行紧凑列表", text: "紧凑" },
              { key: "grid2" as const, icon: LayoutGrid, label: "图文手记", text: "手记" },
              { key: "grid3" as const, icon: LayoutGrid, label: "紧凑图文", text: "密集" },
            ].map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => updateViewMode(v.key)}
                className={
                  "inline-flex items-center gap-1 rounded px-2 py-1 text-[11.5px] font-medium transition-colors " +
                  (viewMode === v.key ? "bg-ink-950 text-white" : "text-ink-500 hover:text-ink-950")
                }
                title={v.label}
              >
                <v.icon size={12} />
                <span>{v.text}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeFilterCount > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-ink-100 pt-2 text-[11.5px]">
          <span className="text-ink-400">当前条件：</span>
          {debounced && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setDebounced("");
              }}
              className="rounded bg-ink-100 px-2 py-0.5 text-ink-700 hover:bg-ink-200"
            >
              搜索：{debounced} ×
            </button>
          )}
          {source && (
            <button
              type="button"
              onClick={() => setSource("")}
              className="rounded bg-brand-subtle px-2 py-0.5 text-accent hover:bg-ink-200/70"
            >
              源：{sourceName(source)} ×
            </button>
          )}
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategories((cur) => cur.filter((x) => x !== cat))}
              className="rounded bg-brand-subtle px-2 py-0.5 text-accent hover:bg-ink-200/70"
            >
              分类：{categoryLabelForPreset(cat, preset)} ×
            </button>
          ))}
          {lang !== "all" && (
            <button
              type="button"
              onClick={() => setLang("all")}
              className="rounded bg-brand-subtle px-2 py-0.5 text-accent hover:bg-ink-200/70"
            >
              语言：{lang === "zh" ? "仅看中文" : "仅看英文"} ×
            </button>
          )}
          {priceCap !== "auto" && (
            <button
              type="button"
              onClick={() => setPriceCap("auto")}
              className="rounded bg-brand-subtle px-2 py-0.5 text-accent hover:bg-ink-200/70"
            >
              价格：{priceCap === "all" ? "不限" : priceCap === "free" ? "仅白嫖" : `≤${priceCap}元`} ×
            </button>
          )}
          {obtain !== "auto" && (
            <button
              type="button"
              onClick={() => setObtain("auto")}
              className="rounded bg-brand-subtle px-2 py-0.5 text-accent hover:bg-ink-200/70"
            >
              方式：{obtain === "all" ? "全部" : (OBTAIN_LABEL[obtain] ?? obtain)} ×
            </button>
          )}
          {range !== "auto" && (
            <button
              type="button"
              onClick={() => setRange("auto")}
              className="rounded bg-brand-subtle px-2 py-0.5 text-accent hover:bg-ink-200/70"
            >
              时间：{range === "all" ? "不限" : range} ×
            </button>
          )}
          {minScore !== "all" && (
            <button
              type="button"
              onClick={() => setMinScore("all")}
              className="rounded bg-brand-subtle px-2 py-0.5 text-accent hover:bg-ink-200/70"
            >
              评分：≥{minScore} ×
            </button>
          )}
          {unreadOnly && (
            <button
              type="button"
              onClick={() => setUnreadOnly(false)}
              className="rounded bg-brand-subtle px-2 py-0.5 text-accent hover:bg-ink-200/70"
            >
              仅未读 ×
            </button>
          )}
        </div>
      )}
    </div>
  );
}
