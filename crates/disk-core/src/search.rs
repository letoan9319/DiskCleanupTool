use std::time::{Instant, SystemTime, UNIX_EPOCH};

use rayon::prelude::*;

use crate::arena::{contains_ascii_ci, Node, ScanArena};
use crate::model::{FileCategory, NodeId, SearchResult, SortDir, SortField};

#[derive(Debug, Clone)]
enum PatternAlt {
    ExactExt(String),
    Wildcard(String),
    Substring(String),
}

#[derive(Debug, Clone)]
enum TokenFilter {
    IsFile,
    IsDir,
    Category(FileCategory),
    Exts(Vec<String>),
    SizeMin { bytes: u64, inclusive: bool },
    SizeMax { bytes: u64, inclusive: bool },
    SizeRange { min: u64, max: u64 },
    OlderThanTs(i64),
    NewerThanTs(i64),
    MultiPattern(Vec<PatternAlt>),
    Substring(String),
}

fn parse_size_bytes(raw: &str) -> Option<u64> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    let split_idx = s
        .find(|c: char| !c.is_ascii_digit() && c != '.')
        .unwrap_or(s.len());
    let num_part = &s[..split_idx];
    let unit_part = s[split_idx..].trim().to_ascii_lowercase();
    let val: f64 = num_part.parse().ok()?;
    if !val.is_finite() || val < 0.0 {
        return None;
    }
    let mult: f64 = match unit_part.as_str() {
        "" | "b" => 1.0,
        "k" | "kb" | "kib" => 1024.0,
        "m" | "mb" | "mib" => 1024.0 * 1024.0,
        "g" | "gb" | "gib" => 1024.0 * 1024.0 * 1024.0,
        "t" | "tb" | "tib" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some((val * mult).round() as u64)
}

fn parse_duration_secs(raw: &str) -> Option<i64> {
    let s = raw.trim().to_ascii_lowercase();
    if s.len() < 2 {
        return None;
    }
    let unit = s.as_bytes()[s.len() - 1];
    let num: i64 = s[..s.len() - 1].parse().ok()?;
    if num < 0 {
        return None;
    }
    let factor: i64 = match unit {
        b'd' => 86_400,
        b'w' => 7 * 86_400,
        b'm' => 30 * 86_400,
        b'y' => 365 * 86_400,
        _ => return None,
    };
    Some(num.saturating_mul(factor))
}

/// Zero-allocation iterative ASCII case-insensitive glob matcher supporting `*` and `?`.
fn wildcard_match_ascii_ci(pattern_lower: &str, text: &str) -> bool {
    let p = pattern_lower.as_bytes();
    let t = text.as_bytes();
    let (mut pi, mut ti) = (0usize, 0usize);
    let mut star_pi: Option<usize> = None;
    let mut star_ti = 0usize;

    while ti < t.len() {
        if pi < p.len() && (p[pi] == b'?' || p[pi] == t[ti].to_ascii_lowercase()) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == b'*' {
            star_pi = Some(pi);
            star_ti = ti;
            pi += 1;
        } else if let Some(sp) = star_pi {
            pi = sp + 1;
            star_ti += 1;
            ti = star_ti;
        } else {
            return false;
        }
    }

    while pi < p.len() && p[pi] == b'*' {
        pi += 1;
    }
    pi == p.len()
}

fn parse_pattern_alt(raw_lower: &str) -> Option<PatternAlt> {
    let p = raw_lower.trim();
    if p.is_empty() {
        return None;
    }
    // Detect pure `*.ext` without further wildcards or dots
    if let Some(ext) = p.strip_prefix("*.") {
        if !ext.is_empty() && !ext.contains('*') && !ext.contains('?') && !ext.contains('.') {
            return Some(PatternAlt::ExactExt(ext.to_string()));
        }
    }
    if p.contains('*') || p.contains('?') {
        Some(PatternAlt::Wildcard(p.to_string()))
    } else {
        Some(PatternAlt::Substring(p.to_string()))
    }
}

