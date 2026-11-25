use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use rustc_hash::FxHashMap;
use thiserror::Error;

use crate::arena::ScanArena;
use crate::model::ScanProgress;

#[derive(Debug, Error)]
pub enum MftError {
    #[error("Not a local drive path")]
    NotLocalDrive,
    #[error("Volume is not formatted as NTFS")]
    NotNtfsVolume,
    #[error("Administrator privileges or raw volume access denied: {0}")]
    AccessDenied(String),
    #[error("NTFS MFT read failed: {0}")]
    Io(String),
    #[error("Scan cancelled by user")]
    Cancelled,
}

#[derive(Debug, Clone)]
pub struct RawMftEntry {
    pub frn: u64,
    pub base_frn: u64,
    pub parent_frn: u64,
    pub is_dir: bool,
    pub name: String,
    pub logical_size: u64,
    pub allocated_size: u64,
    pub modified_ts: i64,
    pub data_runs: Vec<(i64, u64)>,
}

#[inline]
fn read_u16_le(b: &[u8], off: usize) -> u16 {
    u16::from_le_bytes([b[off], b[off + 1]])
}

#[inline]
fn read_u32_le(b: &[u8], off: usize) -> u32 {
    u32::from_le_bytes([b[off], b[off + 1], b[off + 2], b[off + 3]])
}

#[inline]
fn read_u64_le(b: &[u8], off: usize) -> u64 {
    u64::from_le_bytes([
        b[off],
        b[off + 1],
        b[off + 2],
        b[off + 3],
        b[off + 4],
        b[off + 5],
        b[off + 6],
        b[off + 7],
    ])
}

#[inline]
fn filetime_to_unix_secs(ft: u64) -> i64 {
    // Windows FILETIME epoch: 1601-01-01; Unix epoch: 1970-01-01 (11644473600 seconds)
    const WINDOWS_TICK: u64 = 10_000_000;
    const SEC_TO_UNIX_EPOCH: u64 = 11_644_473_600;
    let secs = ft / WINDOWS_TICK;
    secs.saturating_sub(SEC_TO_UNIX_EPOCH) as i64
}

/// Decodes NTFS non-resident data runs into `(lcn, cluster_count)` pairs.
pub fn parse_data_runs(runlist: &[u8]) -> Vec<(i64, u64)> {
    let mut runs = Vec::new();
    let mut pos = 0usize;
    let mut current_lcn = 0i64;

    while pos < runlist.len() {
        let header = runlist[pos];
        if header == 0 {
            break;
        }
        pos += 1;

        let len_size = (header & 0x0F) as usize;
        let off_size = ((header >> 4) & 0x0F) as usize;
        if len_size == 0 || pos + len_size + off_size > runlist.len() {
            break;
        }

        let mut cluster_count = 0u64;
        for i in 0..len_size {
            cluster_count |= (runlist[pos + i] as u64) << (i * 8);
        }
        pos += len_size;

        if off_size == 0 {
            // Sparse run
            continue;
        }

        let mut raw_offset = 0i64;
        for i in 0..off_size {
            raw_offset |= (runlist[pos + i] as i64) << (i * 8);
        }
        // Sign-extend if top bit of last byte is set
        if off_size < 8 && (runlist[pos + off_size - 1] & 0x80) != 0 {
            raw_offset |= !0i64 << (off_size * 8);
        }
        pos += off_size;

        current_lcn += raw_offset;
        if current_lcn >= 0 && cluster_count > 0 {
            runs.push((current_lcn, cluster_count));
        }
    }

    runs
}

