import { all, get, run } from "./db.ts";
import { calibrateScoreByObtain } from "./enrich/alias.ts";
import { enrichItem, FREEBIE_ONLY_SOURCES, isCategory, resolveKind } from "./enrich/index.ts";
import { isAuthoritativeNewsSource } from "./enrich/kind.ts";
import { guessObtain } from "./enrich/obtain.ts";
import { isBlocked, loadActiveBlockRules } from "./enrich/blocklist.ts";
import { aiQueueStats } from "./enrich/ai-queue.ts";
import { aiPendingBreakdown, claimAiTasks, finishAiTask, getActiveAiTaskItemIds, scheduleManualAiTasks } from "./enrich/ai-review-state.ts";
import { getSourceHints } from "./collectors/index.ts";
import { finishAiJob, getAiTelemetry, recordAiBatch, startAiJob } from "./enrich/ai-telemetry.ts";
import {
  aiReady,
  DEFAULT_PROMPT,
  feedbackStats,
  getAiSettings,
  publicAiSettings,
  reviewItems,
  matchesEntryNoise,
  shouldPassSourceToAi,
  saveAiSettings,
  testAiConnection,
  type AiSettings,
} from "./enrich/ai-settings.ts";

function updateAi(
  id: number,
  ai: string,
  keep: number,
  score: number,
  category: string | null,
  obtain: string,
  kind: string,
  quality: number | null,
): void {
  run(
    "UPDATE items SET ai = ?, ai_keep = ?, score = ?, category = ?, obtain = ?, kind = ?, ai_quality = COALESCE(?, ai_quality), ai_reviewed_at = ? WHERE id = ?",
    ai,
    keep,
    score,
    category,
    obtain,
    kind,
    quality,
    new Date().toISOString(),
    id,
  );
}

/** AI 判定统计：总体分布 + 分类分布 + 队列状态 + 执行遥测 + 最近样本。 */
export function aiStats() {
  const totals = get<{ kept: number; rejected: number }>(
    `SELECT
       SUM(CASE WHEN ai_keep = 1 THEN 1 ELSE 0 END) AS kept,
       SUM(CASE WHEN ai_keep = 0 THEN 1 ELSE 0 END) AS rejected
     FROM items WHERE status = 'active'`,
  );
  // 未送审计数要把全局屏蔽词跳过省额度的条目剥离出来，避免界面显示「N 条待审」但点补审却 0 条可执行
  const pendingBreakdown = aiPendingBreakdown();
  const byCategory = all<{ category: string; n: number }>(
    `SELECT COALESCE(category,'other') AS category, COUNT(*) AS n
     FROM items WHERE status = 'active' AND ai_keep = 1
     GROUP BY category ORDER BY n DESC`,
  );
  const byKind = all<{ kind: string; n: number }>(
    `SELECT COALESCE(kind,'freebie') AS kind, COUNT(*) AS n
     FROM items WHERE status = 'active'
     GROUP BY kind ORDER BY n DESC`,
  );
  const recent = all<{
    id: number;
    source_id: string;
    title: string;
    score: number;
    obtain: string | null;
    kind: string | null;
    ai: string;
    ai_reviewed_at: string | null;
    last_seen_at: string;
  }>(
    `SELECT id, source_id, title, score, obtain, kind, ai, ai_reviewed_at, last_seen_at FROM items
     WHERE ai IS NOT NULL ORDER BY COALESCE(ai_reviewed_at, last_seen_at) DESC, id DESC LIMIT 40`,
  );
  return {
    kept: totals?.kept ?? 0,
    rejected: totals?.rejected ?? 0,
    pending: pendingBreakdown.pending,
    blockedSkipped: pendingBreakdown.blocked,
    pendingBreakdown,
    eligibleUnscheduled: pendingBreakdown.eligibleUnscheduled,
    running: pendingBreakdown.running,
    queued: pendingBreakdown.queued,
    retryWait: pendingBreakdown.retryWait,
    failed: pendingBreakdown.failed,
    excluded: pendingBreakdown.excluded,
    entryRuleSkipped: pendingBreakdown.entryRuleSkipped,
    blocked: pendingBreakdown.blocked,
    exempted: pendingBreakdown.exempted,
    tasks: all<{ itemId: number; title: string; sourceId: string; status: string; attempts: number; nextAttemptAt: string | null; lastError: string | null; updatedAt: string }>(
      `SELECT t.item_id AS itemId, i.title, t.source_id AS sourceId, t.status, t.attempts,
              t.next_attempt_at AS nextAttemptAt, t.last_error AS lastError, t.updated_at AS updatedAt
         FROM ai_review_tasks t JOIN items i ON i.id=t.item_id
        WHERE t.status IN ('queued','running','retry_wait','failed')
        ORDER BY CASE t.status WHEN 'failed' THEN 0 WHEN 'retry_wait' THEN 1 ELSE 2 END, t.updated_at DESC LIMIT 20`,
    ),
    queue: aiQueueStats(),
    telemetry: getAiTelemetry(),
    byCategory,
    byKind,
    recent: recent.map((r) => {
      let v: { keep?: boolean; kind?: string; reason?: string; category?: string; obtain?: string; quality?: number } = {};
      try {
        v = JSON.parse(r.ai) as typeof v;
      } catch {
        v = {};
      }
      return {
        id: r.id,
        sourceId: r.source_id,
        title: r.title,
        score: r.score,
        keep: v.keep ?? null,
        kind: v.kind ?? r.kind ?? (v.keep === false ? "noise" : "freebie"),
        reason: v.reason ?? "",
        category: v.category ?? "",
        obtain: v.obtain ?? r.obtain ?? "free",
        quality: typeof v.quality === "number" ? v.quality : null,
        reviewedAt: r.ai_reviewed_at ?? r.last_seen_at,
      };
    }),
  };
}

