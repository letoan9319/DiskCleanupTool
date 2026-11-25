use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use crate::arena::ScanArena;
use crate::model::ScanProgress;

#[cfg(windows)]
fn volume_cluster_size(path: &Path) -> u64 {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceW;

    let path_str = path.to_string_lossy();
    let trimmed = path_str.strip_prefix("\\\\?\\").unwrap_or(&path_str);
    let root = if trimmed.len() >= 2 && trimmed.as_bytes()[1] == b':' {
        format!("{}\\", &trimmed[..2])
    } else {
        return 4096;
    };

    let wide: Vec<u16> = std::ffi::OsStr::new(&root)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut sectors_per_cluster = 0u32;
    let mut bytes_per_sector = 0u32;
    let mut free_clusters = 0u32;
    let mut total_clusters = 0u32;

    let ok = unsafe {
        GetDiskFreeSpaceW(
            PCWSTR(wide.as_ptr()),
            Some(&mut sectors_per_cluster),
            Some(&mut bytes_per_sector),
            Some(&mut free_clusters),
            Some(&mut total_clusters),
        )
    };

    if ok.is_ok() && sectors_per_cluster > 0 && bytes_per_sector > 0 {
        (sectors_per_cluster as u64) * (bytes_per_sector as u64)
    } else {
        4096
    }
}

#[cfg(not(windows))]
fn volume_cluster_size(_path: &Path) -> u64 {
    4096
}

#[inline]
fn align_to_cluster(size: u64, cluster: u64) -> u64 {
    if size == 0 {
        0
    } else {
        let rem = size % cluster;
        if rem == 0 {
            size
        } else {
            size + (cluster - rem)
        }
    }
}

pub struct WalkResult {
    pub arena: ScanArena,
    pub errors_count: u64,
    pub elapsed_ms: u64,
}

