use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use disk_core::analyzer::{
    category_breakdown, detect_junk_targets, find_empty_folders, top_largest_files,
    treemap_children,
};
use disk_core::arena::ScanArena;
use disk_core::deleter::{
    execute_delete as core_execute_delete, preview_delete as core_preview_delete,
};
use disk_core::duplicates::find_duplicates as core_find_duplicates;
use disk_core::model::{
    BreadcrumbItem, CategoryStat, ChildrenPage, DeleteFailure, DeletePreview, DeleteReport,
    DiskHealthReport, DuplicateReport, ExpandedTreeEntry, FileCategory, JunkGroup, MoveReport,
    NodeDto, NodeId, SafetyLevel, ScanEngineKind, ScanSummary, SearchResult, SnapshotDiffReport,
    SortDir, SortField, TreemapItem,
};
use disk_core::safety::evaluate_path_safety;
use disk_core::scanner::scan_path;
use disk_core::search::search_arena;
use disk_core::smart::{collect_all_disk_health, format_smart_report_text};
use disk_core::snapshot::{compare_snapshot_file, export_report_to_file, save_snapshot_to_file};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;
use crate::windows_shell::{
    empty_recycle_bin as shell_empty_recycle_bin,
    get_recycle_bin_info as shell_get_recycle_bin_info, is_context_menu_enabled, is_elevated,
    list_drives as shell_list_drives, move_path as shell_move_path,
    open_file_default as shell_open_file_default, open_terminal_here as shell_open_terminal_here,
    relaunch_as_admin as shell_relaunch_as_admin, reveal_in_explorer as shell_reveal_in_explorer,
    set_context_menu_enabled, show_file_properties as shell_show_file_properties, DriveInfo,
    RecycleBinInfo,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfoDto {
    pub is_admin: bool,
    pub context_menu_enabled: bool,
    pub initial_path: Option<String>,
    pub initial_tab: Option<String>,
}

fn validate_entry_name(name: &str) -> Result<&str, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err("Name cannot be empty or a relative path reference".to_string());
    }
    if trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains(':')
        || trimmed.contains('\0')
    {
        return Err("Name cannot contain path separators or reserved characters".to_string());
    }
    Ok(trimmed)
}

fn deduplicate_node_ids(arena: &ScanArena, node_ids: &[NodeId]) -> Vec<NodeId> {
    let unique: HashSet<NodeId> = node_ids
        .iter()
        .copied()
        .filter(|&id| {
            id != 0
                && arena
                    .nodes
                    .get(id as usize)
                    .map(|n| !n.deleted)
                    .unwrap_or(false)
        })
        .collect();

    let mut result = Vec::with_capacity(unique.len());
    for &id in &unique {
        let mut has_selected_ancestor = false;
        let mut cur = arena.nodes.get(id as usize).and_then(|n| n.parent);
        while let Some(pid) = cur {
            if unique.contains(&pid) {
                has_selected_ancestor = true;
                break;
            }
            cur = arena.nodes.get(pid as usize).and_then(|n| n.parent);
        }
        if !has_selected_ancestor {
            result.push(id);
        }
    }
    result
}

#[tauri::command]
pub fn get_system_info(state: State<'_, AppState>) -> SystemInfoDto {
    let initial_path = state.initial_path.lock().ok().and_then(|mut g| g.take());
    let initial_tab = state.initial_tab.lock().ok().and_then(|mut g| g.take());
    SystemInfoDto {
        is_admin: is_elevated(),
        context_menu_enabled: is_context_menu_enabled(),
        initial_path,
        initial_tab,
    }
}

#[tauri::command]
pub fn list_drives() -> Vec<DriveInfo> {
    shell_list_drives()
}

#[tauri::command]
pub async fn start_scan(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    engine_mode: Option<ScanEngineKind>,
) -> Result<ScanSummary, String> {
    let scan_id = state.active_scan_id.fetch_add(1, Ordering::SeqCst) + 1;

    // Cancel any previous running duplicate scan so it releases the arena read lock
    if let Ok(mut dup_guard) = state.dup_cancel_flag.lock() {
        if let Some(prev_dup) = dup_guard.take() {
            prev_dup.store(true, Ordering::Relaxed);
        }
    }

    // Cancel any previous running scan
    let cancel = {
        let mut guard = state
            .cancel_flag
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        if let Some(prev) = guard.take() {
            prev.store(true, Ordering::Relaxed);
        }
        let new_flag = Arc::new(AtomicBool::new(false));
        *guard = Some(Arc::clone(&new_flag));
        new_flag
    };

    let target = PathBuf::from(&path);
    let engine = engine_mode.unwrap_or(ScanEngineKind::Auto);
    let app_handle = app.clone();

    let (arena, summary) = tauri::async_runtime::spawn_blocking(move || {
        scan_path(scan_id, &target, engine, cancel, move |progress| {
            let _ = app_handle.emit("scan-progress", progress);
        })
    })
    .await
    .map_err(|e| format!("Scan task panicked: {}", e))??;

    // Only commit result if this scan wasn't superseded by a newer one
    if state.active_scan_id.load(Ordering::SeqCst) != scan_id {
        return Err("Scan superseded by a newer scan".to_string());
    }

    if let Ok(mut arena_w) = state.arena.write() {
        *arena_w = Some(arena);
    }
    if let Ok(mut sum_w) = state.summary.write() {
        *sum_w = Some(summary.clone());
    }

    Ok(summary)
}

