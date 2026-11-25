import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  File,
  Folder,
  FolderOpen,
  Search,
  ShieldBan,
  Trash2,
  X,
} from "./PixelIcons";
import {
  CATEGORY_COLORS,
  NodeDto,
  SearchResult,
  SizeUnit,
  SortDir,
  SortField,
  formatBytes,
  formatDate,
  formatNumber,
} from "../types/disk";
import { useI18n } from "../i18n/useI18n";

interface GlobalSearchViewProps {
  scanVersion: number;
  query: string;
  onQueryChange: (q: string) => void;
  sizeUnit: SizeUnit;
  selectedIds: Set<number>;
  onToggleSelect: (node: NodeDto) => void;
  onRequestDelete: (ids: number[], permanent: boolean) => void;
  onRevealInExplorer: (path: string) => void;
  onOpenFile: (path: string) => void;
  onFocusFolder: (dirId: number) => void;
}

const SYNTAX_CHIPS = [
  ">100MB",
  ">1GB",
  "older:1y",
  "*.mp4;*.mkv",
  "*.iso;*.zip",
  "type:archive",
];

export function GlobalSearchView({
  scanVersion,
  query,
  onQueryChange,
  sizeUnit,
  selectedIds,
  onToggleSelect,
  onRequestDelete,
  onRevealInExplorer,
  onOpenFile,
  onFocusFolder,
}: GlobalSearchViewProps) {
  const { t } = useI18n();
  const [sortBy, setSortBy] = useState<SortField>("size");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parentRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResult(null);
      setError(null);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    setError(null);

    const timer = window.setTimeout(async () => {
      try {
        const res = await invoke<SearchResult>("search_global", {
          query: trimmed,
          limit: 1000,
          sortBy,
          sortDir,
        });
        if (!cancelled) {
          setResult(res);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, sortBy, sortDir, scanVersion]);

  const items = result?.items ?? [];

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 34,
    overscan: 15,
  });

  const toggleChip = (chip: string) => {
    const tokens = query.trim().split(/\s+/).filter(Boolean);
    const existsIdx = tokens.findIndex((tok) => tok.toLowerCase() === chip.toLowerCase());
    if (existsIdx >= 0) {
      tokens.splice(existsIdx, 1);
      onQueryChange(tokens.join(" "));
    } else {
      onQueryChange(tokens.length > 0 ? `${tokens.join(" ")} ${chip}` : chip);
    }
    inputRef.current?.focus();
  };

  const handleSortClick = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(field);
      setSortDir(field === "name" ? "asc" : "desc");
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortBy !== field) return null;
    return sortDir === "desc" ? (
      <ArrowDown className="w-3 h-3 inline ml-1 text-sky-400" />
    ) : (
      <ArrowUp className="w-3 h-3 inline ml-1 text-sky-400" />
    );
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search Bar & Chips */}
      <div
        className="px-3 py-2 border-b flex flex-col gap-2 shrink-0"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className="flex items-center flex-1 min-w-[260px] h-8 px-2.5 rounded border gap-2"
            style={{
              backgroundColor: "var(--bg-elevated)",
              borderColor: "var(--border-strong)",
            }}
          >
            <Search className="w-3.5 h-3.5 shrink-0 text-sky-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={t.globalSearchPlaceholder}
              className="flex-1 bg-transparent outline-none text-[12px] font-mono-num"
              style={{ color: "var(--text-primary)" }}
            />
            {query && (
              <button
                type="button"
                onClick={() => onQueryChange("")}
                className="p-0.5 rounded hover:bg-white/10 cursor-pointer"
                style={{ color: "var(--text-muted)" }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Live Stats */}
          {result && (
            <div className="flex items-center gap-3 text-[11px] font-mono-num shrink-0">
              <span style={{ color: "var(--text-secondary)" }}>
                {t.searchMatches}:{" "}
                <strong className="text-sky-400">{formatNumber(result.totalMatches)}</strong>
                {result.totalMatches > result.items.length
                  ? ` (top ${formatNumber(result.items.length)})`
                  : ""}
              </span>
              <span style={{ color: "var(--text-secondary)" }}>
                {t.searchTotalSize}:{" "}
                <strong className="text-emerald-400">
                  {formatBytes(result.totalMatchedBytes, sizeUnit)}
                </strong>
              </span>
              <span
                className="px-1.5 py-0.5 rounded border"
                style={{
                  borderColor: "var(--border-subtle)",
                  backgroundColor: "var(--bg-elevated)",
                  color: "var(--text-muted)",
                }}
              >
                {result.elapsedMs} ms
              </span>
            </div>
          )}
          {isSearching && (
            <span className="text-[11px] text-sky-400 font-mono-num">{t.loading}</span>
          )}
        </div>

        {/* Syntax Chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {SYNTAX_CHIPS.map((chip) => {
            const active = query
              .toLowerCase()
              .split(/\s+/)
              .includes(chip.toLowerCase());
            return (
              <button
                key={chip}
                type="button"
                onClick={() => toggleChip(chip)}
                className="h-6 px-2 rounded border text-[11px] font-mono-num cursor-pointer transition-colors"
                style={{
                  backgroundColor: active ? "var(--bg-selected)" : "var(--bg-elevated)",
                  borderColor: active ? "var(--accent)" : "var(--border-subtle)",
                  color: active ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                {chip}
              </button>
            );
          })}
          <span
            className="text-[11px] ml-auto hidden lg:inline"
            style={{ color: "var(--text-muted)" }}
          >
            {t.globalSearchHint}
          </span>
        </div>
      </div>

      {/* Table Header */}
      <div
        className="grid items-center px-3 py-2 border-b text-[11px] font-semibold uppercase tracking-wider shrink-0"
        style={{
          gridTemplateColumns: "32px 230px 1fr 110px 100px 135px 96px",
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
          color: "var(--text-muted)",
        }}
      >
        <div />
        <button
          type="button"
          onClick={() => handleSortClick("name")}
          className="text-left cursor-pointer hover:text-sky-400"
        >
          {t.colName}
          {renderSortIcon("name")}
        </button>
        <div>{t.colPath}</div>
        <button
          type="button"
          onClick={() => handleSortClick("size")}
          className="text-right cursor-pointer hover:text-sky-400"
        >
          {t.colSize}
          {renderSortIcon("size")}
        </button>
        <button
          type="button"
          onClick={() => handleSortClick("allocated")}
          className="text-right cursor-pointer hover:text-sky-400"
        >
          {t.colAllocated}
          {renderSortIcon("allocated")}
        </button>
        <button
          type="button"
          onClick={() => handleSortClick("modified")}
          className="text-right cursor-pointer hover:text-sky-400"
        >
          {t.colModified}
          {renderSortIcon("modified")}
        </button>
        <div className="text-right">{t.colActions}</div>
      </div>

      {/* Results Body */}
      <div ref={parentRef} className="flex-1 overflow-y-auto overflow-x-auto relative">
        {error ? (
          <div className="h-full flex items-center justify-center text-[13px] text-rose-400 px-4">
            {error}
          </div>
        ) : !query.trim() ? (
          <div
            className="h-full flex flex-col items-center justify-center gap-2 text-[13px] px-4 text-center"
            style={{ color: "var(--text-muted)" }}
          >
            <Search className="w-7 h-7 opacity-40" />
            <span>{t.searchEmptyPrompt}</span>
          </div>
        ) : items.length === 0 && !isSearching ? (
          <div
            className="h-full flex items-center justify-center text-[13px]"
            style={{ color: "var(--text-muted)" }}
          >
            {t.noMatches}
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
              minWidth: "940px",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const node = items[vRow.index];
              const isSelected = selectedIds.has(node.id);
              const catColor = CATEGORY_COLORS[node.category];

              return (
                <div
                  key={node.id}
                  onDoubleClick={() => {
                    if (node.isDir) {
                      onFocusFolder(node.id);
                    } else {
                      onOpenFile(node.fullPath);
                    }
                  }}
                  className="group grid items-center px-3 border-b text-[12px] hover:bg-white/[0.03]"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${vRow.size}px`,
                    transform: `translateY(${vRow.start}px)`,
                    gridTemplateColumns: "32px 230px 1fr 110px 100px 135px 96px",
                    borderColor: "var(--border-subtle)",
                    backgroundColor: isSelected ? "var(--bg-selected)" : "transparent",
                  }}
                >
                  <div className="flex items-center justify-center">
                    {node.safetyLevel === "blocked" ? (
                      <span title={t.protectedLabel}>
                        <ShieldBan className="w-3.5 h-3.5 text-rose-400/70" />
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect(node)}
                        className="w-3.5 h-3.5 accent-sky-500 cursor-pointer"
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-2 min-w-0 pr-2">
                    {node.isDir ? (
                      <Folder className="w-3.5 h-3.5 shrink-0 text-amber-400 fill-amber-400/20" />
                    ) : (
                      <>
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: catColor }}
                        />
                        <File className="w-3.5 h-3.5 shrink-0 text-sky-400" />
                      </>
                    )}
                    <span className="truncate font-medium" title={node.name}>
                      {node.name}
                    </span>
                  </div>

                  <div
                    className="truncate font-mono-num text-[11px] pr-3"
                    style={{ color: "var(--text-muted)" }}
                    title={node.fullPath}
                  >
                    {node.fullPath}
                  </div>

                  <div className="text-right font-mono-num font-semibold">
                    {formatBytes(node.logicalSize, sizeUnit)}
                  </div>

                  <div
                    className="text-right font-mono-num text-[11px]"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {formatBytes(node.allocatedSize, sizeUnit)}
                  </div>

                  <div
                    className="text-right font-mono-num text-[11px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {formatDate(node.modifiedTs)}
                  </div>

                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!node.isDir && (
                      <button
                        type="button"
                        onClick={() => onOpenFile(node.fullPath)}
                        className="p-1 rounded hover:bg-white/10 cursor-pointer"
                        style={{ color: "var(--text-secondary)" }}
                        title={t.openFile}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onRevealInExplorer(node.fullPath)}
                      className="p-1 rounded hover:bg-white/10 cursor-pointer"
                      style={{ color: "var(--text-secondary)" }}
                      title={t.revealExplorer}
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                    {node.safetyLevel !== "blocked" && (
                      <button
                        type="button"
                        onClick={() => onRequestDelete([node.id], false)}
                        className="p-1 rounded hover:bg-amber-500/20 text-amber-400 cursor-pointer"
                        title={t.moveToTrash}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
