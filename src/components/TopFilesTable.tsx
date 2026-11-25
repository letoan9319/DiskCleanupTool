import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, File, FolderOpen, ShieldBan, Trash2 } from "./PixelIcons";
import {
  CATEGORY_COLORS,
  FileCategory,
  NodeDto,
  SizeUnit,
  formatBytes,
  formatDate,
} from "../types/disk";
import { useI18n } from "../i18n/useI18n";

interface TopFilesTableProps {
  scanVersion: number;
  searchQuery: string;
  sizeUnit: SizeUnit;
  selectedIds: Set<number>;
  initialCategory?: FileCategory | null;
  onToggleSelect: (node: NodeDto) => void;
  onRequestDelete: (ids: number[], permanent: boolean) => void;
  onRevealInExplorer: (path: string) => void;
  onOpenFile: (path: string) => void;
}

const SIZE_FILTERS: { labelKey?: "allSizes"; label?: string; bytes: number }[] = [
  { labelKey: "allSizes", bytes: 0 },
  { label: "> 50 MB", bytes: 50 * 1024 * 1024 },
  { label: "> 100 MB", bytes: 100 * 1024 * 1024 },
  { label: "> 500 MB", bytes: 500 * 1024 * 1024 },
  { label: "> 1 GB", bytes: 1024 * 1024 * 1024 },
];

export function TopFilesTable({
  scanVersion,
  searchQuery,
  sizeUnit,
  selectedIds,
  initialCategory = null,
  onToggleSelect,
  onRequestDelete,
  onRevealInExplorer,
  onOpenFile,
}: TopFilesTableProps) {
  const { t } = useI18n();
  const [files, setFiles] = useState<NodeDto[]>([]);
  const [minSizeBytes, setMinSizeBytes] = useState<number>(0);
  const [extFilter, setExtFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<FileCategory | null>(
    initialCategory
  );
  const parentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCategoryFilter(initialCategory ?? null);
  }, [initialCategory]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const items = await invoke<NodeDto[]>("get_top_largest_files", {
        limit: 500,
        minSizeBytes,
        extFilter: extFilter.trim() || null,
        categoryFilter: categoryFilter || null,
        searchQuery,
      });
      if (!cancelled) setFiles(items);
    })();
    return () => {
      cancelled = true;
    };
  }, [scanVersion, minSizeBytes, extFilter, categoryFilter, searchQuery]);

  const rowVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 34,
    overscan: 15,
  });

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Filter Bar */}
      <div
        className="px-3 py-2 border-b flex items-center gap-2 flex-wrap shrink-0 text-[12px]"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <span style={{ color: "var(--text-muted)" }}>{t.minSize}:</span>
        {SIZE_FILTERS.map((sf) => {
          const active = minSizeBytes === sf.bytes;
          return (
            <button
              key={sf.bytes}
              type="button"
              onClick={() => setMinSizeBytes(sf.bytes)}
              className="h-7 px-2.5 rounded border text-[11px] font-medium cursor-pointer"
              style={{
                backgroundColor: active ? "var(--bg-selected)" : "var(--bg-elevated)",
                borderColor: active ? "var(--accent)" : "var(--border-subtle)",
                color: active ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              {sf.labelKey ? t.allSizes : sf.label}
            </button>
          );
        })}

        <select
          value={categoryFilter ?? ""}
          onChange={(e) =>
            setCategoryFilter((e.target.value || null) as FileCategory | null)
          }
          className="h-7 px-2 rounded border text-[11px] outline-none ml-2"
          style={{
            backgroundColor: "var(--bg-elevated)",
            borderColor: "var(--border-subtle)",
            color: "var(--text-primary)",
          }}
        >
          <option value="">{t.allCategories}</option>
          <option value="video">{t.cat_video}</option>
          <option value="archive">{t.cat_archive}</option>
          <option value="installer">{t.cat_installer}</option>
          <option value="image">{t.cat_image}</option>
          <option value="audio">{t.cat_audio}</option>
          <option value="document">{t.cat_document}</option>
          <option value="code_db">{t.cat_code_db}</option>
          <option value="other">{t.cat_other}</option>
        </select>

        <input
          type="text"
          value={extFilter}
          onChange={(e) => setExtFilter(e.target.value)}
          placeholder={t.extensionFilter}
          className="h-7 w-36 px-2 rounded border text-[11px] outline-none font-mono-num"
          style={{
            backgroundColor: "var(--bg-elevated)",
            borderColor: "var(--border-subtle)",
            color: "var(--text-primary)",
          }}
        />

        <span
          className="ml-auto font-mono-num text-[11px]"
          style={{ color: "var(--text-muted)" }}
        >
          Top {files.length}
        </span>
      </div>

      {/* Table Header */}
      <div
        className="grid items-center px-3 py-2 border-b text-[11px] font-semibold uppercase tracking-wider shrink-0"
        style={{
          gridTemplateColumns: "32px 220px 1fr 110px 100px 135px 96px",
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
          color: "var(--text-muted)",
        }}
      >
        <div />
        <div>{t.colName}</div>
        <div>{t.colPath}</div>
        <div className="text-right">{t.colSize}</div>
        <div className="text-right">{t.colAllocated}</div>
        <div className="text-right">{t.colModified}</div>
        <div className="text-right">{t.colActions}</div>
      </div>

      {/* Rows */}
      <div ref={parentRef} className="flex-1 overflow-y-auto overflow-x-auto relative">
        {files.length === 0 ? (
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
              minWidth: "920px",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const node = files[vRow.index];
              const isSelected = selectedIds.has(node.id);
              const catColor = CATEGORY_COLORS[node.category];

              return (
                <div
                  key={node.id}
                  onDoubleClick={() => onOpenFile(node.fullPath)}
                  className="group grid items-center px-3 border-b text-[12px] hover:bg-white/[0.03]"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${vRow.size}px`,
                    transform: `translateY(${vRow.start}px)`,
                    gridTemplateColumns: "32px 220px 1fr 110px 100px 135px 96px",
                    borderColor: "var(--border-subtle)",
                    backgroundColor: isSelected ? "var(--bg-selected)" : "transparent",
                  }}
                >
                  <div className="flex items-center justify-center">
                    {node.safetyLevel === "blocked" ? (
                      <ShieldBan className="w-3.5 h-3.5 text-rose-400/70" />
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
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: catColor }}
                    />
                    <File className="w-3.5 h-3.5 shrink-0 text-sky-400" />
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
                    <button
                      type="button"
                      onClick={() => onOpenFile(node.fullPath)}
                      className="p-1 rounded hover:bg-white/10 cursor-pointer"
                      style={{ color: "var(--text-secondary)" }}
                      title={t.openFile}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
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
