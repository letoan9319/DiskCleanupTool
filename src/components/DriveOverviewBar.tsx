import { Cpu, Zap } from "./PixelIcons";
import {
  DriveInfo,
  ScanProgress,
  ScanSummary,
  SizeUnit,
  formatBytes,
  formatDuration,
  formatNumber,
} from "../types/disk";
import { useI18n } from "../i18n/useI18n";

interface DriveOverviewBarProps {
  drives: DriveInfo[];
  summary: ScanSummary | null;
  progress: ScanProgress | null;
  isScanning: boolean;
  sizeUnit: SizeUnit;
}

export function DriveOverviewBar({
  drives,
  summary,
  progress,
  isScanning,
  sizeUnit,
}: DriveOverviewBarProps) {
  const { t } = useI18n();

  const activeDrive = summary
    ? drives.find((d) =>
        summary.rootPath.toUpperCase().startsWith(d.path.slice(0, 2).toUpperCase())
      )
    : undefined;

  if (isScanning && progress) {
    return (
      <div
        className="px-3 py-1.5 border-b flex items-center gap-4 text-[12px] shrink-0"
        style={{
          backgroundColor: "var(--bg-elevated)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <div className="flex items-center gap-2 shrink-0 text-sky-400 font-medium">
          <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
          <span>
            {t.scanning} ({progress.engine === "ntfs_mft" ? t.mftBadge : t.walkerBadge})
          </span>
        </div>
        <div
          className="font-mono-num flex items-center gap-3 shrink-0"
          style={{ color: "var(--text-secondary)" }}
        >
          <span>{formatNumber(progress.filesScanned)} files</span>
          <span>{formatNumber(progress.dirsScanned)} dirs</span>
          <span className="text-sky-400 font-semibold">
            {formatBytes(progress.bytesScanned, sizeUnit)}
          </span>
          <span>{formatDuration(progress.elapsedMs)}</span>
        </div>
        <div
          className="truncate font-mono-num text-[11px] flex-1"
          style={{ color: "var(--text-muted)" }}
          title={progress.currentPath}
        >
          {progress.currentPath}
        </div>
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  const usedPct =
    activeDrive && activeDrive.totalBytes > 0
      ? Math.min(100, (activeDrive.usedBytes / activeDrive.totalBytes) * 100)
      : 0;

  return (
    <div
      className="px-3 py-1.5 border-b flex items-center justify-between gap-4 text-[12px] flex-wrap shrink-0"
      style={{
        backgroundColor: "var(--bg-elevated)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div className="flex items-center gap-5 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span style={{ color: "var(--text-muted)" }}>{t.scannedSize}:</span>
          <span className="font-mono-num font-semibold text-sky-400">
            {formatBytes(summary.totalLogicalSize, sizeUnit)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span style={{ color: "var(--text-muted)" }}>{t.allocatedSize}:</span>
          <span className="font-mono-num font-medium">
            {formatBytes(summary.totalAllocatedSize, sizeUnit)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span style={{ color: "var(--text-muted)" }}>{t.filesFolders}:</span>
          <span className="font-mono-num">
            {formatNumber(summary.totalFiles)} / {formatNumber(summary.totalDirs)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span style={{ color: "var(--text-muted)" }}>{t.scanTime}:</span>
          <span className="font-mono-num">{formatDuration(summary.elapsedMs)}</span>
        </div>

        <div
          className="flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px]"
          style={{
            borderColor: "var(--border-subtle)",
            backgroundColor: "var(--bg-panel)",
            color:
              summary.engineUsed === "ntfs_mft"
                ? "var(--success)"
                : "var(--text-secondary)",
          }}
          title={summary.fallbackReason ?? undefined}
        >
          {summary.engineUsed === "ntfs_mft" ? (
            <Zap className="w-3 h-3" />
          ) : (
            <Cpu className="w-3 h-3" />
          )}
          <span>{summary.engineUsed === "ntfs_mft" ? t.mftBadge : t.walkerBadge}</span>
        </div>
      </div>

      {activeDrive && (
        <div className="capacity-summary" title={`${activeDrive.path} · ${t.driveUsed}: ${formatBytes(activeDrive.usedBytes, sizeUnit)} / ${formatBytes(activeDrive.totalBytes, sizeUnit)}`}>
          <strong>{activeDrive.path}</strong>
          <span>{t.freeSpace}: {formatBytes(activeDrive.freeBytes, sizeUnit)}</span>
          <div
            className="w-24 h-2 rounded-full overflow-hidden"
            style={{ backgroundColor: "var(--bar-track)" }}
          >
            <div
              className="h-full transition-all"
              style={{
                width: `${usedPct.toFixed(1)}%`,
                backgroundColor:
                  usedPct > 90
                    ? "var(--danger)"
                    : usedPct > 75
                    ? "var(--warning)"
                    : "var(--accent)",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