#[cfg(windows)]
mod win32_walker {
    use std::ffi::{c_void, OsStr};
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Component, Path, PathBuf};
    use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
    use std::sync::{mpsc, Arc};
    use std::time::{Duration, Instant};

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        FindClose, FindExInfoBasic, FindExSearchNameMatch, FindFirstFileExW, FindNextFileW,
        FIND_FIRST_EX_LARGE_FETCH, WIN32_FIND_DATAW,
    };

    use super::{align_to_cluster, volume_cluster_size, WalkResult};
    use crate::arena::ScanArena;
    use crate::model::{NodeId, ScanEngineKind, ScanProgress};

    const FILE_ATTR_DIRECTORY: u32 = 0x0010;
    const FILE_ATTR_REPARSE_POINT: u32 = 0x0400;
    // FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS
    const CLOUD_PLACEHOLDER_MASK: u32 = 0x1000 | 0x0004_0000 | 0x0040_0000;

    struct FindHandleGuard(HANDLE);
    impl Drop for FindHandleGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = FindClose(self.0);
            }
        }
    }

    #[inline]
    fn filetime_to_unix_secs(low: u32, high: u32) -> i64 {
        const WINDOWS_TICK: u64 = 10_000_000;
        const SEC_TO_UNIX_EPOCH: u64 = 11_644_473_600;
        let ft = ((high as u64) << 32) | (low as u64);
        let secs = ft / WINDOWS_TICK;
        secs.saturating_sub(SEC_TO_UNIX_EPOCH) as i64
    }

    fn build_extended_wide_prefix(root_path: &Path) -> Vec<u16> {
        // Resolve relative path to absolute so \\?\ prefix is valid
        let abs = if root_path.is_absolute() {
            root_path.to_path_buf()
        } else {
            std::env::current_dir()
                .map(|cwd| cwd.join(root_path))
                .unwrap_or_else(|_| root_path.to_path_buf())
        };

        // Clean `.` and `..` components without resolving symlinks (unlike canonicalize)
        let mut clean = PathBuf::new();
        for comp in abs.components() {
            match comp {
                Component::CurDir => {}
                Component::ParentDir => {
                    clean.pop();
                }
                other => clean.push(other.as_os_str()),
            }
        }

        let raw = clean.to_string_lossy().replace('/', "\\");
        let mut extended = if raw.starts_with("\\\\?\\") {
            raw
        } else if let Some(unc) = raw.strip_prefix("\\\\") {
            format!("\\\\?\\UNC\\{}", unc)
        } else {
            format!("\\\\?\\{}", raw)
        };

        if !extended.ends_with('\\') {
            extended.push('\\');
        }

        OsStr::new(&extended).encode_wide().collect()
    }

    struct RawEntry {
        name: String,
        is_dir: bool,
        logical_size: u64,
        allocated_size: u64,
        modified_ts: i64,
        child_dir_id: u32, // non-zero only for directories
    }

    struct DirBatch {
        dir_id: u32,
        entries: Vec<RawEntry>,
    }

    pub fn scan_parallel_win32<F>(
        scan_id: u64,
        root_path: &Path,
        cancel: &Arc<AtomicBool>,
        mut progress_cb: F,
    ) -> Result<WalkResult, String>
    where
        F: FnMut(ScanProgress),
    {
        let start = Instant::now();
        let cluster_size = volume_cluster_size(root_path);
        let root_wide = build_extended_wide_prefix(root_path);
        let root_display = root_path.to_string_lossy().to_string();

        let (tx, rx) = mpsc::channel::<DirBatch>();
        let files_scanned = AtomicU64::new(0);
        let dirs_scanned = AtomicU64::new(0);
        let bytes_scanned = AtomicU64::new(0);
        let errors_count = AtomicU64::new(0);

        let mut dir_batches: Vec<Option<Vec<RawEntry>>> = Vec::with_capacity(512);
        let mut total_nodes = 1usize;
        let mut last_progress = Instant::now();

        std::thread::scope(|tscope| {
            let files_ref = &files_scanned;
            let dirs_ref = &dirs_scanned;
            let bytes_ref = &bytes_scanned;
            let errors_ref = &errors_count;
            let cancel_ref = cancel.as_ref();

            tscope.spawn(move || {
                struct WorkerCtx<'a> {
                    cluster_size: u64,
                    cancel: &'a AtomicBool,
                    next_dir_id: AtomicU32,
                    files_scanned: &'a AtomicU64,
                    dirs_scanned: &'a AtomicU64,
                    bytes_scanned: &'a AtomicU64,
                    errors_count: &'a AtomicU64,
                    tx: mpsc::Sender<DirBatch>,
                }

                fn run_dir<'s>(
                    scope: &rayon::Scope<'s>,
                    wctx: &'s WorkerCtx<'s>,
                    dir_id: u32,
                    dir_prefix_wide: Vec<u16>,
                ) {
                    if wctx.cancel.load(Ordering::Relaxed) {
                        return;
                    }

                    let mut pattern = Vec::with_capacity(dir_prefix_wide.len() + 2);
                    pattern.extend_from_slice(&dir_prefix_wide);
                    pattern.push(b'*' as u16);
                    pattern.push(0u16);

                    let mut find_data = WIN32_FIND_DATAW::default();
                    let handle = match unsafe {
                        FindFirstFileExW(
                            PCWSTR(pattern.as_ptr()),
                            FindExInfoBasic,
                            &mut find_data as *mut WIN32_FIND_DATAW as *mut c_void,
                            FindExSearchNameMatch,
                            None,
                            FIND_FIRST_EX_LARGE_FETCH,
                        )
                    } {
                        Ok(h) => h,
                        Err(_) => {
                            wctx.errors_count.fetch_add(1, Ordering::Relaxed);
                            return;
                        }
                    };
                    let _guard = FindHandleGuard(handle);

                    let mut entries = Vec::with_capacity(32);
                    let mut subdirs: Vec<(u32, Vec<u16>)> = Vec::new();
                    let mut local_files = 0u64;
                    let mut local_dirs = 0u64;
                    let mut local_bytes = 0u64;

                    loop {
                        if wctx.cancel.load(Ordering::Relaxed) {
                            return;
                        }

                        let name_len = find_data
                            .cFileName
                            .iter()
                            .position(|&c| c == 0)
                            .unwrap_or(find_data.cFileName.len());
                        let name_wide = &find_data.cFileName[..name_len];

                        let is_dot = (name_len == 1 && name_wide[0] == b'.' as u16)
                            || (name_len == 2
                                && name_wide[0] == b'.' as u16
                                && name_wide[1] == b'.' as u16);

                        if !is_dot && name_len > 0 {
                            let attrs = find_data.dwFileAttributes;
                            // Skip reparse points (junctions, symlinks, mount points) to prevent loops & double counting
                            if (attrs & FILE_ATTR_REPARSE_POINT) == 0 {
                                let is_dir = (attrs & FILE_ATTR_DIRECTORY) != 0;
                                let modified_ts = filetime_to_unix_secs(
                                    find_data.ftLastWriteTime.dwLowDateTime,
                                    find_data.ftLastWriteTime.dwHighDateTime,
                                );
                                let name = String::from_utf16_lossy(name_wide);

                                if is_dir {
                                    local_dirs += 1;
                                    let child_dir_id =
                                        wctx.next_dir_id.fetch_add(1, Ordering::Relaxed);
                                    let mut child_wide =
                                        Vec::with_capacity(dir_prefix_wide.len() + name_len + 1);
                                    child_wide.extend_from_slice(&dir_prefix_wide);
                                    child_wide.extend_from_slice(name_wide);
                                    child_wide.push(b'\\' as u16);
                                    subdirs.push((child_dir_id, child_wide));

                                    entries.push(RawEntry {
                                        name,
                                        is_dir: true,
                                        logical_size: 0,
                                        allocated_size: 0,
                                        modified_ts,
                                        child_dir_id,
                                    });
                                } else {
                                    let logical_size = ((find_data.nFileSizeHigh as u64) << 32)
                                        | (find_data.nFileSizeLow as u64);
                                    let allocated_size = if (attrs & CLOUD_PLACEHOLDER_MASK) != 0 {
                                        0
                                    } else {
                                        align_to_cluster(logical_size, wctx.cluster_size)
                                    };
                                    local_files += 1;
                                    local_bytes = local_bytes.saturating_add(logical_size);

                                    entries.push(RawEntry {
                                        name,
                                        is_dir: false,
                                        logical_size,
                                        allocated_size,
                                        modified_ts,
                                        child_dir_id: 0,
                                    });
                                }
                            }
                        }

                        if unsafe { FindNextFileW(handle, &mut find_data) }.is_err() {
                            break;
                        }
                    }

                    if local_files > 0 {
                        wctx.files_scanned.fetch_add(local_files, Ordering::Relaxed);
                    }
                    if local_dirs > 0 {
                        wctx.dirs_scanned.fetch_add(local_dirs, Ordering::Relaxed);
                    }
                    if local_bytes > 0 {
                        wctx.bytes_scanned.fetch_add(local_bytes, Ordering::Relaxed);
                    }

                    if !entries.is_empty() {
                        let _ = wctx.tx.send(DirBatch { dir_id, entries });
                    }

                    for (child_dir_id, child_wide) in subdirs {
                        if wctx.cancel.load(Ordering::Relaxed) {
                            break;
                        }
                        scope.spawn(move |s| {
                            run_dir(s, wctx, child_dir_id, child_wide);
                        });
                    }
                }

                let wctx = WorkerCtx {
                    cluster_size,
                    cancel: cancel_ref,
                    next_dir_id: AtomicU32::new(1),
                    files_scanned: files_ref,
                    dirs_scanned: dirs_ref,
                    bytes_scanned: bytes_ref,
                    errors_count: errors_ref,
                    tx,
                };
                rayon::scope(|rscope| {
                    run_dir(rscope, &wctx, 0, root_wide);
                });
                // wctx (and tx) is dropped here, closing the channel!
            });

            loop {
                match rx.recv_timeout(Duration::from_millis(80)) {
                    Ok(batch) => {
                        let idx = batch.dir_id as usize;
                        if idx >= dir_batches.len() {
                            dir_batches.resize_with(idx + 1, || None);
                        }
                        total_nodes += batch.entries.len();
                        dir_batches[idx] = Some(batch.entries);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }

                if last_progress.elapsed().as_millis() >= 100 {
                    last_progress = Instant::now();
                    progress_cb(ScanProgress {
                        scan_id,
                        engine: ScanEngineKind::ParallelWalker,
                        files_scanned: files_scanned.load(Ordering::Relaxed),
                        dirs_scanned: dirs_scanned.load(Ordering::Relaxed),
                        bytes_scanned: bytes_scanned.load(Ordering::Relaxed),
                        current_path: root_display.clone(),
                        elapsed_ms: start.elapsed().as_millis() as u64,
                    });
                }
            }
        });

        if cancel.load(Ordering::Relaxed) {
            return Err("Scan cancelled by user".to_string());
        }

        // Assemble ScanArena in a single cache-friendly top-down pass (zero HashMap!)
        let mut arena = ScanArena::with_capacity(root_path.to_path_buf(), total_nodes);
        let mut stack: Vec<(u32, NodeId)> = Vec::with_capacity(256);
        stack.push((0, 0));

        while let Some((dir_id, parent_node_id)) = stack.pop() {
            let Some(entries) = dir_batches
                .get_mut(dir_id as usize)
                .and_then(Option::take)
            else {
                continue;
            };
            for entry in entries {
                let nid = arena.add_node_str(
                    parent_node_id,
                    &entry.name,
                    entry.is_dir,
                    entry.logical_size,
                    entry.allocated_size,
                    entry.modified_ts,
                );
                if entry.is_dir {
                    stack.push((entry.child_dir_id, nid));
                }
            }
        }

        arena.finalize_and_sort();
        let elapsed_ms = start.elapsed().as_millis() as u64;

        progress_cb(ScanProgress {
            scan_id,
            engine: ScanEngineKind::ParallelWalker,
            files_scanned: arena.nodes[0].file_count,
            dirs_scanned: arena.nodes[0].dir_count,
            bytes_scanned: arena.nodes[0].logical_size,
            current_path: root_display,
            elapsed_ms,
        });

        Ok(WalkResult {
            arena,
            errors_count: errors_count.load(Ordering::Relaxed),
            elapsed_ms,
        })
    }
}

