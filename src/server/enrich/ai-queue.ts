import { getAiSettings, matchesEntryNoise, reviewItems, shouldPassSourceToAi, type AiVerdict } from "./ai-settings.ts";
import { FREEBIE_ONLY_SOURCES, isCategory, resolveKind, type ContentKind } from "./index.ts";
import { calibrateScoreByObtain } from "./alias.ts";
import type { RawItem } from "../collectors/types.ts";
import { get, run } from "../db.ts";
import { finishAiJob, recordAiBatch, startAiJob } from "./ai-telemetry.ts";
import {
  aiReviewQueueStats,
  enqueueAiTasks,
  ensureAiReviewState,
  finishAiTask,
  claimAiTasks,
  markInterruptedTasks,
  isRetryableAiError,
  retryDelayMs,
  type AiReviewTask,
} from "./ai-review-state.ts";
import { isBlocked, loadActiveBlockRules } from "./blocklist.ts";

const VALID_OBTAIN = new Set(["free", "conditional", "lottery", "trial", "promo", "paid"]);

function readSourceKindHint(sourceId: string | undefined): string | null {
  if (!sourceId) return null;
  const row = get<{ config: string }>("SELECT config FROM sources WHERE id = ?", sourceId);
  if (!row?.config) return null;
  try {
    const cfg = JSON.parse(row.config) as { kindHint?: unknown };
    return typeof cfg.kindHint === "string" && cfg.kindHint.trim() ? cfg.kindHint.trim() : null;
  } catch {
    return null;
  }
}

/**
 * AI 异步审核队列：
 * - 支持「极速抢码先推后审」模式在后台补齐 AI 结论
 * - 支持「推送前先审」模式消化超过同步上限的剩余新条目
 * - 审核通过（aiKeep=true）且尚未推送的条目，可通过回调触发补推（进即时或攒批队列）
 */

export type AiQueueJob = {
  itemId: number;
  sourceId?: string;
  url: string;
  title: string;
  summary: string;
  content?: string | null;
  pushOnApprove?: boolean;
};

type PostReviewHandler = (sourceId: string, itemIds: number[]) => Promise<unknown>;

let running = false;
let processed = 0;
let dropped = 0;
let postReviewHandler: PostReviewHandler | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let reviewTransport = reviewItems;

/** Tests inject a deterministic transport; production callers use reviewItems. */
export function setAiReviewTransportForTests(transport: typeof reviewItems | null): void {
  reviewTransport = transport ?? reviewItems;
}

export function setPostReviewHandler(handler: PostReviewHandler | null): void {
  postReviewHandler = handler;
}

/** 采集侧调用：把新条目排进队列，立刻返回。 */
export function enqueueForAi(items: AiQueueJob[]): void {
  if (!items.length) return;
  ensureAiReviewState();
  enqueueAiTasks(items);
  void drain();
}

export function aiQueueStats() {
  const stats = aiReviewQueueStats();
  return { ...stats, runningCount: stats.running, processed, dropped, running };
}

/** Initialise durable state. Resume only means previously scheduled tasks; legacy ai=NULL rows stay untouched. */
export function initAiReviewQueue(options: { resume?: boolean } = {}): void {
  ensureAiReviewState();
  if (!running) markInterruptedTasks();
  if (options.resume !== false) void drain();
}

export type AppliedVerdict = {
  aiKeep: boolean;
  kind: ContentKind;
  category: string | null;
  obtain: string | null;
  score: number;
  reason: string | null;
};

