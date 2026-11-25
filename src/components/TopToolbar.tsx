import React from "react";
import {
  FolderOpen,
  HardDrive,
  Play,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Square,
  Sun,
  Moon,
  Zap,
  Cpu,
} from "lucide-react";
import { DriveInfo, ScanEngineKind, SizeUnit, formatBytes } from "../types/disk";
import { LANGUAGES, LangCode } from "../i18n/translations";
import { useI18n } from "../i18n/useI18n";

interface TopToolbarProps {
  drives: DriveInfo[];
  targetPath: string;
  onTargetPathChange: (path: string) => void;
  onBrowseFolder: () => void;
  onStartScan: (path?: string) => void;
  onCancelScan: () => void;
  isScanning: boolean;
  isAdmin: boolean;
  onRelaunchAdmin: () => void;
  engineUsed: ScanEngineKind | null;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSearchSubmit: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  sizeUnit: SizeUnit;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}

export function TopToolbar({
  drives,
  targetPath,
  onTargetPathChange,
  onBrowseFolder,
  onStartScan,
  onCancelScan,
  isScanning,
  isAdmin,
  onRelaunchAdmin,
  engineUsed,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  searchInputRef,
  sizeUnit,
  theme,
  onToggleTheme,
  onOpenSettings,
}: TopToolbarProps) {
  const { lang, setLang, t } = useI18n();

  return (
    <header
      className="flex flex-col gap-2 px-3 py-2 border-b shrink-0"
      style={{
        backgroundColor: "var(--bg-panel)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        {/* Brand */}
        <div
          className="flex items-center gap-2 pr-2 border-r"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="w-6 h-6 rounded flex items-center justify-center bg-sky-500/15 text-sky-400">
            <HardDrive className="w-4 h-4" />
          </div>
          <span className="font-semibold text-[14px] tracking-tight">{t.appName}</span>
        </div>

        {/* Quick Drive Selector */}
        <select
          value={
            drives.some((d) => d.path.toLowerCase() === targetPath.toLowerCase())
              ? targetPath
              : ""
          }
          onChange={(e) => {
            if (e.target.value) {
              onTargetPathChange(e.target.value);
              onStartScan(e.target.value);
            }
          }}
          className="h-8 px-2 rounded border text-[12px] outline-none cursor-pointer"
          style={{
            backgroundColor: "var(--bg-elevated)",
            borderColor: "var(--border-subtle)",
            color: "var(--text-primary)",
          }}
          title="Select Drive"
        >
          <option value="" disabled>
            {drives.length > 0 ? "Drives..." : "Loading drives..."}
          </option>
          {drives.map((d) => {
            const pct =
              d.totalBytes > 0 ? Math.round((d.usedBytes / d.totalBytes) * 100) : 0;
            return (
              <option key={d.path} value={d.path}>
                {d.path} {d.label ? `(${d.label})` : ""} —{" "}
                {formatBytes(d.usedBytes, sizeUnit)} / {formatBytes(d.totalBytes, sizeUnit)}{" "}
                ({pct}%) [{d.fsType || d.driveType}]
              </option>
            );
          })}
        </select>

        {/* Editable Path Input */}
        <div
          className="flex items-center flex-1 min-w-[200px] h-8 rounded border overflow-hidden"
          style={{
            backgroundColor: "var(--bg-elevated)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <input
            type="text"
            value={targetPath}
            onChange={(e) => onTargetPathChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isScanning) {
                onStartScan();
              }
            }}
            placeholder="C:\ or D:\Projects"
            className="flex-1 h-full px-2.5 bg-transparent outline-none text-[12px] font-mono-num"
            style={{ color: "var(--text-primary)" }}
          />
          <button
            type="button"
            onClick={onBrowseFolder}
            className="h-full px-2.5 flex items-center gap-1.5 border-l text-[12px] hover:opacity-90 cursor-pointer"
            style={{
              borderColor: "var(--border-subtle)",
              color: "var(--text-secondary)",
              backgroundColor: "var(--bg-panel)",
            }}
            title={t.browseFolder}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t.browseFolder}</span>
          </button>
        </div>

        {/* Scan / Cancel */}
        {!isScanning ? (
          <button
            type="button"
            onClick={() => onStartScan()}
            disabled={!targetPath.trim()}
            className="h-8 px-3 rounded font-medium text-[12px] flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors"
            style={{
              backgroundColor: "var(--accent-strong)",
              color: "#ffffff",
            }}
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{engineUsed ? t.rescan : t.scan}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onCancelScan}
            className="h-8 px-3 rounded font-medium text-[12px] flex items-center gap-1.5 cursor-pointer bg-rose-600 text-white hover:bg-rose-500"
          >
            <Square className="w-3 h-3 fill-current" />
            <span>{t.cancel}</span>
          </button>
        )}

        {/* Engine / Admin Status */}
        {isAdmin ? (
          <div
            className="h-8 px-2.5 rounded border flex items-center gap-1.5 text-[11px] font-medium text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
            title={t.adminActive}
          >
            <Zap className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{t.adminActive}</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={onRelaunchAdmin}
            className="h-8 px-2.5 rounded border flex items-center gap-1.5 text-[11px] font-medium cursor-pointer hover:opacity-90 text-amber-400 border-amber-500/35 bg-amber-500/10"
            title="Restart elevated with UAC for ultra-fast NTFS MFT scanning"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{t.runAsAdmin}</span>
          </button>
        )}

        {/* Quick Search (Enter opens Global Search tab) */}
        <div
          className="flex items-center h-8 w-[200px] lg:w-[250px] px-2 rounded border gap-1.5"
          style={{
            backgroundColor: "var(--bg-elevated)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <Search
            className="w-3.5 h-3.5 shrink-0"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSearchSubmit();
              }
            }}
            placeholder={t.searchPlaceholder}
            className="w-full bg-transparent outline-none text-[12px]"
            style={{ color: "var(--text-primary)" }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="text-[11px] px-1 rounded cursor-pointer"
              style={{ color: "var(--text-muted)" }}
            >
              ×
            </button>
          )}
        </div>

        {/* Language Quick Switch */}
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value as LangCode)}
          className="h-8 px-1.5 rounded border text-[11px] outline-none cursor-pointer"
          style={{
            backgroundColor: "var(--bg-elevated)",
            borderColor: "var(--border-subtle)",
            color: "var(--text-secondary)",
          }}
          title={t.languageLabel}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.native}
            </option>
          ))}
        </select>

        {/* Theme & Settings */}
        <button
          type="button"
          onClick={onToggleTheme}
          className="h-8 w-8 rounded border flex items-center justify-center cursor-pointer hover:opacity-90"
          style={{
            backgroundColor: "var(--bg-elevated)",
            borderColor: "var(--border-subtle)",
            color: "var(--text-secondary)",
          }}
          title={theme === "dark" ? t.themeLight : t.themeDark}
        >
          {theme === "dark" ? (
            <Sun className="w-3.5 h-3.5" />
          ) : (
            <Moon className="w-3.5 h-3.5" />
          )}
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          className="h-8 w-8 rounded border flex items-center justify-center cursor-pointer hover:opacity-90"
          style={{
            backgroundColor: "var(--bg-elevated)",
            borderColor: "var(--border-subtle)",
            color: "var(--text-secondary)",
          }}
          title={t.settings}
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>

      {engineUsed && (
        <div className="hidden" aria-hidden="true">
          <ShieldCheck />
          <Cpu />
        </div>
      )}
    </header>
  );
}