fn parse_query_tokens(query: &str, now_ts: i64) -> Vec<TokenFilter> {
    let mut filters = Vec::new();
    for raw_tok in query.split_whitespace() {
        let tok = raw_tok.trim();
        if tok.is_empty() {
            continue;
        }
        let lower = tok.to_ascii_lowercase();

        if lower == "is:file" || lower == "is:files" {
            filters.push(TokenFilter::IsFile);
            continue;
        }
        if lower == "is:dir" || lower == "is:dirs" || lower == "is:folder" || lower == "is:folders"
        {
            filters.push(TokenFilter::IsDir);
            continue;
        }
        if let Some(val) = lower.strip_prefix("type:") {
            if let Some(cat) = FileCategory::from_name(val) {
                filters.push(TokenFilter::Category(cat));
                continue;
            }
        }
        if let Some(val) = lower.strip_prefix("ext:") {
            let exts: Vec<String> = val
                .split(';')
                .map(|e| e.trim().trim_start_matches('.').to_string())
                .filter(|e| !e.is_empty())
                .collect();
            if !exts.is_empty() {
                filters.push(TokenFilter::Exts(exts));
                continue;
            }
        }
        if let Some(val) = lower.strip_prefix("older:") {
            if let Some(secs) = parse_duration_secs(val) {
                filters.push(TokenFilter::OlderThanTs(now_ts.saturating_sub(secs)));
                continue;
            }
        }
        if let Some(val) = lower.strip_prefix("newer:") {
            if let Some(secs) = parse_duration_secs(val) {
                filters.push(TokenFilter::NewerThanTs(now_ts.saturating_sub(secs)));
                continue;
            }
        }
        if let Some((lhs, rhs)) = lower.split_once("..") {
            if let (Some(min_b), Some(max_b)) = (parse_size_bytes(lhs), parse_size_bytes(rhs)) {
                let (lo, hi) = if min_b <= max_b {
                    (min_b, max_b)
                } else {
                    (max_b, min_b)
                };
                filters.push(TokenFilter::SizeRange { min: lo, max: hi });
                continue;
            }
        }
        if let Some(val) = lower.strip_prefix(">=") {
            if let Some(bytes) = parse_size_bytes(val) {
                filters.push(TokenFilter::SizeMin {
                    bytes,
                    inclusive: true,
                });
                continue;
            }
        }
        if let Some(val) = lower.strip_prefix('>') {
            if let Some(bytes) = parse_size_bytes(val) {
                filters.push(TokenFilter::SizeMin {
                    bytes,
                    inclusive: false,
                });
                continue;
            }
        }
        if let Some(val) = lower.strip_prefix("<=") {
            if let Some(bytes) = parse_size_bytes(val) {
                filters.push(TokenFilter::SizeMax {
                    bytes,
                    inclusive: true,
                });
                continue;
            }
        }
        if let Some(val) = lower.strip_prefix('<') {
            if let Some(bytes) = parse_size_bytes(val) {
                filters.push(TokenFilter::SizeMax {
                    bytes,
                    inclusive: false,
                });
                continue;
            }
        }
        if lower.contains(';') || lower.contains('*') || lower.contains('?') {
            let alts: Vec<PatternAlt> = lower.split(';').filter_map(parse_pattern_alt).collect();
            if !alts.is_empty() {
                filters.push(TokenFilter::MultiPattern(alts));
                continue;
            }
        }

        filters.push(TokenFilter::Substring(lower));
    }
    filters
}

#[inline]
fn matches_filters(arena: &ScanArena, node: &Node, filters: &[TokenFilter]) -> bool {
    if node.deleted || node.id == 0 {
        return false;
    }
    let name = arena.node_name(node.id);

    for filter in filters {
        match filter {
            TokenFilter::IsFile => {
                if node.is_dir {
                    return false;
                }
            }
            TokenFilter::IsDir => {
                if !node.is_dir {
                    return false;
                }
            }
            TokenFilter::Category(cat) => {
                if node.is_dir || node.category != *cat {
                    return false;
                }
            }
            TokenFilter::Exts(exts) => {
                if node.is_dir {
                    return false;
                }
                let node_ext = arena.extension_of(node.id);
                if !exts.iter().any(|e| e == node_ext) {
                    return false;
                }
            }
            TokenFilter::SizeMin { bytes, inclusive } => {
                if *inclusive {
                    if node.logical_size < *bytes {
                        return false;
                    }
                } else if node.logical_size <= *bytes {
                    return false;
                }
            }
            TokenFilter::SizeMax { bytes, inclusive } => {
                if *inclusive {
                    if node.logical_size > *bytes {
                        return false;
                    }
                } else if node.logical_size >= *bytes {
                    return false;
                }
            }
            TokenFilter::SizeRange { min, max } => {
                if node.logical_size < *min || node.logical_size > *max {
                    return false;
                }
            }
            TokenFilter::OlderThanTs(cutoff) => {
                if node.modified_ts <= 0 || node.modified_ts > *cutoff {
                    return false;
                }
            }
            TokenFilter::NewerThanTs(cutoff) => {
                if node.modified_ts < *cutoff {
                    return false;
                }
            }
            TokenFilter::MultiPattern(alts) => {
                let matched = alts.iter().any(|alt| match alt {
                    PatternAlt::ExactExt(ext) => !node.is_dir && arena.extension_of(node.id) == ext,
                    PatternAlt::Wildcard(pat) => wildcard_match_ascii_ci(pat, name),
                    PatternAlt::Substring(sub) => contains_ascii_ci(name, sub),
                });
                if !matched {
                    return false;
                }
            }
            TokenFilter::Substring(sub) => {
                if !contains_ascii_ci(name, sub) {
                    return false;
                }
            }
        }
    }
    true
}

