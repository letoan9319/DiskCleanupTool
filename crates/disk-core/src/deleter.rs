use std::collections::HashSet;
use std::fs;

use crate::arena::ScanArena;
use crate::model::{
    DeleteFailure, DeletePreview, DeletePreviewItem, DeleteReport, NodeId, SafetyLevel,
};
use crate::safety::evaluate_path_safety;

/// Filters out descendants if an ancestor is already in `node_ids`, and ignores deleted/root nodes.
fn deduplicate_selection(arena: &ScanArena, node_ids: &[NodeId]) -> Vec<NodeId> {
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
        let mut cur = arena.nodes[id as usize].parent;
        while let Some(pid) = cur {
            if unique.contains(&pid) {
                has_selected_ancestor = true;
                break;
            }
            cur = arena.nodes[pid as usize].parent;
        }
        if !has_selected_ancestor {
            result.push(id);
        }
    }
    result
}

pub fn preview_delete(arena: &ScanArena, node_ids: &[NodeId]) -> DeletePreview {
    let targets = deduplicate_selection(arena, node_ids);
    let mut items = Vec::with_capacity(targets.len());
    let mut total_reclaimable_bytes = 0u64;
    let mut safe_count = 0usize;
    let mut warning_count = 0usize;
    let mut blocked_count = 0usize;

    for id in targets {
        let node = &arena.nodes[id as usize];
        let path = arena.full_path(id);
        let (safety_level, safety_reason) = evaluate_path_safety(&path);

        match safety_level {
            SafetyLevel::Safe => {
                safe_count += 1;
                total_reclaimable_bytes = total_reclaimable_bytes.saturating_add(node.logical_size);
            }
            SafetyLevel::Warning => {
                warning_count += 1;
                total_reclaimable_bytes = total_reclaimable_bytes.saturating_add(node.logical_size);
            }
            SafetyLevel::Blocked => {
                blocked_count += 1;
            }
        }

        items.push(DeletePreviewItem {
            id,
            name: arena.node_name(id).to_string(),
            full_path: path.to_string_lossy().to_string(),
            is_dir: node.is_dir,
            logical_size: node.logical_size,
            safety_level,
            safety_reason,
        });
    }

    // Largest items first in modal preview
    items.sort_unstable_by_key(|a| std::cmp::Reverse(a.logical_size));

    DeletePreview {
        items,
        total_reclaimable_bytes,
        safe_count,
        warning_count,
        blocked_count,
    }
}

pub fn execute_delete(arena: &mut ScanArena, node_ids: &[NodeId], permanent: bool) -> DeleteReport {
    let targets = deduplicate_selection(arena, node_ids);
    let mut succeeded_ids = Vec::new();
    let mut failed = Vec::new();
    let mut freed_bytes = 0u64;

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

        let is_dir = arena.nodes[id as usize].is_dir;
        let del_result: Result<(), String> = if !permanent {
            trash::delete(&path).map_err(|e| e.to_string())
        } else if is_dir {
            fs::remove_dir_all(&path).map_err(|e| e.to_string())
        } else {
            fs::remove_file(&path).map_err(|e| e.to_string())
        };

        match del_result {
            Ok(()) => {
                let (freed_logical, _) = arena.mark_deleted_and_recalculate(id);
                freed_bytes = freed_bytes.saturating_add(freed_logical);
                succeeded_ids.push(id);
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

    let root = &arena.nodes[0];
    DeleteReport {
        succeeded_ids,
        failed,
        freed_bytes,
        permanent,
        updated_root_size: root.logical_size,
        updated_root_allocated: root.allocated_size,
        updated_root_files: root.file_count,
        updated_root_dirs: root.dir_count,
    }
}
