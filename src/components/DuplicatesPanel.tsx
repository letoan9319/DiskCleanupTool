import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CheckCircle2,
  CopyCheck,
  ExternalLink,
  File,
  FolderOpen,
  Play,
  ShieldBan,
  Square,
  Trash2,
} from "lucide-react";
import {
  DuplicateFile,
  DuplicateGroup,
  DuplicateProgress,
  DuplicateReport,
  SizeUnit,
  formatBytes,
  formatDate,
  formatDuration,
  formatNumber,
} from "../types/disk";
import { useI18n } from "../i18n/useI18n";

interface DuplicatesPanelProps {
  scanVersion: number;
  deletedIds: Set<number>;
  sizeUnit: SizeUnit;
  selectedIds: Set<number>;
  onToggleSelectId: (id: number, size: number) => void;
  onBulkUpdateSelection: (
    toSelect: { id: number; size: number }[],
    toUnselect: number[]
  ) => void;
  onRequestDelete: (ids: number[], permanent: boolean) => void;
  onRevealInExplorer: (path: string) => void;
  onOpenFile: (path: string) => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

const MIN_SIZE_OPTIONS = [
  { label: ">= 1 MB", bytes: 1 * 1024 * 1024 },
  { label: ">= 10 MB", bytes: 10 * 1024 * 1024 },
  { label: ">= 100 MB", bytes: 100 * 1024 * 1024 },
  { label: ">= 500 MB", bytes: 500 * 1024 * 1024 },
];

type KeepStrategy = "newest" | "oldest" | "shortest";

export function DuplicatesPanel({
  scanVersion,
  deletedIds,
  sizeUnit,
  selectedIds,
  onToggleSelectId,
  onBulkUpdateSelection,
  onRequestDelete,
  onRevealInExplorer,
  onOpenFile,
  onNotify,
}: DuplicatesPanelProps) {
  const { t } = useI18n();
  const [minSizeBytes, setMinSizeBytes] = useState<number>(10 * 1024 * 1024);
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<DuplicateProgress | null>(null);
  const [report, setReport] = useState<DuplicateReport | null>(null);
  const [lastScanVersion, setLastScanVersion] = useState(scanVersion);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await listen<DuplicateProgress>("dup-progress", (ev) => {
        setProgress(ev.payload);
      });
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  // Only clear report if scan changed without being a deletion update
  useEffect(() => {
    if (scanVersion !== lastScanVersion) {
      setLastScanVersion(scanVersion);
    }
  }, [scanVersion, lastScanVersion]);

  const activeGroups = useMemo<DuplicateGroup[]>(() => {
    if (!report) return [];
    const out: DuplicateGroup[] = [];
    for (const g of report.groups) {
      const remaining = g.files.filter((f) => !deletedIds.has(f.nodeId));
      if (remaining.length >= 2) {
        out.push({
          ...g,
          files: remaining,
          wastedBytes: g.fileSize * (remaining.length - 1),
        });
      }
    }
    return out;
  }, [report, deletedIds]);

  const totalWasted = useMemo(
    () => activeGroups.reduce((acc, g) => acc + g.wastedBytes, 0),
    [activeGroups]
  );

  const handleStartScan = async () => {
    setIsScanning(true);
    setProgress(null);
    try {
      const res = await invoke<DuplicateReport>("find_duplicates", {
        minSizeBytes,
      });
      setReport(res);
    } catch (err) {
      const msg = String(err);
      if (!msg.toLowerCase().includes("cancel")) {
        onNotify(msg, true);
      }
    } finally {
      setIsScanning(false);
      setProgress(null);
    }
  };

  const handleCancel = async () => {
    try {
      await invoke<boolean>("cancel_duplicates");
    } catch {
      // ignore
    }
  };

  const applySmartAutoSelect = (strategy: KeepStrategy) => {
    const toSelect: { id: number; size: number }[] = [];
    const toUnselect: number[] = [];

    for (const group of activeGroups) {
      if (group.files.length < 2) continue;

      const sorted = [...group.files].sort((a: DuplicateFile, b: DuplicateFile) => {
        if (strategy === "newest") {
          if (b.modifiedTs !== a.modifiedTs) return b.modifiedTs - a.modifiedTs;
          return a.fullPath.length - b.fullPath.length;
        }
        if (strategy === "oldest") {
          if (a.modifiedTs !== b.modifiedTs) return a.modifiedTs - b.modifiedTs;
          return a.fullPath.length - b.fullPath.length;
        }
        // shortest path
        if (a.fullPath.length !== b.fullPath.length) {
          return a.fullPath.length - b.fullPath.length;
        }
        return b.modifiedTs - a.modifiedTs;
      });

      const keeper = sorted[0];
      toUnselect.push(keeper.nodeId);

      for (let i = 1; i < sorted.length; i++) {
        const dup = sorted[i];
        if (dup.safetyLevel !== "blocked") {
          toSelect.push({ id: dup.nodeId, size: group.fileSize });
        }
      }
    }

    onBulkUpdateSelection(toSelect, toUnselect);
  };

  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, (progress.processed / progress.total) * 100)
      : 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Control Header */}
      <div
        className="px-3 py-2 border-b flex items-center justify-between gap-3 flex-wrap shrink-0"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <CopyCheck className="w-4 h-4 text-sky-400 shrink-0" />
          <span className="font-semibold text-[13px]">{t.dupTitle}</span>

          <div
            className="flex items-center rounded border overflow-hidden ml-2 text-[11px] font-mono-num"
            style={{
              borderColor: "var(--border-subtle)",
              backgroundColor: "var(--bg-elevated)",
            }}
          >
            {MIN_SIZE_OPTIONS.map((opt, idx) => {
              const active = minSizeBytes === opt.bytes;
              return (
                <button
                  key={opt.bytes}
                  type="button"
                  disabled={isScanning}
                  onClick={() => setMinSizeBytes(opt.bytes)}
                  className={`h-7 px-2.5 cursor-pointer disabled:opacity-50 ${
                    idx > 0 ? "border-l" : ""
                  }`}
                  style={{
                    borderColor: "var(--border-subtle)",
                    backgroundColor: active ? "var(--bg-selected)" : "transparent",
                    color: active ? "var(--accent)" : "var(--text-secondary)",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {!isScanning ? (
            <button
              type="button"
              onClick={handleStartScan}
              className="h-7 px-3 rounded text-[12px] font-medium flex items-center gap-1.5 cursor-pointer text-white"
              style={{ backgroundColor: "var(--accent-strong)" }}
            >
              <Play className="w-3 h-3 fill-current" />
              <span>{t.dupScanBtn}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCancel}
              className="h-7 px-3 rounded text-[12px] font-medium flex items-center gap-1.5 cursor-pointer bg-rose-600 text-white hover:bg-rose-500"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>{t.dupCancelBtn}</span>
            </button>
          )}
        </div>

        {/* Smart Auto-Select Buttons */}
        {activeGroups.length > 0 && !isScanning && (
          <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
            <button
              type="button"
              onClick={() => applySmartAutoSelect("newest")}
              className="h-7 px-2.5 rounded border font-medium cursor-pointer hover:border-sky-500/60"
              style={{
                backgroundColor: "var(--bg-elevated)",
                borderColor: "var(--border-subtle)",
                color: "var(--accent)",
              }}
            >
              {t.dupKeepNewest}
            </button>
            <button
              type="button"
              onClick={() => applySmartAutoSelect("oldest")}
              className="h-7 px-2.5 rounded border font-medium cursor-pointer hover:border-sky-500/60"
              style={{
                backgroundColor: "var(--bg-elevated)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-secondary)",
              }}
            >
              {t.dupKeepOldest}
            </button>
            <button
              type="button"
              onClick={() => applySmartAutoSelect("shortest")}
              className="h-7 px-2.5 rounded border font-medium cursor-pointer hover:border-sky-500/60"
              style={{
                backgroundColor: "var(--bg-elevated)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-secondary)",
              }}
            >
              {t.dupKeepShortest}
            </button>
          </div>
        )}
      </div>

      {/* Live 3-Stage Progress Bar */}
      {isScanning && (
        <div
          className="px-3 py-2 border-b flex flex-col gap-1.5 shrink-0"
          style={{
            backgroundColor: "var(--bg-elevated)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div className="flex items-center justify-between text-[11px] font-mono-num">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
              <span className="font-semibold text-sky-400">
                {t.dupStageLabel}: {progress?.stage || "Initializing..."}
              </span>
              {progress && progress.total > 0 && (
                <span style={{ color: "var(--text-secondary)" }}>
                  {formatNumber(progress.processed)} / {formatNumber(progress.total)} (
                  {progressPct.toFixed(0)}%)
                </span>
              )}
            </div>
            {progress && (
              <div className="flex items-center gap-3" style={{ color: "var(--text-secondary)" }}>
                <span>
                  {t.dupGroupsFound}: <strong>{formatNumber(progress.groupsFound)}</strong>
                </span>
                <span>
                  {t.dupWastedSpace}:{" "}
                  <strong className="text-amber-400">
                    {formatBytes(progress.wastedBytes, sizeUnit)}
                  </strong>
                </span>
              </div>
            )}
          </div>
          <div
            className="w-full h-1.5 rounded-full overflow-hidden"
            style={{ backgroundColor: "var(--bar-track)" }}
          >
            <div
              className="h-full transition-all duration-150"
              style={{
                width: `${progress && progress.total > 0 ? Math.max(3, progressPct) : 15}%`,
                backgroundColor: "var(--accent)",
              }}
            />
          </div>
        </div>
      )}

      {/* Summary Strip */}
      {report && !isScanning && (
        <div
          className="px-3 py-1.5 border-b flex items-center gap-5 text-[11px] font-mono-num shrink-0 flex-wrap"
          style={{
            backgroundColor: "var(--bg-elevated)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <span>
            <span style={{ color: "var(--text-muted)" }}>{t.dupGroupsFound}: </span>
            <strong>{formatNumber(activeGroups.length)}</strong>
          </span>
          <span>
            <span style={{ color: "var(--text-muted)" }}>{t.dupWastedSpace}: </span>
            <strong className="text-amber-400">{formatBytes(totalWasted, sizeUnit)}</strong>
          </span>
          <span>
            <span style={{ color: "var(--text-muted)" }}>{t.scanTime}: </span>
            <span>{formatDuration(report.elapsedMs)}</span>
          </span>
          <span className="ml-auto hidden md:inline" style={{ color: "var(--text-muted)" }}>
            {t.dupSubtitle}
          </span>
        </div>
      )}

      {/* Groups List */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5">
        {!report && !isScanning ? (
          <div
            className="flex-1 flex flex-col items-center justify-center gap-2 text-center py-16"
            style={{ color: "var(--text-muted)" }}
          >
            <CopyCheck className="w-8 h-8 opacity-40" />
            <div className="text-[13px] font-medium" style={{ color: "var(--text-secondary)" }}>
              {t.dupSubtitle}
            </div>
            <div className="text-[12px] max-w-md">{t.dupIdleHint}</div>
          </div>
        ) : activeGroups.length === 0 && !isScanning ? (
          <div
            className="flex-1 flex flex-col items-center justify-center gap-2 text-center py-16"
            style={{ color: "var(--text-muted)" }}
          >
            <CheckCircle2 className="w-8 h-8 text-emerald-400/70" />
            <span className="text-[13px]">{t.dupNoFound}</span>
          </div>
        ) : (
          activeGroups.slice(0, 200).map((group) => {
            const unselectedCount = group.files.filter(
              (f) => !selectedIds.has(f.nodeId)
            ).length;

            return (
              <div
                key={group.hash}
                className="rounded-md border overflow-hidden"
                style={{
                  backgroundColor: "var(--bg-panel)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                <div
                  className="px-3 py-1.5 border-b flex items-center justify-between gap-3 text-[12px]"
                  style={{
                    backgroundColor: "var(--bg-elevated)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="font-mono-num font-semibold text-sky-400">
                      {formatBytes(group.fileSize, sizeUnit)}
                    </span>
                    <span
                      className="font-mono-num text-[11px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      × {group.files.length}
                    </span>
                    <span
                      className="font-mono-num text-[10px] px-1.5 py-0.5 rounded border hidden sm:inline"
                      style={{
                        borderColor: "var(--border-subtle)",
                        color: "var(--text-muted)",
                      }}
                      title={`BLAKE3: ${group.hash}`}
                    >
                      #{group.hash.slice(0, 12)}
                    </span>
                  </div>
                  <div className="font-mono-num text-[11px] font-semibold text-amber-400 shrink-0">
                    {t.dupWastedSpace}: {formatBytes(group.wastedBytes, sizeUnit)}
                  </div>
                </div>

                <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                  {group.files.map((file) => {
                    const checked = selectedIds.has(file.nodeId);
                    const isSoleKeeper = !checked && unselectedCount === 1;

                    return (
                      <div
                        key={file.nodeId}
                        className="group px-3 py-1.5 flex items-center justify-between gap-2 text-[12px]"
                        style={{
                          borderColor: "var(--border-subtle)",
                          backgroundColor: checked ? "var(--bg-selected)" : "transparent",
                        }}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {file.safetyLevel === "blocked" ? (
                            <span title={t.protectedLabel}>
                              <ShieldBan className="w-3.5 h-3.5 text-rose-400/70 shrink-0" />
                            </span>
                          ) : (
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => onToggleSelectId(file.nodeId, group.fileSize)}
                              className="w-3.5 h-3.5 accent-sky-500 cursor-pointer shrink-0"
                            />
                          )}
                          <File className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          <span
                            className="truncate font-mono-num text-[11px]"
                            title={file.fullPath}
                          >
                            {file.fullPath}
                          </span>
                          {isSoleKeeper && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                              {t.dupKeepBadge}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className="font-mono-num text-[11px] hidden md:inline"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {formatDate(file.modifiedTs)}
                          </span>
                          <button
                            type="button"
                            onClick={() => onOpenFile(file.fullPath)}
                            className="p-1 rounded hover:bg-white/10 cursor-pointer"
                            style={{ color: "var(--text-muted)" }}
                            title={t.openFile}
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onRevealInExplorer(file.fullPath)}
                            className="p-1 rounded hover:bg-white/10 cursor-pointer"
                            style={{ color: "var(--text-muted)" }}
                            title={t.revealExplorer}
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                          </button>
                          {file.safetyLevel !== "blocked" && (
                            <button
                              type="button"
                              onClick={() => onRequestDelete([file.nodeId], false)}
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
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
