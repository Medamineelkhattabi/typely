//! The configurable global shortcut that opens the panel on the current selection.

use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::AppState;

pub fn plugin() -> tauri::plugin::TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                crate::panel::on_shortcut(app);
            }
        })
        .build()
}

/// Parses an accelerator such as `Ctrl+Shift+Space`. A modifier other than Shift is required,
/// or the shortcut would swallow ordinary typing.
pub fn parse(accelerator: &str) -> Result<Shortcut, String> {
    let shortcut: Shortcut = accelerator
        .parse()
        .map_err(|e| format!("'{accelerator}' is not a valid shortcut ({e})"))?;
    if !shortcut
        .mods
        .intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER)
    {
        return Err(format!(
            "'{accelerator}' needs Ctrl, Alt or Win, or it would capture normal typing"
        ));
    }
    Ok(shortcut)
}

/// Registers `accelerator`, then releases the previous shortcut. If the new one is taken by
/// another app, the previous one stays active and an error is returned.
pub fn register(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    let shortcut = parse(accelerator)?;
    let state = app.state::<AppState>();
    let mut current = state.shortcut.lock().unwrap_or_else(|e| e.into_inner());
    if *current == Some(shortcut) {
        return Ok(());
    }
    app.global_shortcut()
        .register(shortcut)
        .map_err(|e| format!("Cannot use {accelerator}: another app may already use it ({e})"))?;
    if let Some(previous) = current.take() {
        let _ = app.global_shortcut().unregister(previous);
    }
    *current = Some(shortcut);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_requires_a_real_modifier() {
        assert!(parse("Ctrl+Shift+Space").is_ok());
        assert!(parse("Alt+K").is_ok());
        assert!(parse("Shift+A").is_err());
        assert!(parse("Space").is_err());
        assert!(parse("Ctrl+Nope").is_err());
    }
}
