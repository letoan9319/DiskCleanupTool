import type { HTMLAttributes } from "react";

// Windows supplies the glyphs through Segoe Fluent Icons or Segoe MDL2 Assets.
function windowsIcon(codePoint: number) {
  const glyph = String.fromCodePoint(codePoint);
  return function WindowsIcon({ className = "", ...props }: HTMLAttributes<HTMLSpanElement>) {
    return <span {...props} aria-hidden="true" className={`windows-icon ${className}`}>{glyph}</span>;
  };
}

export const AlertTriangle = windowsIcon(0xE7BA);
export const ArrowDown = windowsIcon(0xE74B);
export const ArrowLeft = windowsIcon(0xE72B);
export const ArrowRight = windowsIcon(0xE72A);
export const ArrowUp = windowsIcon(0xE74A);
export const Camera = windowsIcon(0xE722);
export const CheckCircle2 = windowsIcon(0xE73E);
export const CheckSquare = windowsIcon(0xE73D);
export const ChevronDown = windowsIcon(0xE70D);
export const ChevronRight = windowsIcon(0xE76C);
export const Columns2 = windowsIcon(0xE89F);
export const Copy = windowsIcon(0xE8C8);
export const CopyCheck = windowsIcon(0xE8C8);
export const Cpu = windowsIcon(0xE950);
export const Download = windowsIcon(0xE896);
export const ExternalLink = windowsIcon(0xE8A7);
export const File = windowsIcon(0xE7C3);
export const FileJson = windowsIcon(0xE943);
export const FileSpreadsheet = windowsIcon(0xE9F9);
export const Flame = windowsIcon(0xE7BA);
export const Folder = windowsIcon(0xE8B7);
export const FolderInput = windowsIcon(0xE8DE);
export const FolderOpen = windowsIcon(0xE838);
export const FolderPlus = windowsIcon(0xE8F4);
export const FolderTree = windowsIcon(0xED41);
export const FolderX = windowsIcon(0xE8BB);
export const GitCompareArrows = windowsIcon(0xE8AB);
export const HardDrive = windowsIcon(0xEDA2);
export const Info = windowsIcon(0xE946);
export const LayoutGrid = windowsIcon(0xF0E2);
export const ListTree = windowsIcon(0xE8FD);
export const Minimize2 = windowsIcon(0xE921);
export const Moon = windowsIcon(0xE708);
export const MoveRight = windowsIcon(0xE72A);
export const Pencil = windowsIcon(0xE70F);
export const Play = windowsIcon(0xE768);
export const Search = windowsIcon(0xE721);
export const Settings = windowsIcon(0xE713);
export const ShieldAlert = windowsIcon(0xEA18);
export const ShieldBan = windowsIcon(0xEA18);
export const Sparkles = windowsIcon(0xEA99);
export const Square = windowsIcon(0xE71A);
export const Sun = windowsIcon(0xE706);
export const Terminal = windowsIcon(0xE756);
export const Trash2 = windowsIcon(0xE74D);
export const TrendingDown = windowsIcon(0xE74B);
export const TrendingUp = windowsIcon(0xE74A);
export const X = windowsIcon(0xE8BB);
export const Zap = windowsIcon(0xE945);
export const Heart = windowsIcon(0xEB51);
export const RefreshCw = windowsIcon(0xE72C);
export const Clock = windowsIcon(0xE823);
export const Gauge = windowsIcon(0xEC4A);
export const Activity = windowsIcon(0xE9D9);
