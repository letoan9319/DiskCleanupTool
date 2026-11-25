use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex, RwLock};

use disk_core::arena::ScanArena;
use disk_core::model::ScanSummary;

pub struct AppState {
    pub arena: Arc<RwLock<Option<ScanArena>>>,
    pub summary: Arc<RwLock<Option<ScanSummary>>>,
    pub cancel_flag: Mutex<Option<Arc<AtomicBool>>>,
    pub dup_cancel_flag: Mutex<Option<Arc<AtomicBool>>>,
    pub active_scan_id: AtomicU64,
    pub initial_path: Mutex<Option<String>>,
}

impl AppState {
    pub fn new(initial_path: Option<String>) -> Self {
        Self {
            arena: Arc::new(RwLock::new(None)),
            summary: Arc::new(RwLock::new(None)),
            cancel_flag: Mutex::new(None),
            dup_cancel_flag: Mutex::new(None),
            active_scan_id: AtomicU64::new(0),
            initial_path: Mutex::new(initial_path),
        }
    }
}
