import { X } from "lucide-react";
import { LANGUAGES, LangCode } from "../i18n/translations";
import { useI18n } from "../i18n/useI18n";
import { ScanEngineKind } from "../types/disk";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  theme: "dark" | "light";
  onChangeTheme: (theme: "dark" | "light") => void;
  contextMenuEnabled: boolean;
  onToggleContextMenu: (enabled: boolean) => void;
  preferredEngine: ScanEngineKind;
  onChangeEngine: (engine: ScanEngineKind) => void;
}

export function SettingsModal({
  open,
  onClose,
  theme,
  onChangeTheme,
  contextMenuEnabled,
  onToggleContextMenu,
  preferredEngine,
  onChangeEngine,
}: SettingsModalProps) {
  const { lang, setLang, t } = useI18n();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="w-full max-w-lg rounded-lg border shadow-2xl"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-strong)",
        }}
      >
        <div
          className="px-4 py-3 border-b flex items-center justify-between"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <h2 className="font-semibold text-[15px]">{t.settingsTitle}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:opacity-75 cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4 text-[13px]">
          {/* Language */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
              {t.languageLabel}
            </label>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as LangCode)}
              className="h-9 px-2.5 rounded border outline-none text-[13px]"
              style={{
                backgroundColor: "var(--bg-elevated)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.native} ({l.label})
                </option>
              ))}
            </select>
          </div>

          {/* Theme */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
              {t.themeLabel}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onChangeTheme("dark")}
                className="h-9 rounded border text-[12px] font-medium cursor-pointer"
                style={{
                  backgroundColor: theme === "dark" ? "var(--bg-selected)" : "var(--bg-elevated)",
                  borderColor: theme === "dark" ? "var(--accent)" : "var(--border-subtle)",
                  color: theme === "dark" ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                {t.themeDark}
              </button>
              <button
                type="button"
                onClick={() => onChangeTheme("light")}
                className="h-9 rounded border text-[12px] font-medium cursor-pointer"
                style={{
                  backgroundColor: theme === "light" ? "var(--bg-selected)" : "var(--bg-elevated)",
                  borderColor: theme === "light" ? "var(--accent)" : "var(--border-subtle)",
                  color: theme === "light" ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                {t.themeLight}
              </button>
            </div>
          </div>

          {/* Scan Engine */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
              {t.scanEngineLabel}
            </label>
            <select
              value={preferredEngine}
              onChange={(e) => onChangeEngine(e.target.value as ScanEngineKind)}
              className="h-9 px-2.5 rounded border outline-none text-[12px]"
              style={{
                backgroundColor: "var(--bg-elevated)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            >
              <option value="auto">{t.engineAuto}</option>
              <option value="parallel_walker">{t.engineWalker}</option>
            </select>
          </div>

          {/* Windows Explorer Context Menu */}
          <div
            className="p-3 rounded border flex items-start justify-between gap-3"
            style={{
              backgroundColor: "var(--bg-elevated)",
              borderColor: "var(--border-subtle)",
            }}
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium">{t.explorerMenuLabel}</span>
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {t.explorerMenuDesc}
              </span>
            </div>
            <input
              type="checkbox"
              checked={contextMenuEnabled}
              onChange={(e) => onToggleContextMenu(e.target.checked)}
              className="mt-1 w-4 h-4 accent-sky-500 cursor-pointer"
            />
          </div>
        </div>

        <div
          className="px-4 py-3 border-t flex items-center justify-between text-[11px]"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
        >
          <span>DiskCleanupTool v0.2.0 • Rust + Tauri v2</span>
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-4 rounded text-[12px] font-medium cursor-pointer"
            style={{
              backgroundColor: "var(--accent-strong)",
              color: "#fff",
            }}
          >
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}
