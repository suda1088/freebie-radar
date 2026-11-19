import { randomUUID } from "node:crypto";
import { all, get, getDb, run, tx } from "../db.ts";
import { getAiSettings, matchesEntryNoise, shouldPassSourceToAi } from "./ai-settings.ts";
import { isBlocked, loadActiveBlockRules } from "./blocklist.ts";
import { FREEBIE_ONLY_SOURCES } from "./index.ts";

export type AiTaskStatus = "queued" | "running" | "retry_wait" | "succeeded" | "skipped" | "failed";

export type AiReviewTask = {
  id: number;
  item_id: number;
  source_id: string;
  status: AiTaskStatus;
  attempts: number;
  next_attempt_at: string | null;
  lease_until: string | null;
  lease_token: string | null;
  last_error: string | null;
  disposition: string | null;
  push_on_approve: number;
};

let readyDb: ReturnType<typeof getDb> | null = null;

/** Additive, idempotent schema. It deliberately contains no rows for legacy unreviewed items. */
export function ensureAiReviewState(): void {
  const db = getDb();
  if (readyDb === db) return;
  run(`CREATE TABLE IF NOT EXISTS ai_review_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL UNIQUE,
    source_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','running','retry_wait','succeeded','skipped','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    lease_until TEXT,
    lease_token TEXT,
    last_error TEXT,
    disposition TEXT,
    push_on_approve INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  run("CREATE INDEX IF NOT EXISTS idx_ai_review_tasks_due ON ai_review_tasks(status, next_attempt_at)");
  run("CREATE INDEX IF NOT EXISTS idx_ai_review_tasks_item ON ai_review_tasks(item_id)");
  readyDb = db;
}

export function enqueueAiTasks(items: Array<{ itemId: number; sourceId?: string; pushOnApprove?: boolean }>): number {
  ensureAiReviewState();
  const now = new Date().toISOString();
  let inserted = 0;
  tx(() => {
    for (const item of items) {
      const sourceId = item.sourceId ?? get<{ source_id: string }>("SELECT source_id FROM items WHERE id = ?", item.itemId)?.source_id;
      if (!sourceId) continue;
      const r = run(
        `INSERT OR IGNORE INTO ai_review_tasks
         (item_id, source_id, status, push_on_approve, created_at, updated_at)
         SELECT id, source_id, 'queued', ?, ?, ? FROM items
         WHERE id = ? AND ai IS NULL AND status = 'active'`,
        item.pushOnApprove ? 1 : 0,
        now,
        now,
        item.itemId,
      );
      inserted += Number(r.changes ?? 0);
      // A task already scheduled should retain an affirmative post-review policy.
      if (item.pushOnApprove) {
        run("UPDATE ai_review_tasks SET push_on_approve = 1, updated_at = ? WHERE item_id = ?", now, item.itemId);
      }
    }
  });
  return inserted;
}

export function markInterruptedTasks(now = new Date().toISOString()): number {
  ensureAiReviewState();
  const r = run(
    `UPDATE ai_review_tasks
        SET status = 'retry_wait', next_attempt_at = ?, lease_until = NULL, lease_token = NULL,
            last_error = COALESCE(last_error, '进程重启中断'), updated_at = ?
      WHERE status = 'running'`,
    now,
    now,
  );
  return Number(r.changes ?? 0);
}

export function claimAiTasks(limit: number, leaseMs = 120_000, itemIds?: number[]): { tasks: AiReviewTask[]; leaseToken: string } {
  ensureAiReviewState();
  const now = new Date();
  const iso = now.toISOString();
  const until = new Date(now.getTime() + leaseMs).toISOString();
  const leaseToken = randomUUID();
  let tasks: AiReviewTask[] = [];
  if (itemIds && !itemIds.length) return { tasks, leaseToken };
  tx(() => {
    const rows = all<AiReviewTask>(
      `SELECT id, item_id, source_id, status, attempts, next_attempt_at, lease_until, lease_token,
              last_error, disposition, push_on_approve
         FROM ai_review_tasks
        WHERE (status = 'queued' OR (status = 'retry_wait' AND COALESCE(next_attempt_at, ?) <= ?))
          ${itemIds ? `AND item_id IN (${itemIds.map(() => "?").join(",")})` : ""}
        ORDER BY COALESCE(next_attempt_at, created_at), id LIMIT ?`,
      iso,
      iso,
      ...(itemIds ?? []),
      Math.max(1, limit),
    );
    for (const row of rows) {
      run(
        `UPDATE ai_review_tasks SET status = 'running', attempts = attempts + 1,
                lease_until = ?, lease_token = ?, updated_at = ?
          WHERE id = ? AND status IN ('queued','retry_wait')`,
        until,
        leaseToken,
        iso,
        row.id,
      );
    }
    tasks = rows.map((row) => ({ ...row, status: "running" as const, attempts: row.attempts + 1, lease_until: until, lease_token: leaseToken }));
  });
  return { tasks, leaseToken };
}

/** Only a user-selected backfill may schedule terminal tasks or review existing verdicts again. */
export function scheduleManualAiTasks(itemIds: number[]): void {
  ensureAiReviewState();
  const now = new Date().toISOString();
  tx(() => {
    for (const itemId of itemIds) {
      run(`INSERT INTO ai_review_tasks (item_id, source_id, status, created_at, updated_at)
           SELECT id, source_id, 'queued', ?, ? FROM items WHERE id = ?
           ON CONFLICT(item_id) DO UPDATE SET status = 'queued', attempts = 0, next_attempt_at = NULL,
             last_error = NULL, disposition = NULL, push_on_approve = 0, updated_at = excluded.updated_at
           WHERE ai_review_tasks.status IN ('succeeded','skipped','failed')`, now, now, itemId);
    }
  });
}

export function finishAiTask(
  taskId: number,
  result: { status: AiTaskStatus; error?: string; disposition?: string; nextAttemptAt?: string | null },
  leaseToken?: string,
): void {
  ensureAiReviewState();
  const now = new Date().toISOString();
  run(
    `UPDATE ai_review_tasks
        SET status = ?, last_error = ?, disposition = COALESCE(?, disposition),
            next_attempt_at = ?, lease_until = NULL, lease_token = NULL, updated_at = ?
      WHERE id = ? AND (? IS NULL OR lease_token = ?)`,
    result.status,
    result.error ?? null,
    result.disposition ?? null,
    result.nextAttemptAt ?? null,
    now,
    taskId,
    leaseToken ?? null,
    leaseToken ?? null,
  );
}

export function getActiveAiTaskItemIds(): Set<number> {
  ensureAiReviewState();
  return new Set(
    all<{ item_id: number }>("SELECT item_id FROM ai_review_tasks WHERE status IN ('queued','running','retry_wait')").map((r) => r.item_id),
  );
}

export type AiReviewQueueStats = {
  queued: number;
  retryWait: number;
  failed: number;
  persisted: number;
  running: number;
  succeeded: number;
  skipped: number;
};

export function aiReviewQueueStats(): AiReviewQueueStats {
  ensureAiReviewState();
  const rows = all<{ status: AiTaskStatus; n: number }>("SELECT status, COUNT(*) AS n FROM ai_review_tasks GROUP BY status");
  const by = new Map(rows.map((r) => [r.status, Number(r.n)]));
  return {
    queued: by.get("queued") ?? 0,
    retryWait: by.get("retry_wait") ?? 0,
    failed: by.get("failed") ?? 0,
    persisted: rows.reduce((n, r) => n + Number(r.n), 0),
    running: by.get("running") ?? 0,
    succeeded: by.get("succeeded") ?? 0,
    skipped: by.get("skipped") ?? 0,
  };
}

export type AiPendingBreakdown = {
  pending: number;
  eligibleUnscheduled: number;
  running: number;
  queued: number;
  retryWait: number;
  failed: number;
  excluded: number;
  entryRuleSkipped: number;
  blocked: number;
  exempted: number;
};

/** Classifies active ai=NULL rows into disjoint operational buckets. */
export function aiPendingBreakdown(): AiPendingBreakdown {
  ensureAiReviewState();
  const rows = all<{ id: number; source_id: string; title: string; summary: string | null; source_enabled: number | null }>(
    `SELECT i.id, i.source_id, i.title, i.summary, s.enabled AS source_enabled FROM items i
       LEFT JOIN sources s ON s.id = i.source_id WHERE i.status = 'active' AND i.ai IS NULL`,
  );
  const tasks = new Map(
    all<{ item_id: number; status: AiTaskStatus; disposition: string | null }>(
      "SELECT item_id, status, disposition FROM ai_review_tasks",
    ).map((r) => [r.item_id, r]),
  );
  const rules = loadActiveBlockRules();
  const out: AiPendingBreakdown = {
    pending: rows.length,
    eligibleUnscheduled: 0,
    running: 0,
    queued: 0,
    retryWait: 0,
    failed: 0,
    excluded: 0,
    entryRuleSkipped: 0,
    blocked: 0,
    exempted: 0,
  };
  const settings = getAiSettings();
  for (const row of rows) {
    const task = tasks.get(row.id);
    if (task?.status === "running") { out.running += 1; continue; }
    if (task?.status === "queued") { out.queued += 1; continue; }
    if (task?.status === "retry_wait") { out.retryWait += 1; continue; }
    if (task?.status === "failed") { out.failed += 1; continue; }
    if (isBlocked(row, rules)) { out.blocked += 1; continue; }
    if (matchesEntryNoise(row.title, settings)) { out.entryRuleSkipped += 1; continue; }
    if (settings.skipFreebieSources && FREEBIE_ONLY_SOURCES.has(row.source_id)) { out.exempted += 1; continue; }
    if (row.source_enabled === 0 || !shouldPassSourceToAi(row.source_id, settings) || !settings.enabled || !settings.baseUrl || !settings.model) {
      out.excluded += 1;
      continue;
    }
    // Explicit source exemptions normally have ai_keep set by the collector. This bucket remains
    // available for a race where policy changes between collection and disposition.
    if (task?.disposition === "exempted") { out.exempted += 1; continue; }
    out.eligibleUnscheduled += 1;
  }
  return out;
}

export function retryDelayMs(attempt: number): number {
  return Math.min(5 * 60_000, 2_000 * 2 ** Math.max(0, attempt - 1));
}

export function isRetryableAiError(message: string): boolean {
  return /(?:\b429\b|\b503\b|timeout|timed out|aborted|aborterror|etimedout|econnreset|temporar|rate limit|overloaded)/i.test(message);
}
