use serde::{Deserialize, Serialize};

pub type NodeId = u32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[repr(u8)]
pub enum FileCategory {
    Video = 0,
    Archive = 1,
    Installer = 2,
    Image = 3,
    Audio = 4,
    Document = 5,
    CodeDb = 6,
    Other = 7,
}

impl FileCategory {
    #[inline]
    pub const fn as_index(self) -> usize {
        self as usize
    }

    pub fn from_extension(ext: &str) -> Self {
        if ext.is_empty() || ext.len() > 12 {
            return Self::Other;
        }
        let mut buf = [0u8; 12];
        let bytes = ext.as_bytes();
        for (i, &b) in bytes.iter().enumerate() {
            buf[i] = b.to_ascii_lowercase();
        }
        let Ok(lower) = std::str::from_utf8(&buf[..bytes.len()]) else {
            return Self::Other;
        };
        match lower {
            "mp4" | "mkv" | "avi" | "mov" | "wmv" | "webm" | "flv" | "m4v" | "mpg" | "mpeg"
            | "m2ts" => Self::Video,
            "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" | "zst" | "iso" | "vhd"
            | "vhdx" | "img" | "dmg" | "wim" => Self::Archive,
            "exe" | "msi" | "msix" | "appx" | "dll" | "sys" | "cab" | "bat" | "cmd" => {
                Self::Installer
            }
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "psd" | "ai" | "raw"
            | "cr2" | "nef" | "arw" | "heic" | "tiff" | "tif" | "ico" => Self::Image,
            "mp3" | "flac" | "wav" | "aac" | "ogg" | "m4a" | "wma" | "opus" => Self::Audio,
            "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" | "md" | "rtf"
            | "csv" | "odt" | "ods" => Self::Document,
            "db" | "sqlite" | "sqlite3" | "bak" | "sql" | "log" | "json" | "xml" | "yaml"
            | "yml" | "toml" | "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "cs" | "cpp"
            | "c" | "h" | "java" | "go" | "pdb" | "lib" | "obj" | "rlib" => Self::CodeDb,
            _ => Self::Other,
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        match name.trim().to_ascii_lowercase().as_str() {
            "video" | "videos" => Some(Self::Video),
            "archive" | "archives" => Some(Self::Archive),
            "installer" | "installers" => Some(Self::Installer),
            "image" | "images" | "img" => Some(Self::Image),
            "audio" | "music" => Some(Self::Audio),
            "document" | "documents" | "doc" | "docs" => Some(Self::Document),
            "code_db" | "codedb" | "code" | "db" => Some(Self::CodeDb),
            "other" => Some(Self::Other),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Video => "video",
            Self::Archive => "archive",
            Self::Installer => "installer",
            Self::Image => "image",
            Self::Audio => "audio",
            Self::Document => "document",
            Self::CodeDb => "code_db",
            Self::Other => "other",
        }
    }

    pub fn all() -> &'static [FileCategory] {
        &[
            Self::Video,
            Self::Archive,
            Self::Installer,
            Self::Image,
            Self::Audio,
            Self::Document,
            Self::CodeDb,
            Self::Other,
        ]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanEngineKind {
    Auto,
    NtfsMft,
    ParallelWalker,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortField {
    Size,
    Allocated,
    Name,
    Files,
    Folders,
    Modified,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortDir {
    Desc,
    Asc,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SafetyLevel {
    Safe,
    Warning,
    Blocked,
}

impl SafetyLevel {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Safe => "safe",
            Self::Warning => "warning",
            Self::Blocked => "blocked",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeDto {
    pub id: NodeId,
    pub parent_id: Option<NodeId>,
    pub name: String,
    pub full_path: String,
    pub is_dir: bool,
    pub logical_size: u64,
    pub allocated_size: u64,
    pub file_count: u64,
    pub dir_count: u64,
    pub modified_ts: i64,
    pub extension: String,
    pub category: FileCategory,
    pub percent_of_parent: f64,
    pub percent_of_root: f64,
    pub has_children: bool,
    pub safety_level: SafetyLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildrenPage {
    pub parent_id: NodeId,
    pub total_count: usize,
    pub offset: usize,
    pub items: Vec<NodeDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BreadcrumbItem {
    pub id: NodeId,
    pub name: String,
    pub full_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub scan_id: u64,
    pub engine: ScanEngineKind,
    pub files_scanned: u64,
    pub dirs_scanned: u64,
    pub bytes_scanned: u64,
    pub current_path: String,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub root_id: NodeId,
    pub root_path: String,
    pub engine_used: ScanEngineKind,
    pub fallback_reason: Option<String>,
    pub total_logical_size: u64,
    pub total_allocated_size: u64,
    pub total_files: u64,
    pub total_dirs: u64,
    pub elapsed_ms: u64,
    pub errors_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryStat {
    pub category: FileCategory,
    pub logical_size: u64,
    pub allocated_size: u64,
    pub file_count: u64,
    pub percent_of_total: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JunkItem {
    pub node_id: NodeId,
    pub name: String,
    pub full_path: String,
    pub is_dir: bool,
    pub logical_size: u64,
    pub allocated_size: u64,
    pub file_count: u64,
    pub modified_ts: i64,
    pub safety_level: SafetyLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JunkGroup {
    pub group_key: String,
    pub total_size: u64,
    pub item_count: usize,
    pub items: Vec<JunkItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreemapItem {
    pub id: Option<NodeId>,
    pub name: String,
    pub full_path: String,
    pub is_dir: bool,
    pub logical_size: u64,
    pub category: FileCategory,
    pub percent_of_parent: f64,
    pub is_aggregate: bool,
    pub safety_level: SafetyLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePreviewItem {
    pub id: NodeId,
    pub name: String,
    pub full_path: String,
    pub is_dir: bool,
    pub logical_size: u64,
    pub safety_level: SafetyLevel,
    pub safety_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePreview {
    pub items: Vec<DeletePreviewItem>,
    pub total_reclaimable_bytes: u64,
    pub safe_count: usize,
    pub warning_count: usize,
    pub blocked_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFailure {
    pub id: NodeId,
    pub full_path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteReport {
    pub succeeded_ids: Vec<NodeId>,
    pub failed: Vec<DeleteFailure>,
    pub freed_bytes: u64,
    pub permanent: bool,
    pub updated_root_size: u64,
    pub updated_root_allocated: u64,
    pub updated_root_files: u64,
    pub updated_root_dirs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub items: Vec<NodeDto>,
    pub total_matches: usize,
    pub total_matched_bytes: u64,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpandedTreeEntry {
    pub node: NodeDto,
    pub depth: usize,
    pub has_expanded_children: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateProgress {
    pub stage: String,
    pub processed: usize,
    pub total: usize,
    pub groups_found: usize,
    pub wasted_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateFile {
    pub node_id: NodeId,
    pub name: String,
    pub full_path: String,
    pub modified_ts: i64,
    pub safety_level: SafetyLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub hash: String,
    pub file_size: u64,
    pub wasted_bytes: u64,
    pub files: Vec<DuplicateFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateReport {
    pub groups: Vec<DuplicateGroup>,
    pub total_wasted_bytes: u64,
    pub total_duplicate_files: usize,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowthDiffItem {
    pub path: String,
    pub name: String,
    pub before_bytes: u64,
    pub after_bytes: u64,
    pub delta_bytes: i64,
    pub before_files: u64,
    pub after_files: u64,
    pub delta_files: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDiffReport {
    pub baseline_path: String,
    pub baseline_timestamp: i64,
    pub current_path: String,
    pub total_before_bytes: u64,
    pub total_after_bytes: u64,
    pub total_delta_bytes: i64,
    pub items: Vec<GrowthDiffItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotEntry {
    pub rel_path: String,
    pub logical_size: u64,
    pub file_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskSnapshot {
    pub version: u32,
    pub root_path: String,
    pub created_ts: i64,
    pub total_logical_size: u64,
    pub total_files: u64,
    pub total_dirs: u64,
    pub entries: Vec<SnapshotEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveReport {
    pub moved_count: usize,
    pub failed: Vec<DeleteFailure>,
    pub updated_root_size: u64,
    pub updated_root_allocated: u64,
    pub updated_root_files: u64,
    pub updated_root_dirs: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthStatus {
    Good,
    Caution,
    Critical,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SmartAttrStatus {
    Good,
    Caution,
    Critical,
    Neutral,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SmartProtocol {
    Nvme,
    Ata,
    BasicOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartAttribute {
    pub id: u8,
    pub id_hex: String,
    pub name: String,
    pub status: SmartAttrStatus,
    pub current: Option<u8>,
    pub worst: Option<u8>,
    pub threshold: Option<u8>,
    pub raw_hex: String,
    pub raw_value: u64,
    pub decoded_value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalDiskHealth {
    pub disk_index: u32,
    pub model: String,
    pub serial_number: String,
    pub firmware: String,
    pub capacity_bytes: u64,
    pub drive_letters: Vec<String>,
    pub interface_type: String,
    pub standard: String,
    pub media_type: String,
    pub rotation_rate: Option<u32>,
    pub features: Vec<String>,
    pub protocol: SmartProtocol,
    pub health_status: HealthStatus,
    pub health_percent: Option<u8>,
    pub temperature_c: Option<i32>,
    pub total_host_reads_bytes: Option<u64>,
    pub total_host_writes_bytes: Option<u64>,
    pub power_on_count: Option<u64>,
    pub power_on_hours: Option<u64>,
    pub unsafe_shutdowns: Option<u64>,
    pub media_errors: Option<u64>,
    pub available_spare_pct: Option<u8>,
    pub smart_available: bool,
    pub requires_admin_for_smart: bool,
    pub diagnostic_notes: Vec<String>,
    pub attributes: Vec<SmartAttribute>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskHealthReport {
    pub is_admin: bool,
    pub disks: Vec<PhysicalDiskHealth>,
    pub collected_at_ts: i64,
}
