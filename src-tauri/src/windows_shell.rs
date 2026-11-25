use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub path: String,
    pub label: String,
    pub fs_type: String,
    pub drive_type: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub used_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecycleBinInfo {
    pub size_bytes: u64,
    pub item_count: u64,
}

#[cfg(windows)]
pub fn list_drives() -> Vec<DriveInfo> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDriveStringsW, GetVolumeInformationW,
    };

    const DRIVE_REMOVABLE: u32 = 2;
    const DRIVE_FIXED: u32 = 3;
    const DRIVE_REMOTE: u32 = 4;
    const DRIVE_RAMDISK: u32 = 6;

    let mut buf = [0u16; 512];
    let len = unsafe { GetLogicalDriveStringsW(Some(&mut buf)) } as usize;
    if len == 0 {
        return Vec::new();
    }

    let mut drives = Vec::new();
    let slice = &buf[..len.min(buf.len())];

    for raw_part in slice.split(|&c| c == 0) {
        if raw_part.is_empty() {
            continue;
        }
        let path = String::from_utf16_lossy(raw_part);
        let wide: Vec<u16> = OsStr::new(&path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let dtype_code = unsafe { GetDriveTypeW(PCWSTR(wide.as_ptr())) };
        let drive_type = match dtype_code {
            DRIVE_FIXED => "Fixed",
            DRIVE_REMOVABLE => "Removable",
            DRIVE_REMOTE => "Network",
            DRIVE_RAMDISK => "RAMDisk",
            _ => continue, // skip CD-ROM / unknown unmounted
        };

        let mut label_buf = [0u16; 128];
        let mut fs_buf = [0u16; 64];
        let mut label = String::new();
        let mut fs_type = String::new();

        let vol_ok = unsafe {
            GetVolumeInformationW(
                PCWSTR(wide.as_ptr()),
                Some(&mut label_buf),
                None,
                None,
                None,
                Some(&mut fs_buf),
            )
        };
        if vol_ok.is_ok() {
            let l_end = label_buf.iter().position(|&c| c == 0).unwrap_or(0);
            let f_end = fs_buf.iter().position(|&c| c == 0).unwrap_or(0);
            label = String::from_utf16_lossy(&label_buf[..l_end]);
            fs_type = String::from_utf16_lossy(&fs_buf[..f_end]);
        }

        let mut total_bytes = 0u64;
        let mut free_bytes = 0u64;
        let space_ok = unsafe {
            GetDiskFreeSpaceExW(
                PCWSTR(wide.as_ptr()),
                None,
                Some(&mut total_bytes),
                Some(&mut free_bytes),
            )
        };
        if space_ok.is_err() || total_bytes == 0 {
            continue;
        }

        drives.push(DriveInfo {
            path,
            label,
            fs_type,
            drive_type: drive_type.to_string(),
            total_bytes,
            free_bytes,
            used_bytes: total_bytes.saturating_sub(free_bytes),
        });
    }

    drives
}

#[cfg(not(windows))]
pub fn list_drives() -> Vec<DriveInfo> {
    Vec::new()
}

pub fn is_elevated() -> bool {
    disk_core::is_process_elevated()
}

