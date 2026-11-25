export type FileCategory =
  | "video"
  | "archive"
  | "installer"
  | "image"
  | "audio"
  | "document"
  | "code_db"
  | "other";

export type ScanEngineKind = "auto" | "ntfs_mft" | "parallel_walker";
export type SortField = "size" | "allocated" | "name" | "files" | "folders" | "modified";
export type SortDir = "desc" | "asc";
export type SafetyLevel = "safe" | "warning" | "blocked";
export type DisplayMode = "size" | "allocated" | "files" | "percent";
export type SizeUnit = "auto" | "GB" | "MB" | "KB";

export interface DriveInfo {
  path: string;
  label: string;
  fsType: string;
  driveType: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
}

export interface SystemInfoDto {
  isAdmin: boolean;
  contextMenuEnabled: boolean;
  initialPath: string | null;
}

export interface NodeDto {
  id: number;
  parentId: number | null;
  name: string;
  fullPath: string;
  isDir: boolean;
  logicalSize: number;
  allocatedSize: number;
  fileCount: number;
  dirCount: number;
  modifiedTs: number;
  extension: string;
  category: FileCategory;
  percentOfParent: number;
  percentOfRoot: number;
  hasChildren: boolean;
  safetyLevel: SafetyLevel;
}

export interface ChildrenPage {
  parentId: number;
  totalCount: number;
  offset: number;
  items: NodeDto[];
}

export interface BreadcrumbItem {
  id: number;
  name: string;
  fullPath: string;
}

export interface ScanProgress {
  scanId: number;
  engine: ScanEngineKind;
  filesScanned: number;
  dirsScanned: number;
  bytesScanned: number;
  currentPath: string;
  elapsedMs: number;
}

export interface ScanSummary {
  rootId: number;
  rootPath: string;
  engineUsed: ScanEngineKind;
  fallbackReason: string | null;
  totalLogicalSize: number;
  totalAllocatedSize: number;
  totalFiles: number;
  totalDirs: number;
  elapsedMs: number;
  errorsCount: number;
}

export interface CategoryStat {
  category: FileCategory;
  logicalSize: number;
  allocatedSize: number;
  fileCount: number;
  percentOfTotal: number;
}

export interface JunkItem {
  nodeId: number;
  name: string;
  fullPath: string;
  isDir: boolean;
  logicalSize: number;
  allocatedSize: number;
  fileCount: number;
  modifiedTs: number;
  safetyLevel: SafetyLevel;
}

export interface JunkGroup {
  groupKey: string;
  totalSize: number;
  itemCount: number;
  items: JunkItem[];
}

export interface TreemapItem {
  id: number | null;
  name: string;
  fullPath: string;
  isDir: boolean;
  logicalSize: number;
  category: FileCategory;
  percentOfParent: number;
  isAggregate: boolean;
  safetyLevel: SafetyLevel;
}

export interface DeletePreviewItem {
  id: number;
  name: string;
  fullPath: string;
  isDir: boolean;
  logicalSize: number;
  safetyLevel: SafetyLevel;
  safetyReason: string | null;
}

export interface DeletePreview {
  items: DeletePreviewItem[];
  totalReclaimableBytes: number;
  safeCount: number;
  warningCount: number;
  blockedCount: number;
}

export interface DeleteFailure {
  id: number;
  fullPath: string;
  reason: string;
}

export interface DeleteReport {
  succeededIds: number[];
  failed: DeleteFailure[];
  freedBytes: number;
  permanent: boolean;
  updatedRootSize: number;
  updatedRootAllocated: number;
  updatedRootFiles: number;
  updatedRootDirs: number;
}

export interface SearchResult {
  items: NodeDto[];
  totalMatches: number;
  totalMatchedBytes: number;
  elapsedMs: number;
}

export interface ExpandedTreeEntry {
  node: NodeDto;
  depth: number;
  hasExpandedChildren: boolean;
}

export interface DuplicateProgress {
  stage: string;
  processed: number;
  total: number;
  groupsFound: number;
  wastedBytes: number;
}

export interface DuplicateFile {
  nodeId: number;
  name: string;
  fullPath: string;
  modifiedTs: number;
  safetyLevel: SafetyLevel;
}

export interface DuplicateGroup {
  hash: string;
  fileSize: number;
  wastedBytes: number;
  files: DuplicateFile[];
}

export interface DuplicateReport {
  groups: DuplicateGroup[];
  totalWastedBytes: number;
  totalDuplicateFiles: number;
  elapsedMs: number;
}

export interface RecycleBinInfo {
  sizeBytes: number;
  itemCount: number;
}

export interface GrowthDiffItem {
  path: string;
  name: string;
  beforeBytes: number;
  afterBytes: number;
  deltaBytes: number;
  beforeFiles: number;
  afterFiles: number;
  deltaFiles: number;
  status: string;
}

export interface SnapshotDiffReport {
  baselinePath: string;
  baselineTimestamp: number;
  currentPath: string;
  totalBeforeBytes: number;
  totalAfterBytes: number;
  totalDeltaBytes: number;
  items: GrowthDiffItem[];
}

export interface MoveReport {
  movedCount: number;
  failed: DeleteFailure[];
  updatedRootSize: number;
  updatedRootAllocated: number;
  updatedRootFiles: number;
  updatedRootDirs: number;
}

const KB = 1024;
const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

export function formatBytes(bytes: number, unit: SizeUnit = "auto"): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    if (unit === "GB") return "0.00 GB";
    if (unit === "MB") return "0.00 MB";
    if (unit === "KB") return "0.0 KB";
    return "0 B";
  }

  if (unit === "GB") {
    const val = bytes / GB;
    const decimals = val >= 1000 ? 1 : val >= 100 ? 1 : 2;
    return `${val.toFixed(decimals)} GB`;
  }

  if (unit === "MB") {
    const val = bytes / MB;
    const decimals = val >= 1000 ? 0 : val >= 100 ? 1 : 2;
    return `${val >= 1000 ? formatNumber(Math.round(val)) : val.toFixed(decimals)} MB`;
  }

  if (unit === "KB") {
    const val = bytes / KB;
    if (val >= 1000) return `${formatNumber(Math.round(val))} KB`;
    return `${val >= 100 ? val.toFixed(1) : val.toFixed(2)} KB`;
  }

  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, idx);
  if (idx === 0) return `${Math.round(bytes)} B`;
  const decimals = val >= 100 ? 1 : 2;
  return `${val.toFixed(decimals)} ${units[idx]}`;
}

export function formatSignedBytes(deltaBytes: number, unit: SizeUnit = "auto"): string {
  if (!Number.isFinite(deltaBytes) || deltaBytes === 0) {
    return formatBytes(0, unit);
  }
  const sign = deltaBytes > 0 ? "+" : "-";
  return `${sign}${formatBytes(Math.abs(deltaBytes), unit)}`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatDate(unixSec: number): string {
  if (!unixSec || unixSec <= 0) return "—";
  const d = new Date(unixSec * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(2)} s`;
  const mins = Math.floor(s / 60);
  const rem = (s % 60).toFixed(1);
  return `${mins}m ${rem}s`;
}

export const CATEGORY_COLORS: Record<FileCategory, string> = {
  video: "#e07a5f",
  archive: "#d99b26",
  installer: "#d95d74",
  image: "#52b788",
  audio: "#4ea8de",
  document: "#7f8fa6",
  code_db: "#9d7cd8",
  other: "#5c6b7f",
};
