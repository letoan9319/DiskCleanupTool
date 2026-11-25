export type LangCode = "en" | "vi" | "zh" | "ja" | "ko" | "es" | "de" | "fr";

export const LANGUAGES: { code: LangCode; label: string; native: string }[] = [
  { code: "en", label: "English", native: "English" },
  { code: "vi", label: "Vietnamese", native: "Tiếng Việt" },
  { code: "zh", label: "Chinese (Simplified)", native: "简体中文" },
  { code: "ja", label: "Japanese", native: "日本語" },
  { code: "ko", label: "Korean", native: "한국어" },
  { code: "es", label: "Spanish", native: "Español" },
  { code: "de", label: "German", native: "Deutsch" },
  { code: "fr", label: "French", native: "Français" },
];

export interface TranslationDict {
  appName: string;
  browseFolder: string;
  scan: string;
  rescan: string;
  cancel: string;
  scanning: string;
  runAsAdmin: string;
  adminActive: string;
  mftBadge: string;
  walkerBadge: string;
  searchPlaceholder: string;
  settings: string;
  themeDark: string;
  themeLight: string;

  // Tabs
  tabTree: string;
  viewOptions: string;
  tools: string;
  tabSearch: string;
  tabTopFiles: string;
  tabDuplicates: string;
  tabJunk: string;
  tabTreemap: string;

  // Overview bar
  target: string;
  scannedSize: string;
  allocatedSize: string;
  filesFolders: string;
  scanTime: string;
  engine: string;
  driveUsed: string;
  freeSpace: string;

  // ViewControlBar
  navBack: string;
  navForward: string;
  navUp: string;
  modeSize: string;
  modeAllocated: string;
  modeFiles: string;
  modePercent: string;
  unitAuto: string;
  expandLv1: string;
  expandLv2: string;
  expandLv3: string;
  collapseAll: string;
  treeOnly: string;
  splitView: string;
  exportCsv: string;
  exportJson: string;
  snapshotDiff: string;
  recycleBin: string;
  emptyRecycleBin: string;
  confirmEmptyBinTitle: string;
  confirmEmptyBinDesc: string;
  recycleBinEmptied: string;
  recycleBinEmpty: string;

  // Table headers
  colName: string;
  colShare: string;
  colSize: string;
  colAllocated: string;
  colFiles: string;
  colFolders: string;
  colModified: string;
  colActions: string;
  colPath: string;
  colCategory: string;

  // Empty & states
  availableDrives: string;
  emptyTitle: string;
  emptySubtitle: string;
  selectDriveHint: string;
  noMatches: string;
  loading: string;
  itemsCount: string;

  // Context menu & file operations
  openFile: string;
  revealExplorer: string;
  openTerminal: string;
  copyPath: string;
  zoomFolder: string;
  moveToFolder: string;
  newFolder: string;
  renameItem: string;
  properties: string;
  moveToTrash: string;
  deletePermanently: string;
  pathCopied: string;
  newFolderPrompt: string;
  renamePrompt: string;
  createBtn: string;
  renameBtn: string;
  moveSuccess: string;
  movePartial: string;
  renameSuccess: string;
  folderCreated: string;
  exportSuccess: string;

  // Global search
  globalSearchPlaceholder: string;
  globalSearchHint: string;
  searchMatches: string;
  searchTotalSize: string;
  searchElapsed: string;
  searchEmptyPrompt: string;
  searchRunBtn: string;

  // Duplicates
  dupTitle: string;
  dupSubtitle: string;
  dupScanBtn: string;
  dupCancelBtn: string;
  dupGroupsFound: string;
  dupWastedSpace: string;
  dupKeepNewest: string;
  dupKeepOldest: string;
  dupKeepShortest: string;
  dupNoFound: string;
  dupIdleHint: string;
  dupKeepBadge: string;
  dupStageLabel: string;

  // Top files filters
  minSize: string;
  allSizes: string;
  extensionFilter: string;
  allCategories: string;

  // Categories & Junk
  categoryBreakdown: string;
  junkDetection: string;
  selectGroup: string;
  unselectGroup: string;
  noJunkFound: string;
  reclaimable: string;
  vhdxAlertTitle: string;
  vhdxAlertDesc: string;
  copyDiskpartCmd: string;
  copyOptimizeVhdCmd: string;
  compactCmdCopied: string;
  emptyFoldersTitle: string;
  emptyFoldersNone: string;

  // Snapshot / Diff
  snapshotModalTitle: string;
  saveSnapshotBtn: string;
  compareSnapshotBtn: string;
  snapshotSaved: string;
  snapshotBaseline: string;
  snapshotCurrent: string;
  snapshotBefore: string;
  snapshotAfter: string;
  snapshotDelta: string;
  snapshotNoDiff: string;
  snapshotHint: string;
  colStatus: string;
  statusAdded: string;
  statusRemoved: string;
  statusGrew: string;
  statusShrank: string;
  snapshotFilterAll: string;
  snapshotFilterGrew: string;
  snapshotFilterAdded: string;
  snapshotFilterRemoved: string;

  // Treemap
  treemapHint: string;
  backToRoot: string;

  // Selection bar & Delete modal
  selectedSummary: string;
  clearSelection: string;
  confirmDeleteTitle: string;
  confirmTrashTitle: string;
  confirmPermanentTitle: string;
  permanentWarning: string;
  blockedNotice: string;
  warningNotice: string;
  permanentAck: string;
  confirmTrashBtn: string;
  confirmPermanentBtn: string;
  deleting: string;
  deleteSuccess: string;
  deletePartial: string;
  protectedLabel: string;
  warningLabel: string;

  // Settings modal
  settingsTitle: string;
  languageLabel: string;
  themeLabel: string;
  explorerMenuLabel: string;
  explorerMenuDesc: string;
  scanEngineLabel: string;
  engineAuto: string;
  engineWalker: string;
  close: string;

  // Categories
  cat_video: string;
  cat_archive: string;
  cat_installer: string;
  cat_image: string;
  cat_audio: string;
  cat_document: string;
  cat_code_db: string;
  cat_other: string;

  // Junk groups
  junk_dev_node_modules: string;
  junk_dev_rust_target: string;
  junk_dev_gradle_build: string;
  junk_dev_dotnet_build: string;
  junk_dev_python_env: string;
  junk_dev_web_cache: string;
  junk_dev_cargo_cache: string;
  junk_dev_pkg_cache: string;
  junk_gpu_shader_cache: string;
  junk_win_crash_dumps: string;
  junk_win_temp_files: string;
  junk_app_caches: string;
  junk_win_update_cache: string;
  junk_win_old: string;
  junk_virtual_disks: string;
  junk_downloads_installers: string;

  // Disk Health (S.M.A.R.T.)
  tabHealth: string;
  healthTitle: string;
  healthRefresh: string;
  healthRefreshing: string;
  healthStatusLabel: string;
  healthGood: string;
  healthCaution: string;
  healthCritical: string;
  healthUnknown: string;
  healthTempLabel: string;
  healthTempHotWarn: string;
  healthTempWarmWarn: string;
  healthTempNormal: string;
  healthFirmware: string;
  healthSerial: string;
  healthInterface: string;
  healthStandard: string;
  healthMediaType: string;
  healthDriveLetters: string;
  healthFeatures: string;
  healthHostReads: string;
  healthHostWrites: string;
  healthPowerCycles: string;
  healthPowerHours: string;
  healthUnsafeShutdowns: string;
  healthAvailSpare: string;
  healthHideSerial: string;
  healthShowSerial: string;
  healthAutoRefresh: string;
  healthAutoOff: string;
  healthCopyReport: string;
  healthReportCopied: string;
  healthExportTxt: string;
  healthExportJson: string;
  healthExportSaved: string;
  healthAdminRequired: string;
  healthAdminBtn: string;
  healthNoDisks: string;
  healthAttrTableTitle: string;
  healthOnlyWarnings: string;
  healthAllAttrs: string;
  healthColId: string;
  healthColAttr: string;
  healthColCur: string;
  healthColWorst: string;
  healthColThresh: string;
  healthColValue: string;
  healthColRaw: string;
  healthBackHome: string;
}

