import { useCallback, useEffect, useRef, useState } from "react";
import { savedRoute } from "../lib/feed-scope.ts";
import { categoriesForPreset } from "../lib/sources.ts";

/** Feed controls and their reset rules; saved scope remains independent of preset. */
export function useFeedFilters() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [source, setSource] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [catOpen, setCatOpen] = useState(false);
  const catRef = useRef<HTMLDivElement | null>(null);
  const [lang, setLang] = useState<"all" | "zh" | "en">("all");
  const [sort, setSort] = useState("newest");
  const [range, setRange] = useState("auto");
  const [priceCap, setPriceCap] = useState("auto");
  const [minScore, setMinScore] = useState("all");
  const [obtain, setObtain] = useState("auto");
  const [kindFilter, setKindFilter] = useState("auto");
  const [savedOnly, setSavedOnly] = useState(() => savedRoute(typeof location === "undefined" ? "" : location.hash).saved);
  const [preset, setPreset] = useState(() => savedRoute(typeof location === "undefined" ? "" : location.hash).preset);
  const [viewMode, setViewMode] = useState<"compact" | "grid2" | "grid3">(() => {
    if (typeof localStorage === "undefined") return "grid2";
    const saved = localStorage.getItem("radar_view_mode");
    return saved === "grid2" || saved === "grid3" || saved === "compact" ? saved : "grid2";
  });
  const updateViewMode = useCallback((m: "compact" | "grid2" | "grid3") => {
    setViewMode(m);
    try {
      localStorage.setItem("radar_view_mode", m);
    } catch {
      /* ignore */
    }
  }, []);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [mobileFilterBar, setMobileFilterBar] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const switchPreset = useCallback((nextKey: string) => {
    setPreset(nextKey);
    setKindFilter("auto");
    setObtain("auto");
    setPriceCap("auto");
    setCategories((cur) => {
      const allowed = new Set(categoriesForPreset(nextKey));
      return cur.filter((c) => allowed.has(c));
    });
  }, []);

  const activeFilterCount =
    [
      source,
      categories.length > 0,
      lang !== "all",
      debounced,
      minScore !== "all",
      unreadOnly,
      kindFilter !== "auto",
      priceCap !== "auto",
      obtain !== "auto",
      range !== "auto",
      sort !== "newest",
    ].filter(Boolean).length;

  const resetFilters = useCallback(() => {
    setSource("");
    setCategories([]);
    setLang("all");
    setSearch("");
    setDebounced("");
    setMinScore("all");
    setUnreadOnly(false);
    setKindFilter("auto");
    setPriceCap("auto");
    setObtain("auto");
    setRange("auto");
    setSort("newest");
    setPreset(savedOnly ? "all" : "verified");
  }, [savedOnly]);
  useEffect(() => {
    if (!catOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (catRef.current && !catRef.current.contains(event.target as Node)) setCatOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [catOpen]);

  return {
    catOpen, setCatOpen, catRef, search, setSearch, debounced, setDebounced, source, setSource,
    categories, setCategories, lang, setLang, sort, setSort, range, setRange, priceCap, setPriceCap,
    minScore, setMinScore, obtain, setObtain, kindFilter, setKindFilter, savedOnly, setSavedOnly, preset,
    setPreset, viewMode, updateViewMode, unreadOnly, setUnreadOnly, mobileFilterBar, setMobileFilterBar,
    switchPreset, activeFilterCount, resetFilters,
  };
}

export type FeedFilterModel = ReturnType<typeof useFeedFilters>;
