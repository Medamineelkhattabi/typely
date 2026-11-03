//! Windows selection capture and replacement (ADR-010).

mod clipboard;
mod input;
mod spell;
mod uia;
mod window;

use std::thread::sleep;
use std::time::{Duration, Instant};

use super::{Capture, CaptureError, CaptureMethod, Rect, Target};

pub use spell::spell_check;
pub use uia::FocusedElement;
pub use window::{activate, cursor_pos, monitor_at, total_memory_bytes};

/// How long the source app gets to answer a simulated Ctrl+C.
const COPY_WAIT: Duration = Duration::from_millis(600);
/// How long the target app gets to read the clipboard after Ctrl+V before it is restored.
const PASTE_SETTLE: Duration = Duration::from_millis(500);

/// Captures the selection of the foreground window: UI Automation first, then a simulated
/// Ctrl+C with the clipboard saved and restored. Password fields are never captured.
pub fn capture_selection() -> Result<Capture, (CaptureError, Option<Target>)> {
    let Some((hwnd, pid)) = window::foreground() else {
        return Err((CaptureError::NoWindow, None));
    };
    if pid == window::own_pid() {
        return Err((CaptureError::OwnWindow, None));
    }
    let mut target = Target {
        hwnd: hwnd.0 as isize,
        pid,
        process_name: window::process_name(pid),
        element: None,
    };
    if window::is_elevated(pid) && !window::self_elevated() {
        return Err((CaptureError::ElevatedTarget, Some(target)));
    }

    let hint = match uia::focused_selection() {
        uia::Outcome::Password => return Err((CaptureError::PasswordField, Some(target))),
        uia::Outcome::Selection {
            text,
            rect,
            element,
        } => {
            target.element = Some(element);
            return Ok(Capture {
                text,
                anchor: rect.or_else(|| window::caret_rect(&target)),
                target,
                method: CaptureMethod::UiAutomation,
            });
        }
        uia::Outcome::Nothing { rect, element } => {
            target.element = element;
            rect
        }
    };

    match copy_selection() {
        Ok(Some(text)) => Ok(Capture {
            text,
            anchor: window::caret_rect(&target).or(hint),
            target,
            method: CaptureMethod::Clipboard,
        }),
        Ok(None) => Err((CaptureError::NoSelection, Some(target))),
        Err(error) => Err((error, Some(target))),
    }
}

/// Simulated Ctrl+C. The user's clipboard is restored afterwards in every case.
fn copy_selection() -> Result<Option<String>, CaptureError> {
    input::wait_for_modifiers_release(Duration::from_secs(1));
    let owner = clipboard::Owner::new().map_err(CaptureError::Failed)?;
    let saved = clipboard::snapshot(&owner).map_err(CaptureError::Failed)?;
    if saved.unrestorable {
        return Err(CaptureError::ClipboardUnrestorable);
    }
    let before = clipboard::sequence_number();
    input::send_ctrl_chord(b'c').map_err(CaptureError::Failed)?;
    let start = Instant::now();
    while clipboard::sequence_number() == before {
        if start.elapsed() > COPY_WAIT {
            // Nothing was copied (no selection, or the app ignores Ctrl+C): clipboard untouched.
            return Ok(None);
        }
        sleep(Duration::from_millis(10));
    }
    // Some apps put several formats on the clipboard one after the other.
    sleep(Duration::from_millis(40));
    let text = clipboard::get_text(&owner);
    let restored = clipboard::restore(&owner, saved);
    let text = text.map_err(CaptureError::Failed)?;
    restored.map_err(CaptureError::Failed)?;
    Ok(text.filter(|t| !t.trim().is_empty()))
}

/// Pastes `text` over the selection in the recorded window, then restores the clipboard.
pub fn replace_selection(target: &Target, text: &str) -> Result<(), String> {
    window::focus(target)?;
    if let Some(element) = &target.element {
        uia::restore_focus(element)?;
    }
    input::wait_for_modifiers_release(Duration::from_millis(800));
    let owner = clipboard::Owner::new()?;
    let saved = clipboard::snapshot(&owner)?;
    if saved.unrestorable {
        return Err(
            "Your clipboard holds content Typely cannot restore. Use Copy and paste it yourself."
                .to_owned(),
        );
    }
    clipboard::set_text(&owner, text, true)?;
    let ours = clipboard::sequence_number();
    // Focus may have moved while the clipboard was prepared.
    if window::foreground().map(|(hwnd, _)| hwnd) != Some(window::hwnd_of(target)) {
        clipboard::restore(&owner, saved)?;
        return Err("The original window lost focus; nothing was pasted".to_owned());
    }
    let pasted = input::send_ctrl_chord(b'v');
    sleep(PASTE_SETTLE);
    // If something else wrote to the clipboard meanwhile, leave that content alone.
    if clipboard::sequence_number() == ours {
        clipboard::restore(&owner, saved)?;
    }
    pasted
}

/// Copy button: a normal clipboard write the user asked for (kept in history).
pub fn copy_text(text: &str) -> Result<(), String> {
    let owner = clipboard::Owner::new()?;
    clipboard::set_text(&owner, text, false)
}

pub fn fallback_anchor() -> Rect {
    let (x, y) = cursor_pos();
    Rect {
        left: x,
        top: y,
        right: x,
        bottom: y,
    }
}
