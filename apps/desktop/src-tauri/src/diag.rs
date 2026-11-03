//! Local diagnostics log (`%LOCALAPPDATA%\app.typely.desktop\logs\typely.log`). Records
//! outcomes and error messages only, never the user's text. Nothing is sent anywhere.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

/// Keeps the file small: it is rotated once it passes this size.
const MAX_BYTES: u64 = 256 * 1024;

pub fn log(app: &AppHandle, event: &str) {
    let Ok(dir) = app.path().app_log_dir() else {
        return;
    };
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("typely.log");
    if fs::metadata(&path).is_ok_and(|m| m.len() > MAX_BYTES) {
        let _ = fs::rename(&path, dir.join("typely.old.log"));
    }
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{seconds} {event}");
    }
}
