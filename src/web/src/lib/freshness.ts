export type FreshnessInput = { expires_at?: string | null; first_seen_at?: string | null; last_seen_at?: string | null };
export type FreshnessState = "expired" | "soon" | "dated" | "unknown";
const DAY = 86400_000;
/** Require a complete timestamp and explicit timezone; never invent a timezone for a date-only value. */
export function recordedTime(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const calendar = value.slice(0, 10);
  const midnight = Date.parse(calendar + "T00:00:00Z");
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== calendar) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}
export function formatRecordedTime(time: number): string {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(time);
}
export function freshnessOf(item: FreshnessInput, now: number) {
  const expires = recordedTime(item.expires_at);
  const seen = recordedTime(item.last_seen_at);
  const first = recordedTime(item.first_seen_at);
  const remaining = expires === null ? null : expires - now;
  const state: FreshnessState = remaining === null ? "unknown" : remaining <= 0 ? "expired" : remaining <= DAY ? "soon" : "dated";
  const deadlineLabel = state === "expired" ? "已过标注截止" : state === "soon" ? "24h 内到期" : state === "dated" ? "有标注截止" : "截止时间未知";
  const deadline = expires === null ? (item.expires_at ? "截止记录无法解析，暂按未知展示" : "来源未提供明确截止时间") : formatRecordedTime(expires);
  let seenLabel = "最近采集时间未知";
  if (seen !== null) {
    const age = now - seen;
    if (age < -60_000) seenLabel = "采集记录时间异常";
    else if (age < 60_000) seenLabel = "最近采集：刚刚";
    else if (age < 3600_000) seenLabel = `最近采集：${Math.floor(age / 60_000)} 分钟前`;
    else if (age < DAY) seenLabel = `最近采集：${Math.floor(age / 3600_000)} 小时前`;
    else seenLabel = `最近采集：${Math.floor(age / DAY)} 天前`;
  }
  return { state, deadlineLabel, deadline, expires, seen, first, seenLabel,
    needsReview: state === "expired" || seen === null || seen > now + 60_000 || now - seen >= 7 * DAY,
    caveat: state === "expired" ? "已超过记录中的截止时间；是否延期或仍可用，请以原站当前说明为准。" : "采集时间只表示条目再次被来源返回，不代表已核验可领取、价格或库存。",
  };
}