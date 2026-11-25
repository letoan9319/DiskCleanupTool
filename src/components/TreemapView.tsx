import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronRight,
  ExternalLink,
  FolderOpen,
  Info,
  Terminal,
  Trash2,
} from "lucide-react";
import {
  BreadcrumbItem,
  CATEGORY_COLORS,
  SizeUnit,
  TreemapItem,
  formatBytes,
} from "../types/disk";
import { useI18n } from "../i18n/useI18n";

interface TreemapRect {
  item: TreemapItem;
  x: number;
  y: number;
  w: number;
  h: number;
}

function squarifyLayout(
  items: TreemapItem[],
  x: number,
  y: number,
  w: number,
  h: number
): TreemapRect[] {
  const total = items.reduce((s, it) => s + it.logicalSize, 0);
  if (total <= 0 || w <= 2 || h <= 2) return [];

  const rects: TreemapRect[] = [];
  let rx = x;
  let ry = y;
  let rw = w;
  let rh = h;
  let remainingTotal = total;

  let i = 0;
  while (i < items.length && rw > 2 && rh > 2) {
    const horizontalStrip = rw >= rh;
    const stripFixedLen = horizontalStrip ? rh : rw;

    let rowSum = 0;
    let bestWorst = Infinity;
    let endIdx = i;

    for (let j = i; j < items.length; j++) {
      rowSum += items[j].logicalSize;
      const stripThickness = ((rowSum / remainingTotal) * (rw * rh)) / stripFixedLen;
      if (stripThickness <= 0) continue;

      let worst = 0;
      for (let k = i; k <= j; k++) {
        const itemArea = (items[k].logicalSize / remainingTotal) * (rw * rh);
        const itemLen = itemArea / stripThickness;
        const aspect = Math.max(
          stripThickness / Math.max(itemLen, 0.5),
          itemLen / Math.max(stripThickness, 0.5)
        );
        if (aspect > worst) worst = aspect;
      }

      if (worst <= bestWorst) {
        bestWorst = worst;
        endIdx = j;
      } else {
        rowSum -= items[j].logicalSize;
        break;
      }
    }

    const rowItems = items.slice(i, endIdx + 1);
    const actualRowSum = rowItems.reduce((s, it) => s + it.logicalSize, 0);
    const stripArea = (actualRowSum / remainingTotal) * (rw * rh);
    const stripThickness = Math.max(1, stripArea / stripFixedLen);

    let cursor = 0;
    for (const it of rowItems) {
      const frac = actualRowSum > 0 ? it.logicalSize / actualRowSum : 0;
      const segLen = frac * stripFixedLen;
      if (horizontalStrip) {
        rects.push({
          item: it,
          x: rx,
          y: ry + cursor,
          w: stripThickness,
          h: segLen,
        });
      } else {
        rects.push({
          item: it,
          x: rx + cursor,
          y: ry,
          w: segLen,
          h: stripThickness,
        });
      }
      cursor += segLen;
    }

    if (horizontalStrip) {
      rx += stripThickness;
      rw -= stripThickness;
    } else {
      ry += stripThickness;
      rh -= stripThickness;
    }

    remainingTotal -= actualRowSum;
    i = endIdx + 1;
  }

  return rects;
}

interface TreemapViewProps {
  rootId: number;
  focusId?: number;
  onFocusChange?: (id: number) => void;
  highlightId?: number | null;
  compact?: boolean;
  sizeUnit: SizeUnit;
  scanVersion: number;
  selectedIds: Set<number>;
  onToggleSelectId: (id: number, size: number) => void;
  onRequestDelete: (ids: number[], permanent: boolean) => void;
  onRevealInExplorer: (path: string) => void;
  onOpenFile?: (path: string) => void;
  onOpenTerminal?: (path: string) => void;
  onShowProperties?: (path: string) => void;
}

