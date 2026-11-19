import { useEffect, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ArrowUpRight, Ban, Bookmark, Check, Eye, EyeOff, MoreHorizontal, ChevronDown, ArrowRight } from "lucide-react";
import type { Item } from "../types.ts";
import { OBTAIN_LABEL, OBTAIN_HINT, categoryLabelForKind, timeAgo } from "../lib/sources.ts";
import { FreshnessCard } from "./FreshnessCard.tsx";
import { CodeChip } from "./CodeChip.tsx";
import "../resource-journal.css";

type Props = {
  item: Item;
  sourceName: (id: string) => string;
  compact?: boolean;
  selected?: boolean;
  priority?: boolean;
  onPatch: (id: number, body: Record<string, unknown>) => void;
  onOpen: (item: Item) => void;
  onQuickBlock: (item: Item) => void;
  onCopyCode: (code: string) => void;
  onToggleRelated?: (id: number) => void;
  expanded?: boolean;
  relatedItems?: (Item & { sourceName?: string })[];
};

function ResourceActions({ item, onPatch, onQuickBlock }: Pick<Props, "item" | "onPatch" | "onQuickBlock">) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button type="button" className="journal-more" aria-label={`更多操作：${item.title}`} title="更多操作">
          <MoreHorizontal size={18} aria-hidden="true" />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="journal-menu" sideOffset={8} collisionPadding={12}>
          <Menu.Label className="journal-menu-label">管理这条发现</Menu.Label>
          <Menu.Item className="journal-menu-item" onSelect={() => onPatch(item.id, { read: !item.read })}>
            <Eye size={15} aria-hidden="true" />{item.read ? "标为未读" : "标为已读"}
          </Menu.Item>
          <Menu.Item className="journal-menu-item" asChild>
            <a href={item.url} target="_blank" rel="noreferrer noopener" onClick={() => { if (!item.read) onPatch(item.id, { read: true }); }}>
              <ArrowUpRight size={15} aria-hidden="true" />在原站打开
            </a>
          </Menu.Item>
          <Menu.Separator className="journal-menu-divider" />
          <Menu.Item className="journal-menu-item" onSelect={() => onPatch(item.id, { status: item.status === "ignored" ? "active" : "ignored" })}>
            <EyeOff size={15} aria-hidden="true" />{item.status === "ignored" ? "恢复到列表" : "不再显示这条"}
          </Menu.Item>
          <Menu.Item className="journal-menu-item danger" onSelect={() => onQuickBlock(item)}>
            <Ban size={15} aria-hidden="true" />管理屏蔽规则
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Terms({ item }: { item: Item }) {
  if (item.kind === "news" || item.kind === "info") return null;
  const price = item.price === 0 || item.is_free === 1 ? "标注免费" : typeof item.price === "number" && item.price > 0 ? `标注价格 ¥${item.price}` : null;
  const mode = item.obtain;
  return (
    <p className="journal-terms">
      {price && <span className="journal-price">{price}</span>}
      {mode ? <span title={OBTAIN_HINT[mode]}>{OBTAIN_LABEL[mode] ?? mode}{["trial", "lottery", "conditional"].includes(mode) && " · 请核对条件"}</span> : <span>领取条件未注明，请核对原文</span>}
    </p>
  );
}

