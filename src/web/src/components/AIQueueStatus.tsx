import type { AiPendingBreakdown, AiStats } from "../types.ts";

const BUCKETS: { key: Exclude<keyof AiPendingBreakdown, "pending">; label: string; hint: string }[] = [
  { key: "eligibleUnscheduled", label: "符合范围 · 未排队", hint: "需要手动补审才会安排" },
  { key: "queued", label: "已排队", hint: "已安排，等待执行" },
  { key: "running", label: "审核中", hint: "正在处理" },
  { key: "retryWait", label: "等待重试", hint: "暂时失败，等待下次尝试" },
  { key: "failed", label: "失败待处理", hint: "已停止自动重试" },
  { key: "excluded", label: "来源 / 配置未送审", hint: "来源不在范围内，或 AI 未启用、配置不完整" },
  { key: "entryRuleSkipped", label: "入口规则跳过", hint: "命中入口初筛规则，未调用模型" },
  { key: "blocked", label: "屏蔽规则跳过", hint: "命中屏蔽规则，未调用模型" },
  { key: "exempted", label: "来源免审", hint: "按当前来源策略免送模型" },
];

export function AIQueueStatus({ stats }: { stats: AiStats }) {
  const breakdown = stats.pendingBreakdown;
  const queue = stats.queue;
  const durable = queue?.durable;
  const persisted = durable?.persisted ?? queue?.persisted;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "已通过", value: stats.kept, cls: "text-deal" },
          { label: "已拒绝", value: stats.rejected, cls: "text-ink-700" },
          { label: "未审", value: stats.pending, cls: "text-ink-900" },
        ].map(({ label, value, cls }) => (
          <div key={label}>
            <div className={`font-mono text-[18px] font-semibold tabular-nums ${cls}`}>{value}</div>
            <div className="text-[11.5px] text-ink-500">{label}</div>
          </div>
        ))}
      </div>
      <p className="text-[11.5px] leading-relaxed text-ink-500">
        通过 / 拒绝表示当前审核结论，不保证资源有效、仍可领取或实际可用。未审不代表已排入队列。
      </p>
      {breakdown ? (
        <div className="border-t border-ink-200 pt-3">
          <div className="mb-2 text-[11.5px] font-medium text-ink-700">未审条目去向 · 以下状态互斥，共 {breakdown.pending} 条</div>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-3">
            {BUCKETS.map(({ key, label, hint }) => (
              <div key={key} className="flex items-baseline justify-between gap-2 text-[11.5px]" title={hint}>
                <dt className="text-ink-600">{label}</dt>
                <dd className="font-mono tabular-nums text-ink-900">{breakdown[key]}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <p className="text-[11.5px] text-ink-500">当前服务未提供未审状态明细；不能据此推算实际排队数量。</p>
      )}
      {Boolean(stats.tasks?.length) && <details className="border-t border-ink-200 pt-3">
        <summary className="cursor-pointer text-[12px] font-medium text-ink-800">任务详情 · 最近 {stats.tasks?.length} 条</summary>
        <ul className="mt-2 space-y-2">{stats.tasks?.map(task => <li key={task.itemId} className="rounded-xl bg-ink-50 p-3 text-[12px] leading-relaxed">
          <p className="font-medium text-ink-900">{task.title}</p>
          <p className="text-ink-600">{{ queued: "排队中", running: "审核中", retry_wait: "等待重试", failed: "失败待处理" }[task.status] ?? task.status} · 已执行 {task.attempts} / 3 轮{task.lastError ? ` · ${task.lastError}` : ""}</p>
          {task.nextAttemptAt && <p className="text-ink-600">下次尝试：{new Date(task.nextAttemptAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>}
          {task.status === "failed" && <p className="text-ink-600">请检查连接与送审范围，再按上方数量确认手动补审。</p>}
        </li>)}</ul>
      </details>}
      <p className="text-[11.5px] leading-relaxed text-ink-600">
        历史未审条目不会自动排队；请按需手动补审。已安排的任务会持久保存，重启后恢复；暂时错误会有限重试，耗尽次数后转为失败待处理。
        {persisted !== undefined && (
          <span> 已保存任务共 {persisted} 条（含完成和跳过），其中排队 {durable?.queued ?? queue?.queued ?? "—"}、运行 {durable?.running ?? queue?.runningCount ?? "—"}、等待重试 {durable?.retryWait ?? queue?.retryWait ?? "—"}、失败 {durable?.failed ?? queue?.failed ?? "—"}。</span>
        )}
      </p>
    </div>
  );
}
