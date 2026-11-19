import { useState } from "react";
import { CalendarDays, Loader2, Play, Sparkles } from "lucide-react";
import type { Item } from "../types.ts";
import { CompactRow } from "./ItemView.tsx";

export function DigestPanel({
  digests,
  detail,
  pickedDate,
  onPickDate,
  onRunDaily,
  onRunWeekly,
  canAdmin = true,
  sourceName,
  onPatch,
  onOpen,
  onQuickBlock,
  onCopyCode,
}: {
  digests: { date: string; created_at: string; pushed_at: string | null; kind: string; count: number }[];
  detail: {
    data: { date: string; text: string; count: number; created_at: string; pushed_at: string | null; items: Item[] } | null;
    loading: boolean;
    error: string | null;
  };
  pickedDate: string | null;
  onPickDate: (d: string) => void;
  onRunDaily: () => Promise<void>;
  onRunWeekly: () => Promise<void>;
  canAdmin?: boolean;
  sourceName: (id: string) => string;
  onPatch: (id: number, body: Record<string, unknown>) => void;
  onOpen: (item: Item) => void;
  onQuickBlock: (item: Item) => void;
  onCopyCode: (code: string) => void;
}) {
  const [running, setRunning] = useState(false);
  const [weeklyRunning, setWeeklyRunning] = useState(false);
  const active = pickedDate ?? digests[0]?.date ?? null;
  const activeDigest = digests.find((d) => d.date === detail.data?.date);

  return (
    <section className="reading-v3-archive">
      <header className="reading-v3-section-header">
        <div>
          <p className="reading-v3-kicker">THE ARCHIVE / 精选留档</p>
          <h2>把值得读的，留在时间里。</h2>
          <p>按日期回看精选摘要，再逐条打开资源。</p>
        </div>
        {canAdmin && (
          <div className="reading-v3-generation-actions">
            <button
              type="button"
              disabled={running}
              onClick={async () => {
                setRunning(true);
                try { await onRunDaily(); } finally { setRunning(false); }
              }}
              className="reading-v3-action reading-v3-action-primary"
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              生成今日精选
            </button>
            <button
              type="button"
              disabled={weeklyRunning}
              onClick={async () => {
                setWeeklyRunning(true);
                try { await onRunWeekly(); } finally { setWeeklyRunning(false); }
              }}
              title="汇总近 7 天 AI 判为真福利且未过期的条目，附本周热词与分类分布"
              className="reading-v3-action"
            >
              {weeklyRunning ? <Loader2 size={13} className="animate-spin" /> : <CalendarDays size={13} />}
              生成本周周报
            </button>
          </div>
        )}
      </header>
      <div className="reading-v3-archive-layout">
        <nav className="reading-v3-date-rail" aria-label="精选日期">
          <div className="reading-v3-rail-heading">往期目录 <span>{digests.length} 期</span></div>
          <div className="reading-v3-date-list">
            {digests.map((d) => (
              <button
                key={`${d.date}-${d.kind}`}
                type="button"
                onClick={() => onPickDate(d.date)}
                aria-current={d.date === active ? "date" : undefined}
                className={"reading-v3-date-entry " + (d.date === active ? "reading-v3-date-active" : "")}
              >
                <span className="reading-v3-date-kind">{d.kind === "weekly" ? "周报" : "每日精选"}</span>
                <strong>{d.date}</strong>
                <span className="reading-v3-date-meta">{d.count} 条资源<span>{d.pushed_at ? "已推送" : "已留档"}</span></span>
              </button>
            ))}
          </div>
          {!digests.length && <p className="reading-v3-empty-note">生成第一期精选后，日期目录会出现在这里。</p>}
        </nav>

        <div className="reading-v3-archive-pane" aria-busy={detail.loading}>
          {!digests.length && (
            <div className="reading-v3-empty">
              <Sparkles size={28} />
              <h3>第一期，等待收录</h3>
              <p>{canAdmin ? "生成今日精选后，会按照推送规则中的价格、分类与 AI 条件整理并自动留档。" : "尚无精选记录，请等待管理员生成。"}</p>
            </div>
          )}
          {detail.loading && <div className="reading-v3-notice" role="status"><Loader2 size={15} className="animate-spin" /> 正在翻阅精选…</div>}
          {detail.error && <div className="reading-v3-notice reading-v3-error" role="alert">{detail.error}</div>}
          {detail.data && (
            <>
              <article className="reading-v3-digest-editorial">
                <header>
                  <p className="reading-v3-kicker">{activeDigest?.kind === "weekly" ? "WEEKLY EDITION / 周报" : "DAILY EDITION / 每日精选"}</p>
                  <h3>{detail.data.date}</h3>
                  <div className="reading-v3-digest-publication">
                    <span>精选摘要 · 共 {detail.data.count} 条</span>
                    <span>生成于 {detail.data.created_at.replace("T", " ").slice(5, 16)}</span>
                    <span>{detail.data.pushed_at ? "已发 Telegram" : "仅留档"}</span>
                  </div>
                </header>
                <div className="reading-v3-digest-text">{detail.data.text}</div>
              </article>
              <section className="reading-v3-digest-resources" aria-label="本期资源">
                <header className="reading-v3-subheading"><h3>本期资源</h3><span>{detail.data.items.length} 条可继续阅读</span></header>
                {detail.data.items.map((item) => (
                  <CompactRow
                    key={item.id}
                    item={item}
                    sourceName={sourceName}
                    onPatch={onPatch}
                    onOpen={onOpen}
                    onQuickBlock={onQuickBlock}
                    onCopyCode={onCopyCode}
                  />
                ))}
                {!detail.data.items.length && <p className="reading-v3-empty-note">本期没有可展开的资源条目。</p>}
              </section>
            </>
          )}
        </div>
      </div>
    </section>
  );
}