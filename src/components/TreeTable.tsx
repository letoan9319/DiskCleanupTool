import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  File,
  Flame,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Info,
  MoveRight,
  Pencil,
  ShieldBan,
  Terminal,
  Trash2,
  X,
} from "./PixelIcons";
import {
  BreadcrumbItem,
  ChildrenPage,
  DisplayMode,
  ExpandedTreeEntry,
  NodeDto,
  SizeUnit,
  SortDir,
  SortField,
  formatBytes,
  formatDate,
  formatNumber,
} from "../types/disk";
import { useI18n } from "../i18n/useI18n";

interface FlatTreeRow {
  node: NodeDto;
  depth: number;
  expanded: boolean;
  parentKey: number;
}

interface TreeTableProps {
  rootId: number;
  focusId: number;
  onFocusChange: (id: number) => void;
  onBreadcrumbsChange?: (crumbs: BreadcrumbItem[]) => void;
  activeRowId: number | null;
  onActiveRowChange: (id: number | null) => void;
  scanVersion: number;
  searchQuery: string;
  displayMode: DisplayMode;
  sizeUnit: SizeUnit;
  expandRequest: { level: number; seq: number } | null;
  selectedIds: Set<number>;
  onToggleSelect: (node: NodeDto) => void;
  onRequestDelete: (ids: number[], permanent: boolean) => void;
  onRevealInExplorer: (path: string) => void;
  onOpenFile: (path: string) => void;
  onOpenTerminal: (path: string) => void;
  onShowProperties: (path: string) => void;
  onCopyPath: (path: string) => void;
  onMoveNodes: (nodeIds: number[]) => void;
  onRenameNode: (node: NodeDto, newName: string) => Promise<void>;
  onCreateFolder: (parentId: number, name: string) => Promise<void>;
}

const GRID_TEMPLATE =
  "32px minmax(240px, 1fr) 144px 104px 96px 76px 76px 128px 76px";

