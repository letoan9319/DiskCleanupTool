import driveArt from "./assets/disk-array.png";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  CopyCheck,
  FileSpreadsheet,
  FolderTree,
  FolderOpen,
  Heart,
  LayoutGrid,
  Search,
  Sparkles,
  Trash2,
  X,
} from "./components/PixelIcons";
import {
  BreadcrumbItem,
  DeletePreview,
  DeleteReport,
  DiskHealthReport,
  DisplayMode,
  DriveInfo,
  FileCategory,
  JunkItem,
  MoveReport,
  NodeDto,
  RecycleBinInfo,
  ScanEngineKind,
  ScanProgress,
  ScanSummary,
  SizeUnit,
  SystemInfoDto,
  formatBytes,
  formatNumber,
} from "./types/disk";
import { I18nProvider, useI18n } from "./i18n/useI18n";
import { TopToolbar } from "./components/TopToolbar";
import { DriveOverviewBar } from "./components/DriveOverviewBar";
import { ViewControlBar } from "./components/ViewControlBar";
import { TreeTable } from "./components/TreeTable";
import { GlobalSearchView } from "./components/GlobalSearchView";
import { TopFilesTable } from "./components/TopFilesTable";
import { DuplicatesPanel } from "./components/DuplicatesPanel";
import { JunkCleanupPanel } from "./components/JunkCleanupPanel";
import { TreemapView } from "./components/TreemapView";
import { DiskHealthPanel } from "./components/DiskHealthPanel";
import { SelectionActionBar } from "./components/SelectionActionBar";
import { DeleteConfirmModal } from "./components/DeleteConfirmModal";
import { SnapshotDiffModal } from "./components/SnapshotDiffModal";
import { SettingsModal } from "./components/SettingsModal";

type ActiveTab = "tree" | "search" | "top_files" | "duplicates" | "junk" | "treemap" | "health";