const en: TranslationDict = {
  appName: "DiskCleanupTool",
  browseFolder: "Folder",
  scan: "Scan",
  rescan: "Rescan",
  cancel: "Stop",
  scanning: "Scanning",
  runAsAdmin: "Run as Admin (MFT)",
  adminActive: "Admin (MFT Ready)",
  mftBadge: "NTFS MFT",
  walkerBadge: "Parallel Win32",
  searchPlaceholder: "Search files or enter query (Enter)... (Ctrl+K)",
  settings: "Settings",
  themeDark: "Dark",
  themeLight: "Light",

  tabTree: "Folder Tree",
  viewOptions: "View options",
  tools: "Tools",
  tabSearch: "Search",
  tabTopFiles: "Top Largest Files",
  tabDuplicates: "Duplicates",
  tabJunk: "Categories & Junk",
  tabTreemap: "Treemap",

  target: "Target",
  scannedSize: "Scanned Size",
  allocatedSize: "On Disk",
  filesFolders: "Files / Folders",
  scanTime: "Scan Time",
  engine: "Engine",
  driveUsed: "Used",
  freeSpace: "Free",

  navBack: "Back",
  navForward: "Forward",
  navUp: "Up",
  modeSize: "Size",
  modeAllocated: "Allocated",
  modeFiles: "Files",
  modePercent: "%",
  unitAuto: "Auto",
  expandLv1: "Lv 1",
  expandLv2: "Lv 2",
  expandLv3: "Lv 3",
  collapseAll: "Collapse",
  treeOnly: "Tree Only",
  splitView: "Split View",
  exportCsv: "Export CSV",
  exportJson: "Export JSON",
  snapshotDiff: "Snapshot / Diff",
  recycleBin: "Recycle Bin",
  emptyRecycleBin: "Empty Recycle Bin",
  confirmEmptyBinTitle: "Empty Windows Recycle Bin",
  confirmEmptyBinDesc: "All items currently in the Windows Recycle Bin will be permanently erased and cannot be recovered.",
  recycleBinEmptied: "Recycle Bin emptied",
  recycleBinEmpty: "Recycle Bin is empty",

  colName: "Name",
  colShare: "% Share",
  colSize: "Size",
  colAllocated: "Allocated",
  colFiles: "Files",
  colFolders: "Folders",
  colModified: "Modified",
  colActions: "Actions",
  colPath: "Path",
  colCategory: "Type",

  availableDrives: "Available drives",
  emptyTitle: "Select a drive or folder to analyze disk usage",
  emptySubtitle: "Largest files and folders are automatically sorted on top for fast cleanup.",
  selectDriveHint: "Pick a drive above or browse any directory.",
  noMatches: "No matching files or folders found.",
  loading: "Loading...",
  itemsCount: "items",

  openFile: "Open File",
  revealExplorer: "Reveal in Explorer",
  openTerminal: "Open Terminal Here",
  copyPath: "Copy Path",
  zoomFolder: "Focus Folder",
  moveToFolder: "Move to Folder...",
  newFolder: "New Folder",
  renameItem: "Rename",
  properties: "Properties",
  moveToTrash: "Move to Recycle Bin",
  deletePermanently: "Delete Permanently",
  pathCopied: "Path copied to clipboard",
  newFolderPrompt: "Create new folder in",
  renamePrompt: "Rename item",
  createBtn: "Create",
  renameBtn: "Rename",
  moveSuccess: "Moved",
  movePartial: "Some items could not be moved",
  renameSuccess: "Renamed successfully",
  folderCreated: "Folder created",
  exportSuccess: "Exported rows",

  globalSearchPlaceholder: "Query e.g. >100MB *.mp4;*.mkv older:1y type:archive",
  globalSearchHint: "Instant full-drive search across the scanned index. Click a syntax chip or type filters.",
  searchMatches: "Matches",
  searchTotalSize: "Matched Size",
  searchElapsed: "Latency",
  searchEmptyPrompt: "Enter a query or pick a quick filter chip above to search the entire scanned drive.",
  searchRunBtn: "Search",

  dupTitle: "Duplicate File Finder (BLAKE3)",
  dupSubtitle: "3-stage verification: Size Grouping → Partial Hash → Full BLAKE3 Hash",
  dupScanBtn: "Find Duplicates",
  dupCancelBtn: "Cancel Scan",
  dupGroupsFound: "Groups",
  dupWastedSpace: "Wasted Space",
  dupKeepNewest: "Keep Newest",
  dupKeepOldest: "Keep Oldest",
  dupKeepShortest: "Keep Shortest Path",
  dupNoFound: "No duplicate files found above the selected minimum size.",
  dupIdleHint: "Pick a minimum file size and click Find Duplicates to scan for exact byte-identical copies.",
  dupKeepBadge: "Keep",
  dupStageLabel: "Stage",

  minSize: "Min size",
  allSizes: "All sizes",
  extensionFilter: "Ext (e.g. mp4, zip)",
  allCategories: "All types",

  categoryBreakdown: "Storage by File Type",
  junkDetection: "Detected Junk & Build Artifacts",
  selectGroup: "Select All",
  unselectGroup: "Unselect",
  noJunkFound: "No major junk or build artifact folders detected in this scan.",
  reclaimable: "Reclaimable",
  vhdxAlertTitle: "Virtual Disks Detected (WSL2 / Docker .vhdx)",
  vhdxAlertDesc: "Do NOT delete .vhdx files directly — this will destroy WSL2/Docker data. Compact them safely instead:",
  copyDiskpartCmd: "Copy diskpart Compact",
  copyOptimizeVhdCmd: "Copy Optimize-VHD",
  compactCmdCopied: "Safe compact command copied to clipboard",
  emptyFoldersTitle: "Empty Folders",
  emptyFoldersNone: "No empty folders detected in this scan.",

  snapshotModalTitle: "Disk Snapshot & Growth Diff",
  saveSnapshotBtn: "Save Snapshot",
  compareSnapshotBtn: "Compare Snapshot",
  snapshotSaved: "Snapshot saved",
  snapshotBaseline: "Baseline",
  snapshotCurrent: "Current Scan",
  snapshotBefore: "Before",
  snapshotAfter: "After",
  snapshotDelta: "Delta",
  snapshotNoDiff: "No size changes detected between baseline snapshot and current scan.",
  snapshotHint: "Save a snapshot of the current scan (.dctsnap.json), or compare against an earlier snapshot to spot what grew.",
  colStatus: "Status",
  statusAdded: "Added",
  statusRemoved: "Removed",
  statusGrew: "Grew",
  statusShrank: "Shrank",
  snapshotFilterAll: "All",
  snapshotFilterGrew: "Grew",
  snapshotFilterAdded: "Added",
  snapshotFilterRemoved: "Removed",

  treemapHint: "Click to select • Double-click a folder to zoom in • Right-click for actions",
  backToRoot: "Root",

  selectedSummary: "selected",
  clearSelection: "Clear",
  confirmDeleteTitle: "Confirm Deletion",
  confirmTrashTitle: "Move Selected Items to Recycle Bin",
  confirmPermanentTitle: "Permanently Delete Selected Items",
  permanentWarning: "Permanent deletion bypasses the Recycle Bin and CANNOT be undone.",
  blockedNotice: "Protected Windows system items were excluded automatically and cannot be deleted.",
  warningNotice: "Some selected items are inside application or system directories. Verify before confirming.",
  permanentAck: "I understand these files will be permanently erased and cannot be recovered.",
  confirmTrashBtn: "Move to Recycle Bin",
  confirmPermanentBtn: "Delete Permanently",
  deleting: "Deleting...",
  deleteSuccess: "Freed",
  deletePartial: "Some items could not be deleted",
  protectedLabel: "Blocked",
  warningLabel: "Caution",

  settingsTitle: "Settings",
  languageLabel: "Interface Language",
  themeLabel: "Appearance",
  explorerMenuLabel: "Windows Explorer Context Menu",
  explorerMenuDesc: "Add \"Scan with DiskCleanupTool\" to folder and drive right-click menus.",
  scanEngineLabel: "Preferred Scan Engine",
  engineAuto: "Auto (NTFS MFT when Admin, else Parallel Win32)",
  engineWalker: "Always use Parallel Win32 Walker",
  close: "Close",

  cat_video: "Video",
  cat_archive: "Archives & ISO",
  cat_installer: "Installers & Binaries",
  cat_image: "Images & Design",
  cat_audio: "Audio",
  cat_document: "Documents",
  cat_code_db: "Code & Databases",
  cat_other: "Other",

  junk_dev_node_modules: "Node.js Dependencies (node_modules)",
  junk_dev_rust_target: "Rust Build Artifacts (target)",
  junk_dev_gradle_build: "Gradle / Android Build Caches",
  junk_dev_dotnet_build: ".NET Build Outputs (bin / obj)",
  junk_dev_python_env: "Python Environments & Caches",
  junk_dev_web_cache: "Frontend Bundler Caches (.next / .vite / .turbo)",
  junk_dev_cargo_cache: "Cargo & Rust Global Caches (.cargo)",
  junk_dev_pkg_cache: "Package Manager Caches (npm / pnpm / yarn / pip / NuGet)",
  junk_gpu_shader_cache: "GPU Shader Caches (NVIDIA / AMD / DirectX)",
  junk_win_crash_dumps: "Windows Crash Dumps",
  junk_win_temp_files: "Temporary Folders (Temp)",
  junk_app_caches: "Application & Browser Caches",
  junk_win_update_cache: "Windows Update Download Cache",
  junk_win_old: "Previous Windows Installation (Windows.old)",
  junk_virtual_disks: "Virtual Disks (WSL2 / Docker .vhdx)",
  junk_downloads_installers: "Large Installers & Archives in Downloads (>50 MB)",

  tabHealth: "Disk Health",
  healthTitle: "Disk Health & S.M.A.R.T. Diagnostics",
  healthRefresh: "Refresh",
  healthRefreshing: "Reading...",
  healthStatusLabel: "Health Status",
  healthGood: "Good",
  healthCaution: "Caution",
  healthCritical: "Critical",
  healthUnknown: "Unknown",
  healthTempLabel: "Temperature",
  healthTempHotWarn: "High temperature — check cooling / airflow",
  healthTempWarmWarn: "Warm operating temperature",
  healthTempNormal: "Normal operating temperature",
  healthFirmware: "Firmware",
  healthSerial: "Serial Number",
  healthInterface: "Interface",
  healthStandard: "Standard",
  healthMediaType: "Media Type",
  healthDriveLetters: "Drive Letters",
  healthFeatures: "Features",
  healthHostReads: "Total Host Reads",
  healthHostWrites: "Total Host Writes",
  healthPowerCycles: "Power On Count",
  healthPowerHours: "Power On Hours",
  healthUnsafeShutdowns: "Unsafe Shutdowns",
  healthAvailSpare: "Available Spare",
  healthHideSerial: "Hide Serial",
  healthShowSerial: "Show Serial",
  healthAutoRefresh: "Auto",
  healthAutoOff: "Off",
  healthCopyReport: "Copy Report",
  healthReportCopied: "S.M.A.R.T. report copied",
  healthExportTxt: "Export TXT",
  healthExportJson: "Export JSON",
  healthExportSaved: "Health report saved",
  healthAdminRequired: "Running without Administrator privileges. Elevate to read full NVMe / SATA S.M.A.R.T. telemetry.",
  healthAdminBtn: "Run as Admin (Full S.M.A.R.T.)",
  healthNoDisks: "No physical disks detected.",
  healthAttrTableTitle: "S.M.A.R.T. Attributes",
  healthOnlyWarnings: "Warnings Only",
  healthAllAttrs: "All",
  healthColId: "ID",
  healthColAttr: "Attribute Name",
  healthColCur: "Cur",
  healthColWorst: "Worst",
  healthColThresh: "Thresh",
  healthColValue: "Decoded Value",
  healthColRaw: "Raw Value (Hex)",
  healthBackHome: "Back to Drives",
};