#[cfg(windows)]
pub fn scan_parallel<F>(
    scan_id: u64,
    root_path: &Path,
    cancel: &Arc<AtomicBool>,
    progress_cb: F,
) -> Result<WalkResult, String>
where
    F: FnMut(ScanProgress),
{
    win32_walker::scan_parallel_win32(scan_id, root_path, cancel, progress_cb)
}

#[cfg(not(windows))]
pub fn scan_parallel<F>(
    scan_id: u64,
    root_path: &Path,
    cancel: &Arc<AtomicBool>,
    mut progress_cb: F,
) -> Result<WalkResult, String>
where
    F: FnMut(ScanProgress),
{
    use std::sync::atomic::Ordering;
    use std::time::{Instant, UNIX_EPOCH};

    use jwalk::WalkDirGeneric;
    use rustc_hash::FxHashMap;

    use crate::model::{NodeId, ScanEngineKind};

    let start = Instant::now();
    let cluster_size = volume_cluster_size(root_path);
    let mut arena = ScanArena::new(root_path.to_path_buf());
    let mut dir_map: FxHashMap<std::path::PathBuf, NodeId> = FxHashMap::default();
    dir_map.insert(root_path.to_path_buf(), 0);

    let mut files_scanned = 0u64;
    let mut dirs_scanned = 0u64;
    let mut bytes_scanned = 0u64;
    let mut errors_count = 0u64;
    let mut last_emit = Instant::now();

    let walker = WalkDirGeneric::<((), ())>::new(root_path)
        .skip_hidden(false)
        .follow_links(false)
        .process_read_dir(|_depth, _path, _read_dir_state, children| {
            children.retain(|res| match res {
                Ok(entry) => !entry.file_type().is_symlink(),
                Err(_) => true,
            });
        });

    for entry_res in walker {
        if cancel.load(Ordering::Relaxed) {
            return Err("Scan cancelled by user".to_string());
        }

        let entry = match entry_res {
            Ok(e) => e,
            Err(_) => {
                errors_count += 1;
                continue;
            }
        };

        if entry.depth == 0 {
            continue;
        }

        let path = entry.path();
        let Some(parent_path) = path.parent() else {
            continue;
        };
        let parent_id = match dir_map.get(parent_path) {
            Some(&id) => id,
            None => {
                errors_count += 1;
                continue;
            }
        };

        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().is_dir();

        let (logical_size, allocated_size, modified_ts) = if is_dir {
            dirs_scanned += 1;
            let ts = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            (0, 0, ts)
        } else {
            files_scanned += 1;
            match entry.metadata() {
                Ok(meta) => {
                    let size = meta.len();
                    let ts = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);
                    let alloc = align_to_cluster(size, cluster_size);
                    bytes_scanned = bytes_scanned.saturating_add(size);
                    (size, alloc, ts)
                }
                Err(_) => {
                    errors_count += 1;
                    (0, 0, 0)
                }
            }
        };

        let node_id = arena.add_node(
            parent_id,
            name,
            is_dir,
            logical_size,
            allocated_size,
            modified_ts,
        );

        if is_dir {
            dir_map.insert(path, node_id);
        }

        if last_emit.elapsed().as_millis() >= 100 {
            last_emit = Instant::now();
            progress_cb(ScanProgress {
                scan_id,
                engine: ScanEngineKind::ParallelWalker,
                files_scanned,
                dirs_scanned,
                bytes_scanned,
                current_path: entry.path().to_string_lossy().to_string(),
                elapsed_ms: start.elapsed().as_millis() as u64,
            });
        }
    }

    if cancel.load(Ordering::Relaxed) {
        return Err("Scan cancelled by user".to_string());
    }

    arena.finalize_and_sort();

    progress_cb(ScanProgress {
        scan_id,
        engine: ScanEngineKind::ParallelWalker,
        files_scanned,
        dirs_scanned,
        bytes_scanned,
        current_path: root_path.to_string_lossy().to_string(),
        elapsed_ms: start.elapsed().as_millis() as u64,
    });

    Ok(WalkResult {
        arena,
        errors_count,
        elapsed_ms: start.elapsed().as_millis() as u64,
    })
}
