//! The floating panel: shortcut → capture → show near the selection → Replace / Copy.
//! The panel webview only ever receives the captured text, never the window handle.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State};

use crate::AppState;
use crate::platform::{self, CaptureError, CaptureMethod, Rect, Target};

pub const PANEL_LABEL: &str = "panel";
pub const CAPTURE_EVENT: &str = "panel://capture";
pub const HIDDEN_EVENT: &str = "panel://hidden";
/// Logical size from tauri.conf.json.
const PANEL_SIZE: (f64, f64) = (460.0, 420.0);
const GAP: i32 = 8;

#[derive(Debug, Clone, Serialize)]
pub struct CaptureErrorView {
    code: &'static str,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CapturePayload {
    id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<CaptureErrorView>,
    /// Executable name of the source app, for display.
    #[serde(skip_serializing_if = "Option::is_none")]
    source_app: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    method: Option<CaptureMethod>,
    /// Replace is offered only for a captured selection in a window we can paste into.
    can_replace: bool,
}

struct Session {
    payload: CapturePayload,
    target: Option<Target>,
}

#[derive(Default)]
pub struct PanelState {
    busy: AtomicBool,
    next_id: AtomicU64,
    session: Mutex<Option<Session>>,
}

/// Places the panel below the anchor, or above it when there is no room, inside the work area.
pub fn place(anchor: Rect, size: (i32, i32), work: Rect) -> (i32, i32) {
    let (w, h) = size;
    let x = anchor.left.min(work.right - w).max(work.left);
    let below = anchor.bottom + GAP;
    let above = anchor.top - GAP - h;
    let y = if below + h <= work.bottom {
        below.max(work.top)
    } else if above >= work.top {
        above
    } else {
        (work.bottom - h).max(work.top)
    };
    (x, y)
}

fn show_panel(app: &AppHandle, anchor: Option<Rect>) -> tauri::Result<()> {
    let Some(panel) = app.get_webview_window(PANEL_LABEL) else {
        return Ok(());
    };
    let anchor = anchor.unwrap_or_else(platform::fallback_anchor);
    let (work, scale) = platform::monitor_at(anchor.left, anchor.bottom);
    let size = (
        (PANEL_SIZE.0 * scale).round() as i32,
        (PANEL_SIZE.1 * scale).round() as i32,
    );
    let (x, y) = place(anchor, size, work);
    panel.set_position(PhysicalPosition::new(x, y))?;
    panel.show()?;
    // Not `set_focus`: see `platform::activate`. If Windows refuses, the panel is still shown
    // and takes focus on the first click.
    #[cfg(windows)]
    platform::activate(panel.hwnd()?.0 as isize);
    Ok(())
}

/// Global shortcut handler. Captures on a worker thread (UI Automation and the clipboard must
/// not run on the UI thread), then shows the panel. Ignored while a capture is running.
pub fn on_shortcut(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.panel.busy.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let result = platform::capture_selection();
        if let Err((CaptureError::OwnWindow, _)) = result {
            // The shortcut was pressed in Typely itself: nothing to capture.
            state.panel.busy.store(false, Ordering::SeqCst);
            return;
        }
        let id = state.panel.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let (session, anchor) = match result {
            Ok(capture) => (
                Session {
                    payload: CapturePayload {
                        id,
                        text: Some(capture.text),
                        error: None,
                        source_app: capture.target.process_name.clone(),
                        method: Some(capture.method),
                        can_replace: true,
                    },
                    target: Some(capture.target),
                },
                capture.anchor,
            ),
            Err((error, target)) => (
                Session {
                    payload: CapturePayload {
                        id,
                        text: None,
                        error: Some(CaptureErrorView {
                            code: error.code(),
                            message: error.message(),
                        }),
                        source_app: target.as_ref().and_then(|t| t.process_name.clone()),
                        method: None,
                        can_replace: false,
                    },
                    target: None,
                },
                None,
            ),
        };
        let payload = session.payload.clone();
        *state
            .panel
            .session
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(session);
        let _ = show_panel(&app, anchor);
        let _ = app.emit_to(PANEL_LABEL, CAPTURE_EVENT, payload);
        state.panel.busy.store(false, Ordering::SeqCst);
    });
}

/// Hides the panel and tells its webview to cancel any running request.
pub fn hide(app: &AppHandle) {
    if let Some(panel) = app.get_webview_window(PANEL_LABEL)
        && panel.is_visible().unwrap_or(false)
    {
        let _ = panel.hide();
        let _ = app.emit_to(PANEL_LABEL, HIDDEN_EVENT, ());
    }
}

/// Called by the panel webview when it loads: the capture it may have missed.
#[tauri::command]
pub fn panel_ready(state: State<'_, AppState>) -> Option<CapturePayload> {
    state
        .panel
        .session
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|s| s.payload.clone())
}

#[tauri::command]
pub fn panel_hide(app: AppHandle) {
    hide(&app);
}

/// Pastes `text` over the selection of capture `capture_id`, in the window it came from.
#[tauri::command]
pub async fn panel_replace(
    app: AppHandle,
    state: State<'_, AppState>,
    capture_id: u64,
    text: String,
) -> Result<(), String> {
    let target = {
        let session = state
            .panel
            .session
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        match session.as_ref() {
            Some(s) if s.payload.id == capture_id && s.payload.can_replace => s.target.clone(),
            _ => None,
        }
    }
    .ok_or_else(|| "This selection can no longer be replaced. Use Copy instead.".to_owned())?;
    hide(&app);
    let result =
        tauri::async_runtime::spawn_blocking(move || platform::replace_selection(&target, &text))
            .await
            .map_err(|e| e.to_string())?;
    if result.is_err()
        && let Some(panel) = app.get_webview_window(PANEL_LABEL)
    {
        // Bring the panel back so the error (and Copy) are visible.
        let _ = panel.show();
        #[cfg(windows)]
        if let Ok(hwnd) = panel.hwnd() {
            platform::activate(hwnd.0 as isize);
        }
    }
    result
}

#[tauri::command]
pub async fn panel_copy(text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || platform::copy_text(&text))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORK: Rect = Rect {
        left: 0,
        top: 0,
        right: 1920,
        bottom: 1040,
    };

    fn at(left: i32, top: i32, right: i32, bottom: i32) -> Rect {
        Rect {
            left,
            top,
            right,
            bottom,
        }
    }

    #[test]
    fn below_the_selection_when_there_is_room() {
        assert_eq!(place(at(100, 200, 300, 220), (460, 420), WORK), (100, 228));
    }

    #[test]
    fn above_when_near_the_bottom_and_clamped_horizontally() {
        assert_eq!(
            place(at(1800, 900, 1850, 920), (460, 420), WORK),
            (1460, 472)
        );
    }

    #[test]
    fn inside_the_work_area_when_neither_fits() {
        assert_eq!(place(at(10, 100, 900, 1000), (460, 420), WORK), (10, 620));
        let second_monitor = at(1920, 0, 3840, 1040);
        assert_eq!(
            place(at(1000, 10, 1010, 20), (460, 420), second_monitor),
            (1920, 28)
        );
    }
}
