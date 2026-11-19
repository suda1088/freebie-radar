export type WorkspacePage = "feed" | "hot" | "digest" | "rules" | "push" | "ai" | "ops";
export const ADMIN_TABS = new Set<WorkspacePage>(["rules", "push", "ai", "ops"]);

const PAGE_TITLES: Record<WorkspacePage, string> = {
  feed: "发现",
  hot: "今日趋势",
  digest: "每日精选",
  rules: "内容偏好",
  push: "通知与投递",
  ai: "智能整理",
  ops: "来源与维护",
};

export function workspaceTitle(page: WorkspacePage, saved: boolean): string {
  return `${page === "feed" && saved ? "收藏夹" : PAGE_TITLES[page] ?? "设置中心"} · 苏打小窝`;
}

export function PageHeading({ page: tab, saved: savedOnly, last24h }: { page: WorkspacePage; saved: boolean; last24h?: number }) {
  return (
    <section className={"soda-page-heading v3-page-heading" + (tab === "feed" ? " compact-reading-heading" : "")} aria-label="工作台概览">
      <div><p className="v3-overline">{ADMIN_TABS.has(tab)?"MAKE IT YOURS":tab==="feed"?(savedOnly?"YOUR COLLECTION":"A DAILY DOSE OF DISCOVERY"):tab==="hot"?"FOLLOW THE CONVERSATION":"THE DAILY EDIT"}</p>
        <h1 id="main-heading" tabIndex={-1}>{tab==="feed"?(savedOnly?"喜欢的，值得留一份。":"世界很大，先看喜欢的。") : tab==="hot"?"今天，大家在聊什么？":tab==="digest"?"把一天，收进一页。":"设置中心"}</h1>
        <p className="soda-page-description">{tab==="feed"?(savedOnly?"你的星标内容，在这里慢慢回看。":"从一个有用的工具，到一份意外的小惊喜。选择方向，慢慢发现。") : tab==="hot"?"沿着话题与分类，发现值得追踪的线索。":tab==="digest"?"按日期翻阅精选，让值得回看的内容有迹可循。":"让来源、内容和通知，按你的习惯运转。"}</p>
      </div>
      {tab==="feed"&&<div className="v3-edition"><span>READ AT YOUR PACE</span><strong>{savedOnly?"收藏夹":"发现手记"}</strong><small>{last24h??"—"} 条 / 近 24 小时收录</small></div>}
    </section>
  );
}
