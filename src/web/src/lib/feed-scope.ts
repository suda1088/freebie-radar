export const FEED_PRESETS = new Set(["verified", "free", "deal", "opensource", "news", "info", "codes", "urgent", "all", "hidden"]);
/** Collection scope is independent of the selected content filter. */
export function savedRoute(hash: string): { saved: boolean; preset: string } {
  const parts = hash.replace(/^#/, "").split("/");
  const saved = parts[0] === "saved";
  return { saved, preset: saved && FEED_PRESETS.has(parts[1] ?? "") ? parts[1]! : saved ? "all" : "verified" };
}
export function feedHash(saved: boolean, preset: string): string {
  return saved ? "#saved" + (preset === "all" ? "" : "/" + (FEED_PRESETS.has(preset) ? preset : "all")) : "";
}
export function withSavedScope(params: URLSearchParams, saved: boolean): URLSearchParams {
  const result = new URLSearchParams(params);
  if (saved) result.set("starred", "1");
  else result.delete("starred");
  return result;
}