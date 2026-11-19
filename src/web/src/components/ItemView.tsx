import { ResourceStory } from "./ResourceStory.tsx";
import { CodeChip } from "./CodeChip.tsx";
export { CodeChip } from "./CodeChip.tsx";
import { FreshnessCard } from "./FreshnessCard.tsx";
import { useEffect, useRef, useState } from "react";
import "../reading-v3.css";
import "../reader.css";
import {
  ArrowUpRight,
  Ban,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  ShieldAlert,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { KIND_LABEL, OBTAIN_HINT, OBTAIN_LABEL, categoryLabelForKind, extractBlockCandidates, timeAgo } from "../lib/sources.ts";
import type { Item } from "../types.ts";


function PriceBadge({ item, inline = false }: { item: Item; inline?: boolean }) {
  if (item.is_free === 1 || item.price === 0) {
    return inline ? (
      <span className="shrink-0 text-[11.5px] font-semibold text-deal">免费</span>
    ) : (
      <span className="inline-flex items-center rounded bg-deal-subtle px-1.5 py-0.5 text-[11px] font-semibold text-deal">
        免费
      </span>
    );
  }
  if (typeof item.price === "number" && item.price > 0) {
    const label = item.price < 1 ? "<1 元" : Math.round(item.price) + " 元内";
    return inline ? (
      <span className="shrink-0 text-[11.5px] font-semibold text-accent">{label}</span>
    ) : (
      <span className="inline-flex items-center rounded bg-brand-subtle px-1.5 py-0.5 text-[11px] font-semibold text-accent">
        {label}
      </span>
    );
  }
  return null;
}

const OBTAIN_STYLE: Record<string, string> = {
  conditional: "bg-code-subtle text-code",
  lottery: "bg-purple-50 text-purple-700",
  trial: "bg-sky-50 text-sky-700",
  promo: "bg-ink-100 text-ink-600",
  paid: "bg-ink-100 text-ink-600",
};

const OBTAIN_TEXT: Record<string, string> = {
  conditional: "text-code",
  lottery: "text-purple-700",
  trial: "text-sky-700",
  promo: "text-ink-500",
  paid: "text-ink-500",
};

/** 获取方式徽章：非 free 的一律标出来，避免抽奖/试用/推广混进「完全白嫖」。 */
const KIND_STYLE: Record<string, string> = {
  deal: "bg-amber-50 text-amber-700",
  opensource: "bg-emerald-50 text-emerald-700",
  news: "bg-rose-50 text-rose-700",
  info: "bg-sky-50 text-sky-700",
};

function KindBadge({ kind, inline = false }: { kind: string | null | undefined; inline?: boolean }) {
  if (!kind || kind === "freebie" || kind === "noise") return null;
  const label = KIND_LABEL[kind];
  if (!label) return null;
  if (inline) {
    return (
      <span className={"shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium " + (KIND_STYLE[kind] ?? "bg-ink-100 text-ink-600")}>
        {label}
      </span>
    );
  }
  return (
    <span className={"inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium " + (KIND_STYLE[kind] ?? "bg-ink-100 text-ink-600")}>
      {label}
    </span>
  );
}

function ObtainBadge({ obtain, inline = false }: { obtain: string | null | undefined; inline?: boolean }) {
  const mode = obtain ?? "free";
  if (mode === "free") return null;
  if (inline) {
    return (
      <span
        className={"shrink-0 text-[11.5px] font-semibold " + (OBTAIN_TEXT[mode] ?? OBTAIN_TEXT.promo)}
        title={OBTAIN_HINT[mode] ?? ""}
      >
        {OBTAIN_LABEL[mode] ?? mode}
      </span>
    );
  }
  return (
    <span
      className={"inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium " + (OBTAIN_STYLE[mode] ?? OBTAIN_STYLE.promo)}
      title={OBTAIN_HINT[mode] ?? ""}
    >
      {OBTAIN_LABEL[mode] ?? mode}
    </span>
  );
}

/** Compact journal entry; shared resource actions and evidence, without a score rail. */
export function CompactRow(props: {
  item: Item; sourceName: (id: string) => string; selected?: boolean;
  onPatch: (id: number, body: Record<string, unknown>) => void;
  onOpen: (item: Item) => void; onQuickBlock: (item: Item) => void;
  onCopyCode: (code: string) => void; onToggleRelated?: (id: number) => void; expanded?: boolean;
}) { return <ResourceStory {...props} compact/>; }

function CoverImage({
  src,
  className = "",
  children,
}: {
  src: string | null | undefined;
  className?: string;
  children?: React.ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [src]);

  if (!src || broken) return null;
  return (
    <div className={"relative overflow-hidden bg-ink-100 " + className}>
      <img
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
      />
      {children}
    </div>
  );
}

/** Illustrated journal entry. Reading and saving are primary; other tools live in its action menu. */
export function ItemCard(props: {
  item: Item; sourceName: (id: string) => string; priority?: boolean;
  onPatch: (id: number, body: Record<string, unknown>) => void;
  onOpen: (item: Item) => void; onQuickBlock: (item: Item) => void;
  onCopyCode: (code: string) => void; onToggleRelated?: (id: number) => void; expanded?: boolean;
  relatedItems?: (Item & { sourceName?: string })[];
}) { return <ResourceStory {...props}/>; }

/** Reader stays open until its explicit top-right close button is activated. */
export function ItemDetailDrawer({
  item,
  sourceName,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onPatch,
  onQuickBlock,
  onCopyCode,
  overlayActive = false,
}: {
  item: Item;
  sourceName: (id: string) => string;
  overlayActive?: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onPatch: (id: number, body: Record<string, unknown>) => void;
  onQuickBlock: (item: Item) => void;
  onCopyCode: (code: string) => void;
}) {
  const codes = Array.isArray(item.codes) ? item.codes : [];

  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLButtonElement>('[data-reader-close]')?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (overlayActive) return;
      if (e.key === "Tab") {
        const controls = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, summary, [tabindex="0"]');
        if (controls?.length) {
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (!first || !last) return;
          if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
            e.preventDefault(); last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault(); first?.focus();
          }
        }
      }
      // Deliberately do not dismiss on Escape: user requested close-button-only dismissal.
      if (e.key === "Escape") { e.preventDefault(); return; }
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [role=menu], [contenteditable=true], .reading-v3-detail-scroll")) return;
      if (e.key === "ArrowUp" && hasPrev) {
        e.preventDefault();
        onPrev();
      }
      if (e.key === "ArrowDown" && hasNext) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, hasPrev, hasNext, onPrev, onNext, overlayActive]);

  return (
    <div className="reading-v3-backdrop bubble-reader-backdrop backdrop-enter">
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal={!overlayActive}
        aria-hidden={overlayActive || undefined}
        inert={overlayActive || undefined}
        aria-labelledby="reading-v3-detail-title"
        tabIndex={-1}
        className="reading-v3-detail"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶栏 */}
        <div className="reading-v3-detail-toolbar">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!hasPrev}
              onClick={onPrev}
              className="rounded-lg border border-ink-200 p-1.5 text-ink-600 hover:bg-ink-100 disabled:opacity-30"
              title="上一条 (↑)"
            >
              <ChevronUp size={14} />
            </button>
            <button
              type="button"
              disabled={!hasNext}
              onClick={onNext}
              className="rounded-lg border border-ink-200 p-1.5 text-ink-600 hover:bg-ink-100 disabled:opacity-30"
              title="下一条 (↓)"
            >
              <ChevronDown size={14} />
            </button>
            <span className="ml-2 text-[12px] text-ink-500">{sourceName(item.source_id)}</span>
          </div>
          <button
            type="button"
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
            data-reader-close
            aria-label="关闭详情"
            className="bubble-reader-close"
            title="关闭详情"
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="reading-v3-detail-scroll" key={item.id} tabIndex={0} role="region" aria-label="资源正文">
          <header className="reading-v3-detail-heading">
          <div className="reading-v3-kicker">资源档案 / {sourceName(item.source_id)}</div>
          <h2 id="reading-v3-detail-title" className="reading-v3-detail-title">{item.title}</h2>
          <div className="reading-v3-annotations">
            <KindBadge kind={item.kind} />
            {item.category && (
              <span className="rounded bg-brand-subtle px-2 py-0.5 font-medium text-accent">
                {categoryLabelForKind(item.category, item.kind)}
              </span>
            )}
            {item.kind !== "news" && item.kind !== "info" && <PriceBadge item={item} />}
            {item.kind !== "news" && item.kind !== "info" && <ObtainBadge obtain={item.obtain} />}
            <span className="rounded bg-ink-100 px-2 py-0.5 font-mono text-ink-700">
              评分 {Math.round(item.score)}
            </span>

          </div>

          </header>
          <div className="reading-v3-detail-columns">
          <article className="reading-v3-detail-body">
          <FreshnessCard item={item} detail/>
          <CoverImage src={item.image_url} className="reading-v3-detail-cover" />
          {item.ai?.reason && (
            <div
              className={
                "flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-[12.5px] " +
                (item.ai.keep === false
                  ? "border-ink-200 bg-ink-100/70 text-ink-600"
                  : "border-deal-border bg-deal-subtle/70 text-emerald-900")
              }
            >
              <Sparkles size={14} className={item.ai.keep === false ? "text-ink-500" : "text-deal"} />
              <span>
                <strong>AI 判定：</strong>
                {item.ai.keep === false
                  ? "低价值/水帖 · "
                  : item.kind === "news"
                    ? "重要新闻 · "
                    : item.kind === "info"
                      ? "行业资讯 · "
                      : item.kind === "opensource"
                        ? "开源项目 · "
                        : item.kind === "deal"
                          ? "特价好价 · "
                          : "可领取福利 · "}
                {item.ai.reason}
              </span>
            </div>
          )}

          {codes.length > 0 && (
            <section className="reading-v3-code-shelf">
              <div className="mb-2 text-[12px] font-medium text-amber-900">提取到的兑换码（点击复制）</div>
              <div className="flex flex-wrap gap-2">
                {codes.map((code) => (
                  <CodeChip key={code} code={code} onCopy={onCopyCode} />
                ))}
              </div>
            </section>
          )}

          {item.summary && (
            <section className="reading-v3-prose reading-v3-summary">
              <h3>内容摘要</h3>
              <p>{item.summary}</p>
            </section>
          )}

          {item.content && item.content !== item.summary && (
            <section className="reading-v3-prose">
              <h3>正文留档 <span>原帖快照</span></h3>
              <p>
                {item.content}
              </p>
            </section>
          )}

          </article>
          <aside className="reading-v3-detail-notes" aria-label="收录信息">
          <h3 className="reading-v3-kicker">收录信息</h3>
          <dl className="reading-v3-facts">
            <div>
              <dt className="text-ink-500">发布时间</dt>
              <dd className="mt-0.5 font-mono text-ink-900">
                {item.published_at ? item.published_at.replace("T", " ").slice(0, 19) : "—"}
              </dd>
            </div>

            <div>
              <dt className="text-ink-500">来源 ID</dt>
              <dd className="mt-0.5 truncate font-mono text-ink-700">{item.source_id}</dd>
            </div>
          </dl>

          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((t) => (
                <span key={t} className="rounded-md bg-ink-100 px-2 py-0.5 font-mono text-[11px] text-ink-600">
                  #{t}
                </span>
              ))}
            </div>
          )}
          </aside>
          </div>
        </div>

        {/* 底部动作栏 */}
        <div className="reading-v3-detail-actions">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            onClick={() => {
              if (!item.read) onPatch(item.id, { read: true });
            }}
            className="inline-flex min-w-full flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-brand-hover sm:min-w-0 sm:py-2"
          >
            {item.kind === "news" || item.kind === "info" ? "查看原文详情" : "打开原帖领取"} <ArrowUpRight size={14} />
          </a>
          <button
            type="button"
            onClick={() => onPatch(item.id, { starred: !item.starred })}
            className={
              "inline-flex grow basis-[calc(50%-0.25rem)] items-center justify-center gap-1 rounded-lg border px-3 py-2.5 text-[13px] transition-colors sm:grow-0 sm:basis-auto sm:py-2 " +
              (item.starred
                ? "border-amber-300 bg-code-subtle text-amber-800"
                : "border-ink-200 bg-surface text-ink-700 hover:bg-ink-100")
            }
          >
            <Star size={14} fill={item.starred ? "currentColor" : "none"} /> {item.starred ? "已收藏" : "收藏"}
          </button>
          <button
            type="button"
            onClick={() => onPatch(item.id, { read: !item.read })}
            className="inline-flex grow basis-[calc(50%-0.25rem)] items-center justify-center gap-1 rounded-lg border border-ink-200 bg-surface px-3 py-2.5 text-[13px] text-ink-700 hover:bg-ink-100 sm:grow-0 sm:basis-auto sm:py-2"
          >
            <Eye size={14} /> {item.read ? "标未读" : "标已读"}
          </button>
          <button
            type="button"
            onClick={() => {
              onQuickBlock(item);
            }}
            className="inline-flex grow basis-[calc(50%-0.25rem)] items-center justify-center gap-1 rounded-lg border border-alert-border bg-alert-subtle px-3 py-2.5 text-[13px] text-alert hover:bg-red-100/80 sm:grow-0 sm:basis-auto sm:py-2"
          >
            <ShieldAlert size={14} /> 屏蔽
          </button>
          <button
            type="button"
            onClick={() => {
              onPatch(item.id, { status: item.status === "ignored" ? "active" : "ignored" });
            }}
            className="inline-flex grow basis-[calc(50%-0.25rem)] items-center justify-center gap-1 rounded-lg border border-ink-200 bg-surface px-3 py-2.5 text-[13px] text-ink-700 hover:bg-ink-100 sm:grow-0 sm:basis-auto sm:py-2"
            title="修改这条内容的显示状态，不会关闭详情"
          >
            <EyeOff size={14} /> {item.status === "ignored" ? "恢复显示这条" : "不再显示这条"}
          </button>
        </div>
      </aside>
    </div>
  );
}

