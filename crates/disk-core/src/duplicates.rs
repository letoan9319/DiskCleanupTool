use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use rayon::prelude::*;
use rustc_hash::FxHashMap;

use crate::arena::ScanArena;
use crate::model::{
    DuplicateFile, DuplicateGroup, DuplicateProgress, DuplicateReport, NodeId,
};
use crate::safety::evaluate_path_safety;

const PARTIAL_WINDOW: usize = 4096;
const FULL_BUF_SIZE: usize = 128 * 1024;

fn hash_partial(path: &Path, logical_size: u64) -> Option<[u8; 32]> {
    let mut file = File::open(path).ok()?;
    let mut hasher = blake3::Hasher::new();
    hasher.update(&logical_size.to_le_bytes());

    let mut head_buf = [0u8; PARTIAL_WINDOW];
    let head_read = read_up_to(&mut file, &mut head_buf)?;
    hasher.update(&head_buf[..head_read]);

    if logical_size > PARTIAL_WINDOW as u64 {
        let tail_start = logical_size.saturating_sub(PARTIAL_WINDOW as u64);
        if file.seek(SeekFrom::Start(tail_start)).is_ok() {
            let mut tail_buf = [0u8; PARTIAL_WINDOW];
            let tail_read = read_up_to(&mut file, &mut tail_buf)?;
            hasher.update(&tail_buf[..tail_read]);
        }
    }

    Some(*hasher.finalize().as_bytes())
}

fn hash_full(path: &Path, cancel: &AtomicBool) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut hasher = blake3::Hasher::new();
    let mut buf = vec![0u8; FULL_BUF_SIZE];

    loop {
        if cancel.load(Ordering::Relaxed) {
            return None;
        }
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }

    Some(hasher.finalize().to_hex().to_string())
}

fn read_up_to(file: &mut File, buf: &mut [u8]) -> Option<usize> {
    let mut total = 0usize;
    while total < buf.len() {
        match file.read(&mut buf[total..]) {
            Ok(0) => break,
            Ok(n) => total += n,
            Err(_) => return None,
        }
    }
    Some(total)
}