function applyVerdictToItem(itemId: number, verdict: AiVerdict): AppliedVerdict | null {
  const nextCategory = isCategory(verdict.category) ? verdict.category : null;
  const nextObtain = verdict.obtain && VALID_OBTAIN.has(verdict.obtain) ? verdict.obtain : null;
  const nextQuality =
    typeof verdict.quality === "number" && Number.isFinite(verdict.quality)
      ? Math.min(5, Math.max(1, Math.round(verdict.quality)))
      : null;
  try {
    const cur = get<{
      score: number;
      ai_keep: number | null;
      obtain: string | null;
      category: string | null;
      title: string;
      summary: string | null;
      source_id: string;
      is_free: number;
      price: number | null;
    }>(
      "SELECT score, ai_keep, obtain, category, title, summary, source_id, is_free, price FROM items WHERE id = ?",
      itemId,
    );
    if (!cur) return null;
    const effectiveCategory = nextCategory ?? cur?.category ?? null;
    const effectiveObtain = nextObtain ?? cur?.obtain ?? null;
    const effectiveKind = resolveKind(verdict.kind, verdict.keep, {
      title: cur?.title ?? "",
      summary: cur?.summary ?? "",
      sourceId: cur?.source_id,
      category: effectiveCategory,
      obtain: effectiveObtain,
      isFree: cur?.is_free === 1,
      price: cur?.price ?? null,
      freebieOnlySource: Boolean(cur?.source_id && FREEBIE_ONLY_SOURCES.has(cur.source_id)),
      kindHint: readSourceKindHint(cur?.source_id),
    });
    const effectiveKeep = effectiveKind === "noise" ? false : verdict.keep;
    const keep = effectiveKeep ? 1 : 0;
    const nextScore =
      cur && cur.ai_keep === null
        ? calibrateScoreByObtain(cur.score, effectiveObtain, effectiveKeep, nextQuality, effectiveKind)
        : cur?.score ?? 0;
    run(
      `UPDATE items
          SET ai = ?,
              ai_keep = ?,
              kind = ?,
              ai_quality = COALESCE(?, ai_quality),
              obtain = COALESCE(?, obtain),
              category = COALESCE(?, category),
              score = ?,
              ai_reviewed_at = ?
        WHERE id = ?`,
      JSON.stringify({ ...verdict, keep: effectiveKeep, kind: effectiveKind }),
      keep,
      effectiveKind,
      nextQuality,
      nextObtain,
      nextCategory,
      nextScore,
      new Date().toISOString(),
      itemId,
    );
    return {
      aiKeep: effectiveKeep,
      kind: effectiveKind,
      category: effectiveCategory,
      obtain: effectiveObtain,
      score: nextScore,
      reason: typeof verdict.reason === "string" && verdict.reason.trim() ? verdict.reason.trim() : null,
    };
  } catch {
    return null;
  }
}

