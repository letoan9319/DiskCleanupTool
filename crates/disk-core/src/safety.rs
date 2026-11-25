use std::path::Path;

use crate::model::SafetyLevel;

fn normalize_win_path(path: &Path) -> String {
    let mut s = path.to_string_lossy().replace('/', "\\");
    if let Some(stripped) = s.strip_prefix("\\\\?\\") {
        s = stripped.to_string();
    }
    let upper = s.to_ascii_uppercase();
    // Preserve drive root like "C:\"
    if upper.len() == 2 && upper.as_bytes()[1] == b':' {
        return format!("{}\\", upper);
    }
    if upper.len() > 3 && upper.ends_with('\\') {
        return upper.trim_end_matches('\\').to_string();
    }
    upper
}

pub fn evaluate_path_safety(path: &Path) -> (SafetyLevel, Option<String>) {
    let norm = normalize_win_path(path);

    // 1. Drive root: e.g. "C:\" or "D:\"
    if norm.len() == 3 && norm.as_bytes()[1] == b':' && norm.ends_with('\\') {
        return (
            SafetyLevel::Blocked,
            Some("Drive root cannot be deleted.".to_string()),
        );
    }

    // Extract path without drive prefix (e.g. "\WINDOWS\SYSTEM32")
    let after_drive = if norm.len() >= 2 && norm.as_bytes()[1] == b':' {
        &norm[2..]
    } else {
        norm.as_str()
    };

    const BLOCKED_EXACT: &[&str] = &[
        "\\WINDOWS",
        "\\WINDOWS\\SYSTEM32",
        "\\WINDOWS\\SYSWOW64",
        "\\WINDOWS\\WINSXS",
        "\\WINDOWS\\BOOT",
        "\\WINDOWS\\FONTS",
        "\\PROGRAM FILES",
        "\\PROGRAM FILES (X86)",
        "\\PROGRAMDATA",
        "\\USERS",
        "\\$RECYCLE.BIN",
        "\\SYSTEM VOLUME INFORMATION",
        "\\RECOVERY",
        "\\BOOT",
        "\\EFI",
        "\\PAGEFILE.SYS",
        "\\HIBERFIL.SYS",
        "\\SWAPFILE.SYS",
        "\\BOOTMGR",
        "\\NTLDR",
    ];

    for &blocked in BLOCKED_EXACT {
        if after_drive == blocked {
            return (
                SafetyLevel::Blocked,
                Some("Protected Windows system path cannot be deleted.".to_string()),
            );
        }
    }

    // Anything directly inside critical Windows system subdirectories
    if after_drive.starts_with("\\WINDOWS\\SYSTEM32\\")
        || after_drive.starts_with("\\WINDOWS\\SYSWOW64\\")
        || after_drive.starts_with("\\WINDOWS\\WINSXS\\")
        || after_drive.starts_with("\\WINDOWS\\BOOT\\")
        || after_drive.starts_with("\\SYSTEM VOLUME INFORMATION\\")
        || after_drive.starts_with("\\$RECYCLE.BIN\\")
    {
        return (
            SafetyLevel::Blocked,
            Some("Critical Windows system component cannot be deleted.".to_string()),
        );
    }

    // Warning paths (allowed with caution)
    if after_drive.starts_with("\\WINDOWS\\")
        || after_drive.starts_with("\\PROGRAM FILES\\")
        || after_drive.starts_with("\\PROGRAM FILES (X86)\\")
        || after_drive.starts_with("\\PROGRAMDATA\\")
        || after_drive.contains("\\APPDATA\\ROAMING")
    {
        return (
            SafetyLevel::Warning,
            Some("Application or system folder — verify before deleting.".to_string()),
        );
    }

    (SafetyLevel::Safe, None)
}
