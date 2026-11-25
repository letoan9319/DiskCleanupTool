# DiskCleanupTool

[![CI](https://github.com/letoan9319/DiskCleanupTool/actions/workflows/ci.yml/badge.svg)](https://github.com/letoan9319/DiskCleanupTool/actions/workflows/ci.yml)
[![Release](https://github.com/letoan9319/DiskCleanupTool/actions/workflows/release.yml/badge.svg)](https://github.com/letoan9319/DiskCleanupTool/actions/workflows/release.yml)
[![Audit Bot](https://github.com/letoan9319/DiskCleanupTool/actions/workflows/audit-bot.yml/badge.svg)](https://github.com/letoan9319/DiskCleanupTool/actions/workflows/audit-bot.yml)
[![Latest Release](https://img.shields.io/github/v/release/letoan9319/DiskCleanupTool?include_prereleases&label=download)](https://github.com/letoan9319/DiskCleanupTool/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**DiskCleanupTool** is a fast, native Windows disk space analyzer and safe cleanup utility built with **Rust**, **Tauri v2**, and **React**. Designed for instant visibility into what is consuming storage, it combines a low-memory compact arena engine, direct NTFS MFT + Win32 parallel scanning, TreeSize-style descending folder inspection, interactive treemaps, BLAKE3 duplicate detection, developer/WSL2 junk cleanup, and snapshot growth diffing.

---

## Download (Windows x64)

Get the latest Windows build directly from **[GitHub Releases](https://github.com/letoan9319/DiskCleanupTool/releases/latest)**:

| Package | Direct Link | Notes |
| :--- | :--- | :--- |
| **Windows Installer (NSIS)** | [Download Latest Installer (`DiskCleanupTool-latest-x64-setup.exe`)](https://github.com/letoan9319/DiskCleanupTool/releases/latest/download/DiskCleanupTool-latest-x64-setup.exe) | Per-user or per-machine install, 8-language wizard, optional Explorer Context Menu |
| **Portable ZIP** | [Download Portable (`DiskCleanupTool-latest-portable.zip`)](https://github.com/letoan9319/DiskCleanupTool/releases/latest/download/DiskCleanupTool-latest-portable.zip) | Extract and run `DiskCleanupTool.exe` without installation |
| **Checksums** | [`SHA256SUMS.txt`](https://github.com/letoan9319/DiskCleanupTool/releases/latest/download/SHA256SUMS.txt) | Verify integrity with `Get-FileHash <file> -Algorithm SHA256` |

> **Requirements:** Windows 10 / 11 (64-bit) with Microsoft Edge WebView2 Runtime (pre-installed on Windows 11 and modern Windows 10). Run as **Administrator** to unlock direct NTFS MFT scanning.

---

## Key Features (v0.2.0)

- **Dual High-Speed Scan Engine**
  - **Direct NTFS MFT Reader** (when elevated) with parallel record parsing and extension-record merging for near-instant full-volume scans.
  - **Native Win32 Parallel Walker** (`FindFirstFileExW` with `FIND_FIRST_EX_LARGE_FETCH` + Rayon work queue) for non-admin, folder, or non-NTFS scans — zero per-file `metadata()` syscalls, extended-length path (`\\?\`) support, and OneDrive cloud-placeholder awareness (`allocated = 0`).
  - **Compact Arena Memory Model**: pooled strings and flat CSR child arrays keep RAM usage minimal even on drives with millions of files.
- **TreeSize-Style Descending Analysis & View Controls**
  - Instant descending sort by **Size**, **Allocated**, **Files**, **Folders**, **Name**, or **Modified**.
  - Switch display metrics (**Size** | **Allocated** | **Files** | **%**) and size units (**Auto** | **GB** | **MB** | **KB**) on the fly.
  - History navigation (**Back**, **Forward**, **Up**) and one-click tree depth expansion (**Lv 1** | **Lv 2** | **Lv 3** | **Collapse**).
- **Resizable Split View (Folder Tree + Synced Treemap)**
  - Inspect folders in a virtualized hierarchy on top while navigating a synchronized proportional **Treemap** below with a draggable divider.
- **Global Instant Search**
  - Search across the entire scanned drive in milliseconds with rich filter syntax: size thresholds (`>100MB`, `>1GB`), age filters (`older:1y`), multi-extension globs (`*.mp4;*.mkv`, `*.iso;*.zip`), and categories (`type:archive`), complete with match count, total matched bytes, and query latency.
- **3-Stage BLAKE3 Duplicate Finder**
  - Fast size grouping -> partial head/tail hashing -> parallel full **BLAKE3** verification with live cancelable progress.
  - One-click **Smart Auto-Select** policies (`Keep Newest`, `Keep Oldest`, `Keep Shortest Path`) to safely queue redundant copies for deletion.
- **Developer, GPU & WSL2 Junk Cleanup**
  - Detects reclaimable caches across Cargo, npm/pnpm/yarn/pip/NuGet, GPU shader caches, `Windows.old`, temp directories, and **Empty Folders**.
  - Highlights oversized **WSL2 / Docker Virtual Disks (`.vhdx`)** with safe one-click `diskpart` / `Optimize-VHD` compact commands instead of destructive deletion.
- **Snapshot & Storage Growth Diff**
  - Save lightweight directory snapshots (`.dctsnap.json`) and compare against a later scan to pinpoint exactly which folders grew (`+GB` / `-GB`).
- **Safe File Operations & Shell Integration**
  - Built-in **System Path Safety Guard** blocks critical Windows OS directories (`Windows`, `System32`, boot files) from accidental removal.
  - Move to **Recycle Bin** (with live Recycle Bin size/count badge and one-click empty), permanent delete with confirmation preview, Move, Rename, New Folder, Open File, Reveal in Explorer, Open Terminal Here (`wt.exe` / PowerShell), Properties dialog, and **CSV / JSON** report export.
  - Optional **Windows Explorer Context Menu** entry (*"Scan with DiskCleanupTool"*) toggleable in Settings or during NSIS setup.
- **8 Languages & Light / Dark Themes**
  - Full UI and NSIS installer localization in **English**, **Vietnamese**, **Simplified Chinese**, **Japanese**, **Korean**, **Spanish**, **German**, and **French**.

---

## Keyboard Shortcuts & Quick Actions

| Shortcut / Action | Description |
| :--- | :--- |
| `Ctrl + K` | Focus and select the global search input |
| `Enter` (in search bar) | Open the **Global Search** tab and run full-drive query |
| `Double-click` folder (Tree / Treemap) | Drill into folder and record navigation history |
| `Right-click` item | Open context menu (Open, Reveal in Explorer, Move, Rename, New Folder, Open Terminal Here, Properties, Copy Path, Delete) |
| Toolbar `←` / `→` / `↑` | Navigate Back, Forward, or Up to parent folder |

---

## Architecture

```text
DiskCleanupTool/
├── crates/disk-core/     # Pure Rust core engine: compact arena, NTFS MFT & Win32 parallel
│                         # scanner, global search, BLAKE3 duplicates, junk & snapshot diff
├── src-tauri/            # Tauri v2 host, IPC commands, Win32 Shell/Recycle Bin/Context Menu,
│                         # NSIS installer hooks
├── src/                  # React 19 + TypeScript + Tailwind CSS v4 + TanStack Virtual UI
└── .github/              # CI, automated Windows NSIS/portable releases, Audit Bot, Dependabot
```

---

## Building from Source

### Prerequisites

- **Windows 10/11 (x64)**
- **Node.js 22+** and `npm`
- **Rust stable toolchain** (`x86_64-pc-windows-msvc`) with Visual Studio C++ Build Tools (or `x86_64-pc-windows-gnu` for local dev builds)
- **WebView2 Runtime**

### Development & Production Commands

```powershell
# 1. Install frontend dependencies
npm ci

# 2. Run Rust core unit tests
cargo test -p disk-core

# 3. Start Tauri development app (hot reload)
npm run tauri dev

# 4. Build frontend + workspace check + Clippy
npm run build
cargo check --workspace
cargo clippy --workspace --all-targets

# 5. Build production Windows NSIS installer
npm run tauri build -- --bundles nsis
```

Build outputs:
- Release binary: `target/release/DiskCleanupTool.exe`
- NSIS installer: `target/release/bundle/nsis/DiskCleanupTool_0.2.0_x64-setup.exe`

---

## Automation & Quality Assurance

- **CI ([`ci.yml`](.github/workflows/ci.yml))**: Runs `npm ci`, `npm run build`, `cargo test -p disk-core`, `cargo check --workspace`, and `cargo clippy --workspace --all-targets` on Windows MSVC for every push and PR to `main`.
- **Releases ([`release.yml`](.github/workflows/release.yml))**: Automatically builds the NSIS installer, portable ZIP, and `SHA256SUMS.txt`. Pushing a `v*` tag creates a versioned release; pushes to `main` keep the rolling `latest` release up to date.
- **Audit Bot ([`audit-bot.yml`](.github/workflows/audit-bot.yml))**: Runs weekly and on pushes to `main` to check `cargo audit`, `npm audit`, `cargo clippy`, and Rust code hygiene (`.unwrap()` / `TODO` / `FIXME`), automatically tracking and closing findings in a deduplicated `automated-audit` GitHub Issue.

---

## License

Licensed under the [MIT License](LICENSE).
