use std::cmp::Reverse;
use std::collections::BinaryHeap;

use rayon::prelude::*;
use rustc_hash::FxHashMap;

use crate::arena::{contains_ascii_ci, ScanArena};
use crate::model::{
    CategoryStat, FileCategory, JunkGroup, JunkItem, NodeDto, NodeId, TreemapItem,
};
use crate::safety::evaluate_path_safety;

#[inline]
fn push_top_k(heap: &mut BinaryHeap<Reverse<(u64, NodeId)>>, limit: usize, size: u64, id: NodeId) {
    if heap.len() < limit {
        heap.push(Reverse((size, id)));
    } else if let Some(&Reverse((smallest, _))) = heap.peek() {
        if size > smallest {
            heap.pop();
            heap.push(Reverse((size, id)));
        }
    }
}

fn merge_heaps(
    mut a: BinaryHeap<Reverse<(u64, NodeId)>>,
    b: BinaryHeap<Reverse<(u64, NodeId)>>,
    limit: usize,
) -> BinaryHeap<Reverse<(u64, NodeId)>> {
    for Reverse((size, id)) in b {
        push_top_k(&mut a, limit, size, id);
    }
    a
}

pub fn top_largest_files(
    arena: &ScanArena,
    limit: usize,
    min_size_bytes: u64,
    ext_filter: Option<&str>,
    category_filter: Option<FileCategory>,
    search_query: &str,
) -> Vec<NodeDto> {
    let limit = limit.clamp(1, 5000);
    let ext_clean = ext_filter
        .map(|s| s.trim().trim_start_matches('.'))
        .filter(|s| !s.is_empty());
    let query_lower = search_query.trim().to_ascii_lowercase();

    let final_heap: BinaryHeap<Reverse<(u64, NodeId)>> = if let Some(ext_str) = ext_clean {
        // O(bucket) fast path using inverted extension index
        let Some(target_ext_id) = arena.ext_id_of(ext_str) else {
            return Vec::new();
        };
        let Some(bucket) = arena.ext_buckets.get(target_ext_id as usize) else {
            return Vec::new();
        };
        bucket
            .par_chunks(16_384)
            .map(|chunk| {
                let mut local: BinaryHeap<Reverse<(u64, NodeId)>> =
                    BinaryHeap::with_capacity(limit.min(chunk.len()) + 1);
                for &nid in chunk {
                    let node = &arena.nodes[nid as usize];
                    if node.deleted || node.is_dir || node.extension_id != target_ext_id {
                        continue;
                    }
                    if node.logical_size < min_size_bytes {
                        continue;
                    }
                    if let Some(cat) = category_filter {
                        if node.category != cat {
                            continue;
                        }
                    }
                    if !query_lower.is_empty()
                        && !contains_ascii_ci(arena.node_name(nid), &query_lower)
                    {
                        continue;
                    }
                    push_top_k(&mut local, limit, node.logical_size, nid);
                }
                local
            })
            .reduce(
                || BinaryHeap::with_capacity(limit + 1),
                |a, b| merge_heaps(a, b, limit),
            )
    } else {
        arena
            .nodes
            .par_chunks(16_384)
            .map(|chunk| {
                let mut local: BinaryHeap<Reverse<(u64, NodeId)>> =
                    BinaryHeap::with_capacity(limit.min(chunk.len()) + 1);
                for node in chunk {
                    if node.deleted || node.is_dir {
                        continue;
                    }
                    if node.logical_size < min_size_bytes {
                        continue;
                    }
                    if let Some(cat) = category_filter {
                        if node.category != cat {
                            continue;
                        }
                    }
                    if !query_lower.is_empty()
                        && !contains_ascii_ci(arena.node_name(node.id), &query_lower)
                    {
                        continue;
                    }
                    push_top_k(&mut local, limit, node.logical_size, node.id);
                }
                local
            })
            .reduce(
                || BinaryHeap::with_capacity(limit + 1),
                |a, b| merge_heaps(a, b, limit),
            )
    };

    let mut items: Vec<NodeDto> = final_heap
        .into_iter()
        .map(|Reverse((_, id))| arena.node_to_dto(id))
        .collect();
    items.sort_unstable_by(|a, b| {
        b.logical_size
            .cmp(&a.logical_size)
            .then_with(|| a.name.cmp(&b.name))
    });
    items
}

