import { Loader2, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { KIND_LABEL, categoryLabelForKind, timeAgo } from "../lib/sources.ts";
import type { HotReport, HotScope } from "../types.ts";

const WINDOWS = [
  { hours: 24, label: "24 小时" },
  { hours: 72, label: "3 天" },
  { hours: 168, label: "7 天" },
];
const SCOPES: { key: HotScope; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "deals", label: "福利/好价" },
  { key: "news", label: "重要新闻" },
  { key: "info", label: "行业资讯" },
];

function Delta({ delta }: { delta: number }) {
  if (delta === 0) return <span className="reading-v3-delta">持平</span>;
  return (
    <span className={"reading-v3-delta " + (delta > 0 ? "reading-v3-delta-up" : "")}>
      {delta > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {delta > 0 ? "+" : ""}{delta}
    </span>
  );
}

export function HotPanel({
  report,
  loading,
  error,
  hours,
  scope,
  onHours,
  onScope,
  onReload,
  onSearchWord,
  onJumpCategory,
  onOpenItem,
  sourceName,
}: {
  report: HotReport | null;
  loading: boolean;
  error: string | null;
  hours: number;
  scope: HotScope;
  onHours: (h: number) => void;
  onScope: (s: HotScope) => void;
  onReload: () => void;
  onSearchWord: (word: string) => void;
  onJumpCategory: (category: string) => void;
  onOpenItem: (id: number) => void;
  sourceName: (id: string) => string;
}) {
  const words = report?.words ?? [];
  const wordMax = Math.max(1, ...words.map((w) => w.n));
  const catMax = Math.max(1, ...(report?.categories ?? []).map((c) => c.n));
  const windowLabel = WINDOWS.find((w) => w.hours === hours)?.label ?? hours + " 小时";
  const topNews = report?.topNews ?? [];

  const rankedStories = (items: HotReport["top"], news = false) => (
    <ol className="reading-v3-trend-stories">
      {items.map((it, i) => (
        <li key={it.id}>
          <button type="button" onClick={() => onOpenItem(it.id)} className="reading-v3-trend-story">
            <span className="reading-v3-story-number">{String(i + 1).padStart(2, "0")}</span>
            <span className="reading-v3-story-copy">
              <strong>{it.title}</strong>
              <span className="reading-v3-story-meta">
                <span>{sourceName(it.source_id)}</span>
                {it.category && <span>{categoryLabelForKind(it.category, it.kind)}</span>}
                {it.kind && (news || it.kind !== "freebie") && <span>{KIND_LABEL[it.kind] ?? it.kind}</span>}
                {it.quality ? <span>质量 {it.quality}</span> : null}
                {(it.dupCount ?? 1) > 1 && <span>{it.dupCount} {news ? "篇同事件" : "源同步"}</span>}
              </span>
            </span>
            <span className="reading-v3-story-score">{it.score}<small>评分</small></span>
          </button>
        </li>
      ))}
    </ol>
  );

  return (
    <section className="reading-v3-trends" aria-busy={loading}>
      <header className="reading-v3-section-header">
        <div>
          <p className="reading-v3-kicker">TREND OBSERVATORY / 趋势观察</p>
          <h2>从信息流，看见正在发生。</h2>
          <p>跨源事件去重 · 点击热词或分类，回到资源流继续探索</p>
        </div>
        <button type="button" onClick={onReload} className="reading-v3-action" title="重新统计">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> 重新统计
        </button>
      </header>
      <div className="reading-v3-trend-controls">
        <div className="reading-v3-segments" aria-label="统计范围">
          {SCOPES.map((s) => <button key={s.key} type="button" aria-pressed={scope === s.key} onClick={() => onScope(s.key)}>{s.label}</button>)}
        </div>
        <div className="reading-v3-segments" aria-label="统计时间窗口">
          {WINDOWS.map((w) => <button key={w.hours} type="button" aria-pressed={hours === w.hours} onClick={() => onHours(w.hours)}>{w.label}</button>)}
        </div>
      </div>
      {error && <div className="reading-v3-notice reading-v3-error" role="alert">{error}</div>}
      {loading && !report && <div className="reading-v3-notice" role="status"><Loader2 size={15} className="animate-spin" /> 正在统计{windowLabel}趋势…</div>}
      {report && (
        <div key={`${report.windowHours}-${report.scope}`}>
          <div className="reading-v3-trend-brief">
            <div className="reading-v3-trend-lead">
              <span className="reading-v3-kicker">{windowLabel} / 独立事件</span>
              <strong>{report.scanned}</strong>
              <span className="reading-v3-trend-comparison"><Delta delta={report.scanned - report.prevScanned} /> 对比上一窗口 {report.prevScanned} 条</span>
            </div>
            <dl className="reading-v3-trend-facts">
              <div><dt>热词线索</dt><dd>{words.length}</dd><span>已过滤虚词</span></div>
              <div><dt>值得关注的福利</dt><dd>{report.top.length}</dd><span>真福利与特价好价</span></div>
              <div><dt>统计口径</dt><dd>事件去重</dd><span>{report.rawScanned && report.rawScanned > report.scanned ? `原始 ${report.rawScanned} 条` : "跨源合并同事件"}</span></div>
            </dl>
          </div>
          <div className="reading-v3-trend-layout">
            <section className="reading-v3-word-index">
              <header className="reading-v3-subheading"><h3>01 / 热词索引</h3><span>提及次数 · 较上一窗口增减</span></header>
              {words.length ? (
                <ol>
                  {words.map((w, i) => (
                    <li key={w.w}>
                      <button type="button" onClick={() => onSearchWord(w.w)} className="reading-v3-word" title={`${w.w}：本窗口 ${w.n} 次，上一窗口 ${w.prev} 次（点击搜索）`}>
                        <span className="reading-v3-word-rank">{String(i + 1).padStart(2, "0")}</span>
                        <span className="reading-v3-word-body"><strong>{w.w}</strong><span className="reading-v3-word-track"><span style={{ width: `${Math.round(w.n / wordMax * 100)}%` }} /></span></span>
                        <span className="reading-v3-word-count">{w.n}</span>
                        <Delta delta={w.delta} />
                      </button>
                    </li>
                  ))}
                </ol>
              ) : <p className="reading-v3-empty-note">这个窗口还没有足够的热词数据。</p>}
            </section>
            <aside className="reading-v3-category-index">
              <header className="reading-v3-subheading"><h3>02 / 分类动向</h3><span>点击查看分类资源</span></header>
              {report.categories.slice(0, 10).map((c) => (
                <button key={c.key} type="button" onClick={() => onJumpCategory(c.key)} className="reading-v3-category">
                  <span><strong>{categoryLabelForKind(c.key, scope === "news" ? "news" : scope === "info" ? "info" : null)}</strong><span>{c.n} <Delta delta={c.delta} /></span></span>
                  <span className="reading-v3-category-track"><span style={{ width: `${Math.round(c.n / catMax * 100)}%` }} /></span>
                </button>
              ))}
              {!report.categories.length && <p className="reading-v3-empty-note">暂无分类数据</p>}
            </aside>
          </div>
          <div className="reading-v3-trend-reading">
            <section>
              <header className="reading-v3-subheading"><h3>03 / 值得抢</h3><span>仅福利与好价 · 已去重</span></header>
              {rankedStories(report.top)}
              {!report.top.length && <p className="reading-v3-empty-note">这个窗口还没有真福利或特价好价。</p>}
            </section>
            {topNews.length > 0 && (
              <section>
                <header className="reading-v3-subheading"><h3>04 / 值得读</h3><span>重要新闻与行业资讯 · 同事件折叠</span></header>
                {rankedStories(topNews, true)}
              </section>
            )}
          </div>
          <footer className="reading-v3-method-note">统计范围：{windowLabel}内 status=active 且未被 AI 判为噪音的条目 · 更新于 {timeAgo(report.to)}</footer>
        </div>
      )}
    </section>
  );
}