const vi: TranslationDict = {
  appName: "DiskCleanupTool",
  browseFolder: "Chọn thư mục",
  scan: "Quét ngay",
  rescan: "Quét lại",
  cancel: "Dừng",
  scanning: "Đang quét",
  runAsAdmin: "Chạy quyền Admin (MFT)",
  adminActive: "Admin (Sẵn sàng MFT)",
  mftBadge: "NTFS MFT",
  walkerBadge: "Win32 Song song",
  searchPlaceholder: "Tìm kiếm file hoặc nhập cú pháp (Enter)... (Ctrl+K)",
  settings: "Cài đặt",
  themeDark: "Tối",
  themeLight: "Sáng",

  tabTree: "Cây thư mục",
  viewOptions: "Hiển thị",
  tools: "Công cụ",
  tabSearch: "Tìm kiếm",
  tabTopFiles: "Top File Lớn Nhất",
  tabDuplicates: "File Trùng Lặp",
  tabJunk: "Phân loại & Dọn rác",
  tabTreemap: "Bản đồ Treemap",

  target: "Mục tiêu",
  scannedSize: "Dung lượng quét",
  allocatedSize: "Chiếm trên đĩa",
  filesFolders: "File / Thư mục",
  scanTime: "Thời gian quét",
  engine: "Bộ quét",
  driveUsed: "Đã dùng",
  freeSpace: "Còn trống",

  navBack: "Quay lại",
  navForward: "Tiến tới",
  navUp: "Lên cấp trên",
  modeSize: "Dung lượng",
  modeAllocated: "Trên đĩa",
  modeFiles: "Số file",
  modePercent: "%",
  unitAuto: "Tự động",
  expandLv1: "Cấp 1",
  expandLv2: "Cấp 2",
  expandLv3: "Cấp 3",
  collapseAll: "Thu gọn",
  treeOnly: "Chỉ cây thư mục",
  splitView: "Chia đôi Tree + Map",
  exportCsv: "Xuất CSV",
  exportJson: "Xuất JSON",
  snapshotDiff: "Snapshot / So sánh",
  recycleBin: "Thùng rác",
  emptyRecycleBin: "Dọn sạch Thùng rác",
  confirmEmptyBinTitle: "Dọn sạch Thùng rác Windows",
  confirmEmptyBinDesc: "Tất cả mục đang nằm trong Thùng rác Windows sẽ bị xóa vĩnh viễn và không thể khôi phục.",
  recycleBinEmptied: "Đã dọn sạch Thùng rác",
  recycleBinEmpty: "Thùng rác đang trống",

  colName: "Tên",
  colShare: "Tỷ lệ %",
  colSize: "Dung lượng",
  colAllocated: "Trên đĩa",
  colFiles: "Số file",
  colFolders: "Thư mục",
  colModified: "Ngày sửa",
  colActions: "Thao tác",
  colPath: "Đường dẫn",
  colCategory: "Loại",

  availableDrives: "Ổ đĩa hiện có",
  emptyTitle: "Chọn ổ đĩa hoặc thư mục để phân tích dung lượng",
  emptySubtitle: "Mặc định sắp xếp file và thư mục lớn nhất lên trên cùng để dọn dẹp nhanh.",
  selectDriveHint: "Chọn ổ đĩa phía trên hoặc bấm Chọn thư mục.",
  noMatches: "Không tìm thấy file hoặc thư mục phù hợp.",
  loading: "Đang tải...",
  itemsCount: "mục",

  openFile: "Mở tệp",
  revealExplorer: "Mở trong Explorer",
  openTerminal: "Mở Terminal tại đây",
  copyPath: "Sao chép đường dẫn",
  zoomFolder: "Đi sâu vào thư mục",
  moveToFolder: "Di chuyển tới thư mục...",
  newFolder: "Tạo thư mục mới",
  renameItem: "Đổi tên",
  properties: "Thuộc tính (Properties)",
  moveToTrash: "Chuyển vào Thùng rác",
  deletePermanently: "Xóa vĩnh viễn",
  pathCopied: "Đã sao chép đường dẫn",
  newFolderPrompt: "Tạo thư mục mới trong",
  renamePrompt: "Đổi tên mục",
  createBtn: "Tạo",
  renameBtn: "Đổi tên",
  moveSuccess: "Đã di chuyển",
  movePartial: "Một số mục không thể di chuyển",
  renameSuccess: "Đổi tên thành công",
  folderCreated: "Đã tạo thư mục",
  exportSuccess: "Đã xuất dòng dữ liệu",

  globalSearchPlaceholder: "Cú pháp vd: >100MB *.mp4;*.mkv older:1y type:archive",
  globalSearchHint: "Tìm kiếm tức thì toàn ổ đĩa đã quét. Chọn bộ lọc nhanh hoặc nhập cú pháp tìm kiếm.",
  searchMatches: "Kết quả",
  searchTotalSize: "Tổng dung lượng khớp",
  searchElapsed: "Độ trễ",
  searchEmptyPrompt: "Nhập từ khóa hoặc chọn bộ lọc nhanh phía trên để tìm trên toàn ổ đĩa.",
  searchRunBtn: "Tìm",

  dupTitle: "Tìm File Trùng Lặp (BLAKE3)",
  dupSubtitle: "Kiểm tra 3 giai đoạn: Nhóm theo dung lượng → Băm một phần → Băm toàn bộ BLAKE3",
  dupScanBtn: "Tìm trùng lặp",
  dupCancelBtn: "Hủy quét",
  dupGroupsFound: "Nhóm trùng",
  dupWastedSpace: "Dung lượng dư thừa",
  dupKeepNewest: "Giữ bản mới nhất",
  dupKeepOldest: "Giữ bản cũ nhất",
  dupKeepShortest: "Giữ đường dẫn ngắn nhất",
  dupNoFound: "Không tìm thấy file trùng lặp nào vượt mức dung lượng tối thiểu đã chọn.",
  dupIdleHint: "Chọn kích thước tối thiểu và bấm Tìm trùng lặp để tìm các bản sao giống hệt nhau theo byte.",
  dupKeepBadge: "Giữ lại",
  dupStageLabel: "Giai đoạn",

  minSize: "Dung lượng tối thiểu",
  allSizes: "Tất cả",
  extensionFilter: "Đuôi (vd: mp4, zip)",
  allCategories: "Tất cả loại",

  categoryBreakdown: "Phân bố theo loại file",
  junkDetection: "Rác hệ thống & Thư mục build phát hiện được",
  selectGroup: "Chọn nhóm",
  unselectGroup: "Bỏ chọn",
  noJunkFound: "Không phát hiện thư mục rác hoặc build artifact lớn trong phạm vi vừa quét.",
  reclaimable: "Có thể giải phóng",
  vhdxAlertTitle: "Phát hiện Đĩa ảo (WSL2 / Docker .vhdx)",
  vhdxAlertDesc: "KHÔNG xóa trực tiếp tệp .vhdx — việc này sẽ làm mất dữ liệu WSL2/Docker. Hãy nén gọn an toàn bằng lệnh:",
  copyDiskpartCmd: "Chép lệnh diskpart",
  copyOptimizeVhdCmd: "Chép lệnh Optimize-VHD",
  compactCmdCopied: "Đã sao chép lệnh nén gọn an toàn vào clipboard",
  emptyFoldersTitle: "Thư mục rỗng",
  emptyFoldersNone: "Không phát hiện thư mục rỗng nào trong phạm vi quét.",

  snapshotModalTitle: "Snapshot Đĩa & So Sánh Tăng Trưởng",
  saveSnapshotBtn: "Lưu Snapshot",
  compareSnapshotBtn: "So sánh Snapshot",
  snapshotSaved: "Đã lưu snapshot",
  snapshotBaseline: "Mốc so sánh",
  snapshotCurrent: "Bản quét hiện tại",
  snapshotBefore: "Trước",
  snapshotAfter: "Sau",
  snapshotDelta: "Chênh lệch",
  snapshotNoDiff: "Không có thay đổi dung lượng giữa bản snapshot gốc và bản quét hiện tại.",
  snapshotHint: "Lưu snapshot của lần quét hiện tại (.dctsnap.json) hoặc so sánh với snapshot cũ để xem thư mục nào phình to.",
  colStatus: "Trạng thái",
  statusAdded: "Mới thêm",
  statusRemoved: "Đã xóa",
  statusGrew: "Tăng lên",
  statusShrank: "Giảm đi",
  snapshotFilterAll: "Tất cả",
  snapshotFilterGrew: "Tăng lên",
  snapshotFilterAdded: "Mới thêm",
  snapshotFilterRemoved: "Đã xóa",

  treemapHint: "Bấm để chọn • Nhấp đúp thư mục để phóng to • Chuột phải để thao tác",
  backToRoot: "Gốc",

  selectedSummary: "đã chọn",
  clearSelection: "Bỏ chọn",
  confirmDeleteTitle: "Xác nhận xóa",
  confirmTrashTitle: "Chuyển các mục đã chọn vào Thùng rác",
  confirmPermanentTitle: "Xóa vĩnh viễn các mục đã chọn",
  permanentWarning: "Xóa vĩnh viễn sẽ bỏ qua Thùng rác và KHÔNG THỂ khôi phục.",
  blockedNotice: "Các mục hệ thống Windows được bảo vệ đã tự động loại trừ và không thể xóa.",
  warningNotice: "Một số mục nằm trong thư mục ứng dụng hoặc hệ thống. Vui lòng kiểm tra kỹ trước khi xóa.",
  permanentAck: "Tôi hiểu các tệp này sẽ bị xóa vĩnh viễn và không thể khôi phục.",
  confirmTrashBtn: "Chuyển vào Thùng rác",
  confirmPermanentBtn: "Xóa vĩnh viễn",
  deleting: "Đang xóa...",
  deleteSuccess: "Đã giải phóng",
  deletePartial: "Một số mục không thể xóa",
  protectedLabel: "Bị chặn",
  warningLabel: "Cảnh báo",

  settingsTitle: "Cài đặt",
  languageLabel: "Ngôn ngữ giao diện",
  themeLabel: "Giao diện",
  explorerMenuLabel: "Menu chuột phải Windows Explorer",
  explorerMenuDesc: "Thêm mục \"Scan with DiskCleanupTool\" khi chuột phải vào thư mục hoặc ổ đĩa.",
  scanEngineLabel: "Chế độ bộ quét ưu tiên",
  engineAuto: "Tự động (NTFS MFT nếu có Admin, ngược lại Win32 song song)",
  engineWalker: "Luôn dùng Parallel Win32 Walker",
  close: "Đóng",

  cat_video: "Video",
  cat_archive: "Nén & Ảnh đĩa ISO",
  cat_installer: "Bộ cài & Thực thi",
  cat_image: "Hình ảnh & Thiết kế",
  cat_audio: "Âm thanh",
  cat_document: "Tài liệu",
  cat_code_db: "Mã nguồn & CSDL",
  cat_other: "Khác",

  junk_dev_node_modules: "Thư viện Node.js (node_modules)",
  junk_dev_rust_target: "Thư mục build Rust (target)",
  junk_dev_gradle_build: "Cache build Gradle / Android",
  junk_dev_dotnet_build: "Thư mục build .NET (bin / obj)",
  junk_dev_python_env: "Môi trường & Cache Python",
  junk_dev_web_cache: "Cache Frontend Bundler (.next / .vite / .turbo)",
  junk_dev_cargo_cache: "Cache toàn cục Cargo / Rust (.cargo)",
  junk_dev_pkg_cache: "Cache trình quản lý gói (npm / pnpm / yarn / pip / NuGet)",
  junk_gpu_shader_cache: "Cache Shader GPU (NVIDIA / AMD / DirectX)",
  junk_win_crash_dumps: "Tệp báo lỗi Windows CrashDumps",
  junk_win_temp_files: "Thư mục tạm (Temp)",
  junk_app_caches: "Cache ứng dụng & Trình duyệt",
  junk_win_update_cache: "Bộ nhớ đệm Windows Update",
  junk_win_old: "Bản cài Windows cũ (Windows.old)",
  junk_virtual_disks: "Đĩa ảo (WSL2 / Docker .vhdx)",
  junk_downloads_installers: "File cài đặt & file nén lớn trong Downloads (>50 MB)",

  tabHealth: "Sức khỏe ổ đĩa",
  healthTitle: "Phân tích Sức khỏe Ổ đĩa & S.M.A.R.T.",
  healthRefresh: "Làm mới",
  healthRefreshing: "Đang đọc...",
  healthStatusLabel: "Trạng thái sức khỏe",
  healthGood: "Tốt",
  healthCaution: "Cảnh báo",
  healthCritical: "Nguy hiểm",
  healthUnknown: "Chưa rõ",
  healthTempLabel: "Nhiệt độ",
  healthTempHotWarn: "Nhiệt độ cao — kiểm tra tản nhiệt / luồng gió",
  healthTempWarmWarn: "Nhiệt độ hoạt động hơi ấm",
  healthTempNormal: "Nhiệt độ hoạt động ổn định",
  healthFirmware: "Firmware",
  healthSerial: "Số Sê-ri",
  healthInterface: "Chuẩn giao tiếp",
  healthStandard: "Tiêu chuẩn",
  healthMediaType: "Loại ổ đĩa",
  healthDriveLetters: "Ký tự ổ đĩa",
  healthFeatures: "Tính năng",
  healthHostReads: "Tổng dung lượng đọc",
  healthHostWrites: "Tổng dung lượng ghi",
  healthPowerCycles: "Số lần khởi động",
  healthPowerHours: "Tổng giờ hoạt động",
  healthUnsafeShutdowns: "Tắt nguồn đột ngột",
  healthAvailSpare: "Vùng dự phòng còn lại",
  healthHideSerial: "Ẩn Sê-ri",
  healthShowSerial: "Hiện Sê-ri",
  healthAutoRefresh: "Tự cập nhật",
  healthAutoOff: "Tắt",
  healthCopyReport: "Sao chép báo cáo",
  healthReportCopied: "Đã sao chép báo cáo S.M.A.R.T.",
  healthExportTxt: "Xuất TXT",
  healthExportJson: "Xuất JSON",
  healthExportSaved: "Đã lưu báo cáo sức khỏe",
  healthAdminRequired: "Đang chạy quyền User thường. Cần quyền Administrator để đọc đầy đủ thông số S.M.A.R.T. (NVMe / SATA).",
  healthAdminBtn: "Chạy quyền Admin (Đầy đủ S.M.A.R.T.)",
  healthNoDisks: "Không phát hiện ổ đĩa vật lý nào.",
  healthAttrTableTitle: "Danh sách thuộc tính S.M.A.R.T.",
  healthOnlyWarnings: "Chỉ cảnh báo",
  healthAllAttrs: "Tất cả",
  healthColId: "ID",
  healthColAttr: "Tên thuộc tính",
  healthColCur: "Hiện tại",
  healthColWorst: "Thấp nhất",
  healthColThresh: "Ngưỡng",
  healthColValue: "Giá trị giải mã",
  healthColRaw: "Giá trị thô (Hex)",
  healthBackHome: "Quay lại danh sách ổ đĩa",
};

