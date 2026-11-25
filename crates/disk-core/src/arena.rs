use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use memchr::{memchr, memchr2};
use rayon::prelude::*;
use rustc_hash::FxHashMap;

use crate::model::{
    BreadcrumbItem, ChildrenPage, ExpandedTreeEntry, FileCategory, NodeDto, NodeId, SortDir,
    SortField,
};
use crate::safety::evaluate_path_safety;

/// Zero-allocation ASCII case-insensitive lexicographical comparison.
#[inline]
pub fn cmp_ascii_ci(a: &str, b: &str) -> Ordering {
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    let min_len = ab.len().min(bb.len());
    for i in 0..min_len {
        let ca = ab[i].to_ascii_lowercase();
        let cb = bb[i].to_ascii_lowercase();
        if ca != cb {
            return ca.cmp(&cb);
        }
    }
    ab.len().cmp(&bb.len())
}

/// Zero-allocation SIMD-accelerated ASCII case-insensitive substring match.
/// `needle_lower` must already be ASCII-lowercased.
#[inline]
pub fn contains_ascii_ci(haystack: &str, needle_lower: &str) -> bool {
    let nb = needle_lower.as_bytes();
    if nb.is_empty() {
        return true;
    }
    let hb = haystack.as_bytes();
    if hb.len() < nb.len() {
        return false;
    }

    let first_lo = nb[0].to_ascii_lowercase();
    let first_hi = first_lo.to_ascii_uppercase();
    let max_start = hb.len() - nb.len();
    let mut pos = 0usize;

    while pos <= max_start {
        let search_slice = &hb[pos..=max_start];
        let found = if first_lo == first_hi {
            memchr(first_lo, search_slice)
        } else {
            memchr2(first_lo, first_hi, search_slice)
        };
        let Some(rel) = found else {
            return false;
        };
        let start = pos + rel;
        if hb[start..start + nb.len()].eq_ignore_ascii_case(nb) {
            return true;
        }
        pos = start + 1;
    }
    false
}

#[derive(Debug, Clone)]
pub struct Node {
    pub id: NodeId,
    pub parent: Option<NodeId>,
    pub name_off: u32,
    pub name_len: u16,
    pub is_dir: bool,
    pub logical_size: u64,
    pub allocated_size: u64,
    pub file_count: u64,
    pub dir_count: u64,
    pub modified_ts: i64,
    pub extension_id: u16,
    pub category: FileCategory,
    pub deleted: bool,
    pub children_start: u32,
    pub children_len: u32,
}

pub struct ScanArena {
    pub root_path: PathBuf,
    pub nodes: Vec<Node>,
    name_pool: String,
    children_pool: Vec<NodeId>,
    build_children: Vec<Vec<NodeId>>,
    extensions: Vec<String>,
    ext_map: FxHashMap<String, u16>,
    pub ext_buckets: Vec<Vec<NodeId>>,
}

impl ScanArena {
    pub fn new(root_path: PathBuf) -> Self {
        Self::with_capacity(root_path, 64)
    }

    pub fn with_capacity(root_path: PathBuf, estimated_nodes: usize) -> Self {
        let root_name = Self::display_root_name(&root_path);
        let mut name_pool = String::with_capacity(estimated_nodes.saturating_mul(16).max(256));
        let (name_off, name_len) = Self::append_name_to_pool(&mut name_pool, &root_name);

        let root = Node {
            id: 0,
            parent: None,
            name_off,
            name_len,
            is_dir: true,
            logical_size: 0,
            allocated_size: 0,
            file_count: 0,
            dir_count: 0,
            modified_ts: 0,
            extension_id: 0,
            category: FileCategory::Other,
            deleted: false,
            children_start: 0,
            children_len: 0,
        };

        let mut nodes = Vec::with_capacity(estimated_nodes.max(1));
        nodes.push(root);

        let mut build_children = Vec::with_capacity(estimated_nodes.max(1));
        build_children.push(Vec::new());

        let mut ext_map = FxHashMap::default();
        ext_map.insert(String::new(), 0);

        Self {
            root_path,
            nodes,
            name_pool,
            children_pool: Vec::new(),
            build_children,
            extensions: vec![String::new()],
            ext_map,
            ext_buckets: Vec::new(),
        }
    }

