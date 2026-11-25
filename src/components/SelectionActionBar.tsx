import { Trash2, X, Flame } from "./PixelIcons";
import { SizeUnit, formatBytes, formatNumber } from "../types/disk";
import { useI18n } from "../i18n/useI18n";

interface SelectionActionBarProps {
  selectedCount: number;
  selectedTotalBytes: number;
  sizeUnit: SizeUnit;
  onMoveToTrash: () => void;
  onDeletePermanent: () => void;
  onClear: () => void;
}

export function SelectionActionBar({
  selectedCount,
  selectedTotalBytes,
  sizeUnit,
  onMoveToTrash,
  onDeletePermanent,
  onClear,
}: SelectionActionBarProps) {
  const { t } = useI18n();

  if (selectedCount === 0) return null;

  return (
    <div
      className="px-4 py-2 border-t flex items-center justify-between gap-4 shrink-0"
      style={{
        backgroundColor: "var(--bg-panel)",
        borderColor: "var(--border-strong)",
      }}
    >
      <div className="flex items-center gap-3 text-[12px]">
        <span className="font-mono-num font-semibold text-sky-400">
          {formatNumber(selectedCount)} {t.selectedSummary}
        </span>
        <span style={{ color: "var(--text-muted)" }}>•</span>
        <span className="font-mono-num font-semibold text-emerald-400">
          {t.reclaimable}: {formatBytes(selectedTotalBytes, sizeUnit)}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClear}
          className="h-8 px-2.5 rounded border text-[12px] flex items-center gap-1 cursor-pointer hover:opacity-80"
          style={{
            borderColor: "var(--border-subtle)",
            color: "var(--text-secondary)",
          }}
        >
          <X className="w-3.5 h-3.5" />
          <span>{t.clearSelection}</span>
        </button>

        <button
          type="button"
          onClick={onDeletePermanent}
          className="h-8 px-3 rounded border text-[12px] font-medium flex items-center gap-1.5 cursor-pointer border-rose-500/40 text-rose-400 bg-rose-500/10 hover:bg-rose-500/20"
        >
          <Flame className="w-3.5 h-3.5" />
          <span>{t.deletePermanently} (Shift+Del)</span>
        </button>

        <button
          type="button"
          onClick={onMoveToTrash}
          className="h-8 px-3.5 rounded text-[12px] font-medium flex items-center gap-1.5 cursor-pointer bg-amber-600 text-white hover:bg-amber-500"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>{t.moveToTrash} (Del)</span>
        </button>
      </div>
    </div>
  );
}