const zh: TranslationDict = {
  ...en,
  browseFolder: "选择文件夹",
  scan: "扫描",
  rescan: "重新扫描",
  cancel: "停止",
  scanning: "正在扫描",
  runAsAdmin: "管理员运行 (MFT)",
  adminActive: "管理员 (MFT 就绪)",
  searchPlaceholder: "搜索文件或输入条件 (Enter)... (Ctrl+K)",
  settings: "设置",
  themeDark: "深色",
  themeLight: "浅色",
  tabTree: "目录树",
  viewOptions: "显示选项",
  tools: "工具",
  tabSearch: "全局搜索",
  tabTopFiles: "最大文件排行",
  tabDuplicates: "重复文件",
  tabJunk: "分类与垃圾清理",
  tabTreemap: "矩形树图",
  scannedSize: "扫描大小",
  allocatedSize: "占用空间",
  filesFolders: "文件 / 文件夹",
  scanTime: "耗时",
  engine: "引擎",
  driveUsed: "已用",
  freeSpace: "可用",
  navBack: "后退",
  navForward: "前进",
  navUp: "上级",
  modeSize: "大小",
  modeAllocated: "占用",
  modeFiles: "文件数",
  modePercent: "%",
  unitAuto: "自动",
  expandLv1: "1 级",
  expandLv2: "2 级",
  expandLv3: "3 级",
  collapseAll: "折叠",
  treeOnly: "仅目录树",
  splitView: "分屏视图",
  exportCsv: "导出 CSV",
  exportJson: "导出 JSON",
  snapshotDiff: "快照 / 对比",
  recycleBin: "回收站",
  emptyRecycleBin: "清空回收站",
  confirmEmptyBinTitle: "清空 Windows 回收站",
  confirmEmptyBinDesc: "回收站中的所有项目将被永久删除且无法恢复。",
  recycleBinEmptied: "回收站已清空",
  recycleBinEmpty: "回收站为空",
  colName: "名称",
  colShare: "占比 %",
  colSize: "大小",
  colAllocated: "磁盘占用",
  colFiles: "文件数",
  colFolders: "文件夹数",
  colModified: "修改时间",
  colActions: "操作",
  colPath: "路径",
  colCategory: "类型",
  availableDrives: "可用驱动器",
  emptyTitle: "选择磁盘驱动器或文件夹以分析空间占用",
  emptySubtitle: "默认按大小降序排列，大文件和文件夹始终显示在最顶部。",
  openFile: "打开文件",
  revealExplorer: "在资源管理器中显示",
  openTerminal: "在此打开终端",
  copyPath: "复制路径",
  zoomFolder: "进入此文件夹",
  moveToFolder: "移动到文件夹...",
  newFolder: "新建文件夹",
  renameItem: "重命名",
  properties: "属性",
  moveToTrash: "移入回收站",
  deletePermanently: "永久删除",
  searchMatches: "匹配项",
  searchTotalSize: "匹配总大小",
  searchElapsed: "耗时",
  searchRunBtn: "搜索",
  dupTitle: "重复文件查找器 (BLAKE3)",
  dupScanBtn: "查找重复",
  dupCancelBtn: "取消扫描",
  dupGroupsFound: "重复组",
  dupWastedSpace: "浪费空间",
  dupKeepNewest: "保留最新",
  dupKeepOldest: "保留最旧",
  dupKeepShortest: "保留最短路径",
  dupKeepBadge: "保留",
  categoryBreakdown: "按文件类型分布",
  junkDetection: "检测到的垃圾与构建缓存",
  selectGroup: "全选",
  unselectGroup: "取消",
  vhdxAlertTitle: "检测到虚拟磁盘 (WSL2 / Docker .vhdx)",
  vhdxAlertDesc: "请勿直接删除 .vhdx 文件，否则会丢失数据。请使用安全压缩命令：",
  copyDiskpartCmd: "复制 diskpart 压缩命令",
  copyOptimizeVhdCmd: "复制 Optimize-VHD 命令",
  emptyFoldersTitle: "空文件夹",
  emptyFoldersNone: "未检测到空文件夹。",
  snapshotModalTitle: "磁盘快照与增长对比",
  saveSnapshotBtn: "保存快照",
  compareSnapshotBtn: "对比快照",
  snapshotBefore: "之前",
  snapshotAfter: "之后",
  snapshotDelta: "变化",
  selectedSummary: "已选",
  clearSelection: "清空",
  confirmDeleteTitle: "确认删除",
  confirmTrashTitle: "将所选项目移入回收站",
  confirmPermanentTitle: "永久删除所选项目",
  permanentWarning: "永久删除将跳过回收站，且无法恢复。",
  permanentAck: "我已了解这些文件将被永久删除且无法恢复。",
  confirmTrashBtn: "移入回收站",
  confirmPermanentBtn: "永久删除",
  settingsTitle: "设置",
  languageLabel: "界面语言",
  themeLabel: "外观主题",
  explorerMenuLabel: "Windows 资源管理器右键菜单",
  explorerMenuDesc: "在文件夹和驱动器的右键菜单中添加“Scan with DiskCleanupTool”。",
  close: "关闭",
  junk_dev_cargo_cache: "Cargo / Rust 全局缓存 (.cargo)",
  junk_dev_pkg_cache: "包管理器缓存 (npm / pnpm / yarn / pip / NuGet)",
  junk_gpu_shader_cache: "GPU 着色器缓存 (NVIDIA / AMD / DirectX)",
  junk_win_old: "旧版 Windows 安装 (Windows.old)",
  junk_virtual_disks: "虚拟磁盘 (WSL2 / Docker .vhdx)",
};