#[tauri::command]
pub fn cancel_scan(state: State<'_, AppState>) -> bool {
    if let Ok(guard) = state.cancel_flag.lock() {
        if let Some(flag) = guard.as_ref() {
            flag.store(true, Ordering::Relaxed);
            return true;
        }
    }
    false
}

#[tauri::command]
pub fn get_scan_summary(state: State<'_, AppState>) -> Option<ScanSummary> {
    state.summary.read().ok().and_then(|g| g.clone())
}

#[tauri::command]
pub fn get_node_children(
    state: State<'_, AppState>,
    node_id: NodeId,
    offset: Option<usize>,
    limit: Option<usize>,
    sort_by: Option<SortField>,
    sort_dir: Option<SortDir>,
    search_query: Option<String>,
) -> Result<ChildrenPage, String> {
    let guard = state.arena.read().map_err(|_| "Lock error".to_string())?;
    let Some(arena) = guard.as_ref() else {
        return Ok(ChildrenPage {
            parent_id: node_id,
            total_count: 0,
            offset: 0,
            items: Vec::new(),
        });
    };

    Ok(arena.get_children(
        node_id,
        offset.unwrap_or(0),
        limit.unwrap_or(500).min(5000),
        sort_by.unwrap_or(SortField::Size),
        sort_dir.unwrap_or(SortDir::Desc),
        search_query.as_deref().unwrap_or(""),
    ))
}

#[tauri::command]
pub fn get_node_ancestors(
    state: State<'_, AppState>,
    node_id: NodeId,
) -> Result<Vec<BreadcrumbItem>, String> {
    let guard = state.arena.read().map_err(|_| "Lock error".to_string())?;
    let Some(arena) = guard.as_ref() else {
        return Ok(Vec::new());
    };
    Ok(arena.get_ancestors(node_id))
}

#[tauri::command]
pub fn get_top_largest_files(
    state: State<'_, AppState>,
    limit: Option<usize>,
    min_size_bytes: Option<u64>,
    ext_filter: Option<String>,
    category_filter: Option<FileCategory>,
    search_query: Option<String>,
) -> Result<Vec<NodeDto>, String> {
    let guard = state.arena.read().map_err(|_| "Lock error".to_string())?;
    let Some(arena) = guard.as_ref() else {
        return Ok(Vec::new());
    };
    Ok(top_largest_files(
        arena,
        limit.unwrap_or(500),
        min_size_bytes.unwrap_or(0),
        ext_filter.as_deref(),
        category_filter,
        search_query.as_deref().unwrap_or(""),
    ))
}

#[tauri::command]
pub fn get_category_breakdown(state: State<'_, AppState>) -> Result<Vec<CategoryStat>, String> {
    let guard = state.arena.read().map_err(|_| "Lock error".to_string())?;
    let Some(arena) = guard.as_ref() else {
        return Ok(Vec::new());
    };
    Ok(category_breakdown(arena))
}

#[tauri::command]
pub fn get_junk_targets(state: State<'_, AppState>) -> Result<Vec<JunkGroup>, String> {
    let guard = state.arena.read().map_err(|_| "Lock error".to_string())?;
    let Some(arena) = guard.as_ref() else {
        return Ok(Vec::new());
    };
    Ok(detect_junk_targets(arena))
}

#[tauri::command]
pub fn get_treemap_children(
    state: State<'_, AppState>,
    dir_id: NodeId,
    max_items: Option<usize>,
) -> Result<Vec<TreemapItem>, String> {
    let guard = state.arena.read().map_err(|_| "Lock error".to_string())?;
    let Some(arena) = guard.as_ref() else {
        return Ok(Vec::new());
    };
    Ok(treemap_children(arena, dir_id, max_items.unwrap_or(45)))
}

