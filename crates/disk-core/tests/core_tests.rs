use std::cmp::Ordering;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use rustc_hash::FxHashMap;

use disk_core::analyzer::{
    category_breakdown, detect_junk_targets, find_empty_folders, top_largest_files,
    treemap_children,
};
use disk_core::arena::{cmp_ascii_ci, contains_ascii_ci, ScanArena};
use disk_core::deleter::{execute_delete, preview_delete};
use disk_core::duplicates::find_duplicates;
use disk_core::model::{FileCategory, SafetyLevel, ScanEngineKind, SortDir, SortField};
use disk_core::safety::evaluate_path_safety;
use disk_core::scanner::ntfs_mft::{
    merge_extension_records, parse_data_runs, parse_mft_record, parse_mft_record_in_place,
};
use disk_core::scanner::scan_path;
use disk_core::search::search_arena;
use disk_core::snapshot::{
    capture_snapshot, compare_snapshot_file, export_report_to_file, save_snapshot_to_file,
};

fn make_temp_dir(name: &str) -> PathBuf {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("diskcleanup_test_{}_{}", name, ts));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write_sized_file(path: &Path, size: usize) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    let mut f = File::create(path).unwrap();
    if size > 0 {
        let buf = vec![0x41u8; size];
        f.write_all(&buf).unwrap();
    }
}

fn write_bytes_file(path: &Path, bytes: &[u8]) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    let mut f = File::create(path).unwrap();
    f.write_all(bytes).unwrap();
}

#[test]
fn arena_sort_desc_default() {
    let mut arena = ScanArena::new(PathBuf::from("D:\\TestRoot"));
    let dir_small = arena.add_node(0, "small_dir".into(), true, 0, 0, 100);
    let dir_big = arena.add_node(0, "big_dir".into(), true, 0, 0, 200);
    arena.add_node(0, "medium.bin".into(), false, 5_000, 8_192, 150);

    arena.add_node(dir_small, "a.txt".into(), false, 100, 4_096, 100);
    arena.add_node(dir_big, "huge.mp4".into(), false, 50_000, 53_248, 200);
    arena.add_node(dir_big, "tiny.log".into(), false, 50, 4_096, 180);

    arena.finalize_and_sort();

    let root_page = arena.get_children(0, 0, 100, SortField::Size, SortDir::Desc, "");
    assert_eq!(root_page.items.len(), 3);
    assert_eq!(root_page.items[0].name, "big_dir");
    assert_eq!(root_page.items[0].logical_size, 50_050);
    assert_eq!(root_page.items[1].name, "medium.bin");
    assert_eq!(root_page.items[1].logical_size, 5_000);
    assert_eq!(root_page.items[2].name, "small_dir");
    assert_eq!(root_page.items[2].logical_size, 100);

    let big_page = arena.get_children(dir_big, 0, 100, SortField::Size, SortDir::Desc, "");
    assert_eq!(big_page.items[0].name, "huge.mp4");
    assert_eq!(big_page.items[1].name, "tiny.log");
}

#[test]
fn arena_incremental_delete_updates_ancestors_and_resorts() {
    let mut arena = ScanArena::new(PathBuf::from("D:\\TestRoot"));
    let d1 = arena.add_node(0, "folder_a".into(), true, 0, 0, 100);
    let d2 = arena.add_node(0, "folder_b".into(), true, 0, 0, 100);

    let f_big = arena.add_node(d1, "huge.iso".into(), false, 10_000, 12_288, 100);
    arena.add_node(d1, "keep.txt".into(), false, 200, 4_096, 100);
    arena.add_node(d2, "b.zip".into(), false, 3_000, 4_096, 100);

    arena.finalize_and_sort();
    // Before delete: folder_a (10,200) > folder_b (3,000)
    assert_eq!(arena.children_slice(0), &[d1, d2]);
    assert_eq!(arena.nodes[0].logical_size, 13_200);

    let (freed_l, freed_a) = arena.mark_deleted_and_recalculate(f_big);
    assert_eq!(freed_l, 10_000);
    assert_eq!(freed_a, 12_288);
    assert_eq!(arena.nodes[d1 as usize].logical_size, 200);
    assert_eq!(arena.nodes[0].logical_size, 3_200);
    assert_eq!(arena.nodes[0].file_count, 2);
    // After delete: folder_b (3,000) > folder_a (200)
    assert_eq!(arena.children_slice(0), &[d2, d1]);
}