export type BackfillMode = "pending" | "recent" | "rejected";

/** Read-only estimate for confirmation UI; uses the identical capped selection as backfillAi. */
export function estimateAiBackfill(limit = 200, mode: BackfillMode = "pending") {
  const s = getAiSettings();
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.round(limit), 1), 2000) : 200;
  const scanLimit = Math.min(safeLimit * 4, 4000);
  const extra = mode === "rejected" ? "AND ai_keep = 0" : mode === "recent" ? "" : "AND ai IS NULL";
  const rows = all<{ id: number; source_id: string; title: string; summary: string | null }>(
    `SELECT id, source_id, title, summary FROM items WHERE status = 'active' ${extra}
     ORDER BY COALESCE(published_at, first_seen_at) DESC LIMIT ?`, scanLimit,
  );
  const activeIds = getActiveAiTaskItemIds();
  const disabledSources = new Set(all<{ id: string }>("SELECT id FROM sources WHERE enabled = 0").map((r) => r.id));
  const rules = loadActiveBlockRules();
  let skippedBlocked = 0;
  const eligible = rows.filter((r) => {
    if (isBlocked(r, rules)) { skippedBlocked += 1; return false; }
    return !activeIds.has(r.id) && !disabledSources.has(r.source_id)
      && shouldPassSourceToAi(r.source_id, s) && !matchesEntryNoise(r.title, s);
  });
  return { mode, limit: safeLimit, scanned: rows.length, selected: aiReady(s) ? Math.min(safeLimit, eligible.length) : 0,
    skippedBlocked, configured: aiReady(s) };
}

/**
 * 手动补审 / 重审：
 * - pending：仅审还没有 AI 结论的条目（默认）
 * - recent：用最新提示词/偏好重审近期入库条目（校准分类、获取方式与质量分）
 * - rejected：复核近期被 AI 拦截的非福利条目（防止误杀）
 * All modes obey the current source/entry/block policy and exclude active queued/running/retry tasks.
 * They never override a source exemption. Explicit reruns reset only selected terminal task rows.
 */