const ja: TranslationDict = {
  ...en,
  browseFolder: "フォルダ",
  scan: "スキャン",
  rescan: "再スキャン",
  cancel: "停止",
  scanning: "スキャン中",
  runAsAdmin: "管理者で実行 (MFT)",
  adminActive: "管理者 (MFT 有効)",
  searchPlaceholder: "ファイルや条件を検索 (Enter)... (Ctrl+K)",
  settings: "設定",
  themeDark: "ダーク",
  themeLight: "ライト",
  tabTree: "フォルダツリー",
  viewOptions: "表示設定",
  tools: "ツール",
  tabSearch: "検索",
  tabTopFiles: "最大ファイル一覧",
  tabDuplicates: "重複ファイル",
  tabJunk: "カテゴリ・不要ファイル",
  tabTreemap: "ツリーマップ",
  scannedSize: "スキャン容量",
  allocatedSize: "ディスク占有",
  filesFolders: "ファイル / フォルダ",
  scanTime: "所要時間",
  engine: "エンジン",
  driveUsed: "使用済み",
  freeSpace: "空き",
  navBack: "戻る",
  navForward: "進む",
  navUp: "上へ",
  modeSize: "サイズ",
  modeAllocated: "占有",
  modeFiles: "ファイル数",
  modePercent: "%",
  unitAuto: "自動",
  expandLv1: "Lv 1",
  expandLv2: "Lv 2",
  expandLv3: "Lv 3",
  collapseAll: "折りたたむ",
  treeOnly: "ツリーのみ",
  splitView: "分割表示",
  exportCsv: "CSV 出力",
  exportJson: "JSON 出力",
  snapshotDiff: "スナップショット",
  recycleBin: "ごみ箱",
  emptyRecycleBin: "ごみ箱を空にする",
  confirmEmptyBinTitle: "Windows のごみ箱を空にする",
  confirmEmptyBinDesc: "ごみ箱内のすべての項目が完全に削除され、復元できなくなります。",
  recycleBinEmptied: "ごみ箱を空にしました",
  recycleBinEmpty: "ごみ箱は空です",
  colName: "名前",
  colShare: "割合 %",
  colSize: "サイズ",
  colAllocated: "占有サイズ",
  colFiles: "ファイル数",
  colFolders: "フォルダ数",
  colModified: "更新日時",
  colActions: "操作",
  colPath: "パス",
  colCategory: "種類",
  availableDrives: "利用可能なドライブ",
  emptyTitle: "ドライブまたはフォルダを選択して容量を分析",
  emptySubtitle: "サイズの大きい項目が常に上部に降順表示され、素早く整理できます。",
  openFile: "ファイルを開く",
  revealExplorer: "エクスプローラーで開く",
  openTerminal: "ここでターミナルを開く",
  copyPath: "パスをコピー",
  zoomFolder: "フォルダをフォーカス",
  moveToFolder: "フォルダへ移動...",
  newFolder: "新規フォルダ",
  renameItem: "名前の変更",
  properties: "プロパティ",
  moveToTrash: "ごみ箱へ移動",
  deletePermanently: "完全に削除",
  searchMatches: "一致件数",
  searchTotalSize: "合計サイズ",
  searchElapsed: "処理時間",
  searchRunBtn: "検索",
  dupTitle: "重複ファイル検索 (BLAKE3)",
  dupScanBtn: "重複を検索",
  dupCancelBtn: "キャンセル",
  dupGroupsFound: "グループ",
  dupWastedSpace: "重複容量",
  dupKeepNewest: "最新を残す",
  dupKeepOldest: "最古を残す",
  dupKeepShortest: "最短パスを残す",
  dupKeepBadge: "保持",
  categoryBreakdown: "ファイル種類別の容量",
  junkDetection: "検出されたキャッシュ・ビルド成果物",
  selectGroup: "すべて選択",
  unselectGroup: "解除",
  vhdxAlertTitle: "仮想ディスク検出 (WSL2 / Docker .vhdx)",
  vhdxAlertDesc: ".vhdx を直接削除するとデータが失われます。代わりに安全な圧縮コマンドを使用してください。",
  copyDiskpartCmd: "diskpart コマンドをコピー",
  copyOptimizeVhdCmd: "Optimize-VHD をコピー",
  emptyFoldersTitle: "空フォルダ",
  emptyFoldersNone: "空のフォルダは検出されませんでした。",
  snapshotModalTitle: "スナップショット・増減比較",
  saveSnapshotBtn: "スナップショット保存",
  compareSnapshotBtn: "スナップショット比較",
  snapshotBefore: "比較元",
  snapshotAfter: "現在",
  snapshotDelta: "差分",
  selectedSummary: "選択中",
  clearSelection: "クリア",
  confirmDeleteTitle: "削除の確認",
  confirmTrashTitle: "選択項目をごみ箱へ移動",
  confirmPermanentTitle: "選択項目を完全に削除",
  permanentWarning: "完全削除はごみ箱を経由せず、元に戻すことはできません。",
  permanentAck: "これらのファイルが完全に消去され復元できないことを理解しました。",
  confirmTrashBtn: "ごみ箱へ移動",
  confirmPermanentBtn: "完全に削除",
  settingsTitle: "設定",
  languageLabel: "表示言語",
  themeLabel: "テーマ",
  explorerMenuLabel: "エクスプローラー右クリックメニュー",
  explorerMenuDesc: "フォルダとドライブの右クリックメニューに「Scan with DiskCleanupTool」を追加します。",
  close: "閉じる",
  junk_dev_cargo_cache: "Cargo / Rust グローバルキャッシュ (.cargo)",
  junk_dev_pkg_cache: "パッケージマネージャキャッシュ (npm / pnpm / yarn / pip / NuGet)",
  junk_gpu_shader_cache: "GPU シェーダーキャッシュ (NVIDIA / AMD / DirectX)",
  junk_win_old: "以前の Windows インストール (Windows.old)",
  junk_virtual_disks: "仮想ディスク (WSL2 / Docker .vhdx)",
};

