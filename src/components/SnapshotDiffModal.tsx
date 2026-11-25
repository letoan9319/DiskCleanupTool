import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  Camera,
  FolderOpen,
  GitCompareArrows,
  TrendingDown,
  TrendingUp,
  X,
} from "./PixelIcons";
import {
  SizeUnit,
  SnapshotDiffReport,
  formatBytes,
  formatDate,
  formatNumber,
  formatSignedBytes,
} from "../types/disk";
import { useI18n } from "../i18n/useI18n";

interface SnapshotDiffModalProps {
  open: boolean;
  onClose: () => void;
  sizeUnit: SizeUnit;
  onNotify: (msg: string, isError?: boolean) => void;
}

type DiffFilter = "all" | "grew" | "added" | "removed";

export function SnapshotDiffModal({
  open,
  onClose,
  sizeUnit,
  onNotify,
}: SnapshotDiffModalProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<SnapshotDiffReport | null>(null);
  const [filter, setFilter] = useState<DiffFilter>("all");

  const filteredItems = useMemo(() => {
    if (!report) return [];
    const list = report.items.filter((it) => {
      const st = it.status.toLowerCase();
      if (filter === "all") return true;
      if (filter === "grew") return st === "grew" || it.deltaBytes > 0;
      if (filter === "added") return st === "added";
      if (filter === "removed") return st === "removed";
      return true;
    });
    return [...list].sort((a, b) => b.deltaBytes - a.deltaBytes);
  }, [report, filter]);

  if (!open) return null;

  const handleSaveSnapshot = async () => {
    try {
      const now = new Date();
      const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
        now.getDate()
      ).padStart(2, "0")}`;
      const destPath = await saveDialog({
        defaultPath: `disk-snapshot-${stamp}.dctsnap.json`,
        filters: [{ name: "DiskCleanupTool Snapshot", extensions: ["dctsnap.json", "json"] }],
      });
      if (!destPath) return;

      setBusy(true);
      const count = await invoke<number>("save_snapshot", {
        destPath,
        maxDepth: 6,
      });
      onNotify(`${t.snapshotSaved}: ${formatNumber(count)} ${t.itemsCount}`);
    } catch (err) {
      onNotify(String(err), true);
    } finally {
      setBusy(false);
    }
  };

  const handleCompareSnapshot = async () => {
    try {
      const picked = await openDialog({
        multiple: false,
        filters: [{ name: "DiskCleanupTool Snapshot", extensions: ["dctsnap.json", "json"] }],
      });
      if (typeof picked !== "string" || !picked) return;

      setBusy(true);
      const diff = await invoke<SnapshotDiffReport>("compare_snapshot", {
        snapshotPath: picked,
      });
      setReport(diff);
    } catch (err) {
      onNotify(String(err), true);
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = (status: string, deltaBytes: number) => {
    const st = status.toLowerCase();
    if (st === "added") {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-500/15 text-sky-400 border border-sky-500/30">
          {t.statusAdded}
        </span>
      );
    }
    if (st === "removed") {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
          {t.statusRemoved}
        </span>
      );
    }
    if (st === "grew" || deltaBytes > 0) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-500/15 text-rose-400 border border-rose-500/30">
          {t.statusGrew}
        </span>
      );
    }
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
        {t.statusShrank}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
      <div
        className="w-full max-w-5xl rounded-lg border shadow-2xl flex flex-col max-h-[86vh]"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-strong)",
        }}
      >
        {/* Header */}
        <div
          className="px-4 py-3 border-b flex items-center justify-between gap-3"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2">
            <GitCompareArrows className="w-4 h-4 text-sky-400" />
            <h2 className="font-semibold text-[15px]">{t.snapshotModalTitle}</h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleSaveSnapshot}
              className="h-8 px-3 rounded border text-[12px] font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-45 hover:border-sky-500/60"
              style={{
                backgroundColor: "var(--bg-elevated)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            >
              <Camera className="w-3.5 h-3.5 text-sky-400" />
              <span>{t.saveSnapshotBtn}</span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={handleCompareSnapshot}
              className="h-8 px-3 rounded text-[12px] font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-45 text-white"
              style={{ backgroundColor: "var(--accent-strong)" }}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>{t.compareSnapshotBtn}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded hover:opacity-75 cursor-pointer"
              style={{ color: "var(--text-muted)" }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Summary Strip */}
        {report && (
          <div
            className="px-4 py-2.5 border-b flex items-center justify-between gap-4 flex-wrap text-[12px]"
            style={{
              backgroundColor: "var(--bg-elevated)",
              borderColor: "var(--border-subtle)",
            }}
          >
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="font-mono-num text-[11px] truncate" style={{ color: "var(--text-secondary)" }}>
                <strong>{t.snapshotBaseline}:</strong> {report.baselinePath} (
                {formatDate(report.baselineTimestamp)})
              </div>
              <div className="font-mono-num text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                <strong>{t.snapshotCurrent}:</strong> {report.currentPath}
              </div>
            </div>

            <div className="flex items-center gap-4 font-mono-num shrink-0">
              <div>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {t.snapshotBefore}:{" "}
                </span>
                <span className="font-semibold">
                  {formatBytes(report.totalBeforeBytes, sizeUnit)}
                </span>
              </div>
              <div>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {t.snapshotAfter}:{" "}
                </span>
                <span className="font-semibold">
                  {formatBytes(report.totalAfterBytes, sizeUnit)}
                </span>
              </div>
              <div
                className={`flex items-center gap-1 font-semibold px-2 py-0.5 rounded border ${
                  report.totalDeltaBytes > 0
                    ? "border-rose-500/40 bg-rose-500/10 text-rose-400"
                    : report.totalDeltaBytes < 0
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : "border-slate-500/30 text-slate-300"
                }`}
              >
                {report.totalDeltaBytes > 0 ? (
                  <TrendingUp className="w-3.5 h-3.5" />
                ) : report.totalDeltaBytes < 0 ? (
                  <TrendingDown className="w-3.5 h-3.5" />
                ) : null}
                <span>{formatSignedBytes(report.totalDeltaBytes, sizeUnit)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Filter Chips */}
        {report && (
          <div
            className="px-4 py-2 border-b flex items-center gap-1.5 text-[11px]"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            {(
              [
                { id: "all", label: t.snapshotFilterAll },
                { id: "grew", label: t.snapshotFilterGrew },
                { id: "added", label: t.snapshotFilterAdded },
                { id: "removed", label: t.snapshotFilterRemoved },
              ] as const
            ).map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className="h-6 px-2.5 rounded border cursor-pointer"
                  style={{
                    backgroundColor: active ? "var(--bg-selected)" : "var(--bg-elevated)",
                    borderColor: active ? "var(--accent)" : "var(--border-subtle)",
                    color: active ? "var(--accent)" : "var(--text-secondary)",
                  }}
                >
                  {f.label}
                </button>
              );
            })}
            <span className="ml-auto font-mono-num" style={{ color: "var(--text-muted)" }}>
              {formatNumber(filteredItems.length)} {t.itemsCount}
            </span>
          </div>
        )}

        {/* Diff Body */}
        <div className="flex-1 min-h-[280px] overflow-y-auto">
          {!report ? (
            <div
              className="h-full flex flex-col items-center justify-center p-10 text-center gap-3"
              style={{ color: "var(--text-muted)" }}
            >
              <GitCompareArrows className="w-8 h-8 opacity-40" />
              <p className="text-[13px] max-w-md">{t.snapshotHint}</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div
              className="h-full flex items-center justify-center p-10 text-[13px]"
              style={{ color: "var(--text-muted)" }}
            >
              {t.snapshotNoDiff}
            </div>
          ) : (
            <div className="min-w-[760px]">
              <div
                className="grid items-center px-4 py-2 border-b text-[11px] font-semibold uppercase tracking-wider sticky top-0"
                style={{
                  gridTemplateColumns: "82px 1fr 110px 110px 120px 85px",
                  backgroundColor: "var(--bg-panel)",
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-muted)",
                }}
              >
                <div>{t.colStatus}</div>
                <div>{t.colPath}</div>
                <div className="text-right">{t.snapshotBefore}</div>
                <div className="text-right">{t.snapshotAfter}</div>
                <div className="text-right">{t.snapshotDelta}</div>
                <div className="text-right">{t.colFiles}</div>
              </div>

              <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                {filteredItems.slice(0, 500).map((item) => (
                  <div
                    key={item.path}
                    className="grid items-center px-4 py-1.5 text-[12px] hover:bg-white/[0.03]"
                    style={{
                      gridTemplateColumns: "82px 1fr 110px 110px 120px 85px",
                      borderColor: "var(--border-subtle)",
                    }}
                  >
                    <div>{statusBadge(item.status, item.deltaBytes)}</div>
                    <div
                      className="truncate font-mono-num text-[11px] pr-3"
                      title={item.path}
                    >
                      {item.path}
                    </div>
                    <div
                      className="text-right font-mono-num text-[11px]"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {formatBytes(item.beforeBytes, sizeUnit)}
                    </div>
                    <div
                      className="text-right font-mono-num text-[11px]"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {formatBytes(item.afterBytes, sizeUnit)}
                    </div>
                    <div
                      className={`text-right font-mono-num font-semibold ${
                        item.deltaBytes > 0
                          ? "text-rose-400"
                          : item.deltaBytes < 0
                          ? "text-emerald-400"
                          : ""
                      }`}
                    >
                      {formatSignedBytes(item.deltaBytes, sizeUnit)}
                    </div>
                    <div
                      className="text-right font-mono-num text-[11px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {item.deltaFiles > 0
                        ? `+${formatNumber(item.deltaFiles)}`
                        : item.deltaFiles < 0
                        ? formatNumber(item.deltaFiles)
                        : "0"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-4 py-2.5 border-t flex items-center justify-end"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-4 rounded border text-[12px] cursor-pointer"
            style={{
              borderColor: "var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
          >
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}