function DiskCleanupShell() {
  const { t } = useI18n();

  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      return localStorage.getItem("diskcleanup.theme") === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });
  const [preferredEngine, setPreferredEngine] = useState<ScanEngineKind>("auto");

  const [systemInfo, setSystemInfo] = useState<SystemInfoDto>({
    isAdmin: false,
    contextMenuEnabled: false,
    initialPath: null,
  });
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [diskHealth, setDiskHealth] = useState<DiskHealthReport | null>(null);
  const [healthLoading, setHealthLoading] = useState<boolean>(false);
  const [healthAutoRefreshSec, setHealthAutoRefreshSec] = useState<number>(60);
  const [recycleBin, setRecycleBin] = useState<RecycleBinInfo | null>(null);
  const [targetPath, setTargetPath] = useState<string>("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("tree");
  const [topFilesCatFilter, setTopFilesCatFilter] = useState<FileCategory | null>(null);

  // View controls state
  const [displayMode, setDisplayMode] = useState<DisplayMode>("size");
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>("auto");
  const [splitView, setSplitView] = useState<boolean>(false);
  const [splitRatio, setSplitRatio] = useState<number>(58);
  const [expandRequest, setExpandRequest] = useState<{
    level: number;
    seq: number;
  } | null>(null);

  // Navigation history for focusId (shared by TreeTable & synced TreemapView)
  const [navHistory, setNavHistory] = useState<{ stack: number[]; index: number }>({
    stack: [],
    index: -1,
  });
  const [currentBreadcrumbs, setCurrentBreadcrumbs] = useState<BreadcrumbItem[]>([]);
  const [activeRowId, setActiveRowId] = useState<number | null>(null);

  // Scan state
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [scanVersion, setScanVersion] = useState(0);
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set());

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMap, setSelectedMap] = useState<Map<number, number>>(new Map());

  // Modals
  const [deleteModal, setDeleteModal] = useState<{
    preview: DeletePreview;
    permanent: boolean;
    ids: number[];
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [snapshotModalOpen, setSnapshotModalOpen] = useState(false);
  const [emptyBinModalOpen, setEmptyBinModalOpen] = useState(false);
  const [isEmptyingBin, setIsEmptyingBin] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; isError?: boolean } | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

  const showToast = useCallback((message: string, isError = false) => {
    setToast({ message, isError });
    window.setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 3600);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("diskcleanup.theme", theme);
    } catch {
      // ignore
    }
  }, [theme]);

  // Ctrl+K search focus shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const refreshDrives = useCallback(async () => {
    try {
      const list = await invoke<DriveInfo[]>("list_drives");
      setDrives(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  const refreshRecycleBin = useCallback(async () => {
    try {
      const info = await invoke<RecycleBinInfo>("get_recycle_bin_info");
      setRecycleBin(info);
    } catch {
      // ignore on non-windows or error
    }
  }, []);

  const refreshDiskHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const rep = await invoke<DiskHealthReport>("get_disk_health");
      setDiskHealth(rep);
    } catch {
      // ignore on unsupported platforms
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (healthAutoRefreshSec <= 0) return;
    const id = window.setInterval(() => {
      void refreshDiskHealth();
    }, healthAutoRefreshSec * 1000);
    return () => window.clearInterval(id);
  }, [healthAutoRefreshSec, refreshDiskHealth]);

  const currentFocusId =
    navHistory.index >= 0 && navHistory.index < navHistory.stack.length
      ? navHistory.stack[navHistory.index]
      : summary?.rootId ?? 0;

  const navigateFocus = useCallback((nextId: number) => {
    setNavHistory((prev) => {
      const cur = prev.index >= 0 ? prev.stack[prev.index] : undefined;
      if (cur === nextId) return prev;
      const truncated = prev.stack.slice(0, prev.index + 1);
      truncated.push(nextId);
      return { stack: truncated, index: truncated.length - 1 };
    });
    setActiveRowId(null);
  }, []);

  const handleNavBack = useCallback(() => {
    setNavHistory((prev) =>
      prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev
    );
    setActiveRowId(null);
  }, []);

  const handleNavForward = useCallback(() => {
    setNavHistory((prev) =>
      prev.index < prev.stack.length - 1 ? { ...prev, index: prev.index + 1 } : prev
    );
    setActiveRowId(null);
  }, []);

  const handleNavUp = useCallback(() => {
    if (currentBreadcrumbs.length >= 2) {
      const parentCrumb = currentBreadcrumbs[currentBreadcrumbs.length - 2];
      navigateFocus(parentCrumb.id);
    }
  }, [currentBreadcrumbs, navigateFocus]);

  const canBack = navHistory.index > 0;
  const canForward = navHistory.index >= 0 && navHistory.index < navHistory.stack.length - 1;
  const canUp = currentBreadcrumbs.length >= 2;

  const startScan = useCallback(
    async (explicitPath?: string) => {
      const pathToScan = (explicitPath ?? targetPath).trim();
      if (!pathToScan) return;

      setTargetPath(pathToScan);
      setIsScanning(true);
      setProgress(null);
      setSelectedMap(new Map());
      setDeletedIds(new Set());

      try {
        const res = await invoke<ScanSummary>("start_scan", {
          path: pathToScan,
          engineMode: preferredEngine,
        });
        setSummary(res);
        setActiveTab((prev) => (prev === "health" ? "tree" : prev));
        setNavHistory({ stack: [res.rootId], index: 0 });
        setCurrentBreadcrumbs([]);
        setActiveRowId(null);
        setScanVersion((v) => v + 1);
        void refreshDrives();
        void refreshRecycleBin();
      } catch (err) {
        const msg = String(err);
        if (!msg.toLowerCase().includes("cancel")) {
          showToast(msg, true);
        }
      } finally {
        setIsScanning(false);
        setProgress(null);
      }
    },
    [targetPath, preferredEngine, refreshDrives, refreshRecycleBin, showToast]
  );

  // Startup initialization + Tauri event listeners
  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenOpenPath: (() => void) | undefined;

    (async () => {
      const [sys, driveList] = await Promise.all([
        invoke<SystemInfoDto>("get_system_info"),
        refreshDrives(),
        refreshRecycleBin(),
        refreshDiskHealth(),
      ]);
      setSystemInfo(sys);

      if (sys.initialTab === "health") {
        setActiveTab("health");
      }

      if (sys.initialPath) {
        setTargetPath(sys.initialPath);
        void startScan(sys.initialPath);
      } else if (driveList.length > 0) {
        setTargetPath(driveList[0].path);
      }

      unlistenProgress = await listen<ScanProgress>("scan-progress", (ev) => {
        setProgress(ev.payload);
      });

      unlistenOpenPath = await listen<string>("open-scan-path", (ev) => {
        if (ev.payload) {
          void startScan(ev.payload);
        }
      });
    })();

    return () => {
      unlistenProgress?.();
      unlistenOpenPath?.();
    };
  }, []);

  const handleBrowseFolder = async () => {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: targetPath || undefined,
    });
    if (typeof picked === "string" && picked.trim()) {
      setTargetPath(picked);
      void startScan(picked);
    }
  };

  const handleCancelScan = async () => {
    await invoke("cancel_scan");
  };

  const handleRelaunchAdmin = async (tab?: string) => {
    try {
      await invoke("relaunch_as_admin", {
        targetPath: targetPath.trim() || null,
        initialTab: tab ?? (activeTab === "health" ? "health" : null),
      });
    } catch (err) {
      showToast(String(err), true);
    }
  };

  const handleToggleContextMenu = async (enabled: boolean) => {
    try {
      const actual = await invoke<boolean>("set_context_menu", { enabled });
      setSystemInfo((prev) => ({ ...prev, contextMenuEnabled: actual }));
    } catch (err) {
      showToast(String(err), true);
    }
  };

  const selectedIds = useMemo(() => new Set(selectedMap.keys()), [selectedMap]);
  const selectedTotalBytes = useMemo(() => {
    let sum = 0;
    for (const v of selectedMap.values()) sum += v;
    return sum;
  }, [selectedMap]);

  const handleToggleSelectNode = useCallback((node: NodeDto) => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (next.has(node.id)) {
        next.delete(node.id);
      } else {
        next.set(node.id, node.logicalSize);
      }
      return next;
    });
  }, []);

  const handleToggleSelectId = useCallback((id: number, size: number) => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, size);
      return next;
    });
  }, []);

  const handleBulkUpdateSelection = useCallback(
    (toSelect: { id: number; size: number }[], toUnselect: number[]) => {
      setSelectedMap((prev) => {
        const next = new Map(prev);
        for (const id of toUnselect) next.delete(id);
        for (const entry of toSelect) next.set(entry.id, entry.size);
        return next;
      });
    },
    []
  );

  const handleToggleJunkItems = useCallback((items: JunkItem[], select: boolean) => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      for (const it of items) {
        if (it.safetyLevel === "blocked") continue;
        if (select) next.set(it.nodeId, it.logicalSize);
        else next.delete(it.nodeId);
      }
      return next;
    });
  }, []);

  const handleToggleEmptyFolders = useCallback((folders: NodeDto[], select: boolean) => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      for (const f of folders) {
        if (f.safetyLevel === "blocked") continue;
        if (select) next.set(f.id, f.logicalSize);
        else next.delete(f.id);
      }
      return next;
    });
  }, []);

  const handleRequestDelete = useCallback(
    async (ids: number[], permanent: boolean) => {
      if (ids.length === 0) return;
      try {
        const preview = await invoke<DeletePreview>("preview_delete", { nodeIds: ids });
        setDeleteModal({ preview, permanent, ids });
      } catch (err) {
        showToast(String(err), true);
      }
    },
    [showToast]
  );

  const handleConfirmDelete = async () => {
    if (!deleteModal) return;
    setIsDeleting(true);
    try {
      const report = await invoke<DeleteReport>("execute_delete", {
        nodeIds: deleteModal.ids,
        permanent: deleteModal.permanent,
      });

      setSummary((prev) =>
        prev
          ? {
              ...prev,
              totalLogicalSize: report.updatedRootSize,
              totalAllocatedSize: report.updatedRootAllocated,
              totalFiles: report.updatedRootFiles,
              totalDirs: report.updatedRootDirs,
            }
          : prev
      );

      setSelectedMap((prev) => {
        const next = new Map(prev);
        for (const sid of report.succeededIds) next.delete(sid);
        return next;
      });

      setDeletedIds((prev) => {
        const next = new Set(prev);
        for (const sid of report.succeededIds) next.add(sid);
        return next;
      });

      setScanVersion((v) => v + 1);
      setDeleteModal(null);
      void refreshDrives();
      void refreshRecycleBin();

      if (report.failed.length > 0) {
        showToast(
          `${t.deleteSuccess}: ${formatBytes(report.freedBytes, sizeUnit)} • ${t.deletePartial} (${report.failed.length})`,
          true
        );
      } else {
        showToast(`${t.deleteSuccess}: ${formatBytes(report.freedBytes, sizeUnit)}`);
      }
    } catch (err) {
      showToast(String(err), true);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmEmptyRecycleBin = async () => {
    setIsEmptyingBin(true);
    try {
      await invoke("empty_recycle_bin");
      setEmptyBinModalOpen(false);
      await Promise.all([refreshRecycleBin(), refreshDrives()]);
      showToast(t.recycleBinEmptied);
    } catch (err) {
      showToast(String(err), true);
    } finally {
      setIsEmptyingBin(false);
    }
  };

  const handleRevealInExplorer = useCallback(
    async (path: string) => {
      try {
        await invoke("reveal_in_explorer", { path });
      } catch (err) {
        showToast(String(err), true);
      }
    },
    [showToast]
  );

  const handleOpenFile = useCallback(
    async (path: string) => {
      try {
        await invoke("open_file", { path });
      } catch (err) {
        showToast(String(err), true);
      }
    },
    [showToast]
  );

  const handleOpenTerminal = useCallback(
    async (path: string) => {
      try {
        await invoke("open_terminal", { path });
      } catch (err) {
        showToast(String(err), true);
      }
    },
    [showToast]
  );

  const handleShowProperties = useCallback(
    async (path: string) => {
      try {
        await invoke("show_properties", { path });
      } catch (err) {
        showToast(String(err), true);
      }
    },
    [showToast]
  );

  const handleCopyText = useCallback(
    async (text: string, toastMessage: string) => {
      try {
        await navigator.clipboard.writeText(text);
        showToast(toastMessage);
      } catch {
        // ignore clipboard error
      }
    },
    [showToast]
  );

  const handleCopyPath = useCallback(
    (path: string) => {
      void handleCopyText(path, t.pathCopied);
    },
    [handleCopyText, t.pathCopied]
  );

  const handleMoveNodes = useCallback(
    async (nodeIds: number[]) => {
      if (nodeIds.length === 0) return;
      try {
        const destDir = await openDialog({
          directory: true,
          multiple: false,
          defaultPath: targetPath || undefined,
        });
        if (typeof destDir !== "string" || !destDir.trim()) return;

        const report = await invoke<MoveReport>("move_items", {
          nodeIds,
          destDir,
        });

        setSummary((prev) =>
          prev
            ? {
                ...prev,
                totalLogicalSize: report.updatedRootSize,
                totalAllocatedSize: report.updatedRootAllocated,
                totalFiles: report.updatedRootFiles,
                totalDirs: report.updatedRootDirs,
              }
            : prev
        );

        const failedSet = new Set(report.failed.map((f) => f.id));
        const movedIds = nodeIds.filter((id) => !failedSet.has(id));

        setSelectedMap((prev) => {
          const next = new Map(prev);
          for (const id of movedIds) next.delete(id);
          return next;
        });

        setDeletedIds((prev) => {
          const next = new Set(prev);
          for (const id of movedIds) next.add(id);
          return next;
        });

        setScanVersion((v) => v + 1);
        void refreshDrives();

        if (report.failed.length > 0) {
          showToast(
            `${t.moveSuccess}: ${report.movedCount} • ${t.movePartial} (${report.failed.length})`,
            true
          );
        } else {
          showToast(`${t.moveSuccess}: ${report.movedCount} ${t.itemsCount}`);
        }
      } catch (err) {
        showToast(String(err), true);
      }
    },
    [targetPath, refreshDrives, showToast, t.moveSuccess, t.movePartial, t.itemsCount]
  );

  const handleRenameNode = useCallback(
    async (node: NodeDto, newName: string) => {
      try {
        await invoke<NodeDto>("rename_item", {
          nodeId: node.id,
          newName,
        });
        setScanVersion((v) => v + 1);
        showToast(t.renameSuccess);
      } catch (err) {
        showToast(String(err), true);
        throw err;
      }
    },
    [showToast, t.renameSuccess]
  );

  const handleCreateFolder = useCallback(
    async (parentId: number, name: string) => {
      try {
        await invoke<NodeDto>("create_folder", {
          parentId,
          name,
        });
        setSummary((prev) =>
          prev ? { ...prev, totalDirs: prev.totalDirs + 1 } : prev
        );
        setScanVersion((v) => v + 1);
        showToast(t.folderCreated);
      } catch (err) {
        showToast(String(err), true);
        throw err;
      }
    },
    [showToast, t.folderCreated]
  );

  const handleExport = useCallback(
    async (format: "csv" | "json") => {
      try {
        const scope = activeTab === "top_files" ? "top_files" : "tree";
        const destPath = await saveDialog({
          defaultPath: `disk-report-${scope}.${format}`,
          filters: [
            {
              name: format.toUpperCase(),
              extensions: [format],
            },
          ],
        });
        if (!destPath) return;

        const rows = await invoke<number>("export_report", {
          format,
          scope,
          destPath,
        });
        showToast(`${t.exportSuccess}: ${formatNumber(rows)}`);
      } catch (err) {
        showToast(String(err), true);
      }
    },
    [activeTab, showToast, t.exportSuccess]
  );

  const handleExpandLevel = useCallback((level: number) => {
    setActiveTab("tree");
    setExpandRequest((prev) => ({ level, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  const handleToggleSplitView = useCallback(() => {
    setActiveTab("tree");
    setSplitView((prev) => !prev);
  }, []);

  const handleSearchSubmit = useCallback(() => {
    if (summary) {
      setActiveTab("search");
    }
  }, [summary]);

  // Drag splitter for Split View
  const handleStartSplitDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;

    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      if (rect.height <= 0) return;
      const pct = ((ev.clientY - rect.top) / rect.height) * 100;
      setSplitRatio(Math.max(25, Math.min(78, pct)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const maxTempC = useMemo(() => {
    if (!diskHealth || diskHealth.disks.length === 0) return null;
    let hottest: number | null = null;
    for (const d of diskHealth.disks) {
      if (d.temperatureC !== null && (hottest === null || d.temperatureC > hottest)) {
        hottest = d.temperatureC;
      }
    }
    return hottest;
  }, [diskHealth]);

  const healthByDriveLetter = useMemo(() => {
    const map = new Map<string, { pct: number | null; tempC: number | null; status: string }>();
    if (!diskHealth) return map;
    for (const d of diskHealth.disks) {
      for (const letter of d.driveLetters) {
        map.set(letter.toUpperCase(), {
          pct: d.healthPercent,
          tempC: d.temperatureC,
          status: d.healthStatus,
        });
      }
    }
    return map;
  }, [diskHealth]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <TopToolbar
        drives={drives}
        targetPath={targetPath}
        onTargetPathChange={setTargetPath}
        onBrowseFolder={handleBrowseFolder}
        onStartScan={startScan}
        onCancelScan={handleCancelScan}
        isScanning={isScanning}
        isAdmin={systemInfo.isAdmin}
        onRelaunchAdmin={() => void handleRelaunchAdmin()}
        engineUsed={summary?.engineUsed ?? null}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSearchSubmit={handleSearchSubmit}
        searchInputRef={searchInputRef}
        healthActive={activeTab === "health"}
        maxTempC={maxTempC}
        onOpenHealth={() => {
          setActiveTab("health");
          if (!diskHealth) void refreshDiskHealth();
        }}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <DriveOverviewBar
        drives={drives}
        summary={summary}
        progress={progress}
        isScanning={isScanning}
        sizeUnit={sizeUnit}
      />

      {/* ViewControlBar */}
      {summary && activeTab !== "health" && (
        <ViewControlBar
          canBack={canBack}
          canForward={canForward}
          canUp={canUp}
          onBack={handleNavBack}
          onForward={handleNavForward}
          onUp={handleNavUp}
          displayMode={displayMode}
          onDisplayModeChange={setDisplayMode}
          sizeUnit={sizeUnit}
          onSizeUnitChange={setSizeUnit}
          onExpandLevel={handleExpandLevel}
          splitView={splitView}
          onToggleSplitView={handleToggleSplitView}
          onExport={handleExport}
          onOpenSnapshotModal={() => setSnapshotModalOpen(true)}
          recycleBin={recycleBin}
          onRequestEmptyRecycleBin={() => {
            if (recycleBin && recycleBin.itemCount === 0 && recycleBin.sizeBytes === 0) {
              showToast(t.recycleBinEmpty);
            } else {
              setEmptyBinModalOpen(true);
            }
          }}
        />
      )}

      {/* Tabs */}
      {summary && (
        <nav
          className="px-3 border-b flex items-center gap-1 shrink-0 overflow-x-auto"
          style={{
            backgroundColor: "var(--bg-panel)",
            borderColor: "var(--border-subtle)",
          }}
        >
          {(
            [
              { id: "tree", label: t.tabTree, icon: FolderTree },
              { id: "search", label: t.tabSearch, icon: Search },
              { id: "top_files", label: t.tabTopFiles, icon: FileSpreadsheet },
              { id: "duplicates", label: t.tabDuplicates, icon: CopyCheck },
              { id: "junk", label: t.tabJunk, icon: Sparkles },
              { id: "treemap", label: t.tabTreemap, icon: LayoutGrid },
              { id: "health", label: t.tabHealth, icon: Heart },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                aria-current={active ? "page" : undefined}
                type="button"
                onClick={() => {
                  if (tab.id !== "top_files") setTopFilesCatFilter(null);
                  setActiveTab(tab.id);
                }}
                className="px-3 py-2 text-[12px] font-medium flex items-center gap-1.5 border-b-2 cursor-pointer transition-colors shrink-0"
                style={{
                  borderColor: active ? "var(--accent)" : "transparent",
                  color: active ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* Main Content */}
      <main className="flex-1 min-h-0 flex flex-col">
        {activeTab === "health" ? (
          <DiskHealthPanel
            report={diskHealth}
            loading={healthLoading}
            hasScanSummary={summary !== null}
            autoRefreshSec={healthAutoRefreshSec}
            onChangeAutoRefresh={setHealthAutoRefreshSec}
            onRefresh={() => void refreshDiskHealth()}
            onRelaunchAdmin={() => void handleRelaunchAdmin("health")}
            onBackHome={() => setActiveTab("tree")}
            onCopyText={handleCopyText}
            onToast={showToast}
          />
        ) : !summary ? (
          <section className="home-screen">
            <div className="home-content">
              <div className="welcome-panel">
                <div className="welcome-copy">
                  <h1>{t.emptyTitle}</h1>
                  <p>{t.emptySubtitle}</p>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <button type="button" className="folder-action" onClick={handleBrowseFolder} disabled={isScanning}>
                      <FolderOpen className="w-4 h-4" />{t.browseFolder}
                    </button>
                    <button
                      type="button"
                      className="folder-action"
                      style={{
                        background: "var(--bg-elevated)",
                        color: "var(--text-primary)",
                      }}
                      onClick={() => {
                        setActiveTab("health");
                        if (!diskHealth) void refreshDiskHealth();
                      }}
                    >
                      <Heart className="w-4 h-4 text-rose-400" />
                      {t.tabHealth}
                      {maxTempC !== null ? ` (${maxTempC}°C)` : ""}
                    </button>
                  </div>
                </div>
                <div className="disk-scene" aria-hidden="true"><img src={driveArt} alt="" /></div>
              </div>
            {drives.length > 0 && (
              <>
              <h2 className="drive-heading">{t.availableDrives}</h2>
              <div className="drive-grid">
                {drives.map((d) => {
                  const usedPct =
                    d.totalBytes > 0
                      ? Math.min(100, (d.usedBytes / d.totalBytes) * 100)
                      : 0;
                  const dh = healthByDriveLetter.get(d.path.slice(0, 2).toUpperCase());
                  return (
                    <button
                      key={d.path}
                      type="button"
                      onClick={() => {
                        setTargetPath(d.path);
                        void startScan(d.path);
                      }}
                      disabled={isScanning}
                      className="drive-card p-3 border text-left flex flex-col gap-2 hover:border-sky-500/60 cursor-pointer transition-colors"
                      style={{
                        backgroundColor: "var(--bg-panel)",
                        borderColor: "var(--border-subtle)",
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[13px] truncate">
                          {d.path} {d.label ? `(${d.label})` : ""}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {dh && (dh.pct !== null || dh.tempC !== null) && (
                            <span
                              className="font-mono-num text-[10px] px-1.5 py-0.5 rounded border"
                              style={{
                                borderColor: "var(--border-subtle)",
                                color:
                                  dh.tempC !== null && dh.tempC >= 60
                                    ? "var(--danger)"
                                    : dh.status === "caution"
                                    ? "var(--warning)"
                                    : "var(--success)",
                              }}
                            >
                              {dh.pct !== null ? `${dh.pct}%` : ""}
                              {dh.pct !== null && dh.tempC !== null ? " · " : ""}
                              {dh.tempC !== null ? `${dh.tempC}°C` : ""}
                            </span>
                          )}
                          <span
                            className="font-mono-num text-[10px] px-1.5 py-0.5 rounded border"
                            style={{
                              borderColor: "var(--border-subtle)",
                              color: "var(--text-muted)",
                            }}
                          >
                            {d.fsType || d.driveType}
                          </span>
                        </div>
                      </div>
                      <div
                        className="w-full h-2 rounded-full overflow-hidden"
                        style={{ backgroundColor: "var(--bar-track)" }}
                      >
                        <div
                          className="h-full"
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
                      <div
                        className="flex items-center justify-between text-[11px] font-mono-num"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        <span>
                          {formatBytes(d.usedBytes, sizeUnit)} /{" "}
                          {formatBytes(d.totalBytes, sizeUnit)}
                        </span>
                        <span>
                          {t.freeSpace}: {formatBytes(d.freeBytes, sizeUnit)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
              </>
            )}
            </div>
          </section>
        ) : activeTab === "tree" ? (
          <div ref={splitContainerRef} className="flex flex-col flex-1 min-h-0">
            <div
              className="flex flex-col min-h-0"
              style={
                splitView
                  ? { height: `${splitRatio}%`, flexShrink: 0 }
                  : { flex: "1 1 0%" }
              }
            >
              <TreeTable
                rootId={summary.rootId}
                focusId={currentFocusId}
                onFocusChange={navigateFocus}
                onBreadcrumbsChange={setCurrentBreadcrumbs}
                activeRowId={activeRowId}
                onActiveRowChange={setActiveRowId}
                scanVersion={scanVersion}
                searchQuery={searchQuery}
                displayMode={displayMode}
                sizeUnit={sizeUnit}
                expandRequest={expandRequest}
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelectNode}
                onRequestDelete={handleRequestDelete}
                onRevealInExplorer={handleRevealInExplorer}
                onOpenFile={handleOpenFile}
                onOpenTerminal={handleOpenTerminal}
                onShowProperties={handleShowProperties}
                onCopyPath={handleCopyPath}
                onMoveNodes={handleMoveNodes}
                onRenameNode={handleRenameNode}
                onCreateFolder={handleCreateFolder}
              />
            </div>

            {splitView && (
              <>
                <div
                  onMouseDown={handleStartSplitDrag}
                  className="h-1.5 shrink-0 cursor-row-resize flex items-center justify-center border-y hover:bg-sky-500/20 transition-colors"
                  style={{
                    backgroundColor: "var(--bg-elevated)",
                    borderColor: "var(--border-strong)",
                  }}
                >
                  <span
                    className="w-10 h-0.5 rounded-full"
                    style={{ backgroundColor: "var(--text-muted)" }}
                  />
                </div>
                <div className="flex-1 min-h-0 flex flex-col">
                  <TreemapView
                    rootId={summary.rootId}
                    focusId={currentFocusId}
                    onFocusChange={navigateFocus}
                    highlightId={activeRowId}
                    compact
                    sizeUnit={sizeUnit}
                    scanVersion={scanVersion}
                    selectedIds={selectedIds}
                    onToggleSelectId={handleToggleSelectId}
                    onRequestDelete={handleRequestDelete}
                    onRevealInExplorer={handleRevealInExplorer}
                    onOpenFile={handleOpenFile}
                    onOpenTerminal={handleOpenTerminal}
                    onShowProperties={handleShowProperties}
                  />
                </div>
              </>
            )}
          </div>
        ) : activeTab === "search" ? (
          <GlobalSearchView
            scanVersion={scanVersion}
            query={searchQuery}
            onQueryChange={setSearchQuery}
            sizeUnit={sizeUnit}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelectNode}
            onRequestDelete={handleRequestDelete}
            onRevealInExplorer={handleRevealInExplorer}
            onOpenFile={handleOpenFile}
            onFocusFolder={(dirId) => {
              navigateFocus(dirId);
              setActiveTab("tree");
            }}
          />
        ) : activeTab === "top_files" ? (
          <TopFilesTable
            scanVersion={scanVersion}
            searchQuery={searchQuery}
            sizeUnit={sizeUnit}
            selectedIds={selectedIds}
            initialCategory={topFilesCatFilter}
            onToggleSelect={handleToggleSelectNode}
            onRequestDelete={handleRequestDelete}
            onRevealInExplorer={handleRevealInExplorer}
            onOpenFile={handleOpenFile}
          />
        ) : activeTab === "duplicates" ? (
          <DuplicatesPanel
            scanVersion={scanVersion}
            deletedIds={deletedIds}
            sizeUnit={sizeUnit}
            selectedIds={selectedIds}
            onToggleSelectId={handleToggleSelectId}
            onBulkUpdateSelection={handleBulkUpdateSelection}
            onRequestDelete={handleRequestDelete}
            onRevealInExplorer={handleRevealInExplorer}
            onOpenFile={handleOpenFile}
            onNotify={showToast}
          />
        ) : activeTab === "junk" ? (
          <JunkCleanupPanel
            scanVersion={scanVersion}
            sizeUnit={sizeUnit}
            selectedIds={selectedIds}
            onSelectCategory={(cat) => {
              setTopFilesCatFilter(cat);
              setActiveTab("top_files");
            }}
            onToggleJunkItems={handleToggleJunkItems}
            onToggleEmptyFolders={handleToggleEmptyFolders}
            onRequestDelete={handleRequestDelete}
            onRevealInExplorer={handleRevealInExplorer}
            onCopyText={handleCopyText}
          />
        ) : (
          <TreemapView
            rootId={summary.rootId}
            focusId={currentFocusId}
            onFocusChange={navigateFocus}
            highlightId={activeRowId}
            sizeUnit={sizeUnit}
            scanVersion={scanVersion}
            selectedIds={selectedIds}
            onToggleSelectId={handleToggleSelectId}
            onRequestDelete={handleRequestDelete}
            onRevealInExplorer={handleRevealInExplorer}
            onOpenFile={handleOpenFile}
            onOpenTerminal={handleOpenTerminal}
            onShowProperties={handleShowProperties}
          />
        )}
      </main>

      <SelectionActionBar
        selectedCount={selectedIds.size}
        selectedTotalBytes={selectedTotalBytes}
        sizeUnit={sizeUnit}
        onMoveToTrash={() => handleRequestDelete(Array.from(selectedIds), false)}
        onDeletePermanent={() => handleRequestDelete(Array.from(selectedIds), true)}
        onClear={() => setSelectedMap(new Map())}
      />

      {deleteModal && (
        <DeleteConfirmModal
          preview={deleteModal.preview}
          permanent={deleteModal.permanent}
          isDeleting={isDeleting}
          sizeUnit={sizeUnit}
          onConfirm={handleConfirmDelete}
          onCancel={() => {
            if (!isDeleting) setDeleteModal(null);
          }}
        />
      )}

      <SnapshotDiffModal
        open={snapshotModalOpen}
        onClose={() => setSnapshotModalOpen(false)}
        sizeUnit={sizeUnit}
        onNotify={showToast}
      />

      {/* Confirm Empty Recycle Bin Modal */}
      {emptyBinModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div
            className="w-full max-w-md rounded-lg border shadow-2xl overflow-hidden"
            style={{
              backgroundColor: "var(--bg-panel)",
              borderColor: "var(--border-strong)",
            }}
          >
            <div
              className="px-4 py-3 border-b flex items-center justify-between"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-rose-400" />
                <h2 className="font-semibold text-[14px]">
                  {t.confirmEmptyBinTitle}
                </h2>
              </div>
              <button
                type="button"
                disabled={isEmptyingBin}
                onClick={() => setEmptyBinModalOpen(false)}
                className="p-1 rounded hover:opacity-75 cursor-pointer"
                style={{ color: "var(--text-muted)" }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3 text-[12px]">
              <div className="px-3 py-2 rounded border border-rose-500/40 bg-rose-500/10 text-rose-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                <span>{t.confirmEmptyBinDesc}</span>
              </div>
              {recycleBin && (
                <div className="font-mono-num text-[12px] flex items-center justify-between px-1">
                  <span style={{ color: "var(--text-muted)" }}>{t.recycleBin}:</span>
                  <span className="font-semibold text-amber-400">
                    {formatBytes(recycleBin.sizeBytes, sizeUnit)} (
                    {formatNumber(recycleBin.itemCount)} {t.itemsCount})
                  </span>
                </div>
              )}
            </div>
            <div
              className="px-4 py-3 border-t flex items-center justify-end gap-2"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <button
                type="button"
                disabled={isEmptyingBin}
                onClick={() => setEmptyBinModalOpen(false)}
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
                disabled={isEmptyingBin}
                onClick={handleConfirmEmptyRecycleBin}
                className="h-8 px-4 rounded text-[12px] font-medium bg-rose-600 hover:bg-rose-500 text-white cursor-pointer disabled:opacity-45"
              >
                {isEmptyingBin ? t.deleting : t.emptyRecycleBin}
              </button>
            </div>
          </div>
        </div>
      )}

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onChangeTheme={setTheme}
        contextMenuEnabled={systemInfo.contextMenuEnabled}
        onToggleContextMenu={handleToggleContextMenu}
        preferredEngine={preferredEngine}
        onChangeEngine={setPreferredEngine}
      />

      {toast && (
        <div
          className={`fixed bottom-14 right-4 z-50 px-3.5 py-2 rounded-md border shadow-lg text-[12px] font-medium ${
            toast.isError
              ? "bg-rose-950/90 border-rose-500/50 text-rose-200"
              : "bg-slate-900/95 border-sky-500/40 text-sky-100"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <DiskCleanupShell />
    </I18nProvider>
  );
}