/// 3-stage BLAKE3 duplicate finder:
/// 1. Group active files by exact `logical_size` in `FxHashMap`.
/// 2. Parallel BLAKE3 partial hash (first 4 KB + last 4 KB + size).
/// 3. Parallel BLAKE3 full streaming hash (128 KB buffer).
pub fn find_duplicates<F>(
    arena: &ScanArena,
    min_size_bytes: u64,
    cancel: Arc<AtomicBool>,
    mut progress_cb: F,
) -> Result<DuplicateReport, String>
where
    F: FnMut(DuplicateProgress),
{
    let start = Instant::now();
    let min_size = min_size_bytes.max(1);

    // Stage 1: Group by logical_size
    let mut by_size: FxHashMap<u64, Vec<NodeId>> = FxHashMap::default();
    for node in &arena.nodes {
        if node.deleted || node.is_dir || node.logical_size < min_size {
            continue;
        }
        by_size.entry(node.logical_size).or_default().push(node.id);
    }

    if cancel.load(Ordering::Relaxed) {
        return Err("Duplicate scan cancelled by user".to_string());
    }

    let mut size_candidates: Vec<(NodeId, u64)> = Vec::new();
    let mut size_groups_count = 0usize;
    for (size, ids) in by_size {
        if ids.len() >= 2 {
            size_groups_count += 1;
            for id in ids {
                size_candidates.push((id, size));
            }
        }
    }

    progress_cb(DuplicateProgress {
        stage: "grouping_by_size".to_string(),
        processed: size_candidates.len(),
        total: size_candidates.len(),
        groups_found: size_groups_count,
        wasted_bytes: 0,
    });

    if size_candidates.is_empty() {
        return Ok(DuplicateReport {
            groups: Vec::new(),
            total_wasted_bytes: 0,
            total_duplicate_files: 0,
            elapsed_ms: start.elapsed().as_millis() as u64,
        });
    }

    // Stage 2: Parallel partial BLAKE3 hash (4 KB head + 4 KB tail + size)
    let total_partial = size_candidates.len();
    let mut partial_map: FxHashMap<(u64, [u8; 32]), Vec<NodeId>> = FxHashMap::default();
    let mut processed_partial = 0usize;
    let mut last_emit = Instant::now();

    for chunk in size_candidates.chunks(256) {
        if cancel.load(Ordering::Relaxed) {
            return Err("Duplicate scan cancelled by user".to_string());
        }
        let hashed: Vec<(NodeId, u64, [u8; 32])> = chunk
            .par_iter()
            .filter_map(|&(nid, size)| {
                if cancel.load(Ordering::Relaxed) {
                    return None;
                }
                let path = arena.full_path(nid);
                let digest = hash_partial(&path, size)?;
                Some((nid, size, digest))
            })
            .collect();

        for (nid, size, digest) in hashed {
            partial_map.entry((size, digest)).or_default().push(nid);
        }
        processed_partial += chunk.len();

        if last_emit.elapsed().as_millis() >= 80 || processed_partial == total_partial {
            last_emit = Instant::now();
            progress_cb(DuplicateProgress {
                stage: "partial_hashing".to_string(),
                processed: processed_partial,
                total: total_partial,
                groups_found: partial_map.values().filter(|v| v.len() >= 2).count(),
                wasted_bytes: 0,
            });
        }
    }

    if cancel.load(Ordering::Relaxed) {
        return Err("Duplicate scan cancelled by user".to_string());
    }

    let mut full_candidates: Vec<(NodeId, u64)> = Vec::new();
    for ((size, _), ids) in partial_map {
        if ids.len() >= 2 {
            for id in ids {
                full_candidates.push((id, size));
            }
        }
    }

    if full_candidates.is_empty() {
        progress_cb(DuplicateProgress {
            stage: "complete".to_string(),
            processed: 0,
            total: 0,
            groups_found: 0,
            wasted_bytes: 0,
        });
        return Ok(DuplicateReport {
            groups: Vec::new(),
            total_wasted_bytes: 0,
            total_duplicate_files: 0,
            elapsed_ms: start.elapsed().as_millis() as u64,
        });
    }

    // Stage 3: Parallel full BLAKE3 streaming hash (128 KB buffer)
    let total_full = full_candidates.len();
    let mut full_map: FxHashMap<(u64, String), Vec<NodeId>> = FxHashMap::default();
    let mut processed_full = 0usize;
    last_emit = Instant::now();

    for chunk in full_candidates.chunks(64) {
        if cancel.load(Ordering::Relaxed) {
            return Err("Duplicate scan cancelled by user".to_string());
        }
        let hashed: Vec<(NodeId, u64, String)> = chunk
            .par_iter()
            .filter_map(|&(nid, size)| {
                if cancel.load(Ordering::Relaxed) {
                    return None;
                }
                let path = arena.full_path(nid);
                let hex = hash_full(&path, cancel.as_ref())?;
                Some((nid, size, hex))
            })
            .collect();

        for (nid, size, hex) in hashed {
            full_map.entry((size, hex)).or_default().push(nid);
        }
        processed_full += chunk.len();

        if last_emit.elapsed().as_millis() >= 80 || processed_full == total_full {
            last_emit = Instant::now();
            let mut running_groups = 0usize;
            let mut running_wasted = 0u64;
            for ((size, _), ids) in &full_map {
                if ids.len() >= 2 {
                    running_groups += 1;
                    running_wasted = running_wasted
                        .saturating_add(size.saturating_mul((ids.len() - 1) as u64));
                }
            }
            progress_cb(DuplicateProgress {
                stage: "full_hashing".to_string(),
                processed: processed_full,
                total: total_full,
                groups_found: running_groups,
                wasted_bytes: running_wasted,
            });
        }
    }

    if cancel.load(Ordering::Relaxed) {
        return Err("Duplicate scan cancelled by user".to_string());
    }

    let mut groups: Vec<DuplicateGroup> = Vec::new();
    let mut total_wasted_bytes = 0u64;
    let mut total_duplicate_files = 0usize;

    for ((file_size, hash), ids) in full_map {
        if ids.len() < 2 {
            continue;
        }
        let mut files: Vec<DuplicateFile> = ids
            .into_iter()
            .map(|nid| {
                let node = &arena.nodes[nid as usize];
                let path_buf = arena.full_path(nid);
                let (safety_level, _) = evaluate_path_safety(&path_buf);
                DuplicateFile {
                    node_id: nid,
                    name: arena.node_name(nid).to_string(),
                    full_path: path_buf.to_string_lossy().to_string(),
                    modified_ts: node.modified_ts,
                    safety_level,
                }
            })
            .collect();

        files.sort_unstable_by(|a, b| a.full_path.cmp(&b.full_path));
        let wasted_bytes = file_size.saturating_mul((files.len() - 1) as u64);
        total_wasted_bytes = total_wasted_bytes.saturating_add(wasted_bytes);
        total_duplicate_files += files.len();

        groups.push(DuplicateGroup {
            hash,
            file_size,
            wasted_bytes,
            files,
        });
    }

    groups.sort_unstable_by(|a, b| {
        b.wasted_bytes
            .cmp(&a.wasted_bytes)
            .then_with(|| b.file_size.cmp(&a.file_size))
            .then_with(|| a.hash.cmp(&b.hash))
    });

    progress_cb(DuplicateProgress {
        stage: "complete".to_string(),
        processed: total_full,
        total: total_full,
        groups_found: groups.len(),
        wasted_bytes: total_wasted_bytes,
    });

    Ok(DuplicateReport {
        groups,
        total_wasted_bytes,
        total_duplicate_files,
        elapsed_ms: start.elapsed().as_millis() as u64,
    })
}
