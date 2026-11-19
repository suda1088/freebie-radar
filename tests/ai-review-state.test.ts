import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

process.env.DATABASE_PATH = ":memory:";
const { migrate, run, get, all, closeDb } = await import("../src/server/db.ts");
const { saveAiSettings } = await import("../src/server/enrich/ai-settings.ts");
const {
  aiPendingBreakdown, aiReviewQueueStats, enqueueAiTasks, ensureAiReviewState,
  claimAiTasks, finishAiTask, markInterruptedTasks, retryDelayMs, isRetryableAiError,
} = await import("../src/server/enrich/ai-review-state.ts");
const {
  initAiReviewQueue, reviewFreshNow, setAiReviewTransportForTests, enqueueForAi, aiQueueStats,
} = await import("../src/server/enrich/ai-queue.ts");
const { aiStats, backfillAi, estimateAiBackfill } = await import("../src/server/ai-admin.ts");

migrate();
ensureAiReviewState();

function item(id: number, source = "test-source", title = "免费领取开发者额度") {
  const now = new Date().toISOString();
  run(`INSERT INTO items (id, source_id, external_id, url, url_key, title, summary, score, status, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, '', 60, 'active', ?, ?)`, id, source, String(id), `https://example.invalid/${id}`, String(id), title, now, now);
  return { itemId: id, sourceId: source, url: `https://example.invalid/${id}`, title, summary: "" };
}

beforeEach(() => {
  run("DELETE FROM ai_review_tasks");
  run("DELETE FROM items");
  run("DELETE FROM sources");
  run("DELETE FROM block_rules");
  saveAiSettings({ enabled: true, baseUrl: "https://example.invalid/v1", model: "mock", preFilterEnabled: true,
    skipFreebieSources: false, sourceMode: "all", sourceIds: [], customNoiseKeywords: [] });
  // Fail closed if a test accidentally uses the production transport.
  setAiReviewTransportForTests(async () => { throw new Error("unmocked transport"); });
});

after(() => {
  setAiReviewTransportForTests(null);
  closeDb();
});

test("durable enqueue deduplicates within a call and has no 500-item eviction", () => {
  const jobs = Array.from({ length: 510 }, (_, i) => item(i + 1));
  assert.equal(enqueueAiTasks([...jobs, jobs[0]!]), 510);
  assert.equal(enqueueAiTasks(jobs), 0);
  assert.equal(aiReviewQueueStats().queued, 510);
  assert.equal(aiReviewQueueStats().persisted, 510);
});

test("leases reserve once, recover interrupted work, and never import unscheduled legacy rows", () => {
  const first = item(1);
  item(2);
  enqueueAiTasks([first]);
  const lease = claimAiTasks(10);
  assert.equal(lease.tasks.length, 1);
  assert.equal(lease.tasks[0]!.attempts, 1);
  assert.equal(claimAiTasks(10).tasks.length, 0);
  initAiReviewQueue({ resume: false });
  assert.equal(aiReviewQueueStats().retryWait, 1);
  assert.equal(aiReviewQueueStats().persisted, 1);
  const second = claimAiTasks(10);
  assert.equal(second.tasks[0]!.attempts, 2);
  finishAiTask(second.tasks[0]!.id, { status: "succeeded" }, lease.leaseToken);
  assert.equal(aiReviewQueueStats().running, 1, "stale lease cannot finalize another reservation");
  finishAiTask(second.tasks[0]!.id, { status: "succeeded" }, second.leaseToken);
  assert.equal(aiReviewQueueStats().succeeded, 1);
  assert.equal(markInterruptedTasks(), 0);
  assert.equal(aiPendingBreakdown().eligibleUnscheduled, 2);
});