pub fn category_breakdown(arena: &ScanArena) -> Vec<CategoryStat> {
    let totals = arena
        .nodes
        .par_iter()
        .fold(
            || [(0u64, 0u64, 0u64); 8],
            |mut acc, node| {
                if !node.deleted && !node.is_dir {
                    let idx = node.category.as_index();
                    acc[idx].0 = acc[idx].0.saturating_add(node.logical_size);
                    acc[idx].1 = acc[idx].1.saturating_add(node.allocated_size);
                    acc[idx].2 = acc[idx].2.saturating_add(1);
                }
                acc
            },
        )
        .reduce(
            || [(0u64, 0u64, 0u64); 8],
            |mut a, b| {
                for i in 0..8 {
                    a[i].0 = a[i].0.saturating_add(b[i].0);
                    a[i].1 = a[i].1.saturating_add(b[i].1);
                    a[i].2 = a[i].2.saturating_add(b[i].2);
                }
                a
            },
        );

    let total_bytes: u64 = totals
        .iter()
        .fold(0u64, |acc, &(logical, _, _)| acc.saturating_add(logical));

    let mut stats: Vec<CategoryStat> = FileCategory::all()
        .iter()
        .map(|&category| {
            let (logical_size, allocated_size, file_count) = totals[category.as_index()];
            CategoryStat {
                category,
                logical_size,
                allocated_size,
                file_count,
                percent_of_total: if total_bytes > 0 {
                    (logical_size as f64 / total_bytes as f64) * 100.0
                } else {
                    0.0
                },
            }
        })
        .collect();

    stats.sort_unstable_by_key(|a| Reverse(a.logical_size));
    stats
}

fn has_sibling(arena: &ScanArena, parent_id: Option<NodeId>, target_names: &[&str]) -> bool {
    let Some(pid) = parent_id else {
        return false;
    };
    arena.children_slice(pid).iter().any(|&cid| {
        let c = &arena.nodes[cid as usize];
        !c.deleted
            && target_names
                .iter()
                .any(|t| arena.node_name(cid).eq_ignore_ascii_case(t))
    })
}

fn has_sibling_ext(arena: &ScanArena, parent_id: Option<NodeId>, exts: &[&str]) -> bool {
    let Some(pid) = parent_id else {
        return false;
    };
    arena.children_slice(pid).iter().any(|&cid| {
        let c = &arena.nodes[cid as usize];
        !c.deleted && !c.is_dir && exts.contains(&arena.extension_of(cid))
    })
}

fn eq_any_ci(name: &str, candidates: &[&str]) -> bool {
    candidates.iter().any(|c| name.eq_ignore_ascii_case(c))
}