/** Structural article with native action controls. Blank-area clicks are a pointer convenience, not a second keyboard control. */
export function ResourceStory({ item, sourceName, compact = false, selected, priority = false, onPatch, onOpen, onQuickBlock, onCopyCode, onToggleRelated, expanded, relatedItems }: Props) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [item.image_url]);
  const hasImage = Boolean(item.image_url && !broken);
  const codes = Array.isArray(item.codes) ? item.codes : [];
  const matched = Array.isArray(item.matched) ? item.matched : [];
  const rejected = item.ai?.keep === false;
  const name = sourceName(item.source_id);

  return (
    <article
      className={`journal-entry ${compact ? "journal-compact" : "journal-visual reading-v3-card soda-resource-card"} ${hasImage ? "has-art" : "text-only"} ${item.read ? "is-read" : ""} ${selected ? "is-selected" : ""}`}
      data-resource-id={item.id}
      aria-label={item.title}
      onClick={event => {
        const target = event.target;
        if (!(target instanceof Element) || !event.currentTarget.contains(target) || target.closest('button,a,summary,details,input,[role="menuitem"]')) return;
        if (window.getSelection()?.toString()) return;
        onOpen(item);
      }}
    >
      {hasImage && <img className="journal-art" src={item.image_url!} alt="" width={240} height={160} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />}
      <header className="journal-header">
        <div className="journal-source">
          <span className="journal-source-initial" aria-hidden="true">{name.slice(0, 1)}</span>
          <div><strong>{name}</strong><span>{categoryLabelForKind(item.category, item.kind)}<i aria-hidden="true">·</i>{timeAgo(item.published_at ?? item.first_seen_at)}{!item.read && <b className="journal-unread">未读</b>}</span></div>
          <ResourceActions item={item} onPatch={onPatch} onQuickBlock={onQuickBlock} />
        </div>
        <h3 className={`journal-title reading-v3-card-title${rejected ? " rejected" : ""}`}>
          <button type="button" aria-haspopup="dialog" onClick={() => onOpen(item)}>{item.title}</button>
        </h3>
      </header>
      <div className="journal-content">
        {item.summary && <p className="journal-excerpt">{item.summary}</p>}
        <Terms item={item} />
        {matched.length > 0 && <p className="journal-interest">与你关注的「{matched.join(" / ")}」有关</p>}
        {codes.length > 0 && <div className="journal-code-line"><span>兑换码</span>{codes.slice(0, 2).map(code => <CodeChip key={code} code={code} onCopy={onCopyCode} />)}{codes.length > 2 && <button type="button" onClick={() => onOpen(item)}>另 {codes.length - 2} 个<span className="sr-only">，查看 {item.title}</span><ArrowRight size={12} aria-hidden="true" /></button>}</div>}
        <FreshnessCard item={item} />
        {(item.ai?.reason || item.blockedBy) && <details className="journal-context"><summary>收录说明<ChevronDown size={12} aria-hidden="true" /></summary><div>{item.blockedBy && <p>当前命中屏蔽：{item.blockedBy}</p>}{item.ai?.reason && <p>{rejected ? "审核未通过：" : "审核备注："}{item.ai.reason}</p>}<p>规则综合评分：{Math.round(item.score)} · 不代表实际有效保证</p></div></details>}
      </div>
      <footer className="journal-footer">
        <button type="button" className="journal-read" aria-haspopup="dialog" onClick={() => onOpen(item)}>展开阅读<span className="sr-only">：{item.title}</span><ArrowRight size={14} aria-hidden="true" /></button>
        {(item.dupCount ?? 1) > 1 && onToggleRelated && <button type="button" className="journal-related-toggle" aria-expanded={Boolean(expanded)} onClick={() => onToggleRelated(item.id)}>{expanded ? "收起来源" : `${item.dupCount} 个来源`}</button>}
        <button type="button" className={`journal-save${item.starred ? " saved" : ""}`} aria-pressed={item.starred} title={item.starred ? "取消收藏" : "收藏"} aria-label={`${item.starred ? "取消收藏" : "收藏"}：${item.title}`} onClick={() => onPatch(item.id, { starred: !item.starred })}>{item.starred ? <Check size={16} aria-hidden="true" /> : <Bookmark size={16} aria-hidden="true" />}<span>{item.starred ? "已收藏" : "收藏"}</span></button>
      </footer>
      {expanded && relatedItems && <section className="journal-related" aria-label="其他来源"><h4>同一内容的其他记录</h4>{relatedItems.length ? relatedItems.map(r => <a key={r.id} href={r.url} target="_blank" rel="noreferrer noopener"><span>{r.sourceName ?? sourceName(r.source_id)}</span><strong>{r.title}</strong><ArrowUpRight size={13} aria-hidden="true" /></a>) : <p>未加载到其他来源记录。</p>}</section>}
    </article>
  );
}