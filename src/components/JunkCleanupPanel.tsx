import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  CheckSquare,
  Copy,
  File,
  Folder,
  FolderOpen,
  FolderX,
  HardDrive,
  Sparkles,
  Terminal,
  Trash2,
} from "./WindowsIcons";
import {
  CATEGORY_COLORS,
  CategoryStat,
  FileCategory,
  JunkGroup,
  JunkItem,
  NodeDto,
  SizeUnit,
  formatBytes,
  formatNumber,
} from "../types/disk";
import { useI18n } from "../i18n/useI18n";

interface JunkCleanupPanelProps {
  scanVersion: number;
  sizeUnit: SizeUnit;
  selectedIds: Set<number>;
  onSelectCategory: (cat: FileCategory) => void;
  onToggleJunkItems: (items: JunkItem[], select: boolean) => void;
  onToggleEmptyFolders: (folders: NodeDto[], select: boolean) => void;
  onRequestDelete: (ids: number[], permanent: boolean) => void;
  onRevealInExplorer: (path: string) => void;
  onCopyText: (text: string, message: string) => void;
}

export function JunkCleanupPanel({
  scanVersion,
  sizeUnit,
  selectedIds,
  onSelectCategory,
  onToggleJunkItems,
  onToggleEmptyFolders,
  onRequestDelete,
  onRevealInExplorer,
  onCopyText,
}: JunkCleanupPanelProps) {
  const { t } = useI18n();
  const [categories, setCategories] = useState<CategoryStat[]>([]);
  const [junkGroups, setJunkGroups] = useState<JunkGroup[]>([]);
  const [emptyFolders, setEmptyFolders] = useState<NodeDto[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cats, junk, empties] = await Promise.all([
        invoke<CategoryStat[]>("get_category_breakdown"),
        invoke<JunkGroup[]>("get_junk_targets"),
        invoke<NodeDto[]>("get_empty_folders", { limit: 500 }).catch(() => []),
      ]);
      if (!cancelled) {
        setCategories(cats);
        setJunkGroups(junk);
        setEmptyFolders(empties);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scanVersion]);

  const { vhdxGroups, regularJunkGroups } = useMemo(() => {
    const vhdx: JunkGroup[] = [];
    const regular: JunkGroup[] = [];
    for (const g of junkGroups) {
      if (g.groupKey === "virtual_disks") {
        vhdx.push(g);
      } else {
        regular.push(g);
      }
    }
    return { vhdxGroups: vhdx, regularJunkGroups: regular };
  }, [junkGroups]);

  const vhdxItems = useMemo(
    () => vhdxGroups.flatMap((g) => g.items),
    [vhdxGroups]
  );

  const catLabel = (cat: FileCategory): string => {
    const key = `cat_${cat}` as keyof typeof t;
    return (t[key] as string) || cat;
  };

  const junkLabel = (groupKey: string): string => {
    const key = `junk_${groupKey}` as keyof typeof t;
    return (t[key] as string) || groupKey;
  };

  const selectableEmptyFolders = useMemo(
    () => emptyFolders.filter((f) => f.safetyLevel !== "blocked"),
    [emptyFolders]
  );

  const allEmptySelected =
    selectableEmptyFolders.length > 0 &&
    selectableEmptyFolders.every((f) => selectedIds.has(f.id));

  const buildDiskpartCmd = (vhdxPath: string) =>
    [
      "wsl --shutdown",
      `echo select vdisk file="${vhdxPath}" > "%TEMP%\\compact_vhdx.txt"`,
      `echo attach vdisk readonly >> "%TEMP%\\compact_vhdx.txt"`,
      `echo compact vdisk >> "%TEMP%\\compact_vhdx.txt"`,
      `echo detach vdisk >> "%TEMP%\\compact_vhdx.txt"`,
      `diskpart /s "%TEMP%\\compact_vhdx.txt"`,
    ].join("\r\n");

  const buildOptimizeVhdCmd = (vhdxPath: string) =>
    `wsl --shutdown; Optimize-VHD -Path "${vhdxPath}" -Mode Full`;

  return (
    <div className="flex-1 overflow-y-auto p-3 grid grid-cols-1 lg:grid-cols-12 gap-3">
      {/* Category Breakdown */}
      <section
        className="lg:col-span-5 rounded-md border p-3 flex flex-col gap-3 self-start"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <h3 className="text-[13px] font-semibold">{t.categoryBreakdown}</h3>
        <div className="flex flex-col gap-2">
          {categories.map((c) => {
            const color = CATEGORY_COLORS[c.category];
            return (
              <button
                key={c.category}
                type="button"
                onClick={() => onSelectCategory(c.category)}
                className="flex flex-col gap-1 text-left p-2 rounded border hover:border-sky-500/50 cursor-pointer transition-colors"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                <div className="flex items-center justify-between text-[12px]">
                  <div className="flex items-center gap-2 font-medium">
                    <span
                      className="w-2.5 h-2.5 rounded-sm"
                      style={{ backgroundColor: color }}
                    />
                    <span>{catLabel(c.category)}</span>
                    <span
                      className="font-mono-num text-[11px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      ({formatNumber(c.fileCount)})
                    </span>
                  </div>
                  <div className="font-mono-num font-semibold">
                    {formatBytes(c.logicalSize, sizeUnit)}{" "}
                    <span
                      className="text-[11px] font-normal"
                      style={{ color: "var(--text-muted)" }}
                    >
                      ({c.percentOfTotal.toFixed(1)}%)
                    </span>
                  </div>
                </div>
                <div
                  className="w-full h-1.5 rounded-sm overflow-hidden"
                  style={{ backgroundColor: "var(--bar-track)" }}
                >
                  <div
                    className="h-full rounded-sm"
                    style={{
                      width: `${Math.max(c.percentOfTotal > 0 ? 1 : 0, c.percentOfTotal)}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>

        {/* Empty Folders Section */}
        <div
          className="mt-2 pt-3 border-t flex flex-col gap-2"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FolderX className="w-4 h-4 text-sky-400" />
              <h3 className="text-[13px] font-semibold">
                {t.emptyFoldersTitle}{" "}
                <span
                  className="font-mono-num text-[11px] font-normal"
                  style={{ color: "var(--text-muted)" }}
                >
                  ({formatNumber(emptyFolders.length)})
                </span>
              </h3>
            </div>
            {selectableEmptyFolders.length > 0 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    onToggleEmptyFolders(selectableEmptyFolders, !allEmptySelected)
                  }
                  className="h-6 px-2 rounded border text-[11px] flex items-center gap-1 cursor-pointer"
                  style={{
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <CheckSquare className="w-3 h-3" />
                  <span>{allEmptySelected ? t.unselectGroup : t.selectGroup}</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onRequestDelete(
                      selectableEmptyFolders.map((f) => f.id),
                      false
                    )
                  }
                  className="h-6 px-2 rounded border border-amber-500/40 bg-amber-500/10 text-amber-400 text-[11px] flex items-center gap-1 cursor-pointer hover:bg-amber-500/20"
                  title={t.moveToTrash}
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{t.moveToTrash}</span>
                </button>
              </div>
            )}
          </div>

          {emptyFolders.length === 0 ? (
            <div className="text-[12px] py-3" style={{ color: "var(--text-muted)" }}>
              {t.emptyFoldersNone}
            </div>
          ) : (
            <div
              className="rounded border divide-y max-h-60 overflow-y-auto"
              style={{
                backgroundColor: "var(--bg-elevated)",
                borderColor: "var(--border-subtle)",
              }}
            >
              {emptyFolders.slice(0, 200).map((folder) => {
                const checked = selectedIds.has(folder.id);
                return (
                  <div
                    key={folder.id}
                    className="px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px] hover:bg-white/[0.03]"
                    style={{ borderColor: "var(--border-subtle)" }}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={folder.safetyLevel === "blocked"}
                        onChange={() => onToggleEmptyFolders([folder], !checked)}
                        className="w-3.5 h-3.5 accent-sky-500 cursor-pointer shrink-0"
                      />
                      <Folder className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                      <span
                        className="truncate font-mono-num"
                        title={folder.fullPath}
                      >
                        {folder.fullPath}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onRevealInExplorer(folder.fullPath)}
                        className="p-1 rounded hover:bg-white/10 cursor-pointer"
                        style={{ color: "var(--text-muted)" }}
                        title={t.revealExplorer}
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                      </button>
                      {folder.safetyLevel !== "blocked" && (
                        <button
                          type="button"
                          onClick={() => onRequestDelete([folder.id], false)}
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
      </section>

      {/* Right Column: Virtual Disks Alert + Junk & Dev Artifacts */}
      <div className="lg:col-span-7 flex flex-col gap-3">
        {/* Virtual Disks (WSL2 / Docker .vhdx) Alert Cards */}
        {vhdxItems.length > 0 && (
          <section
            className="rounded-md border p-3 flex flex-col gap-2.5"
            style={{
              backgroundColor: "var(--bg-panel)",
              borderColor: "rgba(245, 158, 11, 0.45)",
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <h3 className="text-[13px] font-semibold">{t.vhdxAlertTitle}</h3>
              </div>
              <span className="font-mono-num text-[12px] font-semibold text-amber-400">
                {formatBytes(
                  vhdxItems.reduce((acc, it) => acc + it.logicalSize, 0),
                  sizeUnit
                )}
              </span>
            </div>

            <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
              {t.vhdxAlertDesc}
            </p>

            <div className="flex flex-col gap-2">
              {vhdxItems.map((vhdx) => (
                <div
                  key={vhdx.nodeId}
                  className="rounded border p-2.5 flex flex-col gap-2"
                  style={{
                    backgroundColor: "var(--bg-elevated)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <HardDrive className="w-4 h-4 text-amber-400 shrink-0" />
                      <span
                        className="truncate font-mono-num text-[11px] font-medium"
                        title={vhdx.fullPath}
                      >
                        {vhdx.fullPath}
                      </span>
                    </div>
                    <span className="font-mono-num text-[12px] font-semibold text-amber-400 shrink-0">
                      {formatBytes(vhdx.logicalSize, sizeUnit)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                    <button
                      type="button"
                      onClick={() =>
                        onCopyText(buildDiskpartCmd(vhdx.fullPath), t.compactCmdCopied)
                      }
                      className="h-6 px-2.5 rounded border border-sky-500/40 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 flex items-center gap-1 cursor-pointer font-medium"
                    >
                      <Copy className="w-3 h-3" />
                      <span>{t.copyDiskpartCmd}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onCopyText(
                          buildOptimizeVhdCmd(vhdx.fullPath),
                          t.compactCmdCopied
                        )
                      }
                      className="h-6 px-2.5 rounded border flex items-center gap-1 cursor-pointer hover:border-sky-500/50"
                      style={{
                        borderColor: "var(--border-subtle)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      <Terminal className="w-3 h-3" />
                      <span>{t.copyOptimizeVhdCmd}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onRevealInExplorer(vhdx.fullPath)}
                      className="h-6 px-2 rounded border flex items-center gap-1 cursor-pointer ml-auto"
                      style={{
                        borderColor: "var(--border-subtle)",
                        color: "var(--text-muted)",
                      }}
                      title={t.revealExplorer}
                    >
                      <FolderOpen className="w-3 h-3" />
                      <span>{t.revealExplorer}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Junk & Dev Artifacts */}
        <section
          className="rounded-md border p-3 flex flex-col gap-3"
          style={{
            backgroundColor: "var(--bg-panel)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <h3 className="text-[13px] font-semibold">{t.junkDetection}</h3>
            </div>
            <span className="font-mono-num text-[12px] text-emerald-400 font-semibold">
              {t.reclaimable}:{" "}
              {formatBytes(
                regularJunkGroups.reduce((acc, g) => acc + g.totalSize, 0),
                sizeUnit
              )}
            </span>
          </div>

          {regularJunkGroups.length === 0 ? (
            <div
              className="py-12 text-center text-[13px]"
              style={{ color: "var(--text-muted)" }}
            >
              {t.noJunkFound}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {regularJunkGroups.map((group) => {
                const selectable = group.items.filter(
                  (it) => it.safetyLevel !== "blocked"
                );
                const allSelected =
                  selectable.length > 0 &&
                  selectable.every((it) => selectedIds.has(it.nodeId));
                return (
                  <div
                    key={group.groupKey}
                    className="rounded border overflow-hidden shrink-0"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      borderColor: "var(--border-subtle)",
                    }}
                  >
                    <div
                      className="px-3 py-2 border-b flex items-center justify-between gap-2"
                      style={{
                        borderColor: "var(--border-subtle)",
                        backgroundColor: "var(--bg-panel)",
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-[12px] truncate">
                          {junkLabel(group.groupKey)}
                        </span>
                        <span
                          className="font-mono-num text-[11px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          ({group.itemCount})
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono-num text-[12px] font-semibold text-amber-400">
                          {formatBytes(group.totalSize, sizeUnit)}
                        </span>
                        {selectable.length > 0 && (
                          <button
                            type="button"
                            onClick={() => onToggleJunkItems(group.items, !allSelected)}
                            className="h-6 px-2 rounded border text-[11px] flex items-center gap-1 cursor-pointer"
                            style={{
                              borderColor: "var(--border-subtle)",
                              color: "var(--text-secondary)",
                            }}
                          >
                            <CheckSquare className="w-3 h-3" />
                            <span>{allSelected ? t.unselectGroup : t.selectGroup}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div
                      className="divide-y max-h-56 overflow-y-auto"
                      style={{ borderColor: "var(--border-subtle)" }}
                    >
                      {group.items.slice(0, 50).map((item) => {
                        const checked = selectedIds.has(item.nodeId);
                        return (
                          <div
                            key={item.nodeId}
                            className="px-3 py-1.5 flex items-center justify-between gap-2 text-[12px] hover:bg-white/[0.03]"
                            style={{ borderColor: "var(--border-subtle)" }}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={item.safetyLevel === "blocked"}
                                onChange={() => onToggleJunkItems([item], !checked)}
                                className="w-3.5 h-3.5 accent-sky-500 cursor-pointer"
                              />
                              {item.isDir ? (
                                <Folder className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                              ) : (
                                <File className="w-3.5 h-3.5 shrink-0 text-sky-400" />
                              )}
                              <span
                                className="truncate font-mono-num text-[11px]"
                                title={item.fullPath}
                              >
                                {item.fullPath}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span className="font-mono-num font-semibold">
                                {formatBytes(item.logicalSize, sizeUnit)}
                              </span>
                              <button
                                type="button"
                                onClick={() => onRevealInExplorer(item.fullPath)}
                                className="p-1 rounded hover:bg-white/10 cursor-pointer"
                                style={{ color: "var(--text-muted)" }}
                                title={t.revealExplorer}
                              >
                                <FolderOpen className="w-3.5 h-3.5" />
                              </button>
                              {item.safetyLevel !== "blocked" && (
                                <button
                                  type="button"
                                  onClick={() => onRequestDelete([item.nodeId], false)}
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
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