    fn display_root_name(path: &Path) -> String {
        let raw = path.to_string_lossy().to_string();
        if raw.len() <= 3 && raw.ends_with('\\') {
            return raw;
        }
        path.file_name()
            .map(|s| s.to_string_lossy().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or(raw)
    }

    #[inline]
    fn append_name_to_pool(pool: &mut String, name: &str) -> (u32, u16) {
        let off = pool.len() as u32;
        let clipped = if name.len() <= u16::MAX as usize {
            name
        } else {
            let mut end = u16::MAX as usize;
            while end > 0 && !name.is_char_boundary(end) {
                end -= 1;
            }
            &name[..end]
        };
        pool.push_str(clipped);
        (off, clipped.len() as u16)
    }

    #[inline]
    pub fn node_name(&self, id: NodeId) -> &str {
        let Some(node) = self.nodes.get(id as usize) else {
            return "";
        };
        Self::name_from_pool(&self.name_pool, node)
    }

    #[inline]
    fn name_from_pool<'a>(name_pool: &'a str, node: &Node) -> &'a str {
        let start = node.name_off as usize;
        let end = start.saturating_add(node.name_len as usize);
        name_pool.get(start..end).unwrap_or("")
    }

    #[inline]
    pub fn children_slice(&self, id: NodeId) -> &[NodeId] {
        if !self.build_children.is_empty() {
            return self
                .build_children
                .get(id as usize)
                .map(Vec::as_slice)
                .unwrap_or(&[]);
        }
        let Some(node) = self.nodes.get(id as usize) else {
            return &[];
        };
        let start = node.children_start as usize;
        let end = start.saturating_add(node.children_len as usize);
        self.children_pool.get(start..end).unwrap_or(&[])
    }

    pub fn intern_extension(&mut self, ext: &str) -> u16 {
        if ext.is_empty() {
            return 0;
        }
        // Fast stack-allocated ASCII lowercase lookup avoids heap allocation on cache hit
        if ext.len() <= 32 {
            let mut stack_buf = [0u8; 32];
            for (i, &b) in ext.as_bytes().iter().enumerate() {
                stack_buf[i] = b.to_ascii_lowercase();
            }
            if let Ok(lower_str) = std::str::from_utf8(&stack_buf[..ext.len()]) {
                if let Some(&id) = self.ext_map.get(lower_str) {
                    return id;
                }
                if self.extensions.len() >= u16::MAX as usize {
                    return 0;
                }
                let id = self.extensions.len() as u16;
                let owned = lower_str.to_string();
                self.extensions.push(owned.clone());
                self.ext_map.insert(owned, id);
                return id;
            }
        }

        let lower = ext.to_ascii_lowercase();
        if let Some(&id) = self.ext_map.get(&lower) {
            return id;
        }
        if self.extensions.len() >= u16::MAX as usize {
            return 0;
        }
        let id = self.extensions.len() as u16;
        self.extensions.push(lower.clone());
        self.ext_map.insert(lower, id);
        id
    }

    #[inline]
    pub fn extension_of(&self, id: NodeId) -> &str {
        let Some(node) = self.nodes.get(id as usize) else {
            return "";
        };
        self.extensions
            .get(node.extension_id as usize)
            .map(String::as_str)
            .unwrap_or("")
    }

    pub fn ext_id_of(&self, ext: &str) -> Option<u16> {
        let trimmed = ext.trim().trim_start_matches('.');
        if trimmed.is_empty() {
            return Some(0);
        }
        if trimmed.len() <= 32 {
            let mut stack_buf = [0u8; 32];
            for (i, &b) in trimmed.as_bytes().iter().enumerate() {
                stack_buf[i] = b.to_ascii_lowercase();
            }
            if let Ok(lower_str) = std::str::from_utf8(&stack_buf[..trimmed.len()]) {
                return self.ext_map.get(lower_str).copied();
            }
        }
        let lower = trimmed.to_ascii_lowercase();
        self.ext_map.get(&lower).copied()
    }

    pub fn add_node(
        &mut self,
        parent: NodeId,
        name: String,
        is_dir: bool,
        logical_size: u64,
        allocated_size: u64,
        modified_ts: i64,
    ) -> NodeId {
        self.add_node_str(
            parent,
            &name,
            is_dir,
            logical_size,
            allocated_size,
            modified_ts,
        )
    }

    pub fn add_node_str(
        &mut self,
        parent: NodeId,
        name: &str,
        is_dir: bool,
        logical_size: u64,
        allocated_size: u64,
        modified_ts: i64,
    ) -> NodeId {
        let id = self.nodes.len() as NodeId;
        let (extension_id, category) = if is_dir {
            (0, FileCategory::Other)
        } else {
            let ext = Self::extract_extension(name);
            let ext_id = self.intern_extension(ext);
            let cat = FileCategory::from_extension(ext);
            (ext_id, cat)
        };

        let (name_off, name_len) = Self::append_name_to_pool(&mut self.name_pool, name);

        self.nodes.push(Node {
            id,
            parent: Some(parent),
            name_off,
            name_len,
            is_dir,
            logical_size,
            allocated_size,
            file_count: if is_dir { 0 } else { 1 },
            dir_count: 0,
            modified_ts,
            extension_id,
            category,
            deleted: false,
            children_start: 0,
            children_len: 0,
        });

        self.build_children.push(Vec::new());
        if let Some(pch) = self.build_children.get_mut(parent as usize) {
            pch.push(id);
        }
        id
    }

    #[inline]
    fn extract_extension(name: &str) -> &str {
        match name.rsplit_once('.') {
            Some((prefix, ext)) if !prefix.is_empty() && !ext.is_empty() => ext,
            _ => "",
        }
    }

    pub fn full_path(&self, id: NodeId) -> PathBuf {
        if id == 0 {
            return self.root_path.clone();
        }
        let mut segments = Vec::with_capacity(8);
        let mut cur = Some(id);
        while let Some(nid) = cur {
            if nid == 0 {
                break;
            }
            let Some(node) = self.nodes.get(nid as usize) else {
                break;
            };
            segments.push(Self::name_from_pool(&self.name_pool, node));
            cur = node.parent;
        }
        let mut path = self.root_path.clone();
        for seg in segments.iter().rev() {
            path.push(seg);
        }
        path
    }

    /// Aggregates directory totals iteratively from leaves up to root, compacts children into a
    /// flat CSR `children_pool`, sorts all directory slices descending by `logical_size` in
    /// parallel, and builds the inverted `ext_buckets` index.
    pub fn finalize_and_sort(&mut self) {
        if self.nodes.is_empty() {
            return;
        }

        // 1. Iterative post-order aggregation over build_children
        if !self.build_children.is_empty() {
            let mut stack = Vec::with_capacity(1024);
            let mut post_order = Vec::with_capacity(self.nodes.len() / 4 + 16);
            stack.push(0u32);
            while let Some(nid) = stack.pop() {
                post_order.push(nid);
                if let Some(children) = self.build_children.get(nid as usize) {
                    for &child_id in children {
                        if self.nodes[child_id as usize].is_dir {
                            stack.push(child_id);
                        }
                    }
                }
            }

            for &nid in post_order.iter().rev() {
                let children = &self.build_children[nid as usize];
                if !children.is_empty() {
                    let mut sum_logical = 0u64;
                    let mut sum_allocated = 0u64;
                    let mut sum_files = 0u64;
                    let mut sum_dirs = 0u64;
                    let mut max_ts = self.nodes[nid as usize].modified_ts;

                    for &cid in children {
                        let c = &self.nodes[cid as usize];
                        if c.deleted {
                            continue;
                        }
                        sum_logical = sum_logical.saturating_add(c.logical_size);
                        sum_allocated = sum_allocated.saturating_add(c.allocated_size);
                        sum_files = sum_files.saturating_add(c.file_count);
                        sum_dirs = sum_dirs
                            .saturating_add(c.dir_count)
                            .saturating_add(if c.is_dir { 1 } else { 0 });
                        if c.modified_ts > max_ts {
                            max_ts = c.modified_ts;
                        }
                    }

                    let node = &mut self.nodes[nid as usize];
                    node.logical_size = sum_logical;
                    node.allocated_size = sum_allocated;
                    node.file_count = sum_files;
                    node.dir_count = sum_dirs;
                    node.modified_ts = max_ts;
                }
            }

            // 2. Build flat CSR children_pool and free temporary build_children vecs
            let total_children: usize = self.build_children.iter().map(Vec::len).sum();
            let mut pool = Vec::with_capacity(total_children);
            for (nid, ch) in self.build_children.iter().enumerate() {
                let start = pool.len() as u32;
                let len = ch.len() as u32;
                pool.extend_from_slice(ch);
                let node = &mut self.nodes[nid];
                node.children_start = start;
                node.children_len = len;
            }
            self.children_pool = pool;
            self.build_children = Vec::new();
        }

        // 3. Sort every directory's CSR slice descending by logical_size in parallel (zero unsafe)
        {
            let nodes = &self.nodes;
            let name_pool = &self.name_pool;
            let mut slices: Vec<&mut [NodeId]> = Vec::new();
            let mut rem = self.children_pool.as_mut_slice();
            for node in nodes {
                let len = node.children_len as usize;
                let (slice, tail) = rem.split_at_mut(len);
                rem = tail;
                if len > 1 {
                    slices.push(slice);
                }
            }
            slices.into_par_iter().for_each(|slice| {
                slice.sort_unstable_by(|&a, &b| {
                    Self::compare_default_desc_raw(nodes, name_pool, a, b)
                });
            });
        }

        // 4. Build inverted extension index (ext_buckets)
        let ext_count = self.extensions.len();
        let mut counts = vec![0usize; ext_count];
        for node in &self.nodes {
            if !node.deleted && !node.is_dir {
                if let Some(c) = counts.get_mut(node.extension_id as usize) {
                    *c += 1;
                }
            }
        }
        let mut buckets: Vec<Vec<NodeId>> = counts.into_iter().map(Vec::with_capacity).collect();
        for node in &self.nodes {
            if !node.deleted && !node.is_dir {
                if let Some(b) = buckets.get_mut(node.extension_id as usize) {
                    b.push(node.id);
                }
            }
        }
        self.ext_buckets = buckets;
    }

    #[inline]
    fn compare_default_desc_raw(
        nodes: &[Node],
        name_pool: &str,
        a_id: NodeId,
        b_id: NodeId,
    ) -> Ordering {
        let a = &nodes[a_id as usize];
        let b = &nodes[b_id as usize];
        b.logical_size
            .cmp(&a.logical_size)
            .then_with(|| b.is_dir.cmp(&a.is_dir))
            .then_with(|| {
                cmp_ascii_ci(
                    Self::name_from_pool(name_pool, a),
                    Self::name_from_pool(name_pool, b),
                )
            })
    }

    #[inline]
    pub fn compare_nodes(
        &self,
        a_id: NodeId,
        b_id: NodeId,
        sort_by: SortField,
        sort_dir: SortDir,
    ) -> Ordering {
        let a = &self.nodes[a_id as usize];
        let b = &self.nodes[b_id as usize];
        let ord = match sort_by {
            SortField::Size => a.logical_size.cmp(&b.logical_size),
            SortField::Allocated => a.allocated_size.cmp(&b.allocated_size),
            SortField::Files => a.file_count.cmp(&b.file_count),
            SortField::Folders => a.dir_count.cmp(&b.dir_count),
            SortField::Modified => a.modified_ts.cmp(&b.modified_ts),
            SortField::Name => cmp_ascii_ci(
                Self::name_from_pool(&self.name_pool, a),
                Self::name_from_pool(&self.name_pool, b),
            ),
        };
        let ordered = match sort_dir {
            SortDir::Desc => ord.reverse(),
            SortDir::Asc => ord,
        };
        ordered.then_with(|| {
            cmp_ascii_ci(
                Self::name_from_pool(&self.name_pool, a),
                Self::name_from_pool(&self.name_pool, b),
            )
        })
    }

    pub fn node_to_dto(&self, id: NodeId) -> NodeDto {
        let node = &self.nodes[id as usize];
        let full_path_buf = self.full_path(id);
        let full_path = full_path_buf.to_string_lossy().to_string();
        let (safety_level, _) = evaluate_path_safety(&full_path_buf);

        let parent_size = node
            .parent
            .and_then(|pid| self.nodes.get(pid as usize))
            .map(|p| p.logical_size)
            .unwrap_or(node.logical_size);
        let root_size = self.nodes[0].logical_size;

        let percent_of_parent = if parent_size > 0 {
            (node.logical_size as f64 / parent_size as f64) * 100.0
        } else {
            0.0
        };
        let percent_of_root = if root_size > 0 {
            (node.logical_size as f64 / root_size as f64) * 100.0
        } else {
            0.0
        };

        let has_children = self
            .children_slice(id)
            .iter()
            .any(|&cid| !self.nodes[cid as usize].deleted);

        NodeDto {
            id: node.id,
            parent_id: node.parent,
            name: self.node_name(id).to_string(),
            full_path,
            is_dir: node.is_dir,
            logical_size: node.logical_size,
            allocated_size: node.allocated_size,
            file_count: node.file_count,
            dir_count: node.dir_count,
            modified_ts: node.modified_ts,
            extension: self.extension_of(id).to_string(),
            category: node.category,
            percent_of_parent,
            percent_of_root,
            has_children,
            safety_level,
        }
    }

    pub fn get_children(
        &self,
        parent_id: NodeId,
        offset: usize,
        limit: usize,
        sort_by: SortField,
        sort_dir: SortDir,
        search_query: &str,
    ) -> ChildrenPage {
        if self.nodes.get(parent_id as usize).is_none() {
            return ChildrenPage {
                parent_id,
                total_count: 0,
                offset,
                items: Vec::new(),
            };
        }

        let query_lower = search_query.trim().to_ascii_lowercase();
        let slice = self.children_slice(parent_id);
        let mut active: Vec<NodeId> = slice
            .iter()
            .copied()
            .filter(|&cid| {
                let n = &self.nodes[cid as usize];
                if n.deleted {
                    return false;
                }
                if !query_lower.is_empty() && !contains_ascii_ci(self.node_name(cid), &query_lower)
                {
                    return false;
                }
                true
            })
            .collect();

        // When sorting by Size Desc, parent's CSR slice is already in sorted order!
        if !(sort_by == SortField::Size && sort_dir == SortDir::Desc) {
            active.sort_unstable_by(|&a_id, &b_id| {
                self.compare_nodes(a_id, b_id, sort_by, sort_dir)
            });
        }

        let total_count = active.len();
        let end = offset.saturating_add(limit).min(total_count);
        let items = if offset >= total_count {
            Vec::new()
        } else {
            active[offset..end]
                .iter()
                .map(|&cid| self.node_to_dto(cid))
                .collect()
        };

        ChildrenPage {
            parent_id,
            total_count,
            offset,
            items,
        }
    }

    pub fn get_expanded_tree(
        &self,
        root_id: NodeId,
        max_depth: usize,
        sort_by: SortField,
        sort_dir: SortDir,
        limit_per_dir: usize,
    ) -> Vec<ExpandedTreeEntry> {
        if self.nodes.get(root_id as usize).is_none() {
            return Vec::new();
        }
        let max_depth = max_depth.min(8);
        let limit_per_dir = limit_per_dir.clamp(1, 5000);
        const MAX_TOTAL_ENTRIES: usize = 25_000;

        let mut out = Vec::new();
        self.collect_expanded_recursive(
            root_id,
            0,
            max_depth,
            sort_by,
            sort_dir,
            limit_per_dir,
            MAX_TOTAL_ENTRIES,
            &mut out,
        );
        out
    }

    #[allow(clippy::too_many_arguments)]
    fn collect_expanded_recursive(
        &self,
        parent_id: NodeId,
        depth: usize,
        max_depth: usize,
        sort_by: SortField,
        sort_dir: SortDir,
        limit_per_dir: usize,
        max_total: usize,
        out: &mut Vec<ExpandedTreeEntry>,
    ) {
        if out.len() >= max_total {
            return;
        }
        let slice = self.children_slice(parent_id);
        let mut active: Vec<NodeId> = slice
            .iter()
            .copied()
            .filter(|&cid| !self.nodes[cid as usize].deleted)
            .collect();

        if !(sort_by == SortField::Size && sort_dir == SortDir::Desc) {
            active.sort_unstable_by(|&a_id, &b_id| {
                self.compare_nodes(a_id, b_id, sort_by, sort_dir)
            });
        }

        for cid in active.into_iter().take(limit_per_dir) {
            if out.len() >= max_total {
                break;
            }
            let child = &self.nodes[cid as usize];
            let child_has_active = child.is_dir
                && self
                    .children_slice(cid)
                    .iter()
                    .any(|&gc| !self.nodes[gc as usize].deleted);
            let will_expand = child_has_active && depth < max_depth;

            out.push(ExpandedTreeEntry {
                node: self.node_to_dto(cid),
                depth,
                has_expanded_children: will_expand,
            });

            if will_expand {
                self.collect_expanded_recursive(
                    cid,
                    depth + 1,
                    max_depth,
                    sort_by,
                    sort_dir,
                    limit_per_dir,
                    max_total,
                    out,
                );
            }
        }
    }

    pub fn get_ancestors(&self, id: NodeId) -> Vec<BreadcrumbItem> {
        let mut chain = Vec::new();
        let mut cur = Some(id);
        while let Some(nid) = cur {
            if let Some(node) = self.nodes.get(nid as usize) {
                chain.push(BreadcrumbItem {
                    id: node.id,
                    name: self.node_name(node.id).to_string(),
                    full_path: self.full_path(node.id).to_string_lossy().to_string(),
                });
                cur = node.parent;
            } else {
                break;
            }
        }
        chain.reverse();
        chain
    }

    /// Marks `id` and all descendants as deleted, then subtracts sizes up the ancestor chain
    /// in O(depth) and compacts & re-sorts affected parent slices in-place on `children_pool`.
    pub fn mark_deleted_and_recalculate(&mut self, id: NodeId) -> (u64, u64) {
        let Some(node) = self.nodes.get(id as usize) else {
            return (0, 0);
        };
        if node.deleted {
            return (0, 0);
        }

        let freed_logical = node.logical_size;
        let freed_allocated = node.allocated_size;
        let freed_files = node.file_count;
        let freed_dirs = node
            .dir_count
            .saturating_add(if node.is_dir { 1 } else { 0 });
        let parent_start = node.parent;

        // Iterative subtree mark
        let mut stack = vec![id];
        while let Some(cur) = stack.pop() {
            if self.nodes[cur as usize].deleted {
                continue;
            }
            self.nodes[cur as usize].deleted = true;
            if !self.build_children.is_empty() {
                if let Some(ch) = self.build_children.get(cur as usize) {
                    stack.extend_from_slice(ch);
                }
            } else {
                let start = self.nodes[cur as usize].children_start as usize;
                let len = self.nodes[cur as usize].children_len as usize;
                let end = start.saturating_add(len);
                if let Some(slice) = self.children_pool.get(start..end) {
                    stack.extend_from_slice(slice);
                }
            }
        }

        // Propagate subtraction up to root & compact + re-sort affected parent slices in-place
        let mut cur_parent = parent_start;
        while let Some(pid) = cur_parent {
            let next_parent = {
                let p = &mut self.nodes[pid as usize];
                p.logical_size = p.logical_size.saturating_sub(freed_logical);
                p.allocated_size = p.allocated_size.saturating_sub(freed_allocated);
                p.file_count = p.file_count.saturating_sub(freed_files);
                p.dir_count = p.dir_count.saturating_sub(freed_dirs);
                p.parent
            };

            if !self.build_children.is_empty() {
                let nodes = &self.nodes;
                let name_pool = &self.name_pool;
                if let Some(ch) = self.build_children.get_mut(pid as usize) {
                    ch.retain(|&cid| !nodes[cid as usize].deleted);
                    ch.sort_unstable_by(|&a, &b| {
                        Self::compare_default_desc_raw(nodes, name_pool, a, b)
                    });
                }
            } else {
                let start = self.nodes[pid as usize].children_start as usize;
                let len = self.nodes[pid as usize].children_len as usize;
                let end = start.saturating_add(len);
                if end <= self.children_pool.len() {
                    let mut write = start;
                    for read in start..end {
                        let cid = self.children_pool[read];
                        if !self.nodes[cid as usize].deleted {
                            self.children_pool[write] = cid;
                            write += 1;
                        }
                    }
                    let new_len = write - start;
                    self.nodes[pid as usize].children_len = new_len as u32;
                    let nodes = &self.nodes;
                    let name_pool = &self.name_pool;
                    self.children_pool[start..start + new_len].sort_unstable_by(|&a, &b| {
                        Self::compare_default_desc_raw(nodes, name_pool, a, b)
                    });
                }
            }

            cur_parent = next_parent;
        }

        (freed_logical, freed_allocated)
    }

    pub fn rename_node(&mut self, id: NodeId, new_name: &str) -> Option<NodeDto> {
        let trimmed = new_name.trim();
        if id == 0 || trimmed.is_empty() {
            return None;
        }
        let (is_dir, parent_id) = {
            let node = self.nodes.get(id as usize)?;
            if node.deleted {
                return None;
            }
            (node.is_dir, node.parent)
        };

        let (name_off, name_len) = Self::append_name_to_pool(&mut self.name_pool, trimmed);
        let (new_ext_id, new_cat) = if is_dir {
            (0, FileCategory::Other)
        } else {
            let ext = Self::extract_extension(trimmed);
            let ext_id = self.intern_extension(ext);
            let cat = FileCategory::from_extension(ext);
            (ext_id, cat)
        };

        let old_ext_id = self.nodes[id as usize].extension_id;
        {
            let node = &mut self.nodes[id as usize];
            node.name_off = name_off;
            node.name_len = name_len;
            node.extension_id = new_ext_id;
            node.category = new_cat;
        }

        if !is_dir && !self.ext_buckets.is_empty() && new_ext_id != old_ext_id {
            if self.ext_buckets.len() < self.extensions.len() {
                self.ext_buckets.resize_with(self.extensions.len(), Vec::new);
            }
            if let Some(bucket) = self.ext_buckets.get_mut(new_ext_id as usize) {
                bucket.push(id);
            }
        }

        // Re-sort parent slice for name tie-breaking
        if let Some(pid) = parent_id {
            self.resort_parent_children(pid);
        }

        Some(self.node_to_dto(id))
    }

    pub fn add_runtime_folder(&mut self, parent_id: NodeId, name: &str) -> Option<NodeDto> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return None;
        }
        {
            let parent = self.nodes.get(parent_id as usize)?;
            if !parent.is_dir || parent.deleted {
                return None;
            }
        }

        let now_ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let id = self.nodes.len() as NodeId;
        let (name_off, name_len) = Self::append_name_to_pool(&mut self.name_pool, trimmed);

        self.nodes.push(Node {
            id,
            parent: Some(parent_id),
            name_off,
            name_len,
            is_dir: true,
            logical_size: 0,
            allocated_size: 0,
            file_count: 0,
            dir_count: 0,
            modified_ts: now_ts,
            extension_id: 0,
            category: FileCategory::Other,
            deleted: false,
            children_start: 0,
            children_len: 0,
        });

        if !self.build_children.is_empty() {
            self.build_children.push(Vec::new());
            if let Some(pch) = self.build_children.get_mut(parent_id as usize) {
                pch.push(id);
            }
        } else {
            let old_start = self.nodes[parent_id as usize].children_start as usize;
            let old_len = self.nodes[parent_id as usize].children_len as usize;
            let new_start = self.children_pool.len() as u32;
            self.children_pool.reserve(old_len + 1);
            for i in old_start..old_start.saturating_add(old_len) {
                if let Some(&cid) = self.children_pool.get(i) {
                    if !self.nodes[cid as usize].deleted {
                        self.children_pool.push(cid);
                    }
                }
            }
            self.children_pool.push(id);
            let new_len = (self.children_pool.len() as u32).saturating_sub(new_start);
            self.nodes[parent_id as usize].children_start = new_start;
            self.nodes[parent_id as usize].children_len = new_len;
        }

        self.resort_parent_children(parent_id);

        // Update dir_count on parent and all ancestors up to root
        let mut cur = Some(parent_id);
        while let Some(pid) = cur {
            let p = &mut self.nodes[pid as usize];
            p.dir_count = p.dir_count.saturating_add(1);
            cur = p.parent;
        }

        Some(self.node_to_dto(id))
    }

    fn resort_parent_children(&mut self, pid: NodeId) {
        if !self.build_children.is_empty() {
            let nodes = &self.nodes;
            let name_pool = &self.name_pool;
            if let Some(ch) = self.build_children.get_mut(pid as usize) {
                ch.sort_unstable_by(|&a, &b| Self::compare_default_desc_raw(nodes, name_pool, a, b));
            }
        } else {
            let start = self.nodes[pid as usize].children_start as usize;
            let len = self.nodes[pid as usize].children_len as usize;
            let end = start.saturating_add(len);
            if end <= self.children_pool.len() && len > 1 {
                let nodes = &self.nodes;
                let name_pool = &self.name_pool;
                self.children_pool[start..end].sort_unstable_by(|&a, &b| {
                    Self::compare_default_desc_raw(nodes, name_pool, a, b)
                });
            }
        }
    }

    pub fn is_ancestor(&self, potential_ancestor: NodeId, node: NodeId) -> bool {
        let mut cur = self.nodes.get(node as usize).and_then(|n| n.parent);
        while let Some(pid) = cur {
            if pid == potential_ancestor {
                return true;
            }
            cur = self.nodes.get(pid as usize).and_then(|n| n.parent);
        }
        false
    }
}