#[tauri::command]
pub fn preview_delete(
    state: State<'_, AppState>,
    node_ids: Vec<NodeId>,
) -> Result<DeletePreview, String> {
    let guard = state.arena.read().map_err(|_| "Lock error".to_string())?;
    let Some(arena) = guard.as_ref() else {
        return Err("No scan data loaded".to_string());
    };
    Ok(core_preview_delete(arena, &node_ids))
}

#[tauri::command]
pub async fn execute_delete(
    state: State<'_, AppState>,
    node_ids: Vec<NodeId>,
    permanent: bool,
) -> Result<DeleteReport, String> {
    let mut guard = state.arena.write().map_err(|_| "Lock error".to_string())?;
    let Some(arena) = guard.as_mut() else {
        return Err("No scan data loaded".to_string());
    };
    let report = core_execute_delete(arena, &node_ids, permanent);

    if let Ok(mut sum_w) = state.summary.write() {
        if let Some(summary) = sum_w.as_mut() {
            summary.total_logical_size = report.updated_root_size;
            summary.total_allocated_size = report.updated_root_allocated;
            summary.total_files = report.updated_root_files;
            summary.total_dirs = report.updated_root_dirs;
        }
    }

    Ok(report)
}

#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    shell_reveal_in_explorer(&path)
}

#[tauri::command]
pub fn relaunch_as_admin(
    app: AppHandle,
    target_path: Option<String>,
    initial_tab: Option<String>,
) -> Result<(), String> {
    shell_relaunch_as_admin(target_path, initial_tab)?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn set_context_menu(enabled: bool) -> Result<bool, String> {
    set_context_menu_enabled(enabled)?;
    Ok(is_context_menu_enabled())
}

// ============================================================================
// v0.2.0 Commands
// ============================================================================

#[tauri::command]
pub fn search_global(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
    sort_by: Option<SortField>,
    sort_dir: Option<SortDir>,
) -> Result<SearchResult, String> {
    let guard = state.arena.read().map_err(|_| "Lock error".to_string())?;
    let Some(arena) = guard.as_ref() else {
        return Ok(SearchResult {
            items: Vec::new(),
            total_matches: 0,
            total_matched_bytes: 0,
            elapsed_ms: 0,
        });
    };

    Ok(search_arena(
        arena,
        &query,
        limit.unwrap_or(500).min(5000),
        sort_by.unwrap_or(SortField::Size),
        sort_dir.unwrap_or(SortDir::Desc),
    ))
}

#[tauri::command]
pub fn get_expanded_tree(
    state: State<'_, AppState>,
    root_id: NodeId,
    max_depth: usize,
    sort_by: Option<SortField>,
    sort_dir: Option<SortDir>,
    limit_per_dir: Option<usize>,
) -> Result<Vec<ExpandedTreeEntry>, String> {
    let guard = state.arena.read().map_err(|_| "Lock error".to_string())?;
    let Some(arena) = guard.as_ref() else {
        return Ok(Vec::new());
    };

    Ok(arena.get_expanded_tree(
        root_id,
        max_depth,
        sort_by.unwrap_or(SortField::Size),
        sort_dir.unwrap_or(SortDir::Desc),
        limit_per_dir.unwrap_or(100).min(1000),
    ))
}

#[tauri::command]
pub async fn find_duplicates(
    app: AppHandle,
    state: State<'_, AppState>,
    min_size_bytes: Option<u64>,
) -> Result<DuplicateReport, String> {
    let cancel = {
        let mut guard = state
            .dup_cancel_flag
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        if let Some(prev) = guard.take() {
            prev.store(true, Ordering::Relaxed);
        }
        let new_flag = Arc::new(AtomicBool::new(false));
        *guard = Some(Arc::clone(&new_flag));
        new_flag
    };

    let arena_lock = Arc::clone(&state.arena);
    let min_size = min_size_bytes.unwrap_or(1_048_576);
    let app_handle = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let guard = arena_lock.read().map_err(|_| "Lock error".to_string())?;
        let Some(arena) = guard.as_ref() else {
            return Err("No scan data loaded".to_string());
        };
        core_find_duplicates(arena, min_size, cancel, move |progress| {
            let _ = app_handle.emit("dup-progress", progress);
        })
    })
    .await
    .map_err(|e| format!("Duplicate scan task panicked: {}", e))?
}

#[tauri::command]
pub fn cancel_duplicates(state: State<'_, AppState>) -> bool {
    if let Ok(guard) = state.dup_cancel_flag.lock() {
        if let Some(flag) = guard.as_ref() {
            flag.store(true, Ordering::Relaxed);
            return true;
        }
    }
    false
}

