"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { ErrorNotice } from "@/components/error-notice";
import { TimestampWithAge } from "@/components/common/timestamp-with-age";
import { DataQualityBadge, FreshnessBadge } from "@/components/data-quality-badge";
import { RiskDisclosure } from "@/components/risk-disclosure";
import { SectionHeader } from "@/components/ui/section-header";
import { MetricRow } from "@/components/ui/metric-row";
import { WarningBox } from "@/components/ui/warning-box";
import { MobileActivityCard } from "@/components/mobile/mobile-activity-card";
import { useActivity } from "@/hooks/use-activity";
import { useGlobalHotkey } from "@/hooks/use-global-hotkey";
import { useIsMac } from "@/hooks/use-is-mac";
import { isEditableElement } from "@/lib/dom/is-editable-element";
import { getExplorerTxUrl, shortTx } from "@/lib/explorer";
import { SHORTCUTS, getActivitySearchQuickKey } from "@/lib/keyboard-shortcuts";

const FILTERS = ["ALL", "Mint", "Collect", "Rebalance", "Approve", "Worker Action", "System Alert", "Error"] as const;
const ALERT_FLAG_FILTERS = ["ALL", "SUCCESS", "RELAYER", "P95"] as const;
const ALERT_LIMIT_OPTIONS = [5, 10, 20] as const;
const TABLE_LIMIT_OPTIONS = [10, 20, 50] as const;
const SORT_MODES = ["LATEST", "OLDEST", "FAILED_FIRST"] as const;
const SEARCH_FIELDS = ["ALL", "MESSAGE", "TX"] as const;
type ActivityFilter = (typeof FILTERS)[number];
type AlertFlagFilter = (typeof ALERT_FLAG_FILTERS)[number];
type AlertLimitOption = (typeof ALERT_LIMIT_OPTIONS)[number];
type TableLimitOption = (typeof TABLE_LIMIT_OPTIONS)[number];
type SortMode = (typeof SORT_MODES)[number];
type SearchField = (typeof SEARCH_FIELDS)[number];
type ActiveConditionChipKey = "filter" | "alertFlag" | "alertLimit" | "limit" | "page" | "sort" | "qf" | "q" | "hideEmpty";

type ActivityLike = {
  type: string;
  source?: string | null;
  tx?: string | null;
  positionId?: string | null;
  message: string;
  error?: string | null;
};

function parseActivityFilter(raw: string | null): ActivityFilter {
  if (!raw) return "ALL";
  return FILTERS.includes(raw as ActivityFilter) ? (raw as ActivityFilter) : "ALL";
}

function parseAlertFlagFilter(raw: string | null): AlertFlagFilter {
  if (!raw) return "ALL";
  return ALERT_FLAG_FILTERS.includes(raw as AlertFlagFilter) ? (raw as AlertFlagFilter) : "ALL";
}

function parseAlertLimit(raw: string | null): AlertLimitOption {
  if (!raw) return 5;
  const n = Number(raw);
  return ALERT_LIMIT_OPTIONS.includes(n as AlertLimitOption) ? (n as AlertLimitOption) : 5;
}

function parseTableLimit(raw: string | null): TableLimitOption {
  if (!raw) return 20;
  const n = Number(raw);
  return TABLE_LIMIT_OPTIONS.includes(n as TableLimitOption) ? (n as TableLimitOption) : 20;
}

function parseTablePage(raw: string | null): number {
  if (!raw) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.floor(n));
}

function parseSortMode(raw: string | null): SortMode {
  if (!raw) return "LATEST";
  return SORT_MODES.includes(raw as SortMode) ? (raw as SortMode) : "LATEST";
}

function parseSearchField(raw: string | null): SearchField {
  if (!raw) return "ALL";
  return SEARCH_FIELDS.includes(raw as SearchField) ? (raw as SearchField) : "ALL";
}

function parseSearchQuery(raw: string | null): string {
  if (!raw) return "";
  return raw.trim().slice(0, 120);
}

function parseHideEmptyFilters(raw: string | null): boolean {
  return raw === "true";
}

function getChipClearHint(key: ActiveConditionChipKey): string {
  if (key === "filter") return "クリックで filter=ALL に戻します";
  if (key === "alertFlag") return "クリックで alertFlag=ALL に戻します";
  if (key === "alertLimit") return "クリックで alertLimit=5 に戻します";
  if (key === "limit") return "クリックで limit=20 に戻します";
  if (key === "page") return "クリックで page=1 に戻します";
  if (key === "sort") return "クリックで sort=LATEST に戻します";
  if (key === "qf") return "クリックで qf=ALL に戻します";
  if (key === "hideEmpty") return "クリックで hideEmpty を無効化します";
  return "クリックで q をクリアします";
}