/// Checks if the filter list narrows candidates to a small set of extension buckets.
fn extract_ext_bucket_ids(arena: &ScanArena, filters: &[TokenFilter]) -> Option<Vec<u16>> {
    if arena.ext_buckets.is_empty() {
        return None;
    }
    if filters.iter().any(|f| matches!(f, TokenFilter::IsDir)) {
        return None;
    }

    for filter in filters {
        match filter {
            TokenFilter::Exts(exts) => {
                let ids: Vec<u16> = exts
                    .iter()
                    .filter_map(|e| arena.ext_id_of(e))
                    .collect();
                return Some(ids);
            }
            TokenFilter::MultiPattern(alts)
                if !alts.is_empty() && alts.iter().all(|a| matches!(a, PatternAlt::ExactExt(_))) =>
            {
                let ids: Vec<u16> = alts
                    .iter()
                    .filter_map(|a| match a {
                        PatternAlt::ExactExt(e) => arena.ext_id_of(e),
                        _ => None,
                    })
                    .collect();
                return Some(ids);
            }
            _ => {}
        }
    }
    None
}

pub fn search_arena(
    arena: &ScanArena,
    query: &str,
    limit: usize,
    sort_by: SortField,
    sort_dir: SortDir,
) -> SearchResult {
    let start = Instant::now();
    let limit = limit.clamp(1, 5000);
    let now_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let filters = parse_query_tokens(query, now_ts);
    if filters.is_empty() {
        return SearchResult {
            items: Vec::new(),
            total_matches: 0,
            total_matched_bytes: 0,
            elapsed_ms: start.elapsed().as_millis() as u64,
        };
    }

    let mut matched_ids: Vec<NodeId> = if let Some(ext_ids) = extract_ext_bucket_ids(arena, &filters)
    {
        if ext_ids.is_empty() {
            Vec::new()
        } else {
            let mut dedup_ext_ids = ext_ids;
            dedup_ext_ids.sort_unstable();
            dedup_ext_ids.dedup();
            let filters_ref: &[TokenFilter] = &filters;
            dedup_ext_ids
                .into_par_iter()
                .flat_map_iter(|ext_id| {
                    arena
                        .ext_buckets
                        .get(ext_id as usize)
                        .map(Vec::as_slice)
                        .unwrap_or(&[])
                        .iter()
                        .copied()
                        .filter(move |&nid| {
                            let node = &arena.nodes[nid as usize];
                            node.extension_id == ext_id
                                && matches_filters(arena, node, filters_ref)
                        })
                })
                .collect()
        }
    } else {
        arena
            .nodes
            .par_iter()
            .filter_map(|node| {
                if matches_filters(arena, node, &filters) {
                    Some(node.id)
                } else {
                    None
                }
            })
            .collect()
    };

    let total_matches = matched_ids.len();
    let total_matched_bytes: u64 = matched_ids
        .par_iter()
        .map(|&nid| arena.nodes[nid as usize].logical_size)
        .sum();

    matched_ids.par_sort_unstable_by(|&a, &b| arena.compare_nodes(a, b, sort_by, sort_dir));

    let items = matched_ids
        .into_iter()
        .take(limit)
        .map(|id| arena.node_to_dto(id))
        .collect();

    SearchResult {
        items,
        total_matches,
        total_matched_bytes,
        elapsed_ms: start.elapsed().as_millis() as u64,
    }
}
