//! OS integration: selection capture, replacement, clipboard and screen geometry.

use serde::Serialize;

#[cfg(windows)]
mod win;
#[cfg(windows)]
pub use win::*;

/// A screen rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

/// The window the selection came from. Kept in Rust only; the webview never sees the handle.
#[derive(Debug, Clone)]
pub struct Target {
    pub hwnd: isize,
    pub pid: u32,
    pub process_name: Option<String>,
    /// The control that had keyboard focus, when UI Automation could see it.
    #[cfg(windows)]
    pub element: Option<win::FocusedElement>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CaptureMethod {
    UiAutomation,
    Clipboard,
}

pub struct Capture {
    pub text: String,
    pub target: Target,
    pub anchor: Option<Rect>,
    pub method: CaptureMethod,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureError {
    NoWindow,
    OwnWindow,
    PasswordField,
    ElevatedTarget,
    NoSelection,
    ClipboardUnrestorable,
    Failed(String),
}

impl CaptureError {
    pub fn code(&self) -> &'static str {
        match self {
            CaptureError::NoWindow => "no_window",
            CaptureError::OwnWindow => "own_window",
            CaptureError::PasswordField => "password_field",
            CaptureError::ElevatedTarget => "elevated_target",
            CaptureError::NoSelection => "no_selection",
            CaptureError::ClipboardUnrestorable => "clipboard_unrestorable",
            CaptureError::Failed(_) => "capture_failed",
        }
    }

    pub fn message(&self) -> String {
        match self {
            CaptureError::NoWindow => "No active window.".to_owned(),
            CaptureError::OwnWindow => "Select text in another app first.".to_owned(),
            CaptureError::PasswordField => {
                "This is a password field. Typely never reads password fields.".to_owned()
            }
            CaptureError::ElevatedTarget => {
                "This app runs as administrator, so Windows blocks Typely from reading or pasting text in it. Paste the text below instead.".to_owned()
            }
            CaptureError::NoSelection => {
                "No selected text was found. Select text and press the shortcut again, or paste it below.".to_owned()
            }
            CaptureError::ClipboardUnrestorable => {
                "Typely could not read the selection directly, and reading it through the clipboard would lose what your clipboard holds now. Paste the text below instead.".to_owned()
            }
            CaptureError::Failed(reason) => format!("Could not read the selection: {reason}"),
        }
    }
}

#[cfg(not(windows))]
mod unsupported {
    use super::*;

    pub fn capture_selection() -> Result<Capture, (CaptureError, Option<Target>)> {
        Err((
            CaptureError::Failed("only supported on Windows".into()),
            None,
        ))
    }
    pub fn replace_selection(_: &Target, _: &str) -> Result<(), String> {
        Err("Replace is only supported on Windows".into())
    }
    pub fn copy_text(_: &str) -> Result<(), String> {
        Err("Copy is only supported on Windows".into())
    }
    pub fn monitor_at(_: i32, _: i32) -> (Rect, f64) {
        (
            Rect {
                left: 0,
                top: 0,
                right: 1280,
                bottom: 720,
            },
            1.0,
        )
    }
    pub fn fallback_anchor() -> Rect {
        Rect {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        }
    }
    pub fn total_memory_bytes() -> u64 {
        0
    }
    pub fn activate(_: isize) -> bool {
        false
    }
}
#[cfg(not(windows))]
pub use unsupported::*;