function matchesSearchQuery(item: ActivityLike, query: string, field: SearchField): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (field === "MESSAGE") {
    return `${item.message ?? ""} ${item.error ?? ""}`.toLowerCase().includes(q);
  }
  if (field === "TX") {
    return `${item.tx ?? ""}`.toLowerCase().includes(q);
  }
  const haystack = [item.type, item.source ?? "", item.tx ?? "", item.positionId ?? "", item.message ?? "", item.error ?? ""].join(" ").toLowerCase();
  return haystack.includes(q);
}

function isSystemAlert(item: { source?: string; type: string }) {
  return item.source === "system-alert" || item.type === "Automation Alert";
}

function parseSystemAlertFlags(message: string): {
  degradedSuccessRate: boolean;
  elevatedRelayerFailureRate: boolean;
  elevatedP95ElapsedMs: boolean;
} {
  const tokens = message.split(";").map((token) => token.trim());
  const asMap = new Map<string, string>();
  for (const token of tokens) {
    const idx = token.indexOf("=");
    if (idx <= 0) continue;
    asMap.set(token.slice(0, idx), token.slice(idx + 1));
  }
  return {
    degradedSuccessRate: asMap.get("degradedSuccessRate") === "true",
    elevatedRelayerFailureRate: asMap.get("elevatedRelayerFailureRate") === "true",
    elevatedP95ElapsedMs: asMap.get("elevatedP95ElapsedMs") === "true"
  };
}

function ActivityPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { address } = useAccount();
  const { data, isLoading, isError, error } = useActivity(address);
  const [filter, setFilter] = useState<ActivityFilter>(() => parseActivityFilter(searchParams.get("filter")));
  const [systemAlertFlagFilter, setSystemAlertFlagFilter] = useState<AlertFlagFilter>(() =>
    parseAlertFlagFilter(searchParams.get("alertFlag"))
  );
  const [systemAlertLimit, setSystemAlertLimit] = useState<AlertLimitOption>(() => parseAlertLimit(searchParams.get("alertLimit")));
  const [tableLimit, setTableLimit] = useState<TableLimitOption>(() => parseTableLimit(searchParams.get("limit")));
  const [tablePage, setTablePage] = useState<number>(() => parseTablePage(searchParams.get("page")));
  const [sortMode, setSortMode] = useState<SortMode>(() => parseSortMode(searchParams.get("sort")));
  const [searchField, setSearchField] = useState<SearchField>(() => parseSearchField(searchParams.get("qf")));
  const [searchQuery, setSearchQuery] = useState<string>(() => parseSearchQuery(searchParams.get("q")));
  const [searchInput, setSearchInput] = useState<string>(() => parseSearchQuery(searchParams.get("q")));
  const [hideEmptyFilters, setHideEmptyFilters] = useState<boolean>(() => parseHideEmptyFilters(searchParams.get("hideEmpty")));
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [searchToastMessage, setSearchToastMessage] = useState<string>("");
  const isMac = useIsMac();
  const quickSearchModifier: "ctrl" | "meta" = isMac ? "meta" : "ctrl";
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const nextFilter = parseActivityFilter(searchParams.get("filter"));
    const nextAlertFlagFilter = parseAlertFlagFilter(searchParams.get("alertFlag"));
    const nextAlertLimit = parseAlertLimit(searchParams.get("alertLimit"));
    const nextTableLimit = parseTableLimit(searchParams.get("limit"));
    const nextTablePage = parseTablePage(searchParams.get("page"));
    const nextSortMode = parseSortMode(searchParams.get("sort"));
    const nextSearchField = parseSearchField(searchParams.get("qf"));
    const nextSearchQuery = parseSearchQuery(searchParams.get("q"));
    const nextHideEmptyFilters = parseHideEmptyFilters(searchParams.get("hideEmpty"));
    setFilter((prev) => (prev === nextFilter ? prev : nextFilter));
    setSystemAlertFlagFilter((prev) => (prev === nextAlertFlagFilter ? prev : nextAlertFlagFilter));
    setSystemAlertLimit((prev) => (prev === nextAlertLimit ? prev : nextAlertLimit));
    setTableLimit((prev) => (prev === nextTableLimit ? prev : nextTableLimit));
    setTablePage((prev) => (prev === nextTablePage ? prev : nextTablePage));
    setSortMode((prev) => (prev === nextSortMode ? prev : nextSortMode));
    setSearchField((prev) => (prev === nextSearchField ? prev : nextSearchField));
    setSearchQuery((prev) => (prev === nextSearchQuery ? prev : nextSearchQuery));
    setSearchInput((prev) => (prev === nextSearchQuery ? prev : nextSearchQuery));
    setHideEmptyFilters((prev) => (prev === nextHideEmptyFilters ? prev : nextHideEmptyFilters));
  }, [searchParams]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (filter === "ALL") {
      params.delete("filter");
    } else {
      params.set("filter", filter);
    }
    if (systemAlertFlagFilter === "ALL") {
      params.delete("alertFlag");
    } else {
      params.set("alertFlag", systemAlertFlagFilter);
    }
    if (systemAlertLimit === 5) {
      params.delete("alertLimit");
    } else {
      params.set("alertLimit", String(systemAlertLimit));
    }
    if (tableLimit === 20) {
      params.delete("limit");
    } else {
      params.set("limit", String(tableLimit));
    }
    if (tablePage <= 1) {
      params.delete("page");
    } else {
      params.set("page", String(tablePage));
    }
    if (sortMode === "LATEST") {
      params.delete("sort");
    } else {
      params.set("sort", sortMode);
    }
    if (searchField === "ALL") {
      params.delete("qf");
    } else {
      params.set("qf", searchField);
    }
    if (!hideEmptyFilters) {
      params.delete("hideEmpty");
    } else {
      params.set("hideEmpty", "true");
    }
    if (!searchQuery) {
      params.delete("q");
    } else {
      params.set("q", searchQuery);
    }
    const next = params.toString();
    const current = searchParams.toString();
    if (next !== current) {
      router.replace(next.length > 0 ? `${pathname}?${next}` : pathname, { scroll: false });
    }
  }, [filter, hideEmptyFilters, pathname, router, searchField, searchParams, searchQuery, sortMode, systemAlertFlagFilter, systemAlertLimit, tableLimit, tablePage]);

  const rows = useMemo(() => {
    const source = data ?? [];
    if (filter === "ALL") return source;
    if (filter === "System Alert") return source.filter((x) => isSystemAlert(x));
    if (filter === "Worker Action") return source.filter((x) => x.source === "worker");
    if (filter === "Error") return source.filter((x) => x.type === "Error");
    return source.filter((x) => x.type === filter);
  }, [data, filter]);
  const systemAlerts = useMemo(() => {
    const alerts = (data ?? []).filter((x) => isSystemAlert(x));
    const byFlag = systemAlertFlagFilter === "ALL" ? alerts : alerts.filter((item) => {
      const flags = parseSystemAlertFlags(item.message);
      if (systemAlertFlagFilter === "SUCCESS") return flags.degradedSuccessRate;
      if (systemAlertFlagFilter === "RELAYER") return flags.elevatedRelayerFailureRate;
      if (systemAlertFlagFilter === "P95") return flags.elevatedP95ElapsedMs;
      return true;
    });
    return byFlag.filter((item) => matchesSearchQuery(item, searchQuery, searchField));
  }, [data, searchField, searchQuery, systemAlertFlagFilter]);
  const systemAlertFlagCounts = useMemo(() => {
    const alerts = (data ?? []).filter((x) => isSystemAlert(x)).filter((item) => matchesSearchQuery(item, searchQuery, searchField));
    let success = 0;
    let relayer = 0;
    let p95 = 0;
    for (const item of alerts) {
      const flags = parseSystemAlertFlags(item.message);
      if (flags.degradedSuccessRate) success += 1;
      if (flags.elevatedRelayerFailureRate) relayer += 1;
      if (flags.elevatedP95ElapsedMs) p95 += 1;
    }
    return {
      ALL: alerts.length,
      SUCCESS: success,
      RELAYER: relayer,
      P95: p95
    } as const;
  }, [data, searchField, searchQuery]);
  const searchedRows = useMemo(() => rows.filter((x) => matchesSearchQuery(x, searchQuery, searchField)), [rows, searchField, searchQuery]);
  const tableRows = useMemo(() => {
    if (filter === "System Alert") return searchedRows;
    return searchedRows.filter((x) => !isSystemAlert(x));
  }, [searchedRows, filter]);
  const filterCounts = useMemo(() => {
    const scoped = (data ?? []).filter((item) => matchesSearchQuery(item, searchQuery, searchField));
    const counts: Record<ActivityFilter, number> = {
      ALL: 0,
      Mint: 0,
      Collect: 0,
      Rebalance: 0,
      Approve: 0,
      "Worker Action": 0,
      "System Alert": 0,
      Error: 0
    };
    for (const item of scoped) {
      const system = isSystemAlert(item);
      if (system) {
        counts["System Alert"] += 1;
        continue;
      }
      counts.ALL += 1;
      if (item.type === "Mint") counts.Mint += 1;
      if (item.type === "Collect") counts.Collect += 1;
      if (item.type === "Rebalance") counts.Rebalance += 1;
      if (item.type === "Approve") counts.Approve += 1;
      if (item.source === "worker") counts["Worker Action"] += 1;
      if (item.type === "Error") counts.Error += 1;
    }
    return counts;
  }, [data, searchField, searchQuery]);
  const sortedTableRows = useMemo(() => {
    const copy = [...tableRows];
    if (sortMode === "FAILED_FIRST") {
      copy.sort((a, b) => {
        const af = a.success === false ? 0 : 1;
        const bf = b.success === false ? 0 : 1;
        if (af !== bf) return af - bf;
        const at = Date.parse(a.createdAt);
        const bt = Date.parse(b.createdAt);
        return bt - at;
      });
      return copy;
    }
    copy.sort((a, b) => {
      const at = Date.parse(a.createdAt);
      const bt = Date.parse(b.createdAt);
      return sortMode === "OLDEST" ? at - bt : bt - at;
    });
    return copy;
  }, [sortMode, tableRows]);
  const totalPages = Math.max(1, Math.ceil(sortedTableRows.length / tableLimit));
  useEffect(() => {
    setTablePage((prev) => (prev > totalPages ? totalPages : prev));
  }, [totalPages]);
  const pagedTableRows = useMemo(() => {
    const start = (tablePage - 1) * tableLimit;
    return sortedTableRows.slice(start, start + tableLimit);
  }, [sortedTableRows, tableLimit, tablePage]);
  const canApplySearch = parseSearchQuery(searchInput) !== searchQuery;
  const hasActiveControls =
    filter !== "ALL" ||
    systemAlertFlagFilter !== "ALL" ||
    systemAlertLimit !== 5 ||
    tableLimit !== 20 ||
    tablePage !== 1 ||
    sortMode !== "LATEST" ||
    searchField !== "ALL" ||
    hideEmptyFilters ||
    Boolean(searchQuery) ||
    Boolean(searchInput);
  const activeConditionChips = useMemo(() => {
    const chips: Array<{ key: ActiveConditionChipKey; label: string }> = [];
    if (filter !== "ALL") chips.push({ key: "filter", label: `filter:${filter}` });
    if (systemAlertFlagFilter !== "ALL") chips.push({ key: "alertFlag", label: `alertFlag:${systemAlertFlagFilter}` });
    if (systemAlertLimit !== 5) chips.push({ key: "alertLimit", label: `alertLimit:${systemAlertLimit}` });
    if (tableLimit !== 20) chips.push({ key: "limit", label: `limit:${tableLimit}` });
    if (tablePage !== 1) chips.push({ key: "page", label: `page:${tablePage}` });
    if (sortMode !== "LATEST") chips.push({ key: "sort", label: `sort:${sortMode}` });
    if (searchField !== "ALL") chips.push({ key: "qf", label: `qf:${searchField}` });
    if (hideEmptyFilters) chips.push({ key: "hideEmpty", label: "hideEmpty:true" });
    if (searchQuery) chips.push({ key: "q", label: `q:${searchQuery}` });
    return chips;
  }, [filter, hideEmptyFilters, searchField, searchQuery, sortMode, systemAlertFlagFilter, systemAlertLimit, tableLimit, tablePage]);
  function getSearchHitCount(nextQuery: string, opts?: { filter?: ActivityFilter; searchField?: SearchField }): number {
    const appliedFilter = opts?.filter ?? filter;
    const appliedSearchField = opts?.searchField ?? searchField;
    const searched = rows.filter((item) => matchesSearchQuery(item, nextQuery, appliedSearchField));
    if (appliedFilter === "System Alert") return searched.length;
    return searched.filter((item) => !isSystemAlert(item)).length;
  }
  function applySearch(): void {
    const next = parseSearchQuery(searchInput);
    setSearchQuery(next);
    setTablePage(1);
    const hitCount = getSearchHitCount(next);
    setSearchToastMessage(next ? `検索結果: ${hitCount}件` : `検索条件をクリアしました（${hitCount}件表示）`);
  }
  function clearSearch(): void {
    setSearchInput("");
    setSearchQuery("");
    setTablePage(1);
  }
  function resetAllControls(): void {
    setFilter("ALL");
    setSystemAlertFlagFilter("ALL");
    setSystemAlertLimit(5);
    setTableLimit(20);
    setTablePage(1);
    setSortMode("LATEST");
    setSearchField("ALL");
    setSearchInput("");
    setSearchQuery("");
    setHideEmptyFilters(false);
  }
  function clearConditionChip(key: ActiveConditionChipKey): void {
    if (key === "filter") {
      setFilter("ALL");
      setTablePage(1);
      return;
    }
    if (key === "alertFlag") {
      setSystemAlertFlagFilter("ALL");
      return;
    }
    if (key === "alertLimit") {
      setSystemAlertLimit(5);
      return;
    }
    if (key === "limit") {
      setTableLimit(20);
      setTablePage(1);
      return;
    }
    if (key === "page") {
      setTablePage(1);
      return;
    }
    if (key === "sort") {
      setSortMode("LATEST");
      setTablePage(1);
      return;
    }
    if (key === "qf") {
      setSearchField("ALL");
      setTablePage(1);
      return;
    }
    if (key === "hideEmpty") {
      setHideEmptyFilters(false);
      return;
    }
    setSearchInput("");
    setSearchQuery("");
    setTablePage(1);
  }
  async function copyCurrentUrl(): Promise<void> {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }
  useEffect(() => {
    if (copyStatus === "idle") return;
    const timer = window.setTimeout(() => setCopyStatus("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);
  useEffect(() => {
    if (!searchToastMessage) return;
    const timer = window.setTimeout(() => setSearchToastMessage(""), 1800);
    return () => window.clearTimeout(timer);
  }, [searchToastMessage]);
  useGlobalHotkey({
    key: "/",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: true,
    onTrigger: () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  });
  useGlobalHotkey({
    key: "k",
    ctrlKey: quickSearchModifier === "ctrl",
    metaKey: quickSearchModifier === "meta",
    altKey: false,
    shiftKey: false,
    preventDefault: true,
    onTrigger: () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.isComposing) return;
      if (event.key === "Escape" && isEditableElement(event.target)) {
        setSearchInput("");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const auditSummary = useMemo(() => {
    const all = data ?? [];
    const failed = all.filter((x) => x.success === false).length;
    const stale = all.filter((x) => x.stale).length;
    const worker = all.filter((x) => x.source === "worker").length;
    const alerts = all.filter((x) => isSystemAlert(x)).length;
    return { total: all.length, failed, stale, worker, alerts };
  }, [data]);

  return (
    <section className="mx-auto max-w-7xl px-6 py-8 text-slate-100">
      <h1 className="text-2xl font-bold">Activity / Audit Trail</h1>
      <SectionHeader title="Events" description="Mint / Collect / Rebalance / Approval / Error を一貫フォーマットで追跡します。" />
      {isError && <ErrorNotice message={error instanceof Error ? error.message : "Failed to load activity"} />}
      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.filter((item) => {
          if (!hideEmptyFilters) return true;
          if (item === "ALL") return true;
          if (item === filter) return true;
          return filterCounts[item] > 0;
        }).map((item) => (
          <button
            key={item}
            className={`rounded px-3 py-1 text-sm ${
              filter === item
                ? "bg-blue-600 text-white"
                : "border border-slate-700 bg-slate-800 text-slate-100"
            } ${
              filterCounts[item] === 0 && item !== "ALL" && filter !== item ? "cursor-not-allowed opacity-45" : ""
            }`}
            onClick={() => {
              if (filterCounts[item] === 0 && item !== "ALL" && filter !== item) return;
              setFilter(item);
              setTablePage(1);
              const hitCount = getSearchHitCount(searchQuery, { filter: item });
              setSearchToastMessage(`表示条件を更新: ${hitCount}件`);
            }}
            disabled={filterCounts[item] === 0 && item !== "ALL" && filter !== item}
            title={
              filterCounts[item] === 0 && item !== "ALL" && filter !== item
                ? "該当データがないため選択できません"
                : undefined
            }
          >
            {item} ({filterCounts[item]})
          </button>
        ))}
        <button
          className={`rounded border px-3 py-1 text-sm ${
            hideEmptyFilters ? "border-indigo-500 bg-indigo-900/40 text-indigo-100" : "border-slate-600 bg-slate-900 text-slate-200"
          }`}
          onClick={() => setHideEmptyFilters((prev) => !prev)}
        >
          Hide Empty {hideEmptyFilters ? "ON" : "OFF"}
        </button>
        <button
          className="rounded border border-slate-600 bg-slate-900 px-3 py-1 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={resetAllControls}
          disabled={!hasActiveControls}
        >
          Reset
        </button>
        <button
          className={`rounded border px-3 py-1 text-sm ${
            copyStatus === "copied"
              ? "border-emerald-500 bg-emerald-900/40 text-emerald-100"
              : copyStatus === "error"
                ? "border-red-500 bg-red-900/30 text-red-100"
                : "border-slate-600 bg-slate-900 text-slate-200"
          }`}
          onClick={() => {
            void copyCurrentUrl();
          }}
        >
          {copyStatus === "copied" ? "URLコピー済み" : copyStatus === "error" ? "コピー失敗" : "URLをコピー"}
        </button>
        <span className="ml-auto rounded border border-slate-700 bg-slate-900 px-3 py-1 text-sm text-slate-300">
          現在表示: {sortedTableRows.length}件
        </span>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          ref={searchInputRef}
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              applySearch();
            }
          }}
          placeholder="Search activity (type / message / tx / source / positionId)"
          className="min-w-[260px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
        />
        <span className="text-xs text-slate-500">
          shortcut: {SHORTCUTS.ACTIVITY_SEARCH_SLASH.keys} or {getActivitySearchQuickKey(isMac).keys}
        </span>
        <button
          className="rounded border border-blue-600/60 bg-blue-900/40 px-3 py-2 text-xs text-blue-100 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={applySearch}
          disabled={!canApplySearch}
        >
          検索
        </button>
        <button
          className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={clearSearch}
          disabled={!searchInput && !searchQuery}
        >
          クリア
        </button>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className="text-slate-400">検索対象</span>
          {(
            [
              { id: "ALL", label: "全項目" },
              { id: "MESSAGE", label: "message" },
              { id: "TX", label: "tx" }
            ] as const
          ).map((item) => (
            <button
              key={`qf-${item.id}`}
              className={`rounded border px-2 py-1 ${
                searchField === item.id ? "border-blue-500 bg-blue-900/40 text-blue-100" : "border-slate-700 bg-slate-900 text-slate-300"
              }`}
              onClick={() => {
                setSearchField(item.id);
                setTablePage(1);
                const hitCount = getSearchHitCount(searchQuery, { searchField: item.id });
                setSearchToastMessage(`検索対象を更新: ${hitCount}件`);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {searchToastMessage ? (
        <div className="mb-3 rounded border border-blue-700/40 bg-blue-950/40 px-3 py-2 text-xs text-blue-100">{searchToastMessage}</div>
      ) : null}
      <p className="-mt-2 mb-4 text-[11px] text-slate-500">Shortcut: `/` or `Ctrl/Cmd + K` to focus search, `Esc` to clear input.</p>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-400">一覧表示件数</span>
        {TABLE_LIMIT_OPTIONS.map((item) => (
          <button
            key={`table-limit-${item}`}
            className={`rounded border px-2 py-0.5 ${
              tableLimit === item ? "border-blue-500 bg-blue-900/40 text-blue-100" : "border-slate-700 bg-slate-900 text-slate-300"
            }`}
            onClick={() => {
              setTableLimit(item);
              setTablePage(1);
            }}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-400">並び順</span>
        {(
          [
            { id: "LATEST", label: "最新" },
            { id: "OLDEST", label: "最古" },
            { id: "FAILED_FIRST", label: "失敗優先" }
          ] as const
        ).map((item) => (
          <button
            key={`sort-${item.id}`}
            className={`rounded border px-2 py-0.5 ${
              sortMode === item.id ? "border-blue-500 bg-blue-900/40 text-blue-100" : "border-slate-700 bg-slate-900 text-slate-300"
            }`}
            onClick={() => {
              setSortMode(item.id);
              setTablePage(1);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-400">有効条件</span>
        {activeConditionChips.length === 0 ? (
          <span className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-slate-400">なし（default）</span>
        ) : (
          activeConditionChips.map((chip) => (
            <button
              key={chip.label}
              className="rounded border border-indigo-600/40 bg-indigo-900/30 px-2 py-0.5 text-indigo-200 hover:bg-indigo-900/50"
              onClick={() => clearConditionChip(chip.key)}
              title={getChipClearHint(chip.key)}
              aria-label={getChipClearHint(chip.key)}
            >
              {chip.label} ×
            </button>
          ))
        )}
      </div>
      <div className="mb-6 grid gap-4 md:grid-cols-5">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <MetricRow label="total events" value={auditSummary.total} />
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <MetricRow label="failed events" value={<span className="text-red-300">{auditSummary.failed}</span>} />
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <MetricRow label="stale events" value={<span className="text-yellow-300">{auditSummary.stale}</span>} />
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <MetricRow label="worker events" value={auditSummary.worker} />
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <MetricRow label="system alerts" value={<span className="text-amber-300">{auditSummary.alerts}</span>} />
        </div>
      </div>
      {systemAlerts.length > 0 && (
        <div className="mb-6 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-amber-200">System Alerts</p>
            <span className="rounded border border-amber-700/40 bg-amber-950/30 px-2 py-0.5 text-[11px] text-amber-200">
              該当: {systemAlerts.length}件 / 表示: {Math.min(systemAlerts.length, systemAlertLimit)}件
            </span>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            {(
              [
                { id: "ALL", label: "All" },
                { id: "SUCCESS", label: "Success Low" },
                { id: "RELAYER", label: "Relayer Failure High" },
                { id: "P95", label: "P95 High" }
              ] as const
            )
              .filter((item) => {
                if (!hideEmptyFilters) return true;
                if (item.id === "ALL") return true;
                if (item.id === systemAlertFlagFilter) return true;
                return systemAlertFlagCounts[item.id] > 0;
              })
              .map((item) => (
              <button
                key={item.id}
                className={`rounded border px-2 py-0.5 ${
                  systemAlertFlagFilter === item.id
                    ? "border-amber-500 bg-amber-900/40 text-amber-100"
                    : "border-slate-700 bg-slate-900 text-slate-300"
                } ${
                  systemAlertFlagCounts[item.id] === 0 && item.id !== "ALL" && systemAlertFlagFilter !== item.id
                    ? "cursor-not-allowed opacity-45"
                    : ""
                }`}
                onClick={() => {
                  if (systemAlertFlagCounts[item.id] === 0 && item.id !== "ALL" && systemAlertFlagFilter !== item.id) return;
                  setSystemAlertFlagFilter(item.id);
                }}
                disabled={systemAlertFlagCounts[item.id] === 0 && item.id !== "ALL" && systemAlertFlagFilter !== item.id}
                title={
                  systemAlertFlagCounts[item.id] === 0 && item.id !== "ALL" && systemAlertFlagFilter !== item.id
                    ? "該当アラートがないため選択できません"
                    : undefined
                }
              >
                {item.label} ({systemAlertFlagCounts[item.id]})
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-slate-400">表示件数</span>
            {ALERT_LIMIT_OPTIONS.map((item) => (
              <button
                key={`limit-${item}`}
                className={`rounded border px-2 py-0.5 ${
                  systemAlertLimit === item ? "border-blue-500 bg-blue-900/40 text-blue-100" : "border-slate-700 bg-slate-900 text-slate-300"
                }`}
                onClick={() => setSystemAlertLimit(item)}
              >
                {item}
              </button>
            ))}
          </div>
          {systemAlerts.slice(0, systemAlertLimit).map((item) => {
            const flags = parseSystemAlertFlags(item.message);
            return (
              <div key={`alert-${item.id}`} className="space-y-1">
                <WarningBox
                  type="WARNING"
                  title={`Automation Alert ${item.chainId ? `(chain ${item.chainId})` : ""}`}
                  description={`${item.message} / at ${item.createdAt}`}
                />
                <div className="flex flex-wrap gap-2 text-[11px]">
                  {flags.degradedSuccessRate ? (
                    <button
                      className={`rounded border px-2 py-0.5 ${
                        systemAlertFlagFilter === "SUCCESS"
                          ? "border-red-400 bg-red-800/40 text-red-100"
                          : "border-red-600/40 bg-red-900/30 text-red-200"
                      }`}
                      onClick={() => {
                        setFilter("System Alert");
                        setSystemAlertFlagFilter("SUCCESS");
                      }}
                    >
                      SUCCESS LOW
                    </button>
                  ) : null}
                  {flags.elevatedRelayerFailureRate ? (
                    <button
                      className={`rounded border px-2 py-0.5 ${
                        systemAlertFlagFilter === "RELAYER"
                          ? "border-amber-400 bg-amber-800/40 text-amber-100"
                          : "border-amber-600/40 bg-amber-900/30 text-amber-200"
                      }`}
                      onClick={() => {
                        setFilter("System Alert");
                        setSystemAlertFlagFilter("RELAYER");
                      }}
                    >
                      RELAYER FAILURE HIGH
                    </button>
                  ) : null}
                  {flags.elevatedP95ElapsedMs ? (
                    <button
                      className={`rounded border px-2 py-0.5 ${
                        systemAlertFlagFilter === "P95"
                          ? "border-yellow-400 bg-yellow-800/40 text-yellow-100"
                          : "border-yellow-600/40 bg-yellow-900/30 text-yellow-200"
                      }`}
                      onClick={() => {
                        setFilter("System Alert");
                        setSystemAlertFlagFilter("P95");
                      }}
                    >
                      P95 HIGH
                    </button>
                  ) : null}
                  {!flags.degradedSuccessRate && !flags.elevatedRelayerFailureRate && !flags.elevatedP95ElapsedMs ? (
                    <span className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-slate-300">NO FLAG PARSED</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="grid gap-3 md:hidden">
        {!isLoading && pagedTableRows.map((item) => <MobileActivityCard key={`m-${item.id}`} item={item} />)}
      </div>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-4 md:block">
        {isLoading && <p className="text-sm text-slate-400">Loading...</p>}
        {!isLoading && sortedTableRows.length === 0 && <p className="text-sm text-slate-400">No activity yet.</p>}
        {!isLoading && sortedTableRows.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="px-3 py-2 text-xs uppercase tracking-wide text-slate-500">Type</th>
                <th className="px-3 py-2 text-xs uppercase tracking-wide text-slate-500">Source</th>
                <th className="px-3 py-2 text-xs uppercase tracking-wide text-slate-500">Tx</th>
                <th className="px-3 py-2 text-xs uppercase tracking-wide text-slate-500">Position</th>
                <th className="px-3 py-2 text-xs uppercase tracking-wide text-slate-500">Chain</th>
                <th className="px-3 py-2 text-xs uppercase tracking-wide text-slate-500">Timestamp</th>
                <th className="px-3 py-2 text-xs uppercase tracking-wide text-slate-500">Result</th>
                <th className="px-3 py-2 text-xs uppercase tracking-wide text-slate-500">Details</th>
              </tr>
            </thead>
            <tbody>
              {pagedTableRows.map((item) => (
                <tr key={item.id} className="border-t border-slate-800 hover:bg-slate-800">
                  <td className="px-3 py-2 text-sm text-slate-100">{item.type}</td>
                  <td className="px-3 py-2 text-sm text-slate-100">{item.source ?? "-"}</td>
                  <td className="px-3 py-2 text-sm text-slate-300">
                    {item.tx ? (
                      getExplorerTxUrl(item.chainId, item.tx) ? (
                        <a
                          href={getExplorerTxUrl(item.chainId, item.tx) ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-300 underline-offset-2 hover:underline"
                        >
                          {shortTx(item.tx)}
                        </a>
                      ) : (
                        shortTx(item.tx)
                      )
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm text-slate-100">{item.positionId ?? "-"}</td>
                  <td className="px-3 py-2 text-sm text-slate-100">{item.chainId ?? "-"}</td>
                  <td className="px-3 py-2 text-sm text-slate-100">
                    <TimestampWithAge iso={item.createdAt} compact />
                  </td>
                  <td className="px-3 py-2 text-sm text-slate-100">{item.success === false ? "failed" : "success"}</td>
                  <td className="px-3 py-2 text-slate-300">
                    <div className="rounded-lg border border-slate-800 bg-slate-900 p-2">
                      <MetricRow label="explanation" value={item.error ?? item.message} />
                      <MetricRow label="generatedAt" value={<TimestampWithAge iso={item.generatedAt} />} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <DataQualityBadge quality={item.quality} />
                      <FreshnessBadge stale={item.stale} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {!isLoading && sortedTableRows.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
          <p>
            page {tablePage}/{totalPages} ・ showing {pagedTableRows.length} / {sortedTableRows.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={tablePage <= 1}
              onClick={() => setTablePage((prev) => Math.max(1, prev - 1))}
            >
              Prev
            </button>
            <button
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={tablePage >= totalPages}
              onClick={() => setTablePage((prev) => Math.min(totalPages, prev + 1))}
            >
              Next
            </button>
          </div>
        </div>
      )}
      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-4 text-xs text-slate-400">
        <p className="text-sm font-semibold text-slate-100">Audit tag policy</p>
        <p className="mt-2">
          - `EXACT`: chain-confirmed tx events (`Mint/Collect/Rebalance/Approve`) <br />
          - `ESTIMATED`: app-derived summaries <br />
          - `HEURISTIC`: strategy decision/context notes <br />
          - `PLACEHOLDER`: missing integration fields (worker/indexer integration pending)
        </p>
      </div>
      {auditSummary.failed > 0 && (
        <WarningBox
          type="WARNING"
          title="Audit Attention"
          description={`失敗イベントが ${auditSummary.failed} 件あります。Error フィルタで原因を確認してください。`}
          className="mt-6"
        />
      )}
      <RiskDisclosure />
    </section>
  );
}

export default function ActivityPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl px-6 py-8 text-slate-400">Loading...</div>}>
      <ActivityPageContent />
    </Suspense>
  );
}