#[test]
fn walker_scans_temp_tree_and_skips_reparse_loops() {
    let root = make_temp_dir("walker");
    write_sized_file(&root.join("big.mkv"), 60_000);
    write_sized_file(&root.join("sub").join("mid.zip"), 12_000);
    write_sized_file(&root.join("sub").join("small.txt"), 500);

    // On Windows, create a directory junction pointing back to `root` to verify loop protection
    #[cfg(windows)]
    {
        let junction_path = root.join("sub").join("loop_junction");
        let _ = std::process::Command::new("cmd")
            .args([
                "/C",
                "mklink",
                "/J",
                &junction_path.to_string_lossy(),
                &root.to_string_lossy(),
            ])
            .output();
    }

    let cancel = Arc::new(AtomicBool::new(false));
    let (arena, summary) = scan_path(
        1,
        &root,
        ScanEngineKind::ParallelWalker,
        cancel,
        |_| {},
    )
    .unwrap();

    assert_eq!(summary.engine_used, ScanEngineKind::ParallelWalker);
    assert_eq!(summary.total_files, 3);
    assert_eq!(summary.total_logical_size, 72_500);

    let children = arena.get_children(0, 0, 50, SortField::Size, SortDir::Desc, "");
    assert_eq!(children.items[0].name, "big.mkv");
    assert_eq!(children.items[1].name, "sub");
    assert_eq!(children.items[1].logical_size, 12_500);

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn analyzer_top_files_categories_and_junk_detection() {
    let root = make_temp_dir("analyzer");
    write_sized_file(&root.join("movie.mp4"), 100_000);
    write_sized_file(&root.join("proj").join("package.json"), 128);
    write_sized_file(
        &root
            .join("proj")
            .join("node_modules")
            .join("pkg")
            .join("index.js"),
        40_000,
    );
    write_sized_file(&root.join("rustproj").join("Cargo.toml"), 64);
    write_sized_file(
        &root
            .join("rustproj")
            .join("target")
            .join("debug")
            .join("app.exe"),
        25_000,
    );

    let cancel = Arc::new(AtomicBool::new(false));
    let (arena, _) = scan_path(2, &root, ScanEngineKind::ParallelWalker, cancel, |_| {}).unwrap();

    let top = top_largest_files(&arena, 10, 0, None, None, "");
    assert_eq!(top[0].name, "movie.mp4");
    assert_eq!(top[0].category, FileCategory::Video);
    assert_eq!(top[1].name, "index.js");

    let cats = category_breakdown(&arena);
    assert_eq!(cats[0].category, FileCategory::Video);
    assert_eq!(cats[0].logical_size, 100_000);

    let junk = detect_junk_targets(&arena);
    let keys: Vec<&str> = junk.iter().map(|g| g.group_key.as_str()).collect();
    assert!(keys.contains(&"dev_node_modules"));
    assert!(keys.contains(&"dev_rust_target"));

    let tm = treemap_children(&arena, 0, 10);
    assert_eq!(tm[0].name, "movie.mp4");

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn safety_guard_blocks_critical_windows_paths() {
    assert_eq!(
        evaluate_path_safety(Path::new("C:\\")).0,
        SafetyLevel::Blocked
    );
    assert_eq!(
        evaluate_path_safety(Path::new("D:\\")).0,
        SafetyLevel::Blocked
    );
    assert_eq!(
        evaluate_path_safety(Path::new("C:\\Windows")).0,
        SafetyLevel::Blocked
    );
    assert_eq!(
        evaluate_path_safety(Path::new("C:\\Windows\\System32")).0,
        SafetyLevel::Blocked
    );
    assert_eq!(
        evaluate_path_safety(Path::new("C:\\Windows\\System32\\kernel32.dll")).0,
        SafetyLevel::Blocked
    );
    assert_eq!(
        evaluate_path_safety(Path::new("C:\\Program Files")).0,
        SafetyLevel::Blocked
    );
    assert_eq!(
        evaluate_path_safety(Path::new("C:\\pagefile.sys")).0,
        SafetyLevel::Blocked
    );
    assert_eq!(
        evaluate_path_safety(Path::new("C:\\Program Files\\MyApp\\cache.bin")).0,
        SafetyLevel::Warning
    );
    assert_eq!(
        evaluate_path_safety(Path::new("D:\\Projects\\temp_video.mp4")).0,
        SafetyLevel::Safe
    );
}

#[test]
fn deleter_permanent_and_blocked_enforcement() {
    let root = make_temp_dir("deleter");
    let f1 = root.join("delete_me.bin");
    let f2 = root.join("keep_me.bin");
    write_sized_file(&f1, 20_000);
    write_sized_file(&f2, 5_000);

    let cancel = Arc::new(AtomicBool::new(false));
    let (mut arena, _) =
        scan_path(3, &root, ScanEngineKind::ParallelWalker, cancel, |_| {}).unwrap();
    let children = arena.get_children(0, 0, 10, SortField::Size, SortDir::Desc, "");
    let id1 = children.items[0].id;
    assert_eq!(children.items[0].name, "delete_me.bin");

    let preview = preview_delete(&arena, &[id1]);
    assert_eq!(preview.safe_count, 1);
    assert_eq!(preview.blocked_count, 0);
    assert_eq!(preview.total_reclaimable_bytes, 20_000);

    let report = execute_delete(&mut arena, &[id1], true);
    assert_eq!(report.succeeded_ids, vec![id1]);
    assert_eq!(report.freed_bytes, 20_000);
    assert_eq!(report.updated_root_size, 5_000);
    assert!(!f1.exists());
    assert!(f2.exists());

    // Ensure blocked path cannot be deleted even if injected directly into arena
    let mut blocked_arena = ScanArena::new(PathBuf::from("C:\\"));
    let win_id = blocked_arena.add_node(0, "Windows".into(), true, 1000, 1000, 0);
    blocked_arena.finalize_and_sort();
    let blocked_report = execute_delete(&mut blocked_arena, &[win_id], true);
    assert!(blocked_report.succeeded_ids.is_empty());
    assert_eq!(blocked_report.failed.len(), 1);

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn ntfs_mft_binary_record_and_data_runs_parser() {
    // 1. Test data runs decoder: 2 runs
    // Run 1: 0x31 -> len_bytes=1 (clusters=0x10=16), off_bytes=3 (offset=0x0C0000 = 786432)
    // Run 2: 0x11 -> len_bytes=1 (clusters=0x04=4), off_bytes=1 (rel=-2 = 0xFE -> 786430)
    let runlist = [0x31u8, 0x10, 0x00, 0x00, 0x0C, 0x11, 0x04, 0xFE, 0x00];
    let runs = parse_data_runs(&runlist);
    assert_eq!(runs, vec![(0x0C0000, 16), (0x0C0000 - 2, 4)]);

    // 2. Construct synthetic 1024-byte NTFS MFT record with USA fixup, $FILE_NAME (0x30), and non-resident $DATA (0x80)
    let mut rec = vec![0u8; 1024];
    rec[0..4].copy_from_slice(b"FILE");
    // USA offset = 0x30 (48), USA count = 3 (1 USN + 2 sector fixups)
    rec[0x04..0x06].copy_from_slice(&48u16.to_le_bytes());
    rec[0x06..0x08].copy_from_slice(&3u16.to_le_bytes());
    // First attr offset = 0x38 (56)
    rec[0x14..0x16].copy_from_slice(&56u16.to_le_bytes());
    // Flags: IN_USE (1)
    rec[0x16..0x18].copy_from_slice(&1u16.to_le_bytes());
    // Bytes in use = 400
    rec[0x18..0x1C].copy_from_slice(&400u32.to_le_bytes());

    // Write USA USN = [0xAB, 0xCD] and original end-of-sector bytes [0x11, 0x22], [0x33, 0x44]
    rec[48] = 0xAB;
    rec[49] = 0xCD;
    rec[50] = 0x11;
    rec[51] = 0x22;
    rec[52] = 0x33;
    rec[53] = 0x44;
    rec[510] = 0xAB;
    rec[511] = 0xCD;
    rec[1022] = 0xAB;
    rec[1023] = 0xCD;

    // Attribute 1: $FILE_NAME (0x30) at offset 56, length = 112
    let a1 = 56usize;
    rec[a1..a1 + 4].copy_from_slice(&0x30u32.to_le_bytes());
    rec[a1 + 8] = 0; // resident
    let name_utf16: Vec<u16> = "video.mp4".encode_utf16().collect();
    rec[a1 + 4..a1 + 8].copy_from_slice(&112u32.to_le_bytes());
    rec[a1 + 16..a1 + 20].copy_from_slice(&84u32.to_le_bytes());
    rec[a1 + 20..a1 + 22].copy_from_slice(&24u16.to_le_bytes());

    let fn_off = a1 + 24;
    rec[fn_off..fn_off + 8].copy_from_slice(&5u64.to_le_bytes());
    let ft: u64 = (1_735_689_600 + 11_644_473_600) * 10_000_000;
    rec[fn_off + 0x10..fn_off + 0x18].copy_from_slice(&ft.to_le_bytes());
    rec[fn_off + 0x40] = name_utf16.len() as u8;
    rec[fn_off + 0x41] = 1; // Win32 namespace
    for (i, ch) in name_utf16.iter().enumerate() {
        rec[fn_off + 0x42 + i * 2..fn_off + 0x44 + i * 2].copy_from_slice(&ch.to_le_bytes());
    }

    // Attribute 2: non-resident $DATA (0x80) at offset 168, length = 72
    let a2 = a1 + 112;
    rec[a2..a2 + 4].copy_from_slice(&0x80u32.to_le_bytes());
    rec[a2 + 4..a2 + 8].copy_from_slice(&72u32.to_le_bytes());
    rec[a2 + 8] = 1; // non-resident
    rec[a2 + 9] = 0; // unnamed
    rec[a2 + 0x20..a2 + 0x22].copy_from_slice(&0x40u16.to_le_bytes());
    rec[a2 + 0x28..a2 + 0x30].copy_from_slice(&1_048_576u64.to_le_bytes());
    rec[a2 + 0x30..a2 + 0x38].copy_from_slice(&900_000u64.to_le_bytes());
    rec[a2 + 0x40..a2 + 0x45].copy_from_slice(&[0x11, 0x05, 0x20, 0x00, 0x00]);

    // End marker
    let a3 = a2 + 72;
    rec[a3..a3 + 4].copy_from_slice(&0xFFFF_FFFFu32.to_le_bytes());

    let parsed = parse_mft_record(42, &rec).expect("MFT record should parse");
    assert_eq!(parsed.frn, 42);
    assert_eq!(parsed.base_frn, 0);
    assert_eq!(parsed.parent_frn, 5);
    assert!(!parsed.is_dir);
    assert_eq!(parsed.name, "video.mp4");
    assert_eq!(parsed.logical_size, 900_000);
    assert_eq!(parsed.allocated_size, 1_048_576);
    assert_eq!(parsed.modified_ts, 1_735_689_600);
    assert_eq!(parsed.data_runs, vec![(32, 5)]);
}

// =========================================================================
// v0.2.0 New Tests
// =========================================================================

#[test]
fn arena_v2_sort_folders_expanded_tree_rename_and_runtime_folder() {
    assert_eq!(cmp_ascii_ci("Alpha", "alpha"), Ordering::Equal);
    assert_eq!(cmp_ascii_ci("abc", "ABD"), Ordering::Less);
    assert!(contains_ascii_ci("My_Super_Video.MP4", "super_video"));
    assert!(!contains_ascii_ci("tiny.txt", "verylongneedle"));

    let mut arena = ScanArena::new(PathBuf::from("D:\\Workspace"));
    let d_many = arena.add_node(0, "many_dirs".into(), true, 0, 0, 100);
    let d_sub1 = arena.add_node(d_many, "sub1".into(), true, 0, 0, 100);
    let d_sub2 = arena.add_node(d_many, "sub2".into(), true, 0, 0, 100);
    arena.add_node(d_sub1, "f1.txt".into(), false, 100, 4096, 100);
    arena.add_node(d_sub2, "f2.mp4".into(), false, 500, 4096, 100);

    let d_few = arena.add_node(0, "few_dirs".into(), true, 0, 0, 100);
    let f_big = arena.add_node(d_few, "giant.iso".into(), false, 50_000, 53_248, 200);

    arena.finalize_and_sort();

    // Sort by Folders Desc: many_dirs (dir_count=2) > few_dirs (dir_count=0)
    let by_folders = arena.get_children(0, 0, 10, SortField::Folders, SortDir::Desc, "");
    assert_eq!(by_folders.items[0].name, "many_dirs");
    assert_eq!(by_folders.items[0].dir_count, 2);
    assert_eq!(by_folders.items[1].name, "few_dirs");
    assert_eq!(by_folders.items[1].dir_count, 0);

    // Inverted extension index lookup
    let mp4_id = arena.ext_id_of(".MP4").expect("mp4 ext should exist");
    assert_eq!(arena.ext_buckets[mp4_id as usize].len(), 1);
    assert!(arena.ext_id_of("nonexistent").is_none());

    // Expanded tree: depth 0 only (collapsed) vs depth 1 vs depth 2
    let collapsed = arena.get_expanded_tree(0, 0, SortField::Size, SortDir::Desc, 100);
    assert_eq!(collapsed.len(), 2);
    assert!(!collapsed[0].has_expanded_children);

    let lv1 = arena.get_expanded_tree(0, 1, SortField::Size, SortDir::Desc, 100);
    assert_eq!(lv1[0].node.name, "few_dirs");
    assert_eq!(lv1[0].depth, 0);
    assert!(lv1[0].has_expanded_children);
    assert_eq!(lv1[1].node.name, "giant.iso");
    assert_eq!(lv1[1].depth, 1);

    let lv2 = arena.get_expanded_tree(0, 2, SortField::Size, SortDir::Desc, 100);
    assert!(lv2.iter().any(|e| e.depth == 2 && e.node.name == "f2.mp4"));

    // Rename node updates name, extension, category, and ext_buckets
    let renamed = arena
        .rename_node(f_big, "renamed_movie.mkv")
        .expect("rename should succeed");
    assert_eq!(renamed.name, "renamed_movie.mkv");
    assert_eq!(renamed.extension, "mkv");
    assert_eq!(renamed.category, FileCategory::Video);
    assert_eq!(arena.node_name(f_big), "renamed_movie.mkv");

    // Add runtime folder updates parent children and ancestor dir_counts
    let prev_root_dirs = arena.nodes[0].dir_count;
    let new_dir = arena
        .add_runtime_folder(d_few, "NewRuntimeFolder")
        .expect("runtime folder should be added");
    assert!(new_dir.is_dir);
    assert_eq!(new_dir.name, "NewRuntimeFolder");
    assert_eq!(arena.nodes[d_few as usize].dir_count, 1);
    assert_eq!(arena.nodes[0].dir_count, prev_root_dirs + 1);
    assert!(arena.children_slice(d_few).contains(&new_dir.id));
}

#[test]
fn walker_handles_unicode_and_nested_junction_guard() {
    let root = make_temp_dir("walker_unicode");
    let vn_dir = root.join("Tài liệu Tiếng Việt").join("日本語フォルダ");
    write_sized_file(&vn_dir.join("báo_cáo_2026.pdf"), 8_192);
    write_sized_file(&vn_dir.join("動画_테스트.mp4"), 32_768);
    write_sized_file(&root.join("empty_sub").join("nested_empty").join("placeholder.txt"), 0);

    #[cfg(windows)]
    {
        let junction_path = vn_dir.join("self_loop");
        let _ = std::process::Command::new("cmd")
            .args([
                "/C",
                "mklink",
                "/J",
                &junction_path.to_string_lossy(),
                &root.to_string_lossy(),
            ])
            .output();
    }

    let cancel = Arc::new(AtomicBool::new(false));
    let (arena, summary) =
        scan_path(10, &root, ScanEngineKind::ParallelWalker, cancel, |_| {}).unwrap();

    assert_eq!(summary.total_files, 3);
    assert_eq!(summary.total_logical_size, 40_960);

    let top = top_largest_files(&arena, 10, 0, Some("mp4"), None, "");
    assert_eq!(top.len(), 1);
    assert_eq!(top[0].name, "動画_테스트.mp4");

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn ntfs_mft_extension_record_merge_in_place() {
    // Base record FRN 100 with $FILE_NAME but NO $DATA (spilled to extension record)
    let mut base_rec = vec![0u8; 1024];
    base_rec[0..4].copy_from_slice(b"FILE");
    base_rec[0x04..0x06].copy_from_slice(&48u16.to_le_bytes());
    base_rec[0x06..0x08].copy_from_slice(&3u16.to_le_bytes());
    base_rec[0x14..0x16].copy_from_slice(&56u16.to_le_bytes());
    base_rec[0x16..0x18].copy_from_slice(&1u16.to_le_bytes()); // IN_USE
    base_rec[0x18..0x1C].copy_from_slice(&256u32.to_le_bytes());
    base_rec[48..50].copy_from_slice(&[0x55, 0xAA]);
    base_rec[510..512].copy_from_slice(&[0x55, 0xAA]);
    base_rec[1022..1024].copy_from_slice(&[0x55, 0xAA]);

    let a1 = 56usize;
    let name_utf16: Vec<u16> = "fragmented.vhdx".encode_utf16().collect();
    base_rec[a1..a1 + 4].copy_from_slice(&0x30u32.to_le_bytes());
    base_rec[a1 + 4..a1 + 8].copy_from_slice(&128u32.to_le_bytes());
    base_rec[a1 + 8] = 0;
    base_rec[a1 + 16..a1 + 20].copy_from_slice(&(66 + name_utf16.len() as u32 * 2).to_le_bytes());
    base_rec[a1 + 20..a1 + 22].copy_from_slice(&24u16.to_le_bytes());
    let fn_off = a1 + 24;
    base_rec[fn_off..fn_off + 8].copy_from_slice(&5u64.to_le_bytes());
    base_rec[fn_off + 0x40] = name_utf16.len() as u8;
    base_rec[fn_off + 0x41] = 1;
    for (i, ch) in name_utf16.iter().enumerate() {
        base_rec[fn_off + 0x42 + i * 2..fn_off + 0x44 + i * 2].copy_from_slice(&ch.to_le_bytes());
    }
    base_rec[a1 + 128..a1 + 132].copy_from_slice(&0xFFFF_FFFFu32.to_le_bytes());

    // Extension record FRN 101 referencing base FRN 100 at offset 0x20, carrying non-resident $DATA
    let mut ext_rec = vec![0u8; 1024];
    ext_rec[0..4].copy_from_slice(b"FILE");
    ext_rec[0x04..0x06].copy_from_slice(&48u16.to_le_bytes());
    ext_rec[0x06..0x08].copy_from_slice(&3u16.to_le_bytes());
    ext_rec[0x14..0x16].copy_from_slice(&56u16.to_le_bytes());
    ext_rec[0x16..0x18].copy_from_slice(&1u16.to_le_bytes()); // IN_USE
    ext_rec[0x18..0x1C].copy_from_slice(&200u32.to_le_bytes());
    // base_record = 100 (low 48 bits) | seq_num=1 in upper 16 bits
    let base_ref: u64 = 100 | (1u64 << 48);
    ext_rec[0x20..0x28].copy_from_slice(&base_ref.to_le_bytes());

    let ea = 56usize;
    ext_rec[ea..ea + 4].copy_from_slice(&0x80u32.to_le_bytes());
    ext_rec[ea + 4..ea + 8].copy_from_slice(&72u32.to_le_bytes());
    ext_rec[ea + 8] = 1; // non-resident
    ext_rec[ea + 9] = 0; // unnamed
    ext_rec[ea + 0x20..ea + 0x22].copy_from_slice(&0x40u16.to_le_bytes());
    ext_rec[ea + 0x28..ea + 0x30].copy_from_slice(&8_589_934_592u64.to_le_bytes()); // 8 GiB alloc
    ext_rec[ea + 0x30..ea + 0x38].copy_from_slice(&7_000_000_000u64.to_le_bytes()); // 7 GB logical
    ext_rec[ea + 72..ea + 76].copy_from_slice(&0xFFFF_FFFFu32.to_le_bytes());

    let base_entry = parse_mft_record_in_place(100, &mut base_rec).expect("base parses");
    assert_eq!(base_entry.logical_size, 0);
    let ext_entry = parse_mft_record_in_place(101, &mut ext_rec).expect("ext parses");
    assert_eq!(ext_entry.base_frn, 100);
    assert_eq!(ext_entry.logical_size, 7_000_000_000);

    let mut entries = FxHashMap::default();
    entries.insert(base_entry.frn, base_entry);
    merge_extension_records(&mut entries, &[ext_entry]);

    let merged = entries.get(&100).unwrap();
    assert_eq!(merged.logical_size, 7_000_000_000);
    assert_eq!(merged.allocated_size, 8_589_934_592);
}

#[test]
fn global_search_supports_all_query_tokens() {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let two_years_ago = now - 730 * 86_400;
    let two_days_ago = now - 2 * 86_400;

    let mut arena = ScanArena::new(PathBuf::from("D:\\Media"));
    let d_vid = arena.add_node(0, "Movies".into(), true, 0, 0, two_days_ago);
    arena.add_node(
        d_vid,
        "Action_Film.mp4".into(),
        false,
        1_500_000_000,
        1_500_000_000,
        two_days_ago,
    );
    arena.add_node(
        d_vid,
        "Classic_Movie.mkv".into(),
        false,
        600_000_000,
        600_000_000,
        two_years_ago,
    );
    arena.add_node(
        0,
        "backup_archive.zip".into(),
        false,
        200_000_000,
        200_000_000,
        two_years_ago,
    );
    arena.add_node(0, "notes_small.txt".into(), false, 4_096, 4_096, two_days_ago);
    arena.finalize_and_sort();

    // Multi-wildcard (also exercises ext_buckets fast path)
    let r_vid = search_arena(&arena, "*.mp4;*.mkv", 50, SortField::Size, SortDir::Desc);
    assert_eq!(r_vid.total_matches, 2);
    assert_eq!(r_vid.items[0].name, "Action_Film.mp4");
    assert_eq!(r_vid.items[1].name, "Classic_Movie.mkv");

    // Size >500MB + is:file
    let r_big = search_arena(&arena, ">500MB is:file", 50, SortField::Size, SortDir::Desc);
    assert_eq!(r_big.total_matches, 2);

    // Size range 100MB..1GB
    let r_range = search_arena(
        &arena,
        "100MB..1GB is:file",
        50,
        SortField::Size,
        SortDir::Desc,
    );
    assert_eq!(r_range.total_matches, 2);
    assert_eq!(r_range.items[0].name, "Classic_Movie.mkv");
    assert_eq!(r_range.items[1].name, "backup_archive.zip");

    // Size <10KB
    let r_tiny = search_arena(&arena, "<10KB is:file", 50, SortField::Size, SortDir::Desc);
    assert_eq!(r_tiny.total_matches, 1);
    assert_eq!(r_tiny.items[0].name, "notes_small.txt");

    // type:archive
    let r_arch = search_arena(&arena, "type:archive", 50, SortField::Size, SortDir::Desc);
    assert_eq!(r_arch.total_matches, 1);
    assert_eq!(r_arch.items[0].name, "backup_archive.zip");

    // ext:txt
    let r_ext = search_arena(&arena, "ext:txt", 50, SortField::Size, SortDir::Desc);
    assert_eq!(r_ext.total_matches, 1);
    assert_eq!(r_ext.items[0].name, "notes_small.txt");

    // older:1y & newer:7d
    let r_old = search_arena(&arena, "older:1y is:file", 50, SortField::Size, SortDir::Desc);
    assert_eq!(r_old.total_matches, 2);

    let r_new = search_arena(&arena, "newer:7d is:file", 50, SortField::Size, SortDir::Desc);
    assert_eq!(r_new.total_matches, 2);

    // is:dir + substring
    let r_dir = search_arena(&arena, "is:dir mov", 50, SortField::Size, SortDir::Desc);
    assert_eq!(r_dir.total_matches, 1);
    assert_eq!(r_dir.items[0].name, "Movies");
}

#[test]
fn duplicates_three_stage_blake3_and_same_size_different_middle_trap() {
    let root = make_temp_dir("duplicates");

    // Group 1: two identical 32 KB files
    let mut payload_a = vec![0x11u8; 32 * 1024];
    payload_a[16_384] = 0xAA;
    write_bytes_file(&root.join("dup_a1.bin"), &payload_a);
    write_bytes_file(&root.join("sub").join("dup_a2.bin"), &payload_a);

    // Trap: same 32 KB size, identical first 4 KB and last 4 KB, DIFFERENT middle byte!
    // Must pass Stage 1 (size) & Stage 2 (partial head+tail hash), then be REJECTED by Stage 3 (full BLAKE3)!
    let mut trap = payload_a.clone();
    trap[16_384] = 0xBB;
    write_bytes_file(&root.join("trap_middle.bin"), &trap);

    // Group 2: three identical 12 KB files (wasted = 24 KB)
    let payload_b = vec![0x55u8; 12 * 1024];
    write_bytes_file(&root.join("b1.dat"), &payload_b);
    write_bytes_file(&root.join("b2.dat"), &payload_b);
    write_bytes_file(&root.join("sub").join("b3.dat"), &payload_b);

    // Small file below min_size threshold
    write_bytes_file(&root.join("tiny1.txt"), b"hello");
    write_bytes_file(&root.join("tiny2.txt"), b"hello");

    let cancel = Arc::new(AtomicBool::new(false));
    let (arena, _) =
        scan_path(20, &root, ScanEngineKind::ParallelWalker, cancel.clone(), |_| {}).unwrap();

    let mut stages_seen = Vec::new();
    let report = find_duplicates(&arena, 1024, cancel, |p| {
        stages_seen.push(p.stage);
    })
    .unwrap();

    assert_eq!(report.groups.len(), 2);
    // Group 1 wastes 32 KB, Group 2 wastes 24 KB -> Group 1 must be sorted first!
    assert_eq!(report.groups[0].file_size, 32 * 1024);
    assert_eq!(report.groups[0].files.len(), 2);
    assert_eq!(report.groups[0].wasted_bytes, 32 * 1024);
    // Confirm trap_middle.bin was NOT included
    assert!(report.groups[0]
        .files
        .iter()
        .all(|f| f.name != "trap_middle.bin"));

    assert_eq!(report.groups[1].file_size, 12 * 1024);
    assert_eq!(report.groups[1].files.len(), 3);
    assert_eq!(report.groups[1].wasted_bytes, 24 * 1024);

    assert_eq!(report.total_wasted_bytes, (32 + 24) * 1024);
    assert_eq!(report.total_duplicate_files, 5);
    assert!(stages_seen.iter().any(|s| s == "grouping_by_size"));
    assert!(stages_seen.iter().any(|s| s == "complete"));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn empty_folders_and_extended_junk_and_vhdx_detection() {
    let mut arena = ScanArena::new(PathBuf::from("C:\\Users\\Dev"));

    // Outermost empty folder with nested empty child (only outer should be returned!)
    let empty_outer = arena.add_node(0, "EmptyOuter".into(), true, 0, 0, 100);
    arena.add_node(empty_outer, "EmptyInner".into(), true, 0, 0, 100);
    let non_empty = arena.add_node(0, "HasFile".into(), true, 0, 0, 100);
    arena.add_node(non_empty, "a.txt".into(), false, 100, 4096, 100);

    // .cargo\registry\cache & .cargo\git
    let cargo = arena.add_node(0, ".cargo".into(), true, 0, 0, 100);
    let reg = arena.add_node(cargo, "registry".into(), true, 0, 0, 100);
    let reg_cache = arena.add_node(reg, "cache".into(), true, 0, 0, 100);
    arena.add_node(reg_cache, "crate.crate".into(), false, 5_000, 8_192, 100);
    let cargo_git = arena.add_node(cargo, "git".into(), true, 0, 0, 100);
    arena.add_node(cargo_git, "repo.pack".into(), false, 4_000, 4_096, 100);

    // npm-cache, NuGet\packages, .m2\repository
    let npm_cache = arena.add_node(0, "npm-cache".into(), true, 0, 0, 100);
    arena.add_node(npm_cache, "index.json".into(), false, 3_000, 4_096, 100);
    let nuget = arena.add_node(0, "NuGet".into(), true, 0, 0, 100);
    let nuget_pkgs = arena.add_node(nuget, "packages".into(), true, 0, 0, 100);
    arena.add_node(nuget_pkgs, "pkg.nupkg".into(), false, 6_000, 8_192, 100);

    // GPU shader cache
    let dx_cache = arena.add_node(0, "DXCache".into(), true, 0, 0, 100);
    arena.add_node(dx_cache, "shader.bin".into(), false, 7_000, 8_192, 100);

    // Windows.old
    let win_old = arena.add_node(0, "Windows.old".into(), true, 0, 0, 100);
    arena.add_node(win_old, "old.dll".into(), false, 9_000, 12_288, 100);

    // Virtual disks (WSL2 / Docker Desktop)
    let wsl = arena.add_node(0, "WSL".into(), true, 0, 0, 100);
    arena.add_node(wsl, "ext4.vhdx".into(), false, 50_000, 53_248, 100);
    arena.add_node(wsl, "docker_data.vhdx".into(), false, 40_000, 40_960, 100);

    arena.finalize_and_sort();

    let empties = find_empty_folders(&arena, 100);
    assert_eq!(empties.len(), 1);
    assert_eq!(empties[0].name, "EmptyOuter");

    let junk = detect_junk_targets(&arena);
    let keys: Vec<&str> = junk.iter().map(|g| g.group_key.as_str()).collect();
    assert!(keys.contains(&"dev_cargo_cache"));
    assert!(keys.contains(&"dev_pkg_cache"));
    assert!(keys.contains(&"gpu_shader_cache"));
    assert!(keys.contains(&"win_old"));
    assert!(keys.contains(&"virtual_disks"));

    let vhd_group = junk.iter().find(|g| g.group_key == "virtual_disks").unwrap();
    assert_eq!(vhd_group.item_count, 2);
    assert_eq!(vhd_group.total_size, 90_000);
}

#[test]
fn snapshot_save_diff_and_csv_json_export() {
    let root = make_temp_dir("snapshot_export");
    write_sized_file(&root.join("grow_dir").join("a.bin"), 10_000);
    write_sized_file(&root.join("shrink_dir").join("b.bin"), 20_000);
    write_sized_file(&root.join("removed_dir").join("c.bin"), 5_000);

    let cancel = Arc::new(AtomicBool::new(false));
    let (arena_before, _) =
        scan_path(30, &root, ScanEngineKind::ParallelWalker, cancel.clone(), |_| {}).unwrap();

    let snap_obj = capture_snapshot(&arena_before, 4);
    assert_eq!(snap_obj.total_logical_size, 35_000);

    let snap_file = root.join("baseline.dctsnap.json");
    let saved_entries = save_snapshot_to_file(&arena_before, &snap_file, 4).unwrap();
    assert!(saved_entries >= 3);

    // Mutate filesystem: grow_dir +50KB, shrink_dir -15KB, remove removed_dir, add brand_new_dir +12KB
    write_sized_file(&root.join("grow_dir").join("extra.bin"), 50_000);
    write_sized_file(&root.join("shrink_dir").join("b.bin"), 5_000);
    fs::remove_dir_all(root.join("removed_dir")).unwrap();
    write_sized_file(&root.join("brand_new_dir").join("n.bin"), 12_000);

    let (arena_after, _) =
        scan_path(31, &root, ScanEngineKind::ParallelWalker, cancel, |_| {}).unwrap();

    let diff = compare_snapshot_file(&snap_file, &arena_after).unwrap();
    assert_eq!(diff.total_before_bytes, 35_000);
    assert!(diff.total_delta_bytes > 0);
    // Biggest grower must be first
    assert_eq!(diff.items[0].name, "grow_dir");
    assert_eq!(diff.items[0].status, "grew");
    assert_eq!(diff.items[0].delta_bytes, 50_000);
    assert!(diff
        .items
        .iter()
        .any(|i| i.name == "brand_new_dir" && i.status == "added" && i.delta_bytes == 12_000));
    assert!(diff
        .items
        .iter()
        .any(|i| i.name == "shrink_dir" && i.status == "shrunk" && i.delta_bytes == -15_000));
    assert!(diff
        .items
        .iter()
        .any(|i| i.name == "removed_dir" && i.status == "removed" && i.delta_bytes == -5_000));

    // Export CSV (verify UTF-8 BOM + header) and JSON (verify parseable)
    let csv_path = root.join("export_tree.csv");
    let csv_rows = export_report_to_file(&arena_after, "csv", "tree", &csv_path).unwrap();
    assert!(csv_rows >= 4);
    let csv_bytes = fs::read(&csv_path).unwrap();
    assert!(csv_bytes.starts_with(&[0xEF, 0xBB, 0xBF]));
    let csv_text = String::from_utf8_lossy(&csv_bytes[3..]);
    assert!(csv_text.starts_with("Path,Name,Type,LogicalSizeBytes"));
    assert!(csv_text.contains("extra.bin"));

    let json_path = root.join("export_top.json");
    let json_rows = export_report_to_file(&arena_after, "json", "top_files", &json_path).unwrap();
    assert!(json_rows >= 3);
    let json_text = fs::read_to_string(&json_path).unwrap();
    let parsed_json: serde_json::Value = serde_json::from_str(&json_text).unwrap();
    assert_eq!(parsed_json["scope"], "top_files");
    assert_eq!(parsed_json["items"][0]["name"], "extra.bin");

    let _ = fs::remove_dir_all(&root);
}