/// Parses a single NTFS MFT `FILE` record in-place (applying USA fixups directly on `buf` with
/// zero buffer cloning). Handles both base records (`base_frn == 0`) and extension records
/// (`base_frn != 0`) that carry overflow unnamed `$DATA` attributes.
pub fn parse_mft_record_in_place(frn: u64, buf: &mut [u8]) -> Option<RawMftEntry> {
    if buf.len() < 48 || &buf[0..4] != b"FILE" {
        return None;
    }

    let flags = read_u16_le(buf, 0x16);
    const FLAG_IN_USE: u16 = 0x0001;
    const FLAG_DIRECTORY: u16 = 0x0002;
    if (flags & FLAG_IN_USE) == 0 {
        return None;
    }

    let base_record = read_u64_le(buf, 0x20) & 0x0000_FFFF_FFFF_FFFF;

    // Apply Update Sequence Array (USA) fixups in-place on 512-byte sectors
    let usa_offset = read_u16_le(buf, 0x04) as usize;
    let usa_count = read_u16_le(buf, 0x06) as usize;
    if usa_offset >= 42 && usa_count >= 2 && usa_offset + usa_count * 2 <= buf.len() {
        let usn = [buf[usa_offset], buf[usa_offset + 1]];
        for sector_idx in 1..usa_count {
            let sector_end = sector_idx * 512;
            if sector_end > buf.len() {
                break;
            }
            let fix_pos = usa_offset + sector_idx * 2;
            if buf[sector_end - 2] == usn[0] && buf[sector_end - 1] == usn[1] {
                buf[sector_end - 2] = buf[fix_pos];
                buf[sector_end - 1] = buf[fix_pos + 1];
            }
        }
    }

    let is_dir = (flags & FLAG_DIRECTORY) != 0;
    let first_attr_offset = read_u16_le(buf, 0x14) as usize;
    let bytes_in_use = (read_u32_le(buf, 0x18) as usize).min(buf.len());
    if first_attr_offset < 42 || first_attr_offset >= bytes_in_use {
        return None;
    }

    let mut pos = first_attr_offset;
    let mut best_name: Option<(u8, String, u64, i64)> = None; // (priority, name, parent_frn, mtime)
    let mut logical_size = 0u64;
    let mut allocated_size = 0u64;
    let mut found_unnamed_data = false;
    let mut data_runs = Vec::new();

    while pos + 8 <= bytes_in_use {
        let attr_type = read_u32_le(buf, pos);
        if attr_type == 0xFFFF_FFFF {
            break;
        }
        let attr_len = read_u32_le(buf, pos + 4) as usize;
        if attr_len < 16 || pos + attr_len > bytes_in_use {
            break;
        }

        let non_resident = buf[pos + 8];
        let name_len = buf[pos + 9] as usize;

        match attr_type {
            // $FILE_NAME (0x30) - always resident (only needed for base records)
            0x30 if base_record == 0 && non_resident == 0 && pos + 24 <= bytes_in_use => {
                let value_len = read_u32_le(buf, pos + 16) as usize;
                let value_off = read_u16_le(buf, pos + 20) as usize;
                let fn_start = pos + value_off;
                if value_len >= 66 && fn_start + value_len <= pos + attr_len {
                    let parent_frn = read_u64_le(buf, fn_start) & 0x0000_FFFF_FFFF_FFFF;
                    let mtime_raw = read_u64_le(buf, fn_start + 0x10);
                    let mtime = filetime_to_unix_secs(mtime_raw);
                    let fname_len = buf[fn_start + 0x40] as usize;
                    let namespace = buf[fn_start + 0x41];
                    let chars_start = fn_start + 0x42;
                    let chars_bytes = fname_len * 2;
                    if chars_start + chars_bytes <= fn_start + value_len {
                        let utf16: Vec<u16> = (0..fname_len)
                            .map(|i| read_u16_le(buf, chars_start + i * 2))
                            .collect();
                        let name = String::from_utf16_lossy(&utf16);
                        // Namespace priority: 3 (Win32&DOS) = 3, 1 (Win32) = 2, 0 (POSIX) = 1, 2 (DOS 8.3) = 0
                        let prio = match namespace {
                            3 => 3,
                            1 => 2,
                            0 => 1,
                            _ => 0,
                        };
                        let should_replace = best_name
                            .as_ref()
                            .map(|(old_p, _, _, _)| prio > *old_p)
                            .unwrap_or(true);
                        if should_replace {
                            best_name = Some((prio, name, parent_frn, mtime));
                        }
                    }
                }
            }
            // $DATA (0x80), unnamed default stream only
            0x80 if name_len == 0 && !found_unnamed_data => {
                if non_resident == 0 {
                    if pos + 24 <= pos + attr_len {
                        found_unnamed_data = true;
                        let val_len = read_u32_le(buf, pos + 16) as u64;
                        logical_size = logical_size.saturating_add(val_len);
                    }
                } else if pos + 0x38 <= pos + attr_len {
                    let lowest_vcn = read_u64_le(buf, pos + 0x10);
                    if lowest_vcn == 0 {
                        found_unnamed_data = true;
                        let alloc = read_u64_le(buf, pos + 0x28);
                        let real = read_u64_le(buf, pos + 0x30);
                        allocated_size = allocated_size.saturating_add(alloc);
                        logical_size = logical_size.saturating_add(real);
                    }
                    let runs_off = read_u16_le(buf, pos + 0x20) as usize;
                    if runs_off > 0 && pos + runs_off < pos + attr_len {
                        let mut runs = parse_data_runs(&buf[pos + runs_off..pos + attr_len]);
                        data_runs.append(&mut runs);
                    }
                }
            }
            _ => {}
        }

        pos += attr_len;
    }

    if base_record != 0 {
        if logical_size == 0 && allocated_size == 0 && data_runs.is_empty() {
            return None;
        }
        return Some(RawMftEntry {
            frn,
            base_frn: base_record,
            parent_frn: 0,
            is_dir,
            name: String::new(),
            logical_size,
            allocated_size,
            modified_ts: 0,
            data_runs,
        });
    }

    let (_, name, parent_frn, modified_ts) = best_name?;
    Some(RawMftEntry {
        frn,
        base_frn: 0,
        parent_frn,
        is_dir,
        name,
        logical_size: if is_dir { 0 } else { logical_size },
        allocated_size: if is_dir { 0 } else { allocated_size },
        modified_ts,
        data_runs,
    })
}

