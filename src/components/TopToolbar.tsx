import appIcon from "../../src-tauri/icons/32x32.png";
import React from "react";
import {
  FolderOpen,
  Heart,
  Play,
  Search,
  Settings,
  ShieldAlert,
  Square,
  Zap,
} from "./PixelIcons";
import { DriveInfo, ScanEngineKind } from "../types/disk";
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
  healthActive: boolean;
  maxTempC: number | null;
  onOpenHealth: () => void;
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
  healthActive,
  maxTempC,
  onOpenHealth,
  onOpenSettings,
}: TopToolbarProps) {
  const { t } = useI18n();

  return (
    <header
      className="app-header shrink-0"
      style={{
        backgroundColor: "var(--bg-panel)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div className="utility-row">
        {/* Brand */}
        <div
          className="app-brand"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <img width="32" height="32" src={appIcon} alt="" />
          <span className="font-semibold text-[14px] tracking-tight">{t.appName}</span>
        </div>

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
            placeholder={t.tabSearch}
            aria-label={t.searchPlaceholder}
            className="w-full bg-transparent outline-none text-[12px]"
            style={{ color: "var(--text-primary)" }}
          />
          {!searchQuery && <kbd className="search-shortcut">Ctrl K</kbd>}
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

        <button
          type="button"
          onClick={onOpenHealth}
          className="h-8 px-2.5 rounded border flex items-center gap-1.5 text-[12px] font-medium cursor-pointer hover:opacity-90"
          style={{
            backgroundColor: healthActive ? "var(--bg-selected)" : "var(--bg-elevated)",
            borderColor: healthActive ? "var(--accent)" : "var(--border-subtle)",
            color: healthActive ? "var(--accent)" : "var(--text-primary)",
          }}
          title={t.healthTitle}
        >
          <Heart className="w-3.5 h-3.5 text-rose-400" />
          <span className="hidden sm:inline">{t.tabHealth}</span>
          {maxTempC !== null && (
            <span
              className="font-mono-num text-[11px] font-semibold"
              style={{
                color:
                  maxTempC >= 60
                    ? "var(--danger)"
                    : maxTempC >= 50
                    ? "var(--warning)"
                    : "var(--success)",
              }}
            >
              {maxTempC}°C
            </span>
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
      <div className="scan-controls">
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
          aria-label={t.availableDrives}
        >
          <option value="" disabled>
            {t.availableDrives}
          </option>
          {drives.map((drive) => (
            <option key={drive.path} value={drive.path}>{drive.path} {drive.label}</option>
          ))}
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
            className="h-8 px-2.5 rounded border flex items-center gap-1.5 text-[11px] font-medium cursor-pointer hover:opacity-90 admin-action"
            title={t.runAsAdmin}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{t.runAsAdmin}</span>
          </button>
        )}

      </div>

    </header>
  );
}
