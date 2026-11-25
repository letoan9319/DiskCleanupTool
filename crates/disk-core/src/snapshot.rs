use std::fs::File;
use std::io::{BufReader, BufWriter, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rustc_hash::FxHashMap;
use serde::Serialize;

use crate::analyzer::top_largest_files;
use crate::arena::ScanArena;
use crate::model::{
    DiskSnapshot, GrowthDiffItem, NodeDto, NodeId, SnapshotDiffReport, SnapshotEntry,
};

const SNAPSHOT_VERSION: u32 = 1;

fn now_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn capture_snapshot(arena: &ScanArena, max_depth: usize) -> DiskSnapshot {
    let root = &arena.nodes[0];
    let max_depth = max_depth.min(12);
    let mut entries = Vec::new();

    if max_depth > 0 {
        // Stack holds (node_id, depth, rel_path)
        let mut stack: Vec<(NodeId, usize, String)> = Vec::with_capacity(256);
        for &cid in arena.children_slice(0).iter().rev() {
            let child = &arena.nodes[cid as usize];
            if child.deleted {
                continue;
            }
            let rel = arena.node_name(cid).to_string();
            stack.push((cid, 1, rel));
        }

        while let Some((nid, depth, rel_path)) = stack.pop() {
            let node = &arena.nodes[nid as usize];
            if node.deleted {
                continue;
            }
            // Record all directories up to max_depth, plus direct root-level files (depth == 1)
            if node.is_dir || depth == 1 {
                entries.push(SnapshotEntry {
                    rel_path: rel_path.clone(),
                    logical_size: node.logical_size,
                    file_count: node.file_count,
                });
            }

            if node.is_dir && depth < max_depth {
                for &cid in arena.children_slice(nid).iter().rev() {
                    let child = &arena.nodes[cid as usize];
                    if child.deleted || !child.is_dir {
                        continue;
                    }
                    let mut child_rel =
                        String::with_capacity(rel_path.len() + 1 + arena.node_name(cid).len());
                    child_rel.push_str(&rel_path);
                    child_rel.push('\\');
                    child_rel.push_str(arena.node_name(cid));
                    stack.push((cid, depth + 1, child_rel));
                }
            }
        }
    }

    DiskSnapshot {
        version: SNAPSHOT_VERSION,
        root_path: arena.root_path.to_string_lossy().to_string(),
        created_ts: now_unix_secs(),
        total_logical_size: root.logical_size,
        total_files: root.file_count,
        total_dirs: root.dir_count,
        entries,
    }
}

pub fn save_snapshot_to_file(
    arena: &ScanArena,
    dest_path: &Path,
    max_depth: usize,
) -> Result<usize, String> {
    let snapshot = capture_snapshot(arena, max_depth);
    let count = snapshot.entries.len();
    let file = File::create(dest_path)
        .map_err(|e| format!("Failed to create snapshot file: {}", e))?;
    let mut writer = BufWriter::new(file);
    serde_json::to_writer_pretty(&mut writer, &snapshot)
        .map_err(|e| format!("Failed to serialize snapshot: {}", e))?;
    writer
        .flush()
        .map_err(|e| format!("Failed to flush snapshot file: {}", e))?;
    Ok(count)
}

#[inline]
fn signed_diff(after: u64, before: u64) -> i64 {
    let diff = (after as i128) - (before as i128);
    diff.clamp(i64::MIN as i128, i64::MAX as i128) as i64
}

pub fn compare_snapshot_file(
    snapshot_path: &Path,
    arena: &ScanArena,
) -> Result<SnapshotDiffReport, String> {
    let file = File::open(snapshot_path)
        .map_err(|e| format!("Failed to open snapshot file: {}", e))?;
    let reader = BufReader::new(file);
    let baseline: DiskSnapshot = serde_json::from_reader(reader)
        .map_err(|e| format!("Invalid snapshot file format: {}", e))?;

    let inferred_depth = baseline
        .entries
        .iter()
        .map(|e| e.rel_path.split(['\\', '/']).filter(|s| !s.is_empty()).count())
        .max()
        .unwrap_or(4)
        .clamp(1, 12);

    let current = capture_snapshot(arena, inferred_depth);

    let mut base_map: FxHashMap<String, &SnapshotEntry> = FxHashMap::default();
    base_map.reserve(baseline.entries.len());
    for entry in &baseline.entries {
        let key = entry.rel_path.replace('/', "\\").to_ascii_lowercase();
        base_map.insert(key, entry);
    }

    let mut cur_map: FxHashMap<String, &SnapshotEntry> = FxHashMap::default();
    cur_map.reserve(current.entries.len());
    for entry in &current.entries {
        let key = entry.rel_path.replace('/', "\\").to_ascii_lowercase();
        cur_map.insert(key, entry);
    }

    let mut items: Vec<GrowthDiffItem> = Vec::new();

    for (key, cur_entry) in &cur_map {
        let (before_bytes, before_files, existed_before) = match base_map.get(key) {
            Some(b) => (b.logical_size, b.file_count, true),
            None => (0, 0, false),
        };
        let after_bytes = cur_entry.logical_size;
        let after_files = cur_entry.file_count;
        let delta_bytes = signed_diff(after_bytes, before_bytes);
        let delta_files = signed_diff(after_files, before_files);

        if existed_before && delta_bytes == 0 && delta_files == 0 {
            continue;
        }

        let status = if !existed_before {
            "added"
        } else if delta_bytes > 0 || (delta_bytes == 0 && delta_files > 0) {
            "grew"
        } else {
            "shrunk"
        };

        let full_path = arena
            .root_path
            .join(&cur_entry.rel_path)
            .to_string_lossy()
            .to_string();
        let name = cur_entry
            .rel_path
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or(&cur_entry.rel_path)
            .to_string();

        items.push(GrowthDiffItem {
            path: full_path,
            name,
            before_bytes,
            after_bytes,
            delta_bytes,
            before_files,
            after_files,
            delta_files,
            status: status.to_string(),
        });
    }

    for (key, base_entry) in &base_map {
        if cur_map.contains_key(key) {
            continue;
        }
        let delta_bytes = signed_diff(0, base_entry.logical_size);
        let delta_files = signed_diff(0, base_entry.file_count);
        let full_path = arena
            .root_path
            .join(&base_entry.rel_path)
            .to_string_lossy()
            .to_string();
        let name = base_entry
            .rel_path
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or(&base_entry.rel_path)
            .to_string();

        items.push(GrowthDiffItem {
            path: full_path,
            name,
            before_bytes: base_entry.logical_size,
            after_bytes: 0,
            delta_bytes,
            before_files: base_entry.file_count,
            after_files: 0,
            delta_files,
            status: "removed".to_string(),
        });
    }

    // Biggest positive growth first
    items.sort_unstable_by(|a, b| {
        b.delta_bytes
            .cmp(&a.delta_bytes)
            .then_with(|| b.after_bytes.cmp(&a.after_bytes))
            .then_with(|| a.path.cmp(&b.path))
    });
    if items.len() > 5000 {
        items.truncate(5000);
    }

    let total_before_bytes = baseline.total_logical_size;
    let total_after_bytes = current.total_logical_size;
    let total_delta_bytes = signed_diff(total_after_bytes, total_before_bytes);

    Ok(SnapshotDiffReport {
        baseline_path: baseline.root_path,
        baseline_timestamp: baseline.created_ts,
        current_path: current.root_path,
        total_before_bytes,
        total_after_bytes,
        total_delta_bytes,
        items,
    })
}

fn collect_tree_dtos(arena: &ScanArena, max_rows: usize) -> Vec<NodeDto> {
    let mut rows = Vec::with_capacity(arena.nodes.len().min(max_rows));
    let mut stack = vec![0u32];

    while let Some(nid) = stack.pop() {
        if rows.len() >= max_rows {
            break;
        }
        let node = &arena.nodes[nid as usize];
        if node.deleted {
            continue;
        }
        rows.push(arena.node_to_dto(nid));

        if node.is_dir {
            for &cid in arena.children_slice(nid).iter().rev() {
                stack.push(cid);
            }
        }
    }
    rows
}

fn write_csv_field<W: Write>(w: &mut W, field: &str) -> std::io::Result<()> {
    let needs_quote = field
        .bytes()
        .any(|b| b == b',' || b == b'"' || b == b'\n' || b == b'\r');
    if !needs_quote {
        w.write_all(field.as_bytes())
    } else {
        w.write_all(b"\"")?;
        for ch in field.chars() {
            if ch == '"' {
                w.write_all(b"\"\"")?;
            } else {
                let mut buf = [0u8; 4];
                w.write_all(ch.encode_utf8(&mut buf).as_bytes())?;
            }
        }
        w.write_all(b"\"")
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsonExportEnvelope<'a> {
    version: u32,
    root_path: String,
    scope: &'a str,
    exported_ts: i64,
    total_logical_size: u64,
    item_count: usize,
    items: &'a [NodeDto],
}

pub fn export_report_to_file(
    arena: &ScanArena,
    format: &str,
    scope: &str,
    dest_path: &Path,
) -> Result<usize, String> {
    let fmt = format.trim().to_ascii_lowercase();
    let sc = scope.trim().to_ascii_lowercase();

    let items: Vec<NodeDto> = match sc.as_str() {
        "tree" => collect_tree_dtos(arena, 250_000),
        "top_files" => top_largest_files(arena, 5000, 0, None, None, ""),
        _ => return Err(format!("Unsupported export scope: {}", scope)),
    };

    let file =
        File::create(dest_path).map_err(|e| format!("Failed to create export file: {}", e))?;
    let mut writer = BufWriter::new(file);

    match fmt.as_str() {
        "csv" => {
            // UTF-8 BOM for clean Excel Unicode import
            writer
                .write_all(&[0xEF, 0xBB, 0xBF])
                .map_err(|e| format!("CSV write error: {}", e))?;
            writer
                .write_all(
                    b"Path,Name,Type,LogicalSizeBytes,AllocatedSizeBytes,Files,Folders,ModifiedTimestamp,Extension,Category,PercentOfRoot,SafetyLevel\r\n",
                )
                .map_err(|e| format!("CSV header write error: {}", e))?;

            for item in &items {
                write_csv_field(&mut writer, &item.full_path)
                    .map_err(|e| format!("CSV write error: {}", e))?;
                writer
                    .write_all(b",")
                    .map_err(|e| format!("CSV write error: {}", e))?;
                write_csv_field(&mut writer, &item.name)
                    .map_err(|e| format!("CSV write error: {}", e))?;
                write!(
                    writer,
                    ",{},{},{},{},{},{},",
                    if item.is_dir { "Folder" } else { "File" },
                    item.logical_size,
                    item.allocated_size,
                    item.file_count,
                    item.dir_count,
                    item.modified_ts,
                )
                .map_err(|e| format!("CSV write error: {}", e))?;
                write_csv_field(&mut writer, &item.extension)
                    .map_err(|e| format!("CSV write error: {}", e))?;
                writeln!(
                    writer,
                    ",{},{:.2},{}\r",
                    item.category.as_str(),
                    item.percent_of_root,
                    item.safety_level.as_str(),
                )
                .map_err(|e| format!("CSV write error: {}", e))?;
            }
        }
        "json" => {
            let envelope = JsonExportEnvelope {
                version: 1,
                root_path: arena.root_path.to_string_lossy().to_string(),
                scope: &sc,
                exported_ts: now_unix_secs(),
                total_logical_size: arena.nodes[0].logical_size,
                item_count: items.len(),
                items: &items,
            };
            serde_json::to_writer_pretty(&mut writer, &envelope)
                .map_err(|e| format!("JSON write error: {}", e))?;
        }
        _ => return Err(format!("Unsupported export format: {}", format)),
    }

    writer
        .flush()
        .map_err(|e| format!("Failed to flush export file: {}", e))?;
    Ok(items.len())
}
