import { useState } from "react";
import { AlertTriangle, ShieldBan, Trash2, Flame, X, Folder, File } from "lucide-react";
import { DeletePreview, SizeUnit, formatBytes } from "../types/disk";
import { useI18n } from "../i18n/useI18n";

interface DeleteConfirmModalProps {
  preview: DeletePreview;
  permanent: boolean;
  isDeleting: boolean;
  sizeUnit: SizeUnit;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmModal({
  preview,
  permanent,
  isDeleting,
  sizeUnit,
  onConfirm,
  onCancel,
}: DeleteConfirmModalProps) {
  const { t } = useI18n();
  const [ackPermanent, setAckPermanent] = useState(false);

  const deletableCount = preview.safeCount + preview.warningCount;
  const canConfirm = !isDeleting && deletableCount > 0 && (!permanent || ackPermanent);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
      <div
        className="w-full max-w-2xl rounded-lg border shadow-2xl flex flex-col max-h-[82vh]"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-strong)",
        }}
      >
        {/* Header */}
        <div
          className="px-4 py-3 border-b flex items-center justify-between"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2">
            {permanent ? (
              <Flame className="w-4 h-4 text-rose-400" />
            ) : (
              <Trash2 className="w-4 h-4 text-amber-400" />
            )}
            <h2 className="font-semibold text-[15px]">
              {permanent ? t.confirmPermanentTitle : t.confirmTrashTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="p-1 rounded hover:opacity-75 cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Notices */}
        <div className="px-4 pt-3 flex flex-col gap-2 text-[12px]">
          {permanent && (
            <div className="px-3 py-2 rounded border border-rose-500/40 bg-rose-500/10 text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{t.permanentWarning}</span>
            </div>
          )}

          {preview.blockedCount > 0 && (
            <div className="px-3 py-2 rounded border border-rose-500/35 bg-rose-500/10 text-rose-300 flex items-center gap-2">
              <ShieldBan className="w-4 h-4 shrink-0 text-rose-400" />
              <span>
                {t.blockedNotice} ({preview.blockedCount})
              </span>
            </div>
          )}

          {preview.warningCount > 0 && (
            <div className="px-3 py-2 rounded border border-amber-500/35 bg-amber-500/10 text-amber-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
              <span>
                {t.warningNotice} ({preview.warningCount})
              </span>
            </div>
          )}
        </div>

        {/* Item List */}
        <div className="px-4 py-3 overflow-y-auto flex-1">
          <div
            className="rounded border divide-y"
            style={{
              borderColor: "var(--border-subtle)",
              backgroundColor: "var(--bg-elevated)",
            }}
          >
            {preview.items.map((item) => (
              <div
                key={item.id}
                className="px-3 py-2 flex items-center justify-between gap-3 text-[12px]"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {item.isDir ? (
                    <Folder className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                  ) : (
                    <File className="w-3.5 h-3.5 shrink-0 text-sky-400" />
                  )}
                  <span className="truncate font-mono-num" title={item.fullPath}>
                    {item.fullPath}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {item.safetyLevel === "blocked" && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-500/15 text-rose-400 border border-rose-500/30">
                      {t.protectedLabel}
                    </span>
                  )}
                  {item.safetyLevel === "warning" && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                      {t.warningLabel}
                    </span>
                  )}
                  <span className="font-mono-num font-semibold w-24 text-right">
                    {formatBytes(item.logicalSize, sizeUnit)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-4 py-3 border-t flex flex-col gap-3"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          {permanent && deletableCount > 0 && (
            <label className="flex items-center gap-2 text-[12px] cursor-pointer">
              <input
                type="checkbox"
                checked={ackPermanent}
                onChange={(e) => setAckPermanent(e.target.checked)}
                className="accent-rose-500"
              />
              <span className="text-rose-300">{t.permanentAck}</span>
            </label>
          )}

          <div className="flex items-center justify-between gap-4">
            <div className="text-[12px]">
              <span style={{ color: "var(--text-muted)" }}>{t.reclaimable}: </span>
              <span className="font-mono-num font-semibold text-emerald-400">
                {formatBytes(preview.totalReclaimableBytes, sizeUnit)}
              </span>
              <span className="ml-2 font-mono-num" style={{ color: "var(--text-muted)" }}>
                ({deletableCount} {t.itemsCount})
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={isDeleting}
                className="h-8 px-3 rounded border text-[12px] cursor-pointer"
                style={{
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={!canConfirm}
                className={`h-8 px-4 rounded text-[12px] font-medium text-white cursor-pointer disabled:opacity-40 ${
                  permanent
                    ? "bg-rose-600 hover:bg-rose-500"
                    : "bg-amber-600 hover:bg-amber-500"
                }`}
              >
                {isDeleting
                  ? t.deleting
                  : permanent
                  ? t.confirmPermanentBtn
                  : t.confirmTrashBtn}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
