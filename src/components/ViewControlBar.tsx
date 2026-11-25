import { useEffect, useRef, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Columns2,
  Download,
  FileJson,
  GitCompareArrows,
  ListTree,
  Minimize2,
  Trash2,
} from "./PixelIcons";
import {
  DisplayMode,
  RecycleBinInfo,
  SizeUnit,
  formatBytes,
  formatNumber,
} from "../types/disk";
import { useI18n } from "../i18n/useI18n";

function ToolbarDropdown({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false;
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  return (
    <details ref={ref} className="toolbar-dropdown"
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }}
      onKeyDown={event => {
        if (event.key === "Escape") {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}>
      <summary>{label}</summary>
      <div className="toolbar-sheet">{children}</div>
    </details>
  );
}

interface ViewControlBarProps {
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  displayMode: DisplayMode;
  onDisplayModeChange: (mode: DisplayMode) => void;
  sizeUnit: SizeUnit;
  onSizeUnitChange: (unit: SizeUnit) => void;
  onExpandLevel: (level: number) => void;
  splitView: boolean;
  onToggleSplitView: () => void;
  onExport: (format: "csv" | "json") => void;
  onOpenSnapshotModal: () => void;
  recycleBin: RecycleBinInfo | null;
  onRequestEmptyRecycleBin: () => void;
}

export function ViewControlBar({
  canBack,
  canForward,
  canUp,
  onBack,
  onForward,
  onUp,
  displayMode,
  onDisplayModeChange,
  sizeUnit,
  onSizeUnitChange,
  onExpandLevel,
  splitView,
  onToggleSplitView,
  onExport,
  onOpenSnapshotModal,
  recycleBin,
  onRequestEmptyRecycleBin,
}: ViewControlBarProps) {
  const { t } = useI18n();

  const modes: { id: DisplayMode; label: string }[] = [
    { id: "size", label: t.modeSize },
    { id: "allocated", label: t.modeAllocated },
    { id: "files", label: t.modeFiles },
    { id: "percent", label: t.modePercent },
  ];

  const units: { id: SizeUnit; label: string }[] = [
    { id: "auto", label: t.unitAuto },
    { id: "GB", label: "GB" },
    { id: "MB", label: "MB" },
    { id: "KB", label: "KB" },
  ];

  const hasBinItems = recycleBin !== null && (recycleBin.itemCount > 0 || recycleBin.sizeBytes > 0);

  return (
    <div
      className="results-toolbar px-3 py-1.5 border-b flex items-center gap-2 flex-wrap text-[11px] shrink-0"
      style={{
        backgroundColor: "var(--bg-panel)",
        borderColor: "var(--border-subtle)",
      }}
    >
      {/* History Navigation */}
      <div
        className="flex items-center rounded border overflow-hidden shrink-0"
        style={{
          borderColor: "var(--border-subtle)",
          backgroundColor: "var(--bg-elevated)",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          disabled={!canBack}
          title={t.navBack}
          className="h-6 px-2 flex items-center gap-1 cursor-pointer disabled:opacity-35 disabled:cursor-default hover:bg-white/5"
          style={{ color: "var(--text-secondary)" }}
        >
          <ArrowLeft className="w-3 h-3" />
          <span className="hidden xl:inline">{t.navBack}</span>
        </button>
        <button
          type="button"
          onClick={onForward}
          disabled={!canForward}
          title={t.navForward}
          className="h-6 px-2 flex items-center gap-1 border-l cursor-pointer disabled:opacity-35 disabled:cursor-default hover:bg-white/5"
          style={{
            borderColor: "var(--border-subtle)",
            color: "var(--text-secondary)",
          }}
        >
          <ArrowRight className="w-3 h-3" />
          <span className="hidden xl:inline">{t.navForward}</span>
        </button>
        <button
          type="button"
          onClick={onUp}
          disabled={!canUp}
          title={t.navUp}
          className="h-6 px-2 flex items-center gap-1 border-l cursor-pointer disabled:opacity-35 disabled:cursor-default hover:bg-white/5"
          style={{
            borderColor: "var(--border-subtle)",
            color: "var(--text-secondary)",
          }}
        >
          <ArrowUp className="w-3 h-3" />
          <span className="hidden xl:inline">{t.navUp}</span>
        </button>
      </div>

      <ToolbarDropdown label={t.viewOptions}>
      {/* Display Mode Segmented Control */}
      <div
        className="flex items-center rounded border overflow-hidden shrink-0"
        style={{
          borderColor: "var(--border-subtle)",
          backgroundColor: "var(--bg-elevated)",
        }}
      >
        {modes.map((m, idx) => {
          const active = displayMode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onDisplayModeChange(m.id)}
              className={`h-6 px-2 font-medium cursor-pointer transition-colors ${
                idx > 0 ? "border-l" : ""
              }`}
              style={{
                borderColor: "var(--border-subtle)",
                backgroundColor: active ? "var(--bg-selected)" : "transparent",
                color: active ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Size Unit Segmented Control */}
      <div
        className="flex items-center rounded border overflow-hidden shrink-0 font-mono-num"
        style={{
          borderColor: "var(--border-subtle)",
          backgroundColor: "var(--bg-elevated)",
        }}
      >
        {units.map((u, idx) => {
          const active = sizeUnit === u.id;
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => onSizeUnitChange(u.id)}
              className={`h-6 px-2 font-medium cursor-pointer transition-colors ${
                idx > 0 ? "border-l" : ""
              }`}
              style={{
                borderColor: "var(--border-subtle)",
                backgroundColor: active ? "var(--bg-selected)" : "transparent",
                color: active ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              {u.label}
            </button>
          );
        })}
      </div>

      {/* Expand Levels */}
      <div
        className="flex items-center rounded border overflow-hidden shrink-0"
        style={{
          borderColor: "var(--border-subtle)",
          backgroundColor: "var(--bg-elevated)",
        }}
      >
        {[
          { level: 1, label: t.expandLv1 },
          { level: 2, label: t.expandLv2 },
          { level: 3, label: t.expandLv3 },
        ].map((lv, idx) => (
          <button
            key={lv.level}
            type="button"
            onClick={() => onExpandLevel(lv.level)}
            className={`h-6 px-2 cursor-pointer hover:bg-white/5 ${
              idx > 0 ? "border-l" : ""
            }`}
            style={{
              borderColor: "var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
          >
            {lv.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onExpandLevel(0)}
          className="h-6 px-2 border-l flex items-center gap-1 cursor-pointer hover:bg-white/5"
          style={{
            borderColor: "var(--border-subtle)",
            color: "var(--text-secondary)",
          }}
          title={t.collapseAll}
        >
          <Minimize2 className="w-3 h-3" />
          <span className="hidden lg:inline">{t.collapseAll}</span>
        </button>
      </div>

      {/* Split View Toggle */}
      <button
        type="button"
        onClick={onToggleSplitView}
        className="h-6 px-2 rounded border flex items-center gap-1.5 font-medium cursor-pointer shrink-0 transition-colors"
        style={{
          backgroundColor: splitView ? "var(--bg-selected)" : "var(--bg-elevated)",
          borderColor: splitView ? "var(--accent)" : "var(--border-subtle)",
          color: splitView ? "var(--accent)" : "var(--text-secondary)",
        }}
        title={splitView ? t.splitView : t.treeOnly}
      >
        {splitView ? <Columns2 className="w-3 h-3" /> : <ListTree className="w-3 h-3" />}
        <span>{splitView ? t.splitView : t.treeOnly}</span>
      </button>

      </ToolbarDropdown>
      {/* Right-aligned Quick Actions & Recycle Bin */}
      <div className="ml-auto">
        <ToolbarDropdown label={t.tools}>
        <div className="tool-actions" onClick={event => {
          const menu = event.currentTarget.closest("details");
          if (menu) menu.open = false;
        }}>
        <button
          type="button"
          onClick={() => onExport("csv")}
          className="h-6 px-2 rounded border flex items-center gap-1 cursor-pointer hover:opacity-90"
          style={{
            backgroundColor: "var(--bg-elevated)",
            borderColor: "var(--border-subtle)",
            color: "var(--text-secondary)",
          }}
          title={t.exportCsv}
        >
          <Download className="w-3 h-3" />
          <span>{t.exportCsv}</span>
        </button>

        <button
          type="button"
          onClick={() => onExport("json")}
          className="h-6 px-2 rounded border flex items-center gap-1 cursor-pointer hover:opacity-90"
          style={{
            backgroundColor: "var(--bg-elevated)",
            borderColor: "var(--border-subtle)",
            color: "var(--text-secondary)",
          }}
          title={t.exportJson}
        >
          <FileJson className="w-3 h-3" />
          <span>{t.exportJson}</span>
        </button>

        <button
          type="button"
          onClick={onOpenSnapshotModal}
          className="h-6 px-2 rounded border flex items-center gap-1 cursor-pointer hover:opacity-90"
          style={{
            backgroundColor: "var(--bg-elevated)",
            borderColor: "var(--border-subtle)",
            color: "var(--text-secondary)",
          }}
        >
          <GitCompareArrows className="w-3 h-3 text-sky-400" />
          <span>{t.snapshotDiff}</span>
        </button>

        <button
          type="button"
          onClick={onRequestEmptyRecycleBin}
          className={`h-6 px-2 rounded border flex items-center gap-1.5 font-mono-num cursor-pointer transition-colors ${
            hasBinItems
              ? "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
              : "hover:opacity-90"
          }`}
          style={
            hasBinItems
              ? undefined
              : {
                  backgroundColor: "var(--bg-elevated)",
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-muted)",
                }
          }
          title={t.emptyRecycleBin}
        >
          <Trash2 className="w-3 h-3" />
          <span>
            {t.recycleBin}:{" "}
            {recycleBin
              ? `${formatBytes(recycleBin.sizeBytes, sizeUnit)} (${formatNumber(recycleBin.itemCount)})`
              : "—"}
          </span>
        </button>
        </div>
        </ToolbarDropdown>
      </div>
    </div>
  );
}