test("active ai=NULL breakdown is disjoint and kept remains the flattened ai_keep total", () => {
  for (let id = 1; id <= 9; id += 1) item(id, id === 7 ? "excluded-source" : id === 8 ? "epic-free" : "test-source", id === 6 ? "求助如何配置" : id === 5 ? "blocked term" : "免费额度");
  saveAiSettings({ sourceMode: "exclude", sourceIds: ["excluded-source"], skipFreebieSources: true });
  run("INSERT INTO block_rules (pattern, mode, scope, enabled, created_at) VALUES ('blocked', 'keyword', 'all', 1, ?)", new Date().toISOString());
  enqueueAiTasks([{ itemId: 1 }, { itemId: 2 }, { itemId: 3 }, { itemId: 4 }]);
  const claimed = claimAiTasks(3);
  finishAiTask(claimed.tasks[1]!.id, { status: "retry_wait", nextAttemptAt: new Date(Date.now() + 60_000).toISOString() }, claimed.leaseToken);
  finishAiTask(claimed.tasks[2]!.id, { status: "failed" }, claimed.leaseToken);
  run("UPDATE items SET ai_keep = 1 WHERE id = 9");
  const breakdown = aiPendingBreakdown();
  assert.deepEqual(breakdown, { pending: 9, eligibleUnscheduled: 1, running: 1, queued: 1, retryWait: 1, failed: 1,
    excluded: 1, entryRuleSkipped: 1, blocked: 1, exempted: 1 });
  assert.equal(Object.entries(breakdown).filter(([key]) => key !== "pending").reduce((n, [, count]) => n + count, 0), breakdown.pending);
  const stats = aiStats();
  assert.equal(stats.kept, 1);
  assert.equal(stats.pending, 9);
  assert.equal(stats.blockedSkipped, 1);
  assert.ok(stats.telemetry);
  assert.ok(Array.isArray(stats.recent));
});

test("sync partial response records successes once and missing verdicts remain retryable", async () => {
  const jobs = [item(1), item(2)];
  let calls = 0;
  setAiReviewTransportForTests(async () => {
    calls += 1;
    return new Map([[0, { index: 0, keep: true, kind: "freebie", category: "ai", reason: "mock", obtain: "free", quality: 4 }]]);
  });
  const result = await reviewFreshNow(jobs);
  assert.equal(result.size, 1);
  assert.equal(aiReviewQueueStats().succeeded, 1);
  assert.equal(aiReviewQueueStats().retryWait, 1);
  enqueueForAi(jobs);
  assert.equal(calls, 1, "successful and future-retry items do not trigger duplicate review");
  assert.equal(aiQueueStats().dropped, 0);
  assert.equal(get<{ ai: string | null }>("SELECT ai FROM items WHERE id = 2")?.ai, null);
});

test("429 retries are bounded across persisted executions and errors contain no transport secret", async () => {
  const job = item(1);
  let calls = 0;
  setAiReviewTransportForTests(async () => { calls += 1; throw new Error("HTTP 429 bearer SUPER_SECRET"); });
  await reviewFreshNow([job]);
  assert.equal(aiReviewQueueStats().retryWait, 1);
  for (let attempt = 2; attempt <= 3; attempt += 1) {
    run("UPDATE ai_review_tasks SET next_attempt_at = ?", new Date(0).toISOString());
    await reviewFreshNow([job]);
  }
  assert.equal(calls, 3);
  assert.equal(aiReviewQueueStats().failed, 1);
  assert.equal(all<{ last_error: string }>("SELECT last_error FROM ai_review_tasks").some((r) => r.last_error.includes("SUPER_SECRET")), false);
  assert.equal(retryDelayMs(2), 4000);
  assert.equal(isRetryableAiError("HTTP 503"), true);
  assert.equal(isRetryableAiError("request timed out"), true);
  assert.equal(isRetryableAiError("HTTP 401"), false);
});

test("execute rechecks block/source/disabled policy without calling the transport", async () => {
  const jobs = [item(1), item(2, "excluded-source")];
  enqueueAiTasks(jobs);
  saveAiSettings({ sourceMode: "exclude", sourceIds: ["excluded-source"] });
  run("INSERT INTO block_rules (pattern, mode, scope, enabled, created_at) VALUES ('开发者', 'keyword', 'test-source', 1, ?)", new Date().toISOString());
  initAiReviewQueue();
  // drain settles synchronous policy-only tasks before its first await.
  assert.equal(aiReviewQueueStats().skipped, 2);
  assert.equal(aiReviewQueueStats().failed, 0);
  assert.equal(aiReviewQueueStats().persisted, 2);
  const third = item(3);
  enqueueAiTasks([third]);
  saveAiSettings({ enabled: false });
  initAiReviewQueue();
  assert.equal(aiReviewQueueStats().skipped, 3);
});

test("manual backfill excludes current source exemptions and active task duplicates", async () => {
  const queued = item(1);
  item(2, "excluded-source");
  item(3, "epic-free");
  enqueueAiTasks([queued]);
  saveAiSettings({ sourceMode: "exclude", sourceIds: ["excluded-source"], skipFreebieSources: true });
  const result = await backfillAi(200, "pending");
  const estimate = estimateAiBackfill(200, "pending");
  assert.equal(estimate.selected, 0);
  assert.equal(estimate.limit, 200);
  assert.equal(result.reviewed, 0);
  assert.equal(result.scanned, 3);
  assert.equal(aiReviewQueueStats().persisted, 1);
});