#[tauri::command]
pub fn get_empty_folders(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<NodeDto>, String> {
    let guard = state.arena.read().map_err(|_| "Lock error".to_string())?;
    let Some(arena) = guard.as_ref() else {
        return Ok(Vec::new());
    };
    Ok(find_empty_folders(arena, limit.unwrap_or(500).min(5000)))
}

#[tauri::command]
pub fn get_recycle_bin_info() -> RecycleBinInfo {
    shell_get_recycle_bin_info()
}

#[tauri::command]
pub fn empty_recycle_bin() -> Result<(), String> {
    shell_empty_recycle_bin()
}

#[tauri::command]
pub async fn move_items(
    state: State<'_, AppState>,
    node_ids: Vec<NodeId>,
    dest_dir: String,
) -> Result<MoveReport, String> {
    let dest_path = PathBuf::from(&dest_dir);
    if !dest_path.is_dir() {
        return Err(format!(
            "Destination directory does not exist: {}",
            dest_path.display()
        ));
    }

    let arena_lock = Arc::clone(&state.arena);
    let summary_lock = Arc::clone(&state.summary);

    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = arena_lock.write().map_err(|_| "Lock error".to_string())?;
        let Some(arena) = guard.as_mut() else {
            return Err("No scan data loaded".to_string());
        };

        let targets = deduplicate_node_ids(arena, &node_ids);
        let mut moved_count = 0usize;
        let mut failed = Vec::new();

        for id in targets {
            let path = arena.full_path(id);
            let (safety_level, reason) = evaluate_path_safety(&path);
            if safety_level == SafetyLevel::Blocked {
                failed.push(DeleteFailure {
                    id,
                    full_path: path.to_string_lossy().to_string(),
                    reason: reason.unwrap_or_else(|| "Protected system path blocked".to_string()),
                });
                continue;
            }

            match shell_move_path(&path, &dest_path) {
                Ok(_) => {
                    let _ = arena.mark_deleted_and_recalculate(id);
                    moved_count += 1;
                }
                Err(err) => {
                    failed.push(DeleteFailure {
                        id,
                        full_path: path.to_string_lossy().to_string(),
                        reason: err,
                    });
                }
            }
        }

        let (updated_root_size, updated_root_allocated, updated_root_files, updated_root_dirs) =
            arena
                .nodes
                .first()
                .map(|r| (r.logical_size, r.allocated_size, r.file_count, r.dir_count))
                .unwrap_or((0, 0, 0, 0));

        if let Ok(mut sum_w) = summary_lock.write() {
            if let Some(summary) = sum_w.as_mut() {
                summary.total_logical_size = updated_root_size;
                summary.total_allocated_size = updated_root_allocated;
                summary.total_files = updated_root_files;
                summary.total_dirs = updated_root_dirs;
            }
        }

        Ok(MoveReport {
            moved_count,
            failed,
            updated_root_size,
            updated_root_allocated,
            updated_root_files,
            updated_root_dirs,
        })
    })
    .await
    .map_err(|e| format!("Move task panicked: {}", e))?
}

#[tauri::command]
pub fn rename_item(
    state: State<'_, AppState>,
    node_id: NodeId,
    new_name: String,
) -> Result<NodeDto, String> {
    let trimmed = validate_entry_name(&new_name)?;
    if node_id == 0 {
        return Err("Cannot rename the scan root directory".to_string());
    }

    let mut guard = state.arena.write().map_err(|_| "Lock error".to_string())?;
    let Some(arena) = guard.as_mut() else {
        return Err("No scan data loaded".to_string());
    };

    let Some(node) = arena.nodes.get(node_id as usize) else {
        return Err("Item not found".to_string());
    };
    if node.deleted {
        return Err("Cannot rename a deleted item".to_string());
    }

    let old_path = arena.full_path(node_id);
    let (safety_level, reason) = evaluate_path_safety(&old_path);
    if safety_level == SafetyLevel::Blocked {
        return Err(reason.unwrap_or_else(|| "Protected system path cannot be renamed".to_string()));
    }

    let parent_dir = old_path
        .parent()
        .ok_or_else(|| "Cannot determine parent directory".to_string())?;
    let new_path = parent_dir.join(trimmed);

    let same_ci = old_path
        .to_string_lossy()
        .eq_ignore_ascii_case(&new_path.to_string_lossy());
    if !same_ci && new_path.exists() {
        return Err(format!("An item named '{}' already exists", trimmed));
    }

    std::fs::rename(&old_path, &new_path)
        .map_err(|e| format!("Failed to rename '{}': {}", old_path.display(), e))?;

    arena
        .rename_node(node_id, trimmed)
        .ok_or_else(|| "Failed to update renamed item in scan state".to_string())
}