const ko: TranslationDict = {
  ...en,
  browseFolder: "폴더",
  scan: "스캔",
  rescan: "다시 스캔",
  cancel: "중지",
  scanning: "스캔 중",
  runAsAdmin: "관리자 권한 실행 (MFT)",
  adminActive: "관리자 (MFT 사용 가능)",
  searchPlaceholder: "파일 검색 또는 쿼리 입력 (Enter)... (Ctrl+K)",
  settings: "설정",
  themeDark: "다크",
  themeLight: "라이트",
  tabTree: "폴더 트리",
  viewOptions: "보기 설정",
  tools: "도구",
  tabSearch: "검색",
  tabTopFiles: "대용량 파일 Top",
  tabDuplicates: "중복 파일",
  tabJunk: "유형 및 정리 대상",
  tabTreemap: "트리맵",
  scannedSize: "스캔 크기",
  allocatedSize: "디스크 할당",
  filesFolders: "파일 / 폴더",
  scanTime: "소요 시간",
  engine: "엔진",
  driveUsed: "사용됨",
  freeSpace: "여유",
  navBack: "뒤로",
  navForward: "앞으로",
  navUp: "상위",
  modeSize: "크기",
  modeAllocated: "할당",
  modeFiles: "파일 수",
  modePercent: "%",
  unitAuto: "자동",
  collapseAll: "접기",
  treeOnly: "트리만 보기",
  splitView: "분할 보기",
  exportCsv: "CSV 내보내기",
  exportJson: "JSON 내보내기",
  snapshotDiff: "스냅샷 / 비교",
  recycleBin: "휴지통",
  emptyRecycleBin: "휴지통 비우기",
  confirmEmptyBinTitle: "Windows 휴지통 비우기",
  confirmEmptyBinDesc: "휴지통의 모든 항목이 영구 삭제되며 복구할 수 없습니다.",
  recycleBinEmptied: "휴지통을 비웠습니다",
  recycleBinEmpty: "휴지통이 비어 있습니다",
  colName: "이름",
  colShare: "비율 %",
  colSize: "크기",
  colAllocated: "할당 크기",
  colFiles: "파일 수",
  colFolders: "폴더 수",
  colModified: "수정일",
  colActions: "작업",
  colPath: "경로",
  colCategory: "유형",
  availableDrives: "사용 가능한 드라이브",
  emptyTitle: "디스크 사용량을 분석할 드라이브 또는 폴더를 선택하세요",
  emptySubtitle: "가장 큰 파일과 폴더가 기본적으로 상단에 내림차순 정렬됩니다.",
  openFile: "파일 열기",
  revealExplorer: "탐색기에서 열기",
  openTerminal: "여기서 터미널 열기",
  copyPath: "경로 복사",
  zoomFolder: "폴더 집중 보기",
  moveToFolder: "폴더로 이동...",
  newFolder: "새 폴더",
  renameItem: "이름 바꾸기",
  properties: "속성",
  moveToTrash: "휴지통으로 이동",
  deletePermanently: "영구 삭제",
  searchMatches: "일치 항목",
  searchTotalSize: "일치 총 크기",
  searchElapsed: "소요 시간",
  searchRunBtn: "검색",
  dupTitle: "중복 파일 찾기 (BLAKE3)",
  dupScanBtn: "중복 찾기",
  dupCancelBtn: "스캔 취소",
  dupGroupsFound: "그룹",
  dupWastedSpace: "낭비 공간",
  dupKeepNewest: "최신 유지",
  dupKeepOldest: "가장 오래된 항목 유지",
  dupKeepShortest: "최단 경로 유지",
  dupKeepBadge: "유지",
  categoryBreakdown: "파일 유형별 점유율",
  junkDetection: "감지된 캐시 및 빌드 산출물",
  vhdxAlertTitle: "가상 디스크 감지됨 (WSL2 / Docker .vhdx)",
  vhdxAlertDesc: ".vhdx 파일을 직접 삭제하지 마세요. 안전한 압축 명령을 복사해 사용하세요.",
  emptyFoldersTitle: "빈 폴더",
  emptyFoldersNone: "감지된 빈 폴더가 없습니다.",
  snapshotModalTitle: "디스크 스냅샷 및 증가 비교",
  saveSnapshotBtn: "스냅샷 저장",
  compareSnapshotBtn: "스냅샷 비교",
  snapshotBefore: "이전",
  snapshotAfter: "이후",
  snapshotDelta: "변화량",
  selectedSummary: "선택됨",
  clearSelection: "선택 해제",
  confirmDeleteTitle: "삭제 확인",
  confirmTrashTitle: "선택한 항목을 휴지통으로 이동",
  confirmPermanentTitle: "선택한 항목 영구 삭제",
  permanentWarning: "영구 삭제는 휴지통을 거치지 않으며 되돌릴 수 없습니다.",
  permanentAck: "이 파일들이 영구적으로 삭제되어 복구할 수 없음을 이해했습니다.",
  confirmTrashBtn: "휴지통으로 이동",
  confirmPermanentBtn: "영구 삭제",
  settingsTitle: "설정",
  languageLabel: "언어",
  themeLabel: "테마",
  explorerMenuLabel: "Windows 탐색기 우클릭 메뉴",
  explorerMenuDesc: "폴더 및 드라이브 우클릭 메뉴에 \"Scan with DiskCleanupTool\"을 추가합니다.",
  close: "닫기",
  junk_dev_cargo_cache: "Cargo / Rust 전역 캐시 (.cargo)",
  junk_dev_pkg_cache: "패키지 관리자 캐시 (npm / pnpm / yarn / pip / NuGet)",
  junk_gpu_shader_cache: "GPU 셰이더 캐시 (NVIDIA / AMD / DirectX)",
  junk_win_old: "이전 Windows 설치 (Windows.old)",
  junk_virtual_disks: "가상 디스크 (WSL2 / Docker .vhdx)",
};