/** 推送前同步审核：把本轮待推送新条目先送模型判定并写库，返回各 itemId 的最新结论。 */
export async function reviewFreshNow(items: AiQueueJob[]): Promise<Map<number, AppliedVerdict>> {
  const out = new Map<number, AppliedVerdict>();
  if (!items.length) return out;
  const s = getAiSettings();
  if (!s.enabled || !s.baseUrl || !s.model) return out;
  const rules = loadActiveBlockRules();
  // Use the current stored fields, so a stale collector snapshot cannot bypass a changed policy.
  items = items.flatMap((item) => {
    const row = get<{ source_id: string; url: string; title: string; summary: string | null; content: string | null;
      status: string; ai: string | null; source_enabled: number | null }>(
      `SELECT i.source_id, i.url, i.title, i.summary, i.content, i.status, i.ai, s.enabled AS source_enabled
         FROM items i LEFT JOIN sources s ON s.id = i.source_id WHERE i.id = ?`, item.itemId,
    );
    if (!row || row.status !== "active" || row.ai !== null || row.source_enabled === 0) return [];
    return [{ ...item, sourceId: row.source_id, url: row.url, title: row.title, summary: row.summary ?? "", content: row.content }];
  });
  items = items.filter((item) => shouldPassSourceToAi(item.sourceId ?? "", s)
    && !matchesEntryNoise(item.title, s) && !isBlocked(item, rules));
  if (!items.length) return out;
  enqueueAiTasks(items);
  const { tasks, leaseToken } = claimAiTasks(items.length, Math.max(120_000, s.timeoutSec * 4_000), items.map((item) => item.itemId));
  for (const task of tasks) {
    if (task.attempts > MAX_TASK_ATTEMPTS) finishAiTask(task.id, { status: "failed", error: "审核重试次数已耗尽" }, leaseToken);
  }
  const byItem = new Map(tasks.filter((task) => task.attempts <= MAX_TASK_ATTEMPTS).map((task) => [task.item_id, task]));
  items = items.filter((item) => byItem.has(item.itemId));
  if (!items.length) return out;
  const raws = items.map((j) => ({
    externalId: String(j.itemId),
    url: j.url,
    title: j.title,
    summary: j.summary,
    content: j.content ?? null,
  })) as RawItem[];
  const srcId = items[0]?.sourceId;
  const jobId = startAiJob({
    stage: "sync",
    label: srcId ? `${srcId} · 推送前同步审核` : "推送前同步审核",
    sourceId: srcId,
    model: s.model,
    total: items.length,
    totalBatches: Math.ceil(items.length / s.batchSize),
  });
  let batchErr: string | undefined;
  try {
    const map = await reviewTransport(raws, { ...s, maxItems: Math.max(s.maxItems, items.length) }, {
      onBatch: (ev) => {
        if (ev.error) batchErr = ev.error;
        let kept = 0;
        let rejected = 0;
        const events = [];
        for (let i = 0; i < ev.items.length; i += 1) {
          const v = ev.verdicts?.get(ev.start + i);
          if (!v) continue;
          const keep = Boolean(v.keep);
          if (keep) kept += 1;
          else rejected += 1;
          events.push({
            title: ev.items[i]!.title,
            keep,
            kind: v.kind ?? (keep ? "freebie" : "noise"),
            category: v.category ?? "-",
            quality: typeof v.quality === "number" ? v.quality : null,
            reason: v.reason ?? "",
            at: new Date().toISOString(),
          });
        }
        recordAiBatch(jobId, {
          events,
          kept,
          rejected,
          failed: ev.verdicts ? 0 : ev.count,
          ttfbMs: ev.ttfbMs,
        });
      },
    });
    if (!map) {
      for (const task of tasks) failTask(task, batchErr ?? "模型未返回有效结论", leaseToken);
      finishAiJob(jobId, { error: safeAiError(batchErr ?? "模型未返回有效结论") });
      return out;
    }
    for (const [idx, verdict] of map) {
      const job = items[idx];
      if (!job) continue;
      const applied = applyVerdictToItem(job.itemId, verdict);
      if (applied) {
        processed += 1;
        finishAiTask(byItem.get(job.itemId)!.id, { status: "succeeded" }, leaseToken);
        out.set(job.itemId, applied);
      } else {
        failTask(byItem.get(job.itemId)!, "审核结论写入失败", leaseToken);
      }
    }
    for (const task of tasks) {
      if (!out.has(task.item_id)) failTask(task, batchErr ?? "模型未返回该条结论", leaseToken);
    }
    finishAiJob(jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const task of tasks) failTask(task, message, leaseToken);
    finishAiJob(jobId, { error: safeAiError(message) });
  } finally {
    scheduleRetry();
  }
  return out;
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (true) {
      const s = getAiSettings();
      const waveSize = Math.min(Math.max(s.batchSize * s.concurrency, 12), 48);
      const { tasks, leaseToken } = claimAiTasks(waveSize, Math.max(120_000, s.timeoutSec * 4_000));
      if (!tasks.length) break;
      const blockRules = loadActiveBlockRules();
      const batch: (AiQueueJob & { task: AiReviewTask })[] = [];
      for (const task of tasks) {
        const row = get<{
          source_id: string; url: string; title: string; summary: string | null; content: string | null;
          status: string; ai: string | null; source_enabled: number | null;
        }>(`SELECT i.source_id, i.url, i.title, i.summary, i.content, i.status, i.ai, s.enabled AS source_enabled
              FROM items i LEFT JOIN sources s ON s.id = i.source_id WHERE i.id = ?`, task.item_id);
        const disposition = !row ? "missing" : row.status !== "active" ? "inactive" : row.ai !== null ? "already_reviewed"
          : isBlocked(row, blockRules) ? "blocked"
          : matchesEntryNoise(row.title, s) ? "entry_rule"
          : row.source_enabled === 0 ? "source_disabled"
          : !shouldPassSourceToAi(row.source_id, s) ? (s.skipFreebieSources && FREEBIE_ONLY_SOURCES.has(row.source_id) ? "exempted" : "source_excluded")
          : !s.enabled || !s.baseUrl || !s.model ? "disabled" : null;
        if (disposition || !row) {
          finishAiTask(task.id, { status: "skipped", disposition: disposition ?? "missing" }, leaseToken);
          continue;
        }
        if (task.attempts > MAX_TASK_ATTEMPTS) {
          finishAiTask(task.id, { status: "failed", error: "审核重试次数已耗尽" }, leaseToken);
          continue;
        }
        batch.push({ itemId: task.item_id, sourceId: row.source_id, url: row.url, title: row.title,
          summary: row.summary ?? "", content: row.content, pushOnApprove: task.push_on_approve === 1, task });
      }
      if (!batch.length) continue;
      const raws = batch.map((j) => ({
        externalId: String(j.itemId),
        url: j.url,
        title: j.title,
        summary: j.summary,
        content: j.content ?? null,
      })) as RawItem[];

      const jobId = startAiJob({
        stage: "queue",
        label: "异步队列波次",
        sourceId: batch[0]?.sourceId,
        model: s.model,
        total: batch.length,
        totalBatches: Math.ceil(batch.length / s.batchSize),
      });
      let map;
      let batchErr: string | undefined;
      const itemErrors = new Map<number, string>();
      try {
        map = await reviewTransport(raws, { ...s, maxItems: batch.length }, {
          onBatch: (ev) => {
            if (ev.error) {
              batchErr = ev.error;
              for (let i = ev.start; i < ev.start + ev.count; i += 1) itemErrors.set(i, ev.error);
            }
            let kept = 0;
            let rejected = 0;
            const events = [];
            for (let i = 0; i < ev.items.length; i += 1) {
              const v = ev.verdicts?.get(ev.start + i);
              if (!v) continue;
              const keep = Boolean(v.keep);
              if (keep) kept += 1;
              else rejected += 1;
              events.push({
                title: ev.items[i]!.title,
                keep,
                kind: v.kind ?? (keep ? "freebie" : "noise"),
                category: v.category ?? "-",
                quality: typeof v.quality === "number" ? v.quality : null,
                reason: v.reason ?? "",
                at: new Date().toISOString(),
              });
            }
            recordAiBatch(jobId, {
              events,
              kept,
              rejected,
              failed: ev.verdicts ? 0 : ev.count,
              ttfbMs: ev.ttfbMs,
            });
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        for (const job of batch) failTask(job.task, message, leaseToken);
        finishAiJob(jobId, { error: safeAiError(message) });
        continue;
      }
      if (!map) {
        for (const job of batch) failTask(job.task, batchErr ?? "模型未返回有效结论", leaseToken);
        finishAiJob(jobId, { error: safeAiError(batchErr ?? "模型未返回有效结论") });
        continue;
      }
      finishAiJob(jobId);

      const approvedBySource = new Map<string, number[]>();
      for (let idx = 0; idx < batch.length; idx += 1) {
        const job = batch[idx]!;
        const verdict = map.get(idx);
        if (!verdict) {
          failTask(job.task, itemErrors.get(idx) ?? "模型未返回该条结论", leaseToken);
          continue;
        }
        const applied = applyVerdictToItem(job.itemId, verdict);
        if (applied) {
          processed += 1;
          finishAiTask(job.task.id, { status: "succeeded" }, leaseToken);
          if (applied.aiKeep && job.pushOnApprove && job.sourceId) {
            const list = approvedBySource.get(job.sourceId) ?? [];
            list.push(job.itemId);
            approvedBySource.set(job.sourceId, list);
          }
        } else {
          failTask(job.task, "审核结论写入失败", leaseToken);
        }
      }

      if (postReviewHandler && approvedBySource.size) {
        for (const [sourceId, ids] of approvedBySource) {
          try {
            await postReviewHandler(sourceId, ids);
          } catch {
            console.error("[ai-queue] 补审补推回调失败");
          }
        }
      }
    }
  } finally {
    running = false;
    scheduleRetry();
  }
}

// One persisted attempt is one reviewItems invocation for this item. reviewItems itself still
// permits two HTTP attempts per batch, so a task makes at most 6 model requests across 3 runs.
const MAX_TASK_ATTEMPTS = 3;

function safeAiError(message: string): string {
  if (/\b429\b/.test(message)) return "HTTP 429：模型限流";
  if (/\b503\b/.test(message)) return "HTTP 503：模型暂不可用";
  if (/timeout|timed out|aborted|aborterror|etimedout/i.test(message)) return "模型请求超时";
  if (/\b40[13]\b/.test(message)) return "模型认证或权限错误";
  return "模型请求或结论处理失败";
}

function failTask(task: AiReviewTask, message: string, leaseToken: string): void {
  const retryable = isRetryableAiError(message) || /未返回|写入失败/.test(message);
  const retry = retryable && task.attempts < MAX_TASK_ATTEMPTS;
  finishAiTask(task.id, {
    status: retry ? "retry_wait" : "failed",
    error: safeAiError(message),
    nextAttemptAt: retry ? new Date(Date.now() + retryDelayMs(task.attempts)).toISOString() : null,
  }, leaseToken);
}

function scheduleRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const next = get<{ due: string | null }>(
    "SELECT MIN(COALESCE(next_attempt_at, created_at)) AS due FROM ai_review_tasks WHERE status IN ('queued','retry_wait')",
  );
  if (!next?.due) return;
  retryTimer = setTimeout(() => { retryTimer = null; void drain(); }, Math.max(10, Date.parse(next.due) - Date.now()));
  retryTimer.unref();
}