/** 快捷屏蔽弹窗 */
export function QuickBlockModal({
  item,
  sourceName,
  onClose,
  onIgnoreOne,
  onAddRule,
}: {
  item: Item;
  sourceName: (id: string) => string;
  onClose: () => void;
  onIgnoreOne: (id: number) => void;
  onAddRule: (pattern: string, scope: string) => Promise<void>;
}) {
  const candidates = extractBlockCandidates(item.title);
  const [blockError,setBlockError] = useState("");
  const [pattern, setPattern] = useState(candidates[0] ?? "");
  const [scope, setScope] = useState("all");
  const [busy, setBusy] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    blockRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); closeRef.current(); }
      if (event.key === "Tab") {
        const controls = [...(blockRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input') ?? [])];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus(); };
  }, []);

  return (
    <div
      className="backdrop-enter fixed inset-0 z-[70] flex items-end justify-center bg-ink-950/30 backdrop-blur-[1px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={blockRef} role="dialog" aria-modal="true" aria-label="屏蔽处理"
        className="sheet-enter sm:pop-enter panel max-h-[90vh] w-full max-w-md overflow-y-auto rounded-b-none rounded-t-xl p-4 sm:rounded-xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[14.5px] font-semibold text-ink-950">
            <ShieldAlert size={16} className="text-alert" /> 屏蔽处理
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-500 hover:bg-ink-100">
            <X size={15} />
          </button>
        </div>

        <p className="mb-3 line-clamp-2 rounded-lg border border-ink-200 bg-surface-hover p-2.5 text-[12.5px] text-ink-700">
          {item.title}
        </p>

        {blockError && <p role="alert" className="text-alert text-sm">{blockError}</p>}
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-[12px] text-ink-500">点选标题关键词快速加入屏蔽：</div>
            <div className="flex flex-wrap gap-1.5">
              {candidates.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setPattern(c)}
                  className={
                    "rounded-lg border px-2 py-1 text-[12px] transition-colors " +
                    (pattern === c
                      ? "border-alert-border bg-alert-subtle font-medium text-alert"
                      : "border-ink-200 bg-surface text-ink-700 hover:bg-ink-100")
                  }
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[12px] text-ink-500">
              屏蔽关键词（命中该词的新老条目都会隐藏，且不推 Telegram）
            </label>
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="输入要屏蔽的关键词…"
              className="w-full rounded-lg border border-ink-200 bg-surface px-3 py-2 text-[13px] text-ink-950 outline-none focus:border-brand"
            />
          </div>

          <div className="flex flex-col gap-2 text-[12px] sm:flex-row">
            {[
              { key: "all", label: "全部来源屏蔽" },
              { key: item.source_id, label: "仅对「" + sourceName(item.source_id) + "」生效" },
            ].map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setScope(o.key)}
                className={
                  "flex-1 truncate rounded-lg border px-2.5 py-2.5 text-left transition-colors sm:py-2 " +
                  (scope === o.key
                    ? "border-alert-border bg-alert-subtle font-medium text-alert"
                    : "border-ink-200 text-ink-600 hover:bg-ink-100")
                }
              >
                {o.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 pb-[env(safe-area-inset-bottom)]">
            <button
              type="button"
              onClick={() => {
                onIgnoreOne(item.id);
                onClose();
              }}
              className="rounded-lg border border-ink-200 px-3 py-2 text-[12.5px] text-ink-600 hover:bg-ink-100"
            >
              仅隐藏这一条
            </button>
            <button
              type="button"
              disabled={!pattern.trim() || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onAddRule(pattern.trim(), scope);
                  onClose();
                } catch { setBlockError("未能保存屏蔽规则，请重试"); } finally {
                  setBusy(false);
                }
              }}
              className="rounded-lg bg-alert px-4 py-2 text-[12.5px] font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-40"
            >
              加入屏蔽规则
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