#[cfg(windows)]
pub fn relaunch_as_admin(
    target_path: Option<String>,
    initial_tab: Option<String>,
) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_str = exe_path.to_string_lossy().to_string();

    let mut param_parts = Vec::new();
    if let Some(tab) = initial_tab.filter(|s| !s.trim().is_empty()) {
        param_parts.push(format!("--tab={}", tab.trim().replace('"', "")));
    }
    if let Some(p) = target_path.filter(|s| !s.trim().is_empty()) {
        param_parts.push(format!("\"{}\"", p.replace('"', "")));
    }
    let params_str = param_parts.join(" ");

    let verb_w: Vec<u16> = OsStr::new("runas\0").encode_wide().collect();
    let file_w: Vec<u16> = OsStr::new(&exe_str)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let params_w: Vec<u16> = OsStr::new(&params_str)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let res = unsafe {
        ShellExecuteW(
            HWND::default(),
            PCWSTR(verb_w.as_ptr()),
            PCWSTR(file_w.as_ptr()),
            if params_str.is_empty() {
                PCWSTR::null()
            } else {
                PCWSTR(params_w.as_ptr())
            },
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };

    // ShellExecuteW returns HINSTANCE > 32 on success
    if (res.0 as isize) <= 32 {
        return Err("UAC elevation was cancelled or denied".to_string());
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn relaunch_as_admin(
    _target_path: Option<String>,
    _initial_tab: Option<String>,
) -> Result<(), String> {
    Err("Admin elevation is only supported on Windows".to_string())
}

#[cfg(windows)]
fn reg_write_sz(subkey: &str, value_name: &str, data: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_WRITE,
        REG_OPTION_NON_VOLATILE, REG_SZ,
    };

    let subkey_w: Vec<u16> = OsStr::new(subkey)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut hkey = HKEY::default();
    let status = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey_w.as_ptr()),
            0,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            None,
            &mut hkey,
            None,
        )
    };
    if status.0 != 0 {
        return Err(format!("RegCreateKeyExW failed: {}", status.0));
    }

    let name_w: Vec<u16> = OsStr::new(value_name)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let data_w: Vec<u16> = OsStr::new(data)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let bytes = unsafe {
        std::slice::from_raw_parts(data_w.as_ptr() as *const u8, data_w.len() * 2)
    };

    let set_status = unsafe {
        RegSetValueExW(
            hkey,
            if value_name.is_empty() {
                PCWSTR::null()
            } else {
                PCWSTR(name_w.as_ptr())
            },
            0,
            REG_SZ,
            Some(bytes),
        )
    };
    unsafe {
        let _ = RegCloseKey(hkey);
    }
    if set_status.0 != 0 {
        return Err(format!("RegSetValueExW failed: {}", set_status.0));
    }
    Ok(())
}

#[cfg(windows)]
fn reg_delete_tree(subkey: &str) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{RegDeleteTreeW, HKEY_CURRENT_USER};

    let subkey_w: Vec<u16> = OsStr::new(subkey)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        let _ = RegDeleteTreeW(HKEY_CURRENT_USER, PCWSTR(subkey_w.as_ptr()));
    }
}

#[cfg(windows)]
pub fn is_context_menu_enabled() -> bool {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
    };

    let subkey_w: Vec<u16> = OsStr::new("Software\\Classes\\Directory\\shell\\DiskCleanupTool")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut hkey = HKEY::default();
    let status = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey_w.as_ptr()),
            0,
            KEY_READ,
            &mut hkey,
        )
    };
    if status.0 == 0 {
        unsafe {
            let _ = RegCloseKey(hkey);
        }
        true
    } else {
        false
    }
}

#[cfg(not(windows))]
pub fn is_context_menu_enabled() -> bool {
    false
}

#[cfg(windows)]
pub fn set_context_menu_enabled(enabled: bool) -> Result<(), String> {
    const KEYS: &[(&str, &str)] = &[
        ("Software\\Classes\\Directory\\shell\\DiskCleanupTool", "%1"),
        (
            "Software\\Classes\\Directory\\Background\\shell\\DiskCleanupTool",
            "%V",
        ),
        ("Software\\Classes\\Drive\\shell\\DiskCleanupTool", "%1"),
    ];

    if !enabled {
        for (base, _) in KEYS {
            reg_delete_tree(base);
        }
        return Ok(());
    }

    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_str = exe_path.to_string_lossy().to_string();
    let icon_val = format!("{},0", exe_str);

    for (base, arg) in KEYS {
        reg_write_sz(base, "", "Scan with DiskCleanupTool")?;
        reg_write_sz(base, "Icon", &icon_val)?;
        let cmd_key = format!("{}\\command", base);
        let cmd_val = format!("\"{}\" \"{}\"", exe_str, arg);
        reg_write_sz(&cmd_key, "", &cmd_val)?;
    }

    Ok(())
}

#[cfg(not(windows))]
pub fn set_context_menu_enabled(_enabled: bool) -> Result<(), String> {
    Err("Windows Explorer context menu is only supported on Windows".to_string())
}

