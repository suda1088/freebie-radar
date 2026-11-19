import { config } from "./config.ts";
import { all } from "./db.ts";
import { hasCookieConfiguredForSource } from "./cookie-store.ts";
import { runSource, activeSourceIds } from "./collectors/index.ts";
import { batchIsRunning, collectionSchedulerState, sourceSkipReason } from "./collection-jobs.ts";

/** 极简 5 段 cron 匹配：分 时 日 月 周；支持 * , - /。 */
export function matchCron(expr: string, date: Date, utc = false): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const get = utc
    ? [date.getUTCMinutes(), date.getUTCHours(), date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCDay()]
    : [date.getMinutes(), date.getHours(), date.getDate(), date.getMonth() + 1, date.getDay()];
  const ranges: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  return parts.every((part, i) => matchField(part, get[i]!, ranges[i]![0], ranges[i]![1]));
}

export function matchField(field: string, value: number, min: number, max: number): boolean {
  for (const chunk of field.split(",")) {
    const [rangePart, stepPart] = chunk.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isFinite(step) || step <= 0) return false;
    let start = min;
    let end = max;
    if (rangePart && rangePart !== "*") {
      const [a, b] = rangePart.split("-");
      start = Number(a);
      end = b === undefined ? (stepPart ? max : start) : Number(b);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    if (value < start || value > end) continue;
    if ((value - start) % step === 0) return true;
  }
  return false;
}


export function listDueSourceIds(): string[] {
  const due = all<{ id: string; kind: string; interval_sec: number; last_run_at: string | null }>(
    `SELECT id, kind, interval_sec, last_run_at FROM sources
      WHERE enabled = 1
        AND (last_run_at IS NULL OR datetime(last_run_at, '+' || interval_sec || ' seconds') <= datetime('now'))
      ORDER BY last_run_at IS NOT NULL, last_run_at ASC`,
  );
  const filter = config.enabledSources;
  return due
    .filter((s) => {
      if (activeSourceIds().includes(s.id)) return false;
      if (filter.length && !filter.includes(s.id)) return false;
      if (s.kind === "ingest" && !hasCookieConfiguredForSource(s.id)) return false;
      return true;
    })
    .map((s) => s.id);
}

/**
 * 按每个源自己的 interval_sec 轮询：到点就跑，串行执行避免打爆上游。
 * 送码类源设 60-120 秒，日报/清单/Cookie 托管源设半小时至数小时。
 */
export function startIntervalScheduler(task: {
  log?: (m: string) => void;
  tickMs?: number;
} = {}): void {
  if (intervalTimer) return;
  const log = task.log ?? ((m: string) => console.log(m));
  const tickMs = task.tickMs ?? 30_000;
  collectionSchedulerState.enabled = true;
  collectionSchedulerState.tickMs = tickMs;
  let busy = false;

  const tick = async () => {
    collectionSchedulerState.lastTickAt = new Date().toISOString();
    if (busy) return;
    if (batchIsRunning()) return;
    busy = true;
    collectionSchedulerState.busy = true;
    collectionSchedulerState.lastError = null;
    try {
      for (const id of listDueSourceIds()) {
        if (batchIsRunning()) break;
        if (sourceSkipReason(id) || !listDueSourceIds().includes(id)) continue;
        try {
          await runSource(id,{enabledOnly:true});
        } catch (err) {
          log(`[cron] ${id} 失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      collectionSchedulerState.lastError = err instanceof Error ? err.message : String(err);
      log(`[cron] 调度异常: ${collectionSchedulerState.lastError}`);
    } finally {
      busy = false;
      collectionSchedulerState.busy = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), tickMs);
  timer.unref?.();
  intervalTimer = timer;
  log(`[cron] interval scheduler started (tick=${tickMs}ms)`);
}

let intervalTimer: NodeJS.Timeout | null = null;

export function stopIntervalScheduler(): void {
  if (intervalTimer) clearInterval(intervalTimer);
  intervalTimer = null;
  collectionSchedulerState.enabled = false;
}
let timer: NodeJS.Timeout | null = null;
let lastKey = "";

export function startScheduler(task: { collect: () => Promise<unknown>; daily: () => Promise<unknown>; log?: (m: string) => void }): void {
  if (timer) return;
  const log = task.log ?? ((m: string) => console.log(m));
  timer = setInterval(() => {
    const now = new Date();
    const key = now.toISOString().slice(0, 16);
    if (key === lastKey) return;
    lastKey = key;
    if (config.enableScheduler && matchCron(config.collectCron, now)) {
      log("[cron] 触发采集");
      task.collect().catch((e) => log(`[cron] 采集失败: ${String(e)}`));
    }
    if (config.enableScheduler && matchCron(config.dailyCron, now)) {
      log("[cron] 触发日报");
      task.daily().catch((e) => log(`[cron] 日报失败: ${String(e)}`));
    }
  }, 30_000);
  log(`[cron] scheduler started collect="${config.collectCron}" daily="${config.dailyCron}"`);
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
