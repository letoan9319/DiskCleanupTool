pub mod ntfs_mft;
pub mod walker;

use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use crate::arena::ScanArena;
use crate::is_process_elevated;
use crate::model::{ScanEngineKind, ScanProgress, ScanSummary};

pub fn scan_path<F>(
    scan_id: u64,
    root_path: &Path,
    requested_engine: ScanEngineKind,
    cancel: Arc<AtomicBool>,
    mut progress_cb: F,
) -> Result<(ScanArena, ScanSummary), String>
where
    F: FnMut(ScanProgress),
{
    if !root_path.exists() {
        return Err(format!("Path does not exist: {}", root_path.display()));
    }

    let elevated = is_process_elevated();
    let mut fallback_reason: Option<String> = None;

    let try_mft = match requested_engine {
        ScanEngineKind::NtfsMft => true,
        ScanEngineKind::Auto => elevated,
        ScanEngineKind::ParallelWalker => false,
    };

    if try_mft {
        match ntfs_mft::scan_ntfs_mft(scan_id, root_path, &cancel, &mut progress_cb) {
            Ok((arena, errors_count, elapsed_ms)) => {
                let root = &arena.nodes[0];
                let summary = ScanSummary {
                    root_id: 0,
                    root_path: root_path.to_string_lossy().to_string(),
                    engine_used: ScanEngineKind::NtfsMft,
                    fallback_reason: None,
                    total_logical_size: root.logical_size,
                    total_allocated_size: root.allocated_size,
                    total_files: root.file_count,
                    total_dirs: root.dir_count,
                    elapsed_ms,
                    errors_count,
                };
                return Ok((arena, summary));
            }
            Err(ntfs_mft::MftError::Cancelled) => {
                return Err("Scan cancelled by user".to_string());
            }
            Err(err) => {
                fallback_reason = Some(err.to_string());
            }
        }
    } else if requested_engine == ScanEngineKind::Auto && !elevated {
        fallback_reason = Some("Running without Administrator privileges (using Parallel Win32 Walker)".to_string());
    }

    let walk_res = walker::scan_parallel(scan_id, root_path, &cancel, progress_cb)?;
    let root = &walk_res.arena.nodes[0];
    let summary = ScanSummary {
        root_id: 0,
        root_path: root_path.to_string_lossy().to_string(),
        engine_used: ScanEngineKind::ParallelWalker,
        fallback_reason,
        total_logical_size: root.logical_size,
        total_allocated_size: root.allocated_size,
        total_files: root.file_count,
        total_dirs: root.dir_count,
        elapsed_ms: walk_res.elapsed_ms,
        errors_count: walk_res.errors_count,
    };

    Ok((walk_res.arena, summary))
}
