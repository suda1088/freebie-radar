import { withSavedScope } from "./feed-scope.ts";

export interface FeedQueryInput {
  debounced: string;
  source: string;
  categories: readonly string[];
  lang: "all" | "zh" | "en";
  sort: string;
  range: string;
  priceCap: string;
  preset: string;
  kindFilter: string;
  obtain: string;
  minScore: string;
  unreadOnly: boolean;
  savedOnly: boolean;
}

/** Preset defaults are overridden only by the same explicit filters as the feed UI. */
export function buildFeedQuery(input: FeedQueryInput, now: number): string {
  const { debounced, source, categories, lang, sort, range, priceCap, preset,
    kindFilter, obtain, minScore, unreadOnly, savedOnly } = input;
  const p = new URLSearchParams();
  if (debounced) p.set("search", debounced);
  if (source) p.set("source", source);
  if (categories.length) p.set("category", categories.join(","));
  if (lang !== "all") p.set("lang", lang);
  if (sort) p.set("sort", sort);

  if (preset === "verified") {
    p.set("unexpired", "1");
    p.set("aiOnly", "1");
    if (kindFilter === "auto") p.set("kind", "freebie");
    if (obtain === "auto") p.set("obtain", "free,conditional");
    if (range === "auto") p.set("maxAgeDays", "7");
  } else if (preset === "free") {
    p.set("unexpired", "1");
    if (kindFilter === "auto") p.set("kind", "freebie");
    if (range === "auto") p.set("maxAgeDays", "14");
    if (priceCap === "auto") p.set("freeOnly", "1");
    if (obtain === "auto") p.set("obtain", "free");
  } else if (preset === "deal") {
    p.set("unexpired", "1");
    if (kindFilter === "auto") p.set("kind", "deal");
    p.set("hideRejected", "1");
  } else if (preset === "opensource") {
    if (kindFilter === "auto") p.set("kind", "opensource");
    p.set("hideRejected", "1");
  } else if (preset === "news") {
    if (kindFilter === "auto") p.set("kind", "news");
    p.set("hideRejected", "1");
  } else if (preset === "info") {
    if (kindFilter === "auto") p.set("kind", "info");
    p.set("hideRejected", "1");
  } else if (preset === "codes") {
    p.set("unexpired", "1");
    p.set("hasCodes", "1");
  } else if (preset === "urgent") {
    p.set("expiring", "1");
  } else if (preset === "hidden") {
    p.set("status", "ignored");
  }
  if (preset === "all" && !savedOnly) p.set("hideRejected", "1");

  if (kindFilter !== "auto" && kindFilter !== "all") p.set("kind", kindFilter);

  if (priceCap === "free") p.set("freeOnly", "1");
  else if (priceCap !== "auto" && priceCap !== "all") p.set("maxPrice", priceCap);

  if (obtain !== "auto" && obtain !== "all" && obtain) p.set("obtain", obtain);
  if (minScore !== "all") p.set("minScore", minScore);
  if (unreadOnly) p.set("unread", "1");

  const DAYS: Record<string, number> = { "1d": 1, "3d": 3, "7d": 7, "30d": 30 };
  const days = DAYS[range];
  if (days) p.set("since", new Date(now - days * 86_400_000).toISOString());
  p.set("limit", "100");
  return withSavedScope(p, savedOnly).toString();
}