const es: TranslationDict = {
  ...en,
  browseFolder: "Carpeta",
  scan: "Analizar",
  rescan: "Reanalizar",
  cancel: "Detener",
  scanning: "Analizando",
  runAsAdmin: "Ejecutar como Admin (MFT)",
  adminActive: "Admin (MFT listo)",
  searchPlaceholder: "Buscar archivos o consulta (Enter)... (Ctrl+K)",
  settings: "Configuración",
  themeDark: "Oscuro",
  themeLight: "Claro",
  tabTree: "Árbol de carpetas",
  viewOptions: "Opciones de vista",
  tools: "Herramientas",
  tabSearch: "Buscar",
  tabTopFiles: "Archivos más grandes",
  tabDuplicates: "Duplicados",
  tabJunk: "Categorías y basura",
  tabTreemap: "Mapa de árbol",
  navBack: "Atrás",
  navForward: "Adelante",
  navUp: "Subir",
  modeSize: "Tamaño",
  modeAllocated: "En disco",
  modeFiles: "Archivos",
  unitAuto: "Auto",
  collapseAll: "Contraer",
  treeOnly: "Solo árbol",
  splitView: "Vista dividida",
  exportCsv: "Exportar CSV",
  exportJson: "Exportar JSON",
  snapshotDiff: "Instantánea / Diff",
  recycleBin: "Papelera",
  emptyRecycleBin: "Vaciar Papelera",
  colName: "Nombre",
  colShare: "% Cuota",
  colSize: "Tamaño",
  colAllocated: "En disco",
  colFiles: "Archivos",
  colFolders: "Carpetas",
  colModified: "Modificado",
  colActions: "Acciones",
  openFile: "Abrir archivo",
  revealExplorer: "Mostrar en el Explorador",
  openTerminal: "Abrir terminal aquí",
  copyPath: "Copiar ruta",
  moveToFolder: "Mover a carpeta...",
  newFolder: "Nueva carpeta",
  renameItem: "Renombrar",
  properties: "Propiedades",
  moveToTrash: "Mover a la Papelera",
  deletePermanently: "Eliminar permanentemente",
  dupTitle: "Buscador de duplicados (BLAKE3)",
  dupScanBtn: "Buscar duplicados",
  dupKeepNewest: "Conservar más reciente",
  dupKeepOldest: "Conservar más antiguo",
  dupKeepShortest: "Ruta más corta",
  emptyFoldersTitle: "Carpetas vacías",
  snapshotModalTitle: "Instantánea y diferencia de crecimiento",
  saveSnapshotBtn: "Guardar instantánea",
  compareSnapshotBtn: "Comparar instantánea",
  settingsTitle: "Configuración",
  languageLabel: "Idioma",
  themeLabel: "Apariencia",
  close: "Cerrar",
  junk_dev_cargo_cache: "Caché global de Cargo / Rust (.cargo)",
  junk_dev_pkg_cache: "Cachés de paquetes (npm / pnpm / yarn / pip / NuGet)",
  junk_gpu_shader_cache: "Caché de shaders GPU (NVIDIA / AMD / DirectX)",
  junk_win_old: "Instalación anterior de Windows (Windows.old)",
  junk_virtual_disks: "Discos virtuales (WSL2 / Docker .vhdx)",
};