#[cfg(windows)]
pub fn reveal_in_explorer(path: &str) -> Result<(), String> {
    use std::process::Command;
    let p = Path::new(path);
    if p.is_dir() {
        Command::new("explorer.exe")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    } else {
        Command::new("explorer.exe")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn reveal_in_explorer(_path: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
pub fn get_recycle_bin_info() -> RecycleBinInfo {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};

    let mut info = SHQUERYRBINFO {
        cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32,
        i64Size: 0,
        i64NumItems: 0,
    };

    let res = unsafe { SHQueryRecycleBinW(PCWSTR::null(), &mut info) };
    if res.is_ok() {
        RecycleBinInfo {
            size_bytes: info.i64Size.max(0) as u64,
            item_count: info.i64NumItems.max(0) as u64,
        }
    } else {
        RecycleBinInfo {
            size_bytes: 0,
            item_count: 0,
        }
    }
}

#[cfg(not(windows))]
pub fn get_recycle_bin_info() -> RecycleBinInfo {
    RecycleBinInfo {
        size_bytes: 0,
        item_count: 0,
    }
}

#[cfg(windows)]
pub fn empty_recycle_bin() -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{E_UNEXPECTED, HWND};
    use windows::Win32::UI::Shell::{
        SHEmptyRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND,
    };

    let flags = SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND;
    let res = unsafe { SHEmptyRecycleBinW(HWND::default(), PCWSTR::null(), flags) };
    match res {
        Ok(()) => Ok(()),
        Err(err) if err.code() == E_UNEXPECTED && get_recycle_bin_info().item_count == 0 => Ok(()),
        Err(err) => Err(format!("Failed to empty Recycle Bin: {}", err)),
    }
}

#[cfg(not(windows))]
pub fn empty_recycle_bin() -> Result<(), String> {
    Err("Emptying the Recycle Bin is only supported on Windows".to_string())
}

#[cfg(windows)]
pub fn open_file_default(path: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let verb_w: Vec<u16> = OsStr::new("open\0").encode_wide().collect();
    let file_w: Vec<u16> = OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let res = unsafe {
        ShellExecuteW(
            HWND::default(),
            PCWSTR(verb_w.as_ptr()),
            PCWSTR(file_w.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };

    if (res.0 as isize) <= 32 {
        return Err(format!("Failed to open path: {}", path));
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn open_file_default(_path: &str) -> Result<(), String> {
    Err("Opening files via ShellExecuteW is only supported on Windows".to_string())
}

#[cfg(windows)]
pub fn open_terminal_here(path: &str) -> Result<(), String> {
    use std::process::Command;

    let p = Path::new(path);
    let dir = if p.is_dir() {
        p.to_path_buf()
    } else if let Some(parent) = p.parent() {
        if parent.as_os_str().is_empty() {
            PathBuf::from(path)
        } else {
            parent.to_path_buf()
        }
    } else {
        p.to_path_buf()
    };

    let dir_str = dir.to_string_lossy().to_string();

    // Try Windows Terminal first
    if Command::new("wt.exe").arg("-d").arg(&dir_str).spawn().is_ok() {
        return Ok(());
    }

    // Fall back to PowerShell
    let escaped = dir_str.replace('\'', "''");
    Command::new("powershell.exe")
        .args([
            "-NoExit",
            "-Command",
            &format!("Set-Location -LiteralPath '{}'", escaped),
        ])
        .spawn()
        .map_err(|e| format!("Failed to open terminal: {}", e))?;

    Ok(())
}

#[cfg(not(windows))]
pub fn open_terminal_here(_path: &str) -> Result<(), String> {
    Err("Opening Windows terminal is only supported on Windows".to_string())
}

#[cfg(windows)]
pub fn show_file_properties(path: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_INVOKEIDLIST, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOW;

    let verb_w: Vec<u16> = OsStr::new("properties\0").encode_wide().collect();
    let file_w: Vec<u16> = OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let com_hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) };

    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_INVOKEIDLIST,
        hwnd: HWND::default(),
        lpVerb: PCWSTR(verb_w.as_ptr()),
        lpFile: PCWSTR(file_w.as_ptr()),
        nShow: SW_SHOW.0,
        ..Default::default()
    };

    let exec_res = unsafe { ShellExecuteExW(&mut info) };

    if com_hr.is_ok() {
        unsafe { CoUninitialize() };
    }

    exec_res.map_err(|e| format!("Failed to show properties for '{}': {}", path, e))
}

#[cfg(not(windows))]
pub fn show_file_properties(_path: &str) -> Result<(), String> {
    Err("File properties dialog is only supported on Windows".to_string())
}

fn is_cross_device_error(err: &std::io::Error) -> bool {
    #[cfg(windows)]
    {
        // ERROR_NOT_SAME_DEVICE = 17
        err.raw_os_error() == Some(17)
    }
    #[cfg(not(windows))]
    {
        // EXDEV = 18 on Linux/Unix
        err.raw_os_error() == Some(18)
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("Failed to create '{}': {}", dst.display(), e))?;

    let entries =
        fs::read_dir(src).map_err(|e| format!("Failed to read '{}': {}", src.display(), e))?;
    for entry_res in entries {
        let entry = entry_res.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let src_child = entry.path();
        let dst_child = dst.join(entry.file_name());

        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            copy_dir_recursive(&src_child, &dst_child)?;
        } else {
            fs::copy(&src_child, &dst_child).map_err(|e| {
                format!(
                    "Failed to copy '{}' to '{}': {}",
                    src_child.display(),
                    dst_child.display(),
                    e
                )
            })?;
        }
    }
    Ok(())
}

fn is_same_or_descendant(src: &Path, dest_dir: &Path) -> bool {
    let src_canon = fs::canonicalize(src).unwrap_or_else(|_| src.to_path_buf());
    let dest_canon = fs::canonicalize(dest_dir).unwrap_or_else(|_| dest_dir.to_path_buf());

    #[cfg(windows)]
    {
        let s = src_canon.to_string_lossy().to_ascii_lowercase();
        let d = dest_canon.to_string_lossy().to_ascii_lowercase();
        if d == s {
            return true;
        }
        let prefix = if s.ends_with('\\') {
            s
        } else {
            format!("{}\\", s)
        };
        d.starts_with(&prefix)
    }

    #[cfg(not(windows))]
    {
        dest_canon.starts_with(&src_canon)
    }
}

pub fn move_path(src: &Path, dest_dir: &Path) -> Result<PathBuf, String> {
    if !src.exists() {
        return Err(format!("Source path does not exist: {}", src.display()));
    }
    if !dest_dir.is_dir() {
        return Err(format!(
            "Destination directory does not exist: {}",
            dest_dir.display()
        ));
    }

    let file_name = src
        .file_name()
        .ok_or_else(|| format!("Source path has no file name: {}", src.display()))?;

    if src.is_dir() && is_same_or_descendant(src, dest_dir) {
        return Err(format!(
            "Cannot move folder '{}' into itself or a subfolder",
            src.display()
        ));
    }

    let dest_path = dest_dir.join(file_name);
    if dest_path == src {
        return Err("Source and destination are the same path".to_string());
    }
    if dest_path.exists() {
        return Err(format!(
            "Destination already exists: {}",
            dest_path.display()
        ));
    }

    match fs::rename(src, &dest_path) {
        Ok(()) => Ok(dest_path),
        Err(err) if is_cross_device_error(&err) => {
            if src.is_dir() {
                copy_dir_recursive(src, &dest_path)?;
                fs::remove_dir_all(src).map_err(|e| {
                    format!(
                        "Copied to '{}', but failed to remove source '{}': {}",
                        dest_path.display(),
                        src.display(),
                        e
                    )
                })?;
            } else {
                fs::copy(src, &dest_path).map_err(|e| {
                    format!(
                        "Failed to copy '{}' to '{}': {}",
                        src.display(),
                        dest_path.display(),
                        e
                    )
                })?;
                fs::remove_file(src).map_err(|e| {
                    format!(
                        "Copied to '{}', but failed to remove source '{}': {}",
                        dest_path.display(),
                        src.display(),
                        e
                    )
                })?;
            }
            Ok(dest_path)
        }
        Err(err) => Err(format!(
            "Failed to move '{}' to '{}': {}",
            src.display(),
            dest_path.display(),
            err
        )),
    }
}