#[tauri::command]
pub fn create_folder(
    state: State<'_, AppState>,
    parent_id: NodeId,
    name: String,
) -> Result<NodeDto, String> {
    let trimmed = validate_entry_name(&name)?;

    let mut guard = state.arena.write().map_err(|_| "Lock error".to_string())?;
    let Some(arena) = guard.as_mut() else {
        return Err("No scan data loaded".to_string());
    };

    let Some(parent) = arena.nodes.get(parent_id as usize) else {
        return Err("Parent directory not found".to_string());
    };
    if !parent.is_dir || parent.deleted {
        return Err("Parent node is not an active directory".to_string());
    }

    let parent_path = arena.full_path(parent_id);
    let new_dir = parent_path.join(trimmed);
    let (safety_level, reason) = evaluate_path_safety(&new_dir);
    if safety_level == SafetyLevel::Blocked {
        return Err(
            reason.unwrap_or_else(|| "Cannot create folder in protected system path".to_string())
        );
    }

    std::fs::create_dir(&new_dir)
        .map_err(|e| format!("Failed to create folder '{}': {}", new_dir.display(), e))?;

    let dto = arena
        .add_runtime_folder(parent_id, trimmed)
        .ok_or_else(|| "Failed to register new folder in scan state".to_string())?;

    if let Some(root) = arena.nodes.first() {
        if let Ok(mut sum_w) = state.summary.write() {
            if let Some(summary) = sum_w.as_mut() {
                summary.total_dirs = root.dir_count;
            }
        }
    }

    Ok(dto)
}

#[tauri::command]
pub fn open_file(path: String) -> Result<(), String> {
    shell_open_file_default(&path)
}

#[tauri::command]
pub fn open_terminal(path: String) -> Result<(), String> {
    shell_open_terminal_here(&path)
}

#[tauri::command]
pub fn show_properties(path: String) -> Result<(), String> {
    shell_show_file_properties(&path)
}

#[tauri::command]
pub fn export_report(
    state: State<'_, AppState>,
    format: String,
    scope: String,
    dest_path: String,
) -> Result<usize, String> {
    let guard = state.arena.read().map_err(|_| "Lock error".to_string())?;
    let Some(arena) = guard.as_ref() else {
        return Err("No scan data loaded".to_string());
    };
    export_report_to_file(arena, &format, &scope, Path::new(&dest_path))
}

#[tauri::command]
pub fn save_snapshot(
    state: State<'_, AppState>,
    dest_path: String,
    max_depth: Option<usize>,
) -> Result<usize, String> {
    let guard = state.arena.read().map_err(|_| "Lock error".to_string())?;
    let Some(arena) = guard.as_ref() else {
        return Err("No scan data loaded".to_string());
    };
    save_snapshot_to_file(arena, Path::new(&dest_path), max_depth.unwrap_or(4))
}

#[tauri::command]
pub fn compare_snapshot(
    state: State<'_, AppState>,
    snapshot_path: String,
) -> Result<SnapshotDiffReport, String> {
    let guard = state.arena.read().map_err(|_| "Lock error".to_string())?;
    let Some(arena) = guard.as_ref() else {
        return Err("No scan data loaded".to_string());
    };
    compare_snapshot_file(Path::new(&snapshot_path), arena)
}

// ============================================================================
// v0.3.0 Disk Health (S.M.A.R.T.) Commands
// ============================================================================

#[tauri::command]
pub async fn get_disk_health() -> Result<DiskHealthReport, String> {
    tauri::async_runtime::spawn_blocking(collect_all_disk_health)
        .await
        .map_err(|e| format!("Disk health query panicked: {}", e))
}

#[tauri::command]
pub async fn export_disk_health(
    disk_index: u32,
    format: String,
    mask_serial: bool,
    dest_path: String,
) -> Result<(), String> {
    let report = tauri::async_runtime::spawn_blocking(collect_all_disk_health)
        .await
        .map_err(|e| format!("Disk health query panicked: {}", e))?;

    let disk = report
        .disks
        .iter()
        .find(|d| d.disk_index == disk_index)
        .ok_or_else(|| format!("Physical disk #{} not found", disk_index))?;

    let content = match format.to_ascii_lowercase().as_str() {
        "json" => {
            let mut cloned = disk.clone();
            if mask_serial {
                cloned.serial_number = "****************".to_string();
            }
            serde_json::to_string_pretty(&cloned).map_err(|e| e.to_string())?
        }
        _ => format_smart_report_text(disk, mask_serial),
    };

    std::fs::write(Path::new(&dest_path), content).map_err(|e| e.to_string())
}