pub fn detect_junk_targets(arena: &ScanArena) -> Vec<JunkGroup> {
    let mut grouped: FxHashMap<&'static str, Vec<JunkItem>> = FxHashMap::default();

    // Traverse top-down DFS so outer junk folders claim before nested ones
    let mut stack = vec![0u32];
    while let Some(nid) = stack.pop() {
        let node = &arena.nodes[nid as usize];
        if node.deleted {
            continue;
        }

        if nid != 0 && node.is_dir && node.logical_size > 0 {
            let name = arena.node_name(nid);

            // Fast zero-alloc name check first; only materialize full_path() when matched
            let group_key: Option<&'static str> = if name.eq_ignore_ascii_case("node_modules") {
                Some("dev_node_modules")
            } else if name.eq_ignore_ascii_case("target")
                && has_sibling(arena, node.parent, &["Cargo.toml"])
            {
                Some("dev_rust_target")
            } else if eq_any_ci(name, &[".gradle", "build"])
                && has_sibling(
                    arena,
                    node.parent,
                    &["build.gradle", "build.gradle.kts", "settings.gradle"],
                )
            {
                Some("dev_gradle_build")
            } else if eq_any_ci(name, &["bin", "obj"])
                && has_sibling_ext(arena, node.parent, &["csproj", "sln", "fsproj"])
            {
                Some("dev_dotnet_build")
            } else if eq_any_ci(
                name,
                &[
                    ".venv",
                    "venv",
                    "__pycache__",
                    ".pytest_cache",
                    ".mypy_cache",
                ],
            ) {
                Some("dev_python_env")
            } else if eq_any_ci(
                name,
                &[".next", ".nuxt", ".parcel-cache", ".turbo", ".vite"],
            ) {
                Some("dev_web_cache")
            } else if eq_any_ci(name, &["npm-cache", "pnpm-store"]) {
                Some("dev_pkg_cache")
            } else if eq_any_ci(name, &["DXCache", "GLCache", "NV_Cache", "D3DSCache"]) {
                Some("gpu_shader_cache")
            } else if name.eq_ignore_ascii_case("Windows.old") {
                Some("win_old")
            } else if name.eq_ignore_ascii_case("crashdumps") {
                Some("win_crash_dumps")
            } else if eq_any_ci(
                name,
                &[
                    "cache",
                    "git",
                    "packages",
                    "repository",
                    "temp",
                    "code cache",
                    "gpucache",
                    "download",
                ],
            ) {
                // Path-qualified candidates: materialize path only for these exact directory names
                let path_buf = arena.full_path(nid);
                let path_norm = path_buf.to_string_lossy().replace('/', "\\");
                let path_lower = path_norm.to_ascii_lowercase();

                if name.eq_ignore_ascii_case("cache") {
                    if path_lower.ends_with("\\.cargo\\registry\\cache") {
                        Some("dev_cargo_cache")
                    } else if path_lower.ends_with("\\yarn\\cache")
                        || path_lower.ends_with("\\pip\\cache")
                        || path_lower.ends_with("\\uv\\cache")
                    {
                        Some("dev_pkg_cache")
                    } else if path_lower.contains("\\appdata\\") {
                        Some("app_caches")
                    } else {
                        None
                    }
                } else if name.eq_ignore_ascii_case("git") {
                    if path_lower.ends_with("\\.cargo\\git") {
                        Some("dev_cargo_cache")
                    } else {
                        None
                    }
                } else if name.eq_ignore_ascii_case("packages") {
                    if path_lower.ends_with("\\nuget\\packages") {
                        Some("dev_pkg_cache")
                    } else {
                        None
                    }
                } else if name.eq_ignore_ascii_case("repository") {
                    if path_lower.ends_with("\\.m2\\repository") {
                        Some("dev_pkg_cache")
                    } else {
                        None
                    }
                } else if name.eq_ignore_ascii_case("temp") {
                    if path_lower.contains("\\appdata\\local\\temp")
                        || path_lower.contains("\\windows\\temp")
                    {
                        Some("win_temp_files")
                    } else {
                        None
                    }
                } else if eq_any_ci(name, &["code cache", "gpucache"]) {
                    if path_lower.contains("\\appdata\\") {
                        Some("app_caches")
                    } else {
                        None
                    }
                } else if name.eq_ignore_ascii_case("download")
                    && path_lower.ends_with("\\windows\\softwaredistribution\\download")
                {
                    Some("win_update_cache")
                } else {
                    None
                }
            } else {
                None
            };

            if let Some(key) = group_key {
                let path_buf = arena.full_path(nid);
                let (safety_level, _) = evaluate_path_safety(&path_buf);
                grouped.entry(key).or_default().push(JunkItem {
                    node_id: nid,
                    name: name.to_string(),
                    full_path: path_buf.to_string_lossy().to_string(),
                    is_dir: true,
                    logical_size: node.logical_size,
                    allocated_size: node.allocated_size,
                    file_count: node.file_count,
                    modified_ts: node.modified_ts,
                    safety_level,
                });
                // Do not descend inside already-claimed junk directory
                continue;
            }
        } else if !node.is_dir && node.logical_size > 0 {
            let name = arena.node_name(nid);
            if eq_any_ci(name, &["ext4.vhdx", "docker_data.vhdx"]) {
                let path_buf = arena.full_path(nid);
                let (safety_level, _) = evaluate_path_safety(&path_buf);
                grouped.entry("virtual_disks").or_default().push(JunkItem {
                    node_id: nid,
                    name: name.to_string(),
                    full_path: path_buf.to_string_lossy().to_string(),
                    is_dir: false,
                    logical_size: node.logical_size,
                    allocated_size: node.allocated_size,
                    file_count: 1,
                    modified_ts: node.modified_ts,
                    safety_level,
                });
            } else if node.logical_size >= 50 * 1024 * 1024 {
                // Large installers/archives (>= 50 MB) inside Downloads folder
                let ext = arena.extension_of(nid);
                if matches!(ext, "exe" | "msi" | "msix" | "iso" | "zip" | "rar" | "7z") {
                    let path_buf = arena.full_path(nid);
                    let path_lower = path_buf
                        .to_string_lossy()
                        .replace('/', "\\")
                        .to_ascii_lowercase();
                    if path_lower.contains("\\downloads\\") {
                        let (safety_level, _) = evaluate_path_safety(&path_buf);
                        grouped
                            .entry("downloads_installers")
                            .or_default()
                            .push(JunkItem {
                                node_id: nid,
                                name: name.to_string(),
                                full_path: path_buf.to_string_lossy().to_string(),
                                is_dir: false,
                                logical_size: node.logical_size,
                                allocated_size: node.allocated_size,
                                file_count: 1,
                                modified_ts: node.modified_ts,
                                safety_level,
                            });
                    }
                }
            }
        }

        if node.is_dir {
            for &cid in arena.children_slice(nid) {
                stack.push(cid);
            }
        }
    }

    let mut groups: Vec<JunkGroup> = grouped
        .into_iter()
        .map(|(group_key, mut items)| {
            items.sort_unstable_by_key(|a| Reverse(a.logical_size));
            let total_size = items.iter().map(|i| i.logical_size).sum();
            let item_count = items.len();
            JunkGroup {
                group_key: group_key.to_string(),
                total_size,
                item_count,
                items,
            }
        })
        .collect();

    groups.sort_unstable_by_key(|a| Reverse(a.total_size));
    groups
}