export function TreemapView({
  rootId,
  focusId: controlledFocusId,
  onFocusChange,
  highlightId = null,
  compact = false,
  sizeUnit,
  scanVersion,
  selectedIds,
  onToggleSelectId,
  onRequestDelete,
  onRevealInExplorer,
  onOpenFile,
  onOpenTerminal,
  onShowProperties,
}: TreemapViewProps) {
  const { t } = useI18n();
  const [internalFocusId, setInternalFocusId] = useState<number>(rootId);
  const effectiveFocusId = controlledFocusId ?? internalFocusId;

  const updateFocus = (id: number) => {
    if (onFocusChange) {
      onFocusChange(id);
    } else {
      setInternalFocusId(id);
    }
  };

  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
  const [items, setItems] = useState<TreemapItem[]>([]);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 300 });
  const [hovered, setHovered] = useState<{
    rect: TreemapRect;
    clientX: number;
    clientY: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: TreemapItem;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (controlledFocusId === undefined) {
      setInternalFocusId(rootId);
    }
  }, [rootId, scanVersion, controlledFocusId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [tm, crumbs] = await Promise.all([
        invoke<TreemapItem[]>("get_treemap_children", {
          dirId: effectiveFocusId,
          maxItems: 48,
        }),
        invoke<BreadcrumbItem[]>("get_node_ancestors", { nodeId: effectiveFocusId }),
      ]);
      if (!cancelled) {
        setItems(tm);
        setBreadcrumbs(crumbs);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveFocusId, scanVersion]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        if (cr.width > 10 && cr.height > 10) {
          setCanvasSize({ w: Math.floor(cr.width), h: Math.floor(cr.height) });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  const rects = useMemo(
    () => squarifyLayout(items, 4, 4, canvasSize.w - 8, canvasSize.h - 8),
    [items, canvasSize]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.w * dpr;
    canvas.height = canvasSize.h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasSize.w, canvasSize.h);

    for (const r of rects) {
      const pad = 1.5;
      const rx = r.x + pad;
      const ry = r.y + pad;
      const rw = Math.max(0, r.w - pad * 2);
      const rh = Math.max(0, r.h - pad * 2);
      if (rw < 2 || rh < 2) continue;

      const isSelected = r.item.id !== null && selectedIds.has(r.item.id);
      const isHighlighted = highlightId !== null && r.item.id === highlightId;
      const isHovered = hovered?.rect.item === r.item;

      const baseColor = r.item.isDir
        ? "#d97706"
        : r.item.isAggregate
        ? "#475569"
        : CATEGORY_COLORS[r.item.category];

      ctx.fillStyle = baseColor;
      ctx.globalAlpha = isHighlighted || isHovered ? 0.96 : 0.78;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.globalAlpha = 1;

      if (isHighlighted) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.5;
        ctx.strokeRect(rx + 0.5, ry + 0.5, Math.max(0, rw - 1), Math.max(0, rh - 1));
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rx + 2.5, ry + 2.5, Math.max(0, rw - 5), Math.max(0, rh - 5));
      } else {
        ctx.strokeStyle = isSelected
          ? "#38bdf8"
          : isHovered
          ? "#ffffff"
          : "rgba(15, 23, 42, 0.75)";
        ctx.lineWidth = isSelected ? 2.5 : 1;
        ctx.strokeRect(rx, ry, rw, rh);
      }

      if (rw >= 60 && rh >= 28) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rx + 4, ry + 3, rw - 8, rh - 6);
        ctx.clip();

        ctx.fillStyle = "#ffffff";
        ctx.font = "600 11px 'IBM Plex Sans', 'Segoe UI', sans-serif";
        ctx.fillText(
          r.item.isDir ? `📁 ${r.item.name}` : r.item.name,
          rx + 6,
          ry + 15
        );

        if (rh >= 38) {
          ctx.fillStyle = "rgba(255,255,255,0.88)";
          ctx.font = "500 10px 'IBM Plex Mono', Consolas, monospace";
          ctx.fillText(
            `${formatBytes(r.item.logicalSize, sizeUnit)} (${r.item.percentOfParent.toFixed(1)}%)`,
            rx + 6,
            ry + 29
          );
        }
        ctx.restore();
      }
    }
  }, [rects, canvasSize, selectedIds, highlightId, hovered, sizeUnit]);

  const hitTest = (e: React.MouseEvent<HTMLCanvasElement>): TreemapRect | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    const px = e.clientX - bounds.left;
    const py = e.clientY - bounds.top;
    return (
      rects.find((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) || null
    );
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header / Breadcrumb */}
      <div
        className={`px-3 border-b flex items-center justify-between gap-2 text-[11px] shrink-0 ${
          compact ? "py-1" : "py-1.5 text-[12px]"
        }`}
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <div className="flex items-center gap-1 overflow-x-auto">
          {compact && (
            <span
              className="font-semibold uppercase tracking-wider text-[10px] mr-1 shrink-0"
              style={{ color: "var(--text-muted)" }}
            >
              {t.tabTreemap}:
            </span>
          )}
          {breadcrumbs.map((crumb, idx) => (
            <React.Fragment key={crumb.id}>
              {idx > 0 && (
                <ChevronRight
                  className="w-3 h-3 shrink-0"
                  style={{ color: "var(--text-muted)" }}
                />
              )}
              <button
                type="button"
                onClick={() => updateFocus(crumb.id)}
                className={`px-1 py-0.5 rounded hover:underline cursor-pointer shrink-0 font-mono-num ${
                  idx === breadcrumbs.length - 1 ? "font-semibold text-sky-400" : ""
                }`}
                style={{
                  color:
                    idx === breadcrumbs.length - 1
                      ? "var(--accent)"
                      : "var(--text-secondary)",
                }}
              >
                {crumb.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        <span
          className="text-[11px] shrink-0 hidden md:inline"
          style={{ color: "var(--text-muted)" }}
        >
          {t.treemapHint}
        </span>
      </div>

      {/* Canvas Container */}
      <div ref={containerRef} className="flex-1 min-h-0 relative overflow-hidden">
        <canvas
          ref={canvasRef}
          style={{ width: canvasSize.w, height: canvasSize.h }}
          className="block cursor-pointer"
          onMouseMove={(e) => {
            const rect = hitTest(e);
            setHovered(rect ? { rect, clientX: e.clientX, clientY: e.clientY } : null);
          }}
          onMouseLeave={() => setHovered(null)}
          onClick={(e) => {
            const rect = hitTest(e);
            if (rect && rect.item.id !== null && rect.item.safetyLevel !== "blocked") {
              onToggleSelectId(rect.item.id, rect.item.logicalSize);
            }
          }}
          onDoubleClick={(e) => {
            const rect = hitTest(e);
            if (rect && rect.item.isDir && rect.item.id !== null) {
              updateFocus(rect.item.id);
            } else if (rect && !rect.item.isDir && onOpenFile) {
              onOpenFile(rect.item.fullPath);
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            const rect = hitTest(e);
            if (rect && !rect.item.isAggregate) {
              setContextMenu({ x: e.clientX, y: e.clientY, item: rect.item });
            }
          }}
        />

        {hovered && (
          <div
            className="fixed z-40 pointer-events-none px-2.5 py-1.5 rounded border shadow-xl text-[11px] max-w-sm"
            style={{
              top: Math.min(hovered.clientY + 14, window.innerHeight - 90),
              left: Math.min(hovered.clientX + 14, window.innerWidth - 320),
              backgroundColor: "var(--bg-panel)",
              borderColor: "var(--border-strong)",
            }}
          >
            <div className="font-semibold truncate">{hovered.rect.item.name}</div>
            <div className="font-mono-num text-sky-400">
              {formatBytes(hovered.rect.item.logicalSize, sizeUnit)} (
              {hovered.rect.item.percentOfParent.toFixed(1)}%)
            </div>
            <div
              className="font-mono-num truncate text-[10px]"
              style={{ color: "var(--text-muted)" }}
            >
              {hovered.rect.item.fullPath}
            </div>
          </div>
        )}

        {contextMenu && (
          <div
            className="fixed z-50 min-w-[200px] py-1 rounded-md border shadow-xl text-[12px]"
            style={{
              top: Math.min(contextMenu.y, window.innerHeight - 210),
              left: Math.min(contextMenu.x, window.innerWidth - 220),
              backgroundColor: "var(--bg-panel)",
              borderColor: "var(--border-strong)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {!contextMenu.item.isDir && onOpenFile && (
              <button
                type="button"
                onClick={() => {
                  onOpenFile(contextMenu.item.fullPath);
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-white/10 text-left cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5 text-sky-400" />
                <span>{t.openFile}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onRevealInExplorer(contextMenu.item.fullPath);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-white/10 text-left cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
              <span>{t.revealExplorer}</span>
            </button>
            {onOpenTerminal && (
              <button
                type="button"
                onClick={() => {
                  onOpenTerminal(contextMenu.item.fullPath);
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-white/10 text-left cursor-pointer"
              >
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                <span>{t.openTerminal}</span>
              </button>
            )}
            {onShowProperties && (
              <button
                type="button"
                onClick={() => {
                  onShowProperties(contextMenu.item.fullPath);
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-white/10 text-left cursor-pointer"
              >
                <Info className="w-3.5 h-3.5" style={{ color: "var(--text-secondary)" }} />
                <span>{t.properties}</span>
              </button>
            )}
            {contextMenu.item.id !== null && contextMenu.item.safetyLevel !== "blocked" && (
              <>
                <div
                  className="my-1 border-t"
                  style={{ borderColor: "var(--border-subtle)" }}
                />
                <button
                  type="button"
                  onClick={() => {
                    onRequestDelete([contextMenu.item.id!], false);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-amber-500/15 text-amber-400 text-left cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{t.moveToTrash}</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