export async function backfillAi(
  limit = 200,
  mode: BackfillMode = "pending",
): Promise<{ reviewed: number; rejected: number; skippedBlocked: number; scanned: number; mode: BackfillMode; error?: string }> {
  const s = getAiSettings();
  if (!aiReady(s)) return { reviewed: 0, rejected: 0, skippedBlocked: 0, scanned: 0, mode, error: "AI 未启用或未配置" };

  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.round(limit), 1), 2000) : 200;
  const scanLimit = Math.min(safeLimit * 4, 4000);
  const whereExtra =
    mode === "rejected"
      ? "AND ai_keep = 0"
      : mode === "recent"
        ? ""
        : "AND ai IS NULL";

  const rows = all<{
    id: number;
    source_id: string;
    external_id: string;
    title: string;
    summary: string | null;
    content: string | null;
    url: string;
    score: number;
    category: string | null;
    published_at: string | null;
    expires_at: string | null;
  }>(
    `SELECT id, source_id, external_id, title, summary, content, url, score, category, published_at, expires_at
     FROM items WHERE status = 'active' ${whereExtra}
     ORDER BY COALESCE(published_at, first_seen_at) DESC LIMIT ?`,
    scanLimit,
  );
  const blockRules = loadActiveBlockRules();
  const activeTaskIds = getActiveAiTaskItemIds();
  const disabledSources = new Set(all<{ id: string }>("SELECT id FROM sources WHERE enabled = 0").map((r) => r.id));
  const unblocked: typeof rows = [];
  let skippedBlocked = 0;
  for (const r of rows) {
    if (isBlocked(r, blockRules)) skippedBlocked += 1;
    else if (!activeTaskIds.has(r.id) && !disabledSources.has(r.source_id) && shouldPassSourceToAi(r.source_id, s) && !matchesEntryNoise(r.title, s)) unblocked.push(r);
  }
  const activeRows = unblocked.slice(0, safeLimit);
  if (!activeRows.length) return { reviewed: 0, rejected: 0, skippedBlocked, scanned: rows.length, mode };
  scheduleManualAiTasks(activeRows.map((r) => r.id));
  const { tasks, leaseToken } = claimAiTasks(activeRows.length, 120_000, activeRows.map((r) => r.id));
  const taskByItem = new Map(tasks.map((t) => [t.item_id, t]));

  const modeLabel = mode === "rejected" ? "复核已拦截" : mode === "recent" ? "重审近期" : "未审补审";
  const jobId = startAiJob({
    stage: "backfill",
    label: `历史库补审（${modeLabel}）`,
    model: s.model,
    total: activeRows.length,
    totalBatches: Math.ceil(activeRows.length / s.batchSize),
  });

  let reviewed = 0;
  let rejected = 0;
  let lastError: string | undefined;
  const CHUNK = Math.max(s.batchSize * s.concurrency, 24);

  try {
    for (let start = 0; start < activeRows.length; start += CHUNK) {
      const current = getAiSettings();
      const currentRules = loadActiveBlockRules();
      const chunk = activeRows.slice(start, start + CHUNK).filter((r) => {
        if (!taskByItem.has(r.id)) return false;
        const sourceEnabled = get<{ enabled: number }>("SELECT enabled FROM sources WHERE id = ?", r.source_id)?.enabled !== 0;
        const allowed = sourceEnabled && aiReady(current) && shouldPassSourceToAi(r.source_id, current)
          && !matchesEntryNoise(r.title, current) && !isBlocked(r, currentRules);
        if (!allowed) finishAiTask(taskByItem.get(r.id)!.id, { status: "skipped", disposition: "policy_changed" }, leaseToken);
        return allowed;
      });
      if (!chunk.length) continue;

      const raws = chunk.map((r) => ({
        externalId: r.external_id,
        url: r.url,
        title: r.title,
        summary: r.summary ?? "",
        content: r.content ?? null,
      }));
      let map;
      try {
        map = await reviewItems(raws as never, { ...current, maxItems: chunk.length }, {
          onBatch: (ev) => {
            if (ev.error) lastError = ev.error;
            let bKept = 0;
            let bRejected = 0;
            const events = [];
            for (let i = 0; i < ev.items.length; i += 1) {
              const v = ev.verdicts?.get(ev.start + i);
              if (!v) continue;
              const keep = Boolean(v.keep);
              if (keep) bKept += 1;
              else bRejected += 1;
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
              kept: bKept,
              rejected: bRejected,
              failed: ev.verdicts ? 0 : ev.count,
              ttfbMs: ev.ttfbMs,
            });
          },
        });
      } catch (err) {
        lastError = "模型请求失败";
        for (const row of chunk) finishAiTask(taskByItem.get(row.id)!.id, { status: "failed", error: lastError }, leaseToken);
        continue;
      }
      if (!map) {
        for (const row of chunk) finishAiTask(taskByItem.get(row.id)!.id, { status: "failed", error: "模型未返回有效结论" }, leaseToken);
        continue;
      }
      for (let i = 0; i < chunk.length; i += 1) {
        const row = chunk[i]!;
        const v = map.get(i);
        if (!v) {
          finishAiTask(taskByItem.get(row.id)!.id, { status: "failed", error: "模型未返回该条结论" }, leaseToken);
          continue;
        }
        reviewed += 1;
        if (!v.keep) rejected += 1;
        const obtain = v.obtain ?? guessObtain(row.title, row.summary ?? "");
        // 重审时重算一次基础分再校准，避免多次叠加乘除失真
        const baseEnriched = enrichItem(
          {
            externalId: row.external_id,
            url: row.url,
            title: row.title,
            summary: row.summary ?? "",
            publishedAt: row.published_at,
            expiresAt: row.expires_at,
          },
          row.source_id,
        );
        const baseScore = baseEnriched ? baseEnriched.score : row.score;
        const category = isCategory(v.category) ? v.category : row.category;
        const quality =
          typeof v.quality === "number" && Number.isFinite(v.quality)
            ? Math.min(5, Math.max(1, Math.round(v.quality)))
            : null;
        const kind = resolveKind(v.kind, v.keep, {
          title: row.title,
          summary: row.summary ?? "",
          sourceId: row.source_id,
          category,
          obtain,
          isFree: baseEnriched?.isFree ?? false,
          price: baseEnriched?.price ?? null,
          freebieOnlySource: FREEBIE_ONLY_SOURCES.has(row.source_id),
        });
        const effectiveKeep = kind === "noise" ? false : v.keep;
        const keep = effectiveKeep ? 1 : 0;
        const ai = JSON.stringify({ ...v, keep: effectiveKeep, kind });
        const score = calibrateScoreByObtain(baseScore, obtain, effectiveKeep, quality, kind);
        updateAi(row.id, ai, keep, score, category, obtain, kind, quality);
        finishAiTask(taskByItem.get(row.id)!.id, { status: "succeeded" }, leaseToken);
      }
    }
    finishAiJob(jobId, {
      skippedBlocked,
      error: reviewed === 0 ? lastError : undefined,
    });
  } catch (err) {
    for (const task of tasks) finishAiTask(task.id, { status: "failed", error: "补审中断" }, leaseToken);
    finishAiJob(jobId, {
      skippedBlocked,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  return { reviewed, rejected, skippedBlocked, scanned: rows.length, mode };
}

/**
 * 零 Token 存量分类重整：用最新关键词规则重算 active 条目的 category（以及未 AI 审核条目的 kind / obtain）。
 * scope = "other"：仅挽救落入 other/null 的条目；scope = "all"：全量 active 按新规则刷新（已 AI 审核的只刷新 category=other 的漏网条目）。
 */
export function reclassifyStoredItems(scope: "other" | "all" = "other"): {
  scanned: number;
  updated: number;
  movedFromOther: number;
  scope: "other" | "all";
} {
  const cond = scope === "other" ? "status = 'active' AND (category = 'other' OR category IS NULL)" : "status = 'active'";
  const rows = all<{
    id: number;
    source_id: string;
    external_id: string | null;
    url: string;
    title: string;
    summary: string | null;
    category: string | null;
    kind: string | null;
    obtain: string | null;
    ai_keep: number | null;
    published_at: string | null;
    expires_at: string | null;
  }>(
    `SELECT id, source_id, external_id, url, title, summary, category, kind, obtain, ai_keep, published_at, expires_at
       FROM items WHERE ${cond} ORDER BY id DESC LIMIT 6000`,
  );

  let updated = 0;
  let movedFromOther = 0;
  for (const r of rows) {
    const hints = getSourceHints(r.source_id);
    const e = enrichItem(
      {
        externalId: r.external_id ?? String(r.id),
        url: r.url,
        title: r.title,
        summary: r.summary ?? "",
        publishedAt: r.published_at,
        expiresAt: r.expires_at,
      },
      r.source_id,
      hints,
    );
    if (!e) continue;
    // 已人工/AI 审核过的非 other 条目不随意覆盖其 AI 分类，只修复 other / 误判成 news 的 VPS 帖子 / 非权威源的 news
    const catWasLegacyNews = (r.category === "news" || r.category === "headline") && e.category === "vps";
    const nextCat =
      r.ai_keep !== null && r.category && r.category !== "other" && !catWasLegacyNews ? r.category : e.category;
    let nextKind = r.ai_keep === null ? e.kind : (r.kind ?? e.kind);
    if (hints.kindHint && r.ai_keep !== 0 && nextKind !== hints.kindHint) {
      nextKind = e.kind;
    } else if (nextKind === "news" && !isAuthoritativeNewsSource(r.source_id, hints.kindHint)) {
      nextKind = resolveKind("news", r.ai_keep === 1 ? true : r.ai_keep === 0 ? false : null, {
        title: r.title,
        summary: r.summary ?? "",
        sourceId: r.source_id,
        category: nextCat,
        obtain: r.obtain,
        isFree: e.isFree,
        price: e.price,
        kindHint: hints.kindHint,
      });
    }
    const fallbackObtain = guessObtain(r.title, r.summary ?? "");
    const nextObtain = r.ai_keep === null ? fallbackObtain : (r.obtain ?? fallbackObtain);

    if (nextCat !== r.category || nextKind !== r.kind || nextObtain !== r.obtain) {
      run(
        "UPDATE items SET category = ?, kind = ?, obtain = ? WHERE id = ?",
        nextCat,
        nextKind,
        nextObtain,
        r.id,
      );
      updated += 1;
      if ((r.category === "other" || !r.category) && nextCat !== "other") {
        movedFromOther += 1;
      }
    }
  }
  return { scanned: rows.length, updated, movedFromOther, scope };
}

export { publicAiSettings, saveAiSettings, testAiConnection, DEFAULT_PROMPT, aiReady, getAiSettings, feedbackStats };
export type { AiSettings };
