mod commands;
mod state;
mod windows_shell;

use state::AppState;
use tauri::{Emitter, Manager};

fn extract_path_from_args(args: &[String]) -> Option<String> {
    args.iter().skip(1).find_map(|arg| {
        let trimmed = arg.trim().trim_matches('"');
        if trimmed.is_empty() || trimmed.starts_with('-') {
            return None;
        }
        let p = std::path::Path::new(trimmed);
        if p.exists() {
            Some(trimmed.to_string())
        } else {
            None
        }
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let initial_path = extract_path_from_args(&args);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
            if let Some(path) = extract_path_from_args(&argv) {
                let _ = app.emit("open-scan-path", path);
            }
        }))
        .manage(AppState::new(initial_path))
        .invoke_handler(tauri::generate_handler![
            commands::get_system_info,
            commands::list_drives,
            commands::start_scan,
            commands::cancel_scan,
            commands::get_scan_summary,
            commands::get_node_children,
            commands::get_node_ancestors,
            commands::get_top_largest_files,
            commands::get_category_breakdown,
            commands::get_junk_targets,
            commands::get_treemap_children,
            commands::preview_delete,
            commands::execute_delete,
            commands::reveal_in_explorer,
            commands::relaunch_as_admin,
            commands::set_context_menu,
            commands::search_global,
            commands::get_expanded_tree,
            commands::find_duplicates,
            commands::cancel_duplicates,
            commands::get_empty_folders,
            commands::get_recycle_bin_info,
            commands::empty_recycle_bin,
            commands::move_items,
            commands::rename_item,
            commands::create_folder,
            commands::open_file,
            commands::open_terminal,
            commands::show_properties,
            commands::export_report,
            commands::save_snapshot,
            commands::compare_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DiskCleanupTool");
}