export function TreeTable({
  rootId,
  focusId,
  onFocusChange,
  onBreadcrumbsChange,
  activeRowId,
  onActiveRowChange,
  scanVersion,
  searchQuery,
  displayMode,
  sizeUnit,
  expandRequest,
  selectedIds,
  onToggleSelect,
  onRequestDelete,
  onRevealInExplorer,
  onOpenFile,
  onOpenTerminal,
  onShowProperties,
  onCopyPath,
  onMoveNodes,
  onRenameNode,
  onCreateFolder,
}: TreeTableProps) {
  const { t } = useI18n();
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
  const [sortBy, setSortBy] = useState<SortField>("size");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [childrenCache, setChildrenCache] = useState<Map<number, NodeDto[]>>(new Map());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: NodeDto;
  } | null>(null);
  const [promptModal, setPromptModal] = useState<
    | { kind: "rename"; node: NodeDto; value: string }
    | { kind: "new_folder"; parentId: number; parentPath: string; value: string }
    | null
  >(null);
  const [promptBusy, setPromptBusy] = useState(false);

  const parentRef = useRef<HTMLDivElement | null>(null);
  const prevRootRef = useRef<number>(rootId);
  const lastExpandSeqRef = useRef<number>(0);

  // Sync primary sort column when displayMode changes
  useEffect(() => {
    if (displayMode === "size" || displayMode === "percent") {
      setSortBy("size");
      setSortDir("desc");
    } else if (displayMode === "allocated") {
      setSortBy("allocated");
      setSortDir("desc");
    } else if (displayMode === "files") {
      setSortBy("files");
      setSortDir("desc");
    }
  }, [displayMode]);

  const loadChildren = useCallback(
    async (parentId: number) => {
      const page = await invoke<ChildrenPage>("get_node_children", {
        nodeId: parentId,
        offset: 0,
        limit: 1500,
        sortBy,
        sortDir,
        searchQuery,
      });
      setChildrenCache((prev) => {
        const next = new Map(prev);
        next.set(parentId, page.items);
        return next;
      });
    },
    [sortBy, sortDir, searchQuery]
  );

  // Reset expansions when a brand new root scan happens
  useEffect(() => {
    if (prevRootRef.current !== rootId) {
      prevRootRef.current = rootId;
      setExpandedIds(new Set());
      setChildrenCache(new Map());
    }
  }, [rootId]);

  // Clear expansions when focus changes
  useEffect(() => {
    setExpandedIds(new Set());
  }, [focusId]);

  // Load focused directory + breadcrumbs + any expanded dirs
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [page, crumbs] = await Promise.all([
        invoke<ChildrenPage>("get_node_children", {
          nodeId: focusId,
          offset: 0,
          limit: 1500,
          sortBy,
          sortDir,
          searchQuery,
        }),
        invoke<BreadcrumbItem[]>("get_node_ancestors", { nodeId: focusId }),
      ]);
      if (cancelled) return;
      setBreadcrumbs(crumbs);
      onBreadcrumbsChange?.(crumbs);

      const nextCache = new Map<number, NodeDto[]>();
      nextCache.set(focusId, page.items);

      const expandedList = Array.from(expandedIds);
      if (expandedList.length > 0) {
        await Promise.all(
          expandedList.map(async (eid) => {
            try {
              const p = await invoke<ChildrenPage>("get_node_children", {
                nodeId: eid,
                offset: 0,
                limit: 1000,
                sortBy,
                sortDir,
                searchQuery,
              });
              nextCache.set(eid, p.items);
            } catch {
              // ignore deleted expanded node
            }
          })
        );
      }

      if (!cancelled) {
        setChildrenCache(nextCache);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [focusId, scanVersion, sortBy, sortDir, searchQuery]);

  // Handle Expand Level requests from ViewControlBar (Lv 1 / Lv 2 / Lv 3 / Collapse)
  useEffect(() => {
    if (!expandRequest || expandRequest.seq === lastExpandSeqRef.current) return;
    lastExpandSeqRef.current = expandRequest.seq;

    let cancelled = false;
    (async () => {
      if (expandRequest.level <= 0) {
        setExpandedIds(new Set());
        await loadChildren(focusId);
        return;
      }

      try {
        const entries = await invoke<ExpandedTreeEntry[]>("get_expanded_tree", {
          rootId: focusId,
          maxDepth: expandRequest.level,
          sortBy,
          sortDir,
          limitPerDir: 300,
        });
        if (cancelled) return;

        const nextCache = new Map<number, NodeDto[]>();
        const nextExpanded = new Set<number>();

        for (const entry of entries) {
          if (entry.node.id === focusId) continue;
          const parentKey = entry.node.parentId ?? focusId;
          const list = nextCache.get(parentKey);
          if (list) {
            list.push(entry.node);
          } else {
            nextCache.set(parentKey, [entry.node]);
          }
          if (entry.hasExpandedChildren) {
            nextExpanded.add(entry.node.id);
          }
        }

        if (!nextCache.has(focusId)) {
          const page = await invoke<ChildrenPage>("get_node_children", {
            nodeId: focusId,
            offset: 0,
            limit: 1500,
            sortBy,
            sortDir,
            searchQuery,
          });
          if (cancelled) return;
          nextCache.set(focusId, page.items);
        }

        setChildrenCache(nextCache);
        setExpandedIds(nextExpanded);
      } catch {
        // Fallback to simple children load
        if (!cancelled) {
          await loadChildren(focusId);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [expandRequest, focusId, sortBy, sortDir, searchQuery, loadChildren]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  const toggleExpand = useCallback(
    async (node: NodeDto) => {
      if (!node.isDir || !node.hasChildren) return;
      const isExpanded = expandedIds.has(node.id);
      if (isExpanded) {
        setExpandedIds((prev) => {
          const next = new Set(prev);
          next.delete(node.id);
          return next;
        });
      } else {
        if (!childrenCache.has(node.id)) {
          await loadChildren(node.id);
        }
        setExpandedIds((prev) => {
          const next = new Set(prev);
          next.add(node.id);
          return next;
        });
      }
    },
    [expandedIds, childrenCache, loadChildren]
  );

  // Precompute sibling totals per parent for allocated & files display modes
  const siblingTotals = useMemo(() => {
    const map = new Map<number, { allocated: number; files: number }>();
    for (const [parentKey, items] of childrenCache.entries()) {
      let allocated = 0;
      let files = 0;
      for (const it of items) {
        allocated += it.allocatedSize;
        files += it.isDir ? it.fileCount : 1;
      }
      map.set(parentKey, { allocated, files });
    }
    return map;
  }, [childrenCache]);

  const flatRows = useMemo<FlatTreeRow[]>(() => {
    const out: FlatTreeRow[] = [];
    const visited = new Set<number>();

    const walk = (parentId: number, depth: number) => {
      const items = childrenCache.get(parentId);
      if (!items) return;
      for (const node of items) {
        if (visited.has(node.id)) continue;
        visited.add(node.id);
        const expanded = node.isDir && expandedIds.has(node.id);
        out.push({ node, depth, expanded, parentKey: parentId });
        if (expanded) {
          walk(node.id, depth + 1);
        }
      }
    };

    walk(focusId, 0);
    return out;
  }, [childrenCache, expandedIds, focusId]);

  const rowVirtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 16,
  });

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (promptModal) return;
    if (flatRows.length === 0) return;
    const currentIdx = flatRows.findIndex((r) => r.node.id === activeRowId);
    const curRow = currentIdx >= 0 ? flatRows[currentIdx] : null;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIdx = Math.min(flatRows.length - 1, currentIdx + 1);
      onActiveRowChange(flatRows[nextIdx].node.id);
      rowVirtualizer.scrollToIndex(nextIdx);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIdx = Math.max(0, currentIdx <= 0 ? 0 : currentIdx - 1);
      onActiveRowChange(flatRows[prevIdx].node.id);
      rowVirtualizer.scrollToIndex(prevIdx);
    } else if (e.key === "ArrowRight" && curRow?.node.isDir && !curRow.expanded) {
      e.preventDefault();
      void toggleExpand(curRow.node);
    } else if (e.key === "ArrowLeft" && curRow?.node.isDir && curRow.expanded) {
      e.preventDefault();
      void toggleExpand(curRow.node);
    } else if (e.key === " " && curRow) {
      e.preventDefault();
      if (curRow.node.safetyLevel !== "blocked") {
        onToggleSelect(curRow.node);
      }
    } else if (e.key === "Delete" && curRow) {
      e.preventDefault();
      const targets =
        selectedIds.size > 0 ? Array.from(selectedIds) : [curRow.node.id];
      onRequestDelete(targets, e.shiftKey);
    } else if (e.key === "F2" && curRow && curRow.node.safetyLevel !== "blocked") {
      e.preventDefault();
      setPromptModal({
        kind: "rename",
        node: curRow.node,
        value: curRow.node.name,
      });
    }
  };

  const submitPrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promptModal) return;
    const trimmed = promptModal.value.trim();
    if (!trimmed) return;

    setPromptBusy(true);
    try {
      if (promptModal.kind === "rename") {
        if (trimmed !== promptModal.node.name) {
          await onRenameNode(promptModal.node, trimmed);
        }
      } else {
        await onCreateFolder(promptModal.parentId, trimmed);
      }
      setPromptModal(null);
    } finally {
      setPromptBusy(false);
    }
  };

  const computeRowMetricPct = (row: FlatTreeRow): number => {
    if (displayMode === "allocated") {
      const tot = siblingTotals.get(row.parentKey)?.allocated ?? 0;
      return tot > 0 ? Math.min(100, (row.node.allocatedSize / tot) * 100) : 0;
    }
    if (displayMode === "files") {
      const tot = siblingTotals.get(row.parentKey)?.files ?? 0;
      const val = row.node.isDir ? row.node.fileCount : 1;
      return tot > 0 ? Math.min(100, (val / tot) * 100) : 0;
    }
    return Math.max(0, Math.min(100, row.node.percentOfParent));
  };

  return (
    <div
      className="flex flex-col flex-1 min-h-0 outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Breadcrumb bar */}
      {breadcrumbs.length > 0 && (
        <div
          className="px-3 py-1 border-b flex items-center gap-1 text-[12px] overflow-x-auto shrink-0"
          style={{
            backgroundColor: "var(--bg-panel)",
            borderColor: "var(--border-subtle)",
          }}
        >
          {breadcrumbs.map((crumb, idx) => (
            <React.Fragment key={crumb.id}>
              {idx > 0 && (
                <ChevronRight
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: "var(--text-muted)" }}
                />
              )}
              <button
                type="button"
                onClick={() => onFocusChange(crumb.id)}
                className={`px-1.5 py-0.5 rounded hover:underline cursor-pointer shrink-0 font-mono-num ${
                  idx === breadcrumbs.length - 1 ? "font-semibold text-sky-400" : ""
                }`}
                style={{
                  color:
                    idx === breadcrumbs.length - 1
                      ? "var(--accent)"
                      : "var(--text-secondary)",
                }}
              >
                {crumb.name}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Table Header */}
      <div
        className="grid items-center px-3 py-1.5 border-b text-[11px] font-semibold uppercase tracking-wider shrink-0"
        style={{
          gridTemplateColumns: GRID_TEMPLATE,
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
        <div className="text-left pl-2">{t.colShare}</div>
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
          onClick={() => handleSortClick("files")}
          className="text-right cursor-pointer hover:text-sky-400"
        >
          {t.colFiles}
          {renderSortIcon("files")}
        </button>
        <button
          type="button"
          onClick={() => handleSortClick("folders")}
          className="text-right cursor-pointer hover:text-sky-400"
        >
          {t.colFolders}
          {renderSortIcon("folders")}
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

      {/* Virtualized Rows */}
      <div ref={parentRef} className="flex-1 overflow-y-auto overflow-x-auto relative">
        {flatRows.length === 0 ? (
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
              minWidth: "990px",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const row = flatRows[vRow.index];
              const { node, depth, expanded } = row;
              const isSelected = selectedIds.has(node.id);
              const isActive = activeRowId === node.id;
              const pct = computeRowMetricPct(row);

              return (
                <div
                  key={node.id}
                  onClick={() => onActiveRowChange(node.id)}
                  onDoubleClick={() => {
                    if (node.isDir) {
                      onFocusChange(node.id);
                    } else {
                      onOpenFile(node.fullPath);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onActiveRowChange(node.id);
                    setContextMenu({ x: e.clientX, y: e.clientY, node });
                  }}
                  className="group grid items-center px-3 border-b text-[12px] transition-colors duration-75"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${vRow.size}px`,
                    transform: `translateY(${vRow.start}px)`,
                    gridTemplateColumns: GRID_TEMPLATE,
                    borderColor: "var(--border-subtle)",
                    backgroundColor: isSelected
                      ? "var(--bg-selected)"
                      : isActive
                      ? "var(--bg-hover)"
                      : "transparent",
                    borderLeft: isSelected
                      ? "2px solid var(--accent)"
                      : "2px solid transparent",
                  }}
                >
                  {/* Checkbox */}
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
                        onClick={(e) => e.stopPropagation()}
                        className="w-3.5 h-3.5 accent-sky-500 cursor-pointer"
                      />
                    )}
                  </div>

                  {/* Tree Name */}
                  <div
                    className="flex items-center gap-1.5 min-w-0 pr-2"
                    style={{ paddingLeft: `${depth * 18}px` }}
                  >
                    {node.isDir && node.hasChildren ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleExpand(node);
                        }}
                        className="w-4 h-4 flex items-center justify-center rounded hover:bg-white/10 cursor-pointer shrink-0"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {expanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}

                    {node.isDir ? (
                      <Folder className="w-4 h-4 shrink-0 text-amber-400 fill-amber-400/20" />
                    ) : (
                      <File className="w-3.5 h-3.5 shrink-0 text-sky-400" />
                    )}

                    <span className="truncate font-medium" title={node.fullPath}>
                      {node.name}
                    </span>
                  </div>

                  {/* Proportional Bar */}
                  <div className="flex items-center gap-2 pl-2 pr-3">
                    <div
                      className="flex-1 h-2 rounded-sm overflow-hidden"
                      style={{ backgroundColor: "var(--bar-track)" }}
                    >
                      <div
                        className="h-full rounded-sm"
                        style={{
                          width: `${Math.max(pct > 0 ? 1.5 : 0, pct)}%`,
                          backgroundColor:
                            pct >= 50
                              ? "var(--warning)"
                              : pct >= 20
                              ? "var(--accent)"
                              : "var(--success)",
                        }}
                      />
                    </div>
                    <span
                      className="font-mono-num text-[11px] w-11 text-right shrink-0"
                      style={{
                        color:
                          displayMode === "percent"
                            ? "var(--accent)"
                            : "var(--text-secondary)",
                        fontWeight: displayMode === "percent" ? 600 : 400,
                      }}
                    >
                      {pct.toFixed(1)}%
                    </span>
                  </div>

                  {/* Size */}
                  <div
                    className="text-right font-mono-num font-semibold"
                    style={{
                      color:
                        displayMode === "size"
                          ? "var(--text-primary)"
                          : "var(--text-secondary)",
                    }}
                    title={formatBytes(node.logicalSize, sizeUnit)}
                  >
                    {displayMode === "percent"
                      ? `${node.percentOfRoot.toFixed(1)}%`
                      : formatBytes(node.logicalSize, sizeUnit)}
                  </div>

                  {/* Allocated */}
                  <div
                    className="text-right font-mono-num text-[11px]"
                    style={{
                      color:
                        displayMode === "allocated"
                          ? "var(--accent)"
                          : "var(--text-secondary)",
                      fontWeight: displayMode === "allocated" ? 600 : 400,
                    }}
                  >
                    {formatBytes(node.allocatedSize, sizeUnit)}
                  </div>

                  {/* Files */}
                  <div
                    className="text-right font-mono-num text-[11px]"
                    style={{
                      color:
                        displayMode === "files"
                          ? "var(--accent)"
                          : "var(--text-secondary)",
                      fontWeight: displayMode === "files" ? 600 : 400,
                    }}
                  >
                    {node.isDir ? formatNumber(node.fileCount) : "—"}
                  </div>

                  {/* Folders */}
                  <div
                    className="text-right font-mono-num text-[11px]"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {node.isDir ? formatNumber(node.dirCount) : "—"}
                  </div>

                  {/* Modified */}
                  <div
                    className="text-right font-mono-num text-[11px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {formatDate(node.modifiedTs)}
                  </div>

                  {/* Hover Quick Actions */}
                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRevealInExplorer(node.fullPath);
                      }}
                      className="p-1 rounded hover:bg-white/10 cursor-pointer"
                      style={{ color: "var(--text-secondary)" }}
                      title={t.revealExplorer}
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                    {node.safetyLevel !== "blocked" && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRequestDelete([node.id], false);
                        }}
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

      {/* Expanded Right-Click Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[220px] py-1 rounded-md border shadow-xl text-[12px]"
          style={{
            top: Math.min(contextMenu.y, window.innerHeight - 360),
            left: Math.min(contextMenu.x, window.innerWidth - 240),
            backgroundColor: "var(--bg-panel)",
            borderColor: "var(--border-strong)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {!contextMenu.node.isDir && (
            <button
              type="button"
              onClick={() => {
                onOpenFile(contextMenu.node.fullPath);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-white/10 text-left cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5 text-sky-400" />
              <span>{t.openFile}</span>
            </button>
          )}
          {contextMenu.node.isDir && (
            <button
              type="button"
              onClick={() => {
                onFocusChange(contextMenu.node.id);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-white/10 text-left cursor-pointer"
            >
              <FolderInput className="w-3.5 h-3.5 text-sky-400" />
              <span>{t.zoomFolder}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onRevealInExplorer(contextMenu.node.fullPath);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-white/10 text-left cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
            <span>{t.revealExplorer}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenTerminal(contextMenu.node.fullPath);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-white/10 text-left cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span>{t.openTerminal}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onCopyPath(contextMenu.node.fullPath);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-white/10 text-left cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" style={{ color: "var(--text-secondary)" }} />
            <span>{t.copyPath}</span>
          </button>

          <div className="my-1 border-t" style={{ borderColor: "var(--border-subtle)" }} />

          <button
            type="button"
            onClick={() => {
              const targetParentId = contextMenu.node.isDir
                ? contextMenu.node.id
                : contextMenu.node.parentId ?? focusId;
              const targetParentPath = contextMenu.node.isDir
                ? contextMenu.node.fullPath
                : breadcrumbs[breadcrumbs.length - 1]?.fullPath ?? contextMenu.node.fullPath;
              setPromptModal({
                kind: "new_folder",
                parentId: targetParentId,
                parentPath: targetParentPath,
                value: "",
              });
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-white/10 text-left cursor-pointer"
          >
            <FolderPlus className="w-3.5 h-3.5 text-sky-400" />
            <span>{t.newFolder}</span>
          </button>

          {contextMenu.node.safetyLevel !== "blocked" && (
            <>
              <button
                type="button"
                onClick={() => {
                  setPromptModal({
                    kind: "rename",
                    node: contextMenu.node,
                    value: contextMenu.node.name,
                  });
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-white/10 text-left cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" style={{ color: "var(--text-secondary)" }} />
                <span>{t.renameItem}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const ids =
                    selectedIds.has(contextMenu.node.id) && selectedIds.size > 1
                      ? Array.from(selectedIds)
                      : [contextMenu.node.id];
                  onMoveNodes(ids);
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-white/10 text-left cursor-pointer"
              >
                <MoveRight className="w-3.5 h-3.5" style={{ color: "var(--text-secondary)" }} />
                <span>{t.moveToFolder}</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              onShowProperties(contextMenu.node.fullPath);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-white/10 text-left cursor-pointer"
          >
            <Info className="w-3.5 h-3.5" style={{ color: "var(--text-secondary)" }} />
            <span>{t.properties}</span>
          </button>

          {contextMenu.node.safetyLevel !== "blocked" && (
            <>
              <div
                className="my-1 border-t"
                style={{ borderColor: "var(--border-subtle)" }}
              />
              <button
                type="button"
                onClick={() => {
                  onRequestDelete([contextMenu.node.id], false);
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-amber-500/15 text-amber-400 text-left cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t.moveToTrash}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onRequestDelete([contextMenu.node.id], true);
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-rose-500/15 text-rose-400 text-left cursor-pointer"
              >
                <Flame className="w-3.5 h-3.5" />
                <span>{t.deletePermanently}</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Inline Rename / New Folder Modal Prompt */}
      {promptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={submitPrompt}
            className="w-full max-w-md rounded-lg border shadow-2xl overflow-hidden"
            style={{
              backgroundColor: "var(--bg-panel)",
              borderColor: "var(--border-strong)",
            }}
          >
            <div
              className="px-4 py-2.5 border-b flex items-center justify-between"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <h3 className="font-semibold text-[14px]">
                {promptModal.kind === "rename" ? t.renamePrompt : t.newFolder}
              </h3>
              <button
                type="button"
                onClick={() => setPromptModal(null)}
                className="p-1 rounded hover:opacity-75 cursor-pointer"
                style={{ color: "var(--text-muted)" }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-2.5">
              <div
                className="text-[11px] font-mono-num truncate"
                style={{ color: "var(--text-muted)" }}
                title={
                  promptModal.kind === "rename"
                    ? promptModal.node.fullPath
                    : promptModal.parentPath
                }
              >
                {promptModal.kind === "rename"
                  ? promptModal.node.fullPath
                  : `${t.newFolderPrompt}: ${promptModal.parentPath}`}
              </div>
              <input
                type="text"
                autoFocus
                value={promptModal.value}
                onChange={(e) =>
                  setPromptModal((prev) =>
                    prev ? { ...prev, value: e.target.value } : null
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Escape") setPromptModal(null);
                }}
                className="h-9 px-3 rounded border text-[13px] font-mono-num outline-none"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  borderColor: "var(--accent)",
                  color: "var(--text-primary)",
                }}
              />
            </div>
            <div
              className="px-4 py-2.5 border-t flex items-center justify-end gap-2"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <button
                type="button"
                disabled={promptBusy}
                onClick={() => setPromptModal(null)}
                className="h-8 px-3 rounded border text-[12px] cursor-pointer"
                style={{
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={promptBusy || !promptModal.value.trim()}
                className="h-8 px-4 rounded text-[12px] font-medium text-white cursor-pointer disabled:opacity-45"
                style={{ backgroundColor: "var(--accent-strong)" }}
              >
                {promptModal.kind === "rename" ? t.renameBtn : t.createBtn}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