/// Wrapper around `parse_mft_record_in_place` taking an immutable slice (convenient for tests).
pub fn parse_mft_record(frn: u64, raw_buf: &[u8]) -> Option<RawMftEntry> {
    let mut buf = raw_buf.to_vec();
    parse_mft_record_in_place(frn, &mut buf)
}

/// Accumulates unnamed `$DATA` sizes from extension records (`base_frn != 0`) back onto their
/// corresponding base FRN entries.
pub fn merge_extension_records(
    entries: &mut FxHashMap<u64, RawMftEntry>,
    extensions: &[RawMftEntry],
) {
    for ext in extensions {
        if ext.base_frn == 0 {
            continue;
        }
        if let Some(base) = entries.get_mut(&ext.base_frn) {
            if !base.is_dir {
                base.logical_size = base.logical_size.saturating_add(ext.logical_size);
                base.allocated_size = base.allocated_size.saturating_add(ext.allocated_size);
            }
        }
    }
}

#[cfg(windows)]
pub fn scan_ntfs_mft<F>(
    scan_id: u64,
    root_path: &Path,
    cancel: &Arc<AtomicBool>,
    mut progress_cb: F,
) -> Result<(ScanArena, u64, u64), MftError>
where
    F: FnMut(ScanProgress),
{
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::sync::atomic::Ordering;
    use std::time::Instant;

    use rayon::prelude::*;
    use rustc_hash::FxHashSet;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, GetVolumeInformationW, ReadFile, SetFilePointerEx, FILE_BEGIN,
        FILE_FLAG_SEQUENTIAL_SCAN, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
        OPEN_EXISTING,
    };
    use windows::Win32::System::Ioctl::FSCTL_GET_NTFS_VOLUME_DATA;
    use windows::Win32::System::IO::DeviceIoControl;

    use crate::model::{NodeId, ScanEngineKind};

    #[repr(C)]
    #[derive(Default)]
    struct NtfsVolumeDataBuffer {
        volume_serial_number: i64,
        number_sectors: i64,
        total_clusters: i64,
        free_clusters: i64,
        total_reserved: i64,
        bytes_per_sector: u32,
        bytes_per_cluster: u32,
        bytes_per_file_record_segment: u32,
        clusters_per_file_record_segment: u32,
        mft_valid_data_length: i64,
        mft_start_lcn: i64,
        mft2_start_lcn: i64,
        mft_zone_start: i64,
        mft_zone_end: i64,
    }

    struct HandleGuard(HANDLE);
    impl Drop for HandleGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    let start = Instant::now();
    let root_str = root_path.to_string_lossy();
    let mut normalized_str = root_str.as_ref();
    if let Some(s) = normalized_str.strip_prefix("\\\\?\\") {
        normalized_str = s;
    }
    let bytes = normalized_str.as_bytes();
    if bytes.len() < 2 || bytes[1] != b':' {
        return Err(MftError::NotLocalDrive);
    }
    let drive_letter = (bytes[0] as char).to_ascii_uppercase();
    let drive_root = format!("{}:\\", drive_letter);
    let volume_device = format!("\\\\.\\{}:", drive_letter);

    // 1. Check filesystem is NTFS
    let wide_root: Vec<u16> = OsStr::new(&drive_root)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut fs_name_buf = [0u16; 32];
    let vol_ok = unsafe {
        GetVolumeInformationW(
            PCWSTR(wide_root.as_ptr()),
            None,
            None,
            None,
            None,
            Some(&mut fs_name_buf),
        )
    };
    if vol_ok.is_err() {
        return Err(MftError::NotNtfsVolume);
    }
    let fs_len = fs_name_buf.iter().position(|&c| c == 0).unwrap_or(0);
    let fs_name = String::from_utf16_lossy(&fs_name_buf[..fs_len]);
    if !fs_name.eq_ignore_ascii_case("NTFS") {
        return Err(MftError::NotNtfsVolume);
    }

    // 2. Open volume handle
    let wide_dev: Vec<u16> = OsStr::new(&volume_device)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let handle = unsafe {
        CreateFileW(
            PCWSTR(wide_dev.as_ptr()),
            0x8000_0000, // GENERIC_READ
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_SEQUENTIAL_SCAN,
            None,
        )
    }
    .map_err(|e| MftError::AccessDenied(e.to_string()))?;
    let _guard = HandleGuard(handle);

    // 3. Query NTFS volume data
    let mut vol_data = NtfsVolumeDataBuffer::default();
    let mut bytes_returned = 0u32;
    unsafe {
        DeviceIoControl(
            handle,
            FSCTL_GET_NTFS_VOLUME_DATA,
            None,
            0,
            Some(&mut vol_data as *mut _ as *mut std::ffi::c_void),
            std::mem::size_of::<NtfsVolumeDataBuffer>() as u32,
            Some(&mut bytes_returned),
            None,
        )
    }
    .map_err(|e| MftError::Io(e.to_string()))?;

    let cluster_size = vol_data.bytes_per_cluster as u64;
    let record_size = vol_data.bytes_per_file_record_segment as usize;
    if cluster_size == 0 || record_size < 512 || vol_data.mft_valid_data_length <= 0 {
        return Err(MftError::Io("Invalid NTFS volume geometry".to_string()));
    }

    // 4. Read MFT Record #0 ($MFT itself) to get fragmented data runs
    let mft_start_byte = (vol_data.mft_start_lcn as u64) * cluster_size;
    let mut rec0 = vec![0u8; record_size];
    unsafe {
        SetFilePointerEx(handle, mft_start_byte as i64, None, FILE_BEGIN)
            .map_err(|e| MftError::Io(e.to_string()))?;
        let mut read = 0u32;
        ReadFile(handle, Some(&mut rec0), Some(&mut read), None)
            .map_err(|e| MftError::Io(e.to_string()))?;
    }

    let mut runs = parse_mft_record_in_place(0, &mut rec0)
        .map(|e| e.data_runs)
        .unwrap_or_default();
    if runs.is_empty() {
        let total_clusters = (vol_data.mft_valid_data_length as u64).div_ceil(cluster_size);
        runs.push((vol_data.mft_start_lcn, total_clusters));
    }

    // 5. Stream MFT runs in 4 MB chunks and parse records in parallel with Rayon
    let max_valid_bytes = vol_data.mft_valid_data_length as u64;
    let estimated_records = (max_valid_bytes / record_size as u64) as usize;
    let mut entries: FxHashMap<u64, RawMftEntry> = FxHashMap::default();
    entries.reserve(estimated_records.min(1_000_000));
    let mut children_by_parent: FxHashMap<u64, Vec<u64>> = FxHashMap::default();
    children_by_parent.reserve(estimated_records.min(250_000));
    let mut extension_records: Vec<RawMftEntry> = Vec::new();

    const CHUNK_TARGET: usize = 4 * 1024 * 1024;
    let chunk_size = (CHUNK_TARGET / record_size).max(1) * record_size;
    let mut io_buf = vec![0u8; chunk_size];
    let mut leftover = Vec::<u8>::with_capacity(record_size);

    let mut bytes_processed = 0u64;
    let mut frn_counter = 0u64;
    let mut files_scanned = 0u64;
    let mut dirs_scanned = 0u64;
    let mut bytes_scanned = 0u64;
    let mut last_emit = Instant::now();

    'runs: for (lcn, run_clusters) in runs {
        let mut run_byte_offset = (lcn as u64) * cluster_size;
        let mut run_bytes_left = run_clusters * cluster_size;

        while run_bytes_left > 0 && bytes_processed < max_valid_bytes {
            if cancel.load(Ordering::Relaxed) {
                return Err(MftError::Cancelled);
            }

            let want = (run_bytes_left as usize)
                .min(chunk_size)
                .min((max_valid_bytes - bytes_processed) as usize);
            if want == 0 {
                break 'runs;
            }

            // Align read size to sector boundary (512 bytes)
            let aligned_want = want.div_ceil(512) * 512;
            let read_len = aligned_want.min(io_buf.len());
            let buf_slice = &mut io_buf[..read_len];

            let actual = unsafe {
                SetFilePointerEx(handle, run_byte_offset as i64, None, FILE_BEGIN)
                    .map_err(|e| MftError::Io(e.to_string()))?;
                let mut read = 0u32;
                ReadFile(handle, Some(buf_slice), Some(&mut read), None)
                    .map_err(|e| MftError::Io(e.to_string()))?;
                if read == 0 {
                    break 'runs;
                }
                (read as usize).min(want)
            };

            bytes_processed += actual as u64;
            run_byte_offset += actual as u64;
            run_bytes_left = run_bytes_left.saturating_sub(actual as u64);

            let mut data = &mut buf_slice[..actual];
            if !leftover.is_empty() {
                let need = record_size - leftover.len();
                if data.len() >= need {
                    leftover.extend_from_slice(&data[..need]);
                    if frn_counter == 5 || frn_counter >= 16 {
                        if let Some(parsed) = parse_mft_record_in_place(frn_counter, &mut leftover)
                        {
                            if parsed.base_frn != 0 {
                                extension_records.push(parsed);
                            } else {
                                if parsed.is_dir {
                                    dirs_scanned += 1;
                                } else {
                                    files_scanned += 1;
                                    bytes_scanned =
                                        bytes_scanned.saturating_add(parsed.logical_size);
                                }
                                children_by_parent
                                    .entry(parsed.parent_frn)
                                    .or_default()
                                    .push(parsed.frn);
                                entries.insert(parsed.frn, parsed);
                            }
                        }
                    }
                    frn_counter += 1;
                    leftover.clear();
                    data = &mut data[need..];
                } else {
                    leftover.extend_from_slice(data);
                    continue;
                }
            }

            let full_records = data.len() / record_size;
            let full_bytes = full_records * record_size;
            let base_frn_chunk = frn_counter;

            let parsed_chunk: Vec<RawMftEntry> = data[..full_bytes]
                .par_chunks_mut(record_size)
                .enumerate()
                .filter_map(|(i, rec_slice)| {
                    let frn = base_frn_chunk + i as u64;
                    if frn != 5 && frn < 16 {
                        return None;
                    }
                    parse_mft_record_in_place(frn, rec_slice)
                })
                .collect();

            frn_counter += full_records as u64;

            for parsed in parsed_chunk {
                if parsed.base_frn != 0 {
                    extension_records.push(parsed);
                } else {
                    if parsed.is_dir {
                        dirs_scanned += 1;
                    } else {
                        files_scanned += 1;
                        bytes_scanned = bytes_scanned.saturating_add(parsed.logical_size);
                    }
                    children_by_parent
                        .entry(parsed.parent_frn)
                        .or_default()
                        .push(parsed.frn);
                    entries.insert(parsed.frn, parsed);
                }
            }

            let rem = data.len() - full_bytes;
            if rem > 0 {
                leftover.extend_from_slice(&data[full_bytes..]);
            }

            if last_emit.elapsed().as_millis() >= 80 {
                last_emit = Instant::now();
                progress_cb(ScanProgress {
                    scan_id,
                    engine: ScanEngineKind::NtfsMft,
                    files_scanned,
                    dirs_scanned,
                    bytes_scanned,
                    current_path: format!("Reading $MFT ({} records)...", frn_counter),
                    elapsed_ms: start.elapsed().as_millis() as u64,
                });
            }
        }
    }

    if cancel.load(Ordering::Relaxed) {
        return Err(MftError::Cancelled);
    }

    // Merge unnamed $DATA from extension records back onto their base FRNs
    merge_extension_records(&mut entries, &extension_records);

    // 6. Find starting FRN for root_path (FRN 5 is NTFS volume root)
    let mut start_frn = 5u64;
    let rel = normalized_str[2..].trim_matches('\\');
    if !rel.is_empty() {
        for segment in rel.split('\\').filter(|s| !s.is_empty()) {
            let Some(children) = children_by_parent.get(&start_frn) else {
                return Err(MftError::Io(format!(
                    "Target subfolder not found in MFT: {}",
                    segment
                )));
            };
            let found = children.iter().copied().find(|&cid| {
                entries
                    .get(&cid)
                    .map(|e| e.is_dir && e.name.eq_ignore_ascii_case(segment))
                    .unwrap_or(false)
            });
            match found {
                Some(fid) => start_frn = fid,
                None => {
                    return Err(MftError::Io(format!(
                        "Target subfolder not found in MFT: {}",
                        segment
                    )));
                }
            }
        }
    }

    // 7. Build ScanArena iteratively from start_frn
    let mut arena = ScanArena::with_capacity(root_path.to_path_buf(), entries.len().min(500_000));
    let mut stack: Vec<(u64, NodeId)> = vec![(start_frn, 0)];
    let mut visited_frns: FxHashSet<u64> = FxHashSet::default();
    visited_frns.insert(start_frn);

    while let Some((cur_frn, arena_parent)) = stack.pop() {
        if let Some(child_frns) = children_by_parent.get(&cur_frn) {
            for &cfrn in child_frns {
                if cfrn == cur_frn || !visited_frns.insert(cfrn) {
                    continue;
                }
                if let Some(entry) = entries.get(&cfrn) {
                    // Skip NTFS system metadata files at root like $MFT, $Bitmap, $LogFile
                    if cur_frn == 5
                        && entry.name.starts_with('$')
                        && !entry.name.eq_ignore_ascii_case("$Recycle.Bin")
                    {
                        continue;
                    }
                    let node_id = arena.add_node_str(
                        arena_parent,
                        &entry.name,
                        entry.is_dir,
                        entry.logical_size,
                        entry.allocated_size,
                        entry.modified_ts,
                    );
                    if entry.is_dir {
                        stack.push((cfrn, node_id));
                    }
                }
            }
        }
    }

    arena.finalize_and_sort();
    let elapsed_ms = start.elapsed().as_millis() as u64;

    progress_cb(ScanProgress {
        scan_id,
        engine: ScanEngineKind::NtfsMft,
        files_scanned: arena.nodes[0].file_count,
        dirs_scanned: arena.nodes[0].dir_count,
        bytes_scanned: arena.nodes[0].logical_size,
        current_path: root_path.to_string_lossy().to_string(),
        elapsed_ms,
    });

    Ok((arena, 0, elapsed_ms))
}

#[cfg(not(windows))]
pub fn scan_ntfs_mft<F>(
    _scan_id: u64,
    _root_path: &Path,
    _cancel: &Arc<AtomicBool>,
    _progress_cb: F,
) -> Result<(ScanArena, u64, u64), MftError>
where
    F: FnMut(ScanProgress),
{
    Err(MftError::NotNtfsVolume)
}