/// Returns outermost empty directories (`is_dir && !deleted && file_count == 0 && logical_size == 0`).
pub fn find_empty_folders(arena: &ScanArena, limit: usize) -> Vec<NodeDto> {
    let limit = limit.clamp(1, 5000);
    let mut found: Vec<NodeId> = Vec::new();
    let mut stack = vec![0u32];

    while let Some(nid) = stack.pop() {
        let node = &arena.nodes[nid as usize];
        if node.deleted || !node.is_dir {
            continue;
        }
        if nid != 0 && node.file_count == 0 && node.logical_size == 0 {
            found.push(nid);
            // Do not descend inside an already-empty outer directory
            continue;
        }
        for &cid in arena.children_slice(nid) {
            if arena.nodes[cid as usize].is_dir {
                stack.push(cid);
            }
        }
    }

    found.sort_unstable_by(|&a, &b| {
        arena.nodes[b as usize]
            .dir_count
            .cmp(&arena.nodes[a as usize].dir_count)
            .then_with(|| {
                crate::arena::cmp_ascii_ci(arena.node_name(a), arena.node_name(b))
            })
    });

    found
        .into_iter()
        .take(limit)
        .map(|id| arena.node_to_dto(id))
        .collect()
}

pub fn treemap_children(arena: &ScanArena, dir_id: NodeId, max_items: usize) -> Vec<TreemapItem> {
    let Some(dir) = arena.nodes.get(dir_id as usize) else {
        return Vec::new();
    };
    let max_items = max_items.clamp(4, 200);
    let parent_size = dir.logical_size.max(1);

    let active: Vec<NodeId> = arena
        .children_slice(dir_id)
        .iter()
        .copied()
        .filter(|&cid| {
            let n = &arena.nodes[cid as usize];
            !n.deleted && n.logical_size > 0
        })
        .collect();

    if active.is_empty() {
        return Vec::new();
    }

    let mut result = Vec::with_capacity(active.len().min(max_items + 1));
    let mut agg_size = 0u64;
    let mut agg_count = 0usize;

    for (idx, &cid) in active.iter().enumerate() {
        let n = &arena.nodes[cid as usize];
        if idx < max_items {
            let path_buf = arena.full_path(cid);
            let (safety_level, _) = evaluate_path_safety(&path_buf);
            result.push(TreemapItem {
                id: Some(cid),
                name: arena.node_name(cid).to_string(),
                full_path: path_buf.to_string_lossy().to_string(),
                is_dir: n.is_dir,
                logical_size: n.logical_size,
                category: n.category,
                percent_of_parent: (n.logical_size as f64 / parent_size as f64) * 100.0,
                is_aggregate: false,
                safety_level,
            });
        } else {
            agg_size = agg_size.saturating_add(n.logical_size);
            agg_count += 1;
        }
    }

    if agg_count > 0 && agg_size > 0 {
        result.push(TreemapItem {
            id: None,
            name: format!("+{} smaller items", agg_count),
            full_path: arena.full_path(dir_id).to_string_lossy().to_string(),
            is_dir: false,
            logical_size: agg_size,
            category: FileCategory::Other,
            percent_of_parent: (agg_size as f64 / parent_size as f64) * 100.0,
            is_aggregate: true,
            safety_level: crate::model::SafetyLevel::Blocked,
        });
    }

    result
}