const de: TranslationDict = {
  ...en,
  browseFolder: "Ordner",
  scan: "Scannen",
  rescan: "Neu scannen",
  cancel: "Stopp",
  scanning: "Scanne",
  runAsAdmin: "Als Admin starten (MFT)",
  adminActive: "Admin (MFT bereit)",
  searchPlaceholder: "Dateien suchen oder Abfrage (Enter)... (Ctrl+K)",
  settings: "Einstellungen",
  themeDark: "Dunkel",
  themeLight: "Hell",
  tabTree: "Ordnerbaum",
  viewOptions: "Ansicht",
  tools: "Werkzeuge",
  tabSearch: "Suche",
  tabTopFiles: "Größte Dateien",
  tabDuplicates: "Duplikate",
  tabJunk: "Kategorien & Datenmüll",
  tabTreemap: "Treemap",
  navBack: "Zurück",
  navForward: "Vorwärts",
  navUp: "Hoch",
  modeSize: "Größe",
  modeAllocated: "Belegt",
  modeFiles: "Dateien",
  unitAuto: "Auto",
  collapseAll: "Einklappen",
  treeOnly: "Nur Baum",
  splitView: "Geteilte Ansicht",
  exportCsv: "CSV-Export",
  exportJson: "JSON-Export",
  snapshotDiff: "Snapshot / Diff",
  recycleBin: "Papierkorb",
  emptyRecycleBin: "Papierkorb leeren",
  colName: "Name",
  colShare: "Anteil %",
  colSize: "Größe",
  colAllocated: "Belegt",
  colFiles: "Dateien",
  colFolders: "Ordner",
  colModified: "Geändert",
  colActions: "Aktionen",
  openFile: "Datei öffnen",
  revealExplorer: "Im Explorer anzeigen",
  openTerminal: "Terminal hier öffnen",
  copyPath: "Pfad kopieren",
  moveToFolder: "In Ordner verschieben...",
  newFolder: "Neuer Ordner",
  renameItem: "Umbenennen",
  properties: "Eigenschaften",
  moveToTrash: "In den Papierkorb",
  deletePermanently: "Endgültig löschen",
  dupTitle: "Duplikatfinder (BLAKE3)",
  dupScanBtn: "Duplikate suchen",
  dupKeepNewest: "Neueste behalten",
  dupKeepOldest: "Älteste behalten",
  dupKeepShortest: "Kürzesten Pfad behalten",
  emptyFoldersTitle: "Leere Ordner",
  snapshotModalTitle: "Snapshot & Wachstumsvergleich",
  saveSnapshotBtn: "Snapshot speichern",
  compareSnapshotBtn: "Snapshot vergleichen",
  settingsTitle: "Einstellungen",
  languageLabel: "Sprache",
  themeLabel: "Erscheinungsbild",
  close: "Schließen",
  junk_dev_cargo_cache: "Cargo / Rust Global-Cache (.cargo)",
  junk_dev_pkg_cache: "Paketmanager-Caches (npm / pnpm / yarn / pip / NuGet)",
  junk_gpu_shader_cache: "GPU-Shader-Caches (NVIDIA / AMD / DirectX)",
  junk_win_old: "Vorherige Windows-Installation (Windows.old)",
  junk_virtual_disks: "Virtuelle Festplatten (WSL2 / Docker .vhdx)",
};

const fr: TranslationDict = {
  ...en,
  browseFolder: "Dossier",
  scan: "Analyser",
  rescan: "Réanalyser",
  cancel: "Arrêter",
  scanning: "Analyse en cours",
  runAsAdmin: "Exécuter en Admin (MFT)",
  adminActive: "Admin (MFT prêt)",
  searchPlaceholder: "Rechercher fichiers ou requête (Entrée)... (Ctrl+K)",
  settings: "Paramètres",
  themeDark: "Sombre",
  themeLight: "Clair",
  tabTree: "Arborescence",
  viewOptions: "Affichage",
  tools: "Outils",
  tabSearch: "Recherche",
  tabTopFiles: "Plus gros fichiers",
  tabDuplicates: "Doublons",
  tabJunk: "Catégories & Nettoyage",
  tabTreemap: "Carte proportionnelle",
  navBack: "Précédent",
  navForward: "Suivant",
  navUp: "Parent",
  modeSize: "Taille",
  modeAllocated: "Sur disque",
  modeFiles: "Fichiers",
  unitAuto: "Auto",
  collapseAll: "Réduire",
  treeOnly: "Arbre seul",
  splitView: "Vue partagée",
  exportCsv: "Export CSV",
  exportJson: "Export JSON",
  snapshotDiff: "Instantané / Diff",
  recycleBin: "Corbeille",
  emptyRecycleBin: "Vider la Corbeille",
  colName: "Nom",
  colShare: "Part %",
  colSize: "Taille",
  colAllocated: "Sur disque",
  colFiles: "Fichiers",
  colFolders: "Dossiers",
  colModified: "Modifié",
  colActions: "Actions",
  openFile: "Ouvrir le fichier",
  revealExplorer: "Afficher dans l'Explorateur",
  openTerminal: "Ouvrir le terminal ici",
  copyPath: "Copier le chemin",
  moveToFolder: "Déplacer vers un dossier...",
  newFolder: "Nouveau dossier",
  renameItem: "Renommer",
  properties: "Propriétés",
  moveToTrash: "Mettre à la Corbeille",
  deletePermanently: "Supprimer définitivement",
  dupTitle: "Détecteur de doublons (BLAKE3)",
  dupScanBtn: "Chercher doublons",
  dupKeepNewest: "Garder le plus récent",
  dupKeepOldest: "Garder le plus ancien",
  dupKeepShortest: "Chemin le plus court",
  emptyFoldersTitle: "Dossiers vides",
  snapshotModalTitle: "Instantané et suivi de croissance",
  saveSnapshotBtn: "Enregistrer l'instantané",
  compareSnapshotBtn: "Comparer l'instantané",
  settingsTitle: "Paramètres",
  languageLabel: "Langue",
  themeLabel: "Apparence",
  close: "Fermer",
  junk_dev_cargo_cache: "Cache global Cargo / Rust (.cargo)",
  junk_dev_pkg_cache: "Caches de paquets (npm / pnpm / yarn / pip / NuGet)",
  junk_gpu_shader_cache: "Caches shaders GPU (NVIDIA / AMD / DirectX)",
  junk_win_old: "Ancienne installation Windows (Windows.old)",
  junk_virtual_disks: "Disques virtuels (WSL2 / Docker .vhdx)",
};

export const TRANSLATIONS: Record<LangCode, TranslationDict> = {
  en,
  vi,
  zh,
  ja,
  ko,
  es,
  de,
  fr,
};
