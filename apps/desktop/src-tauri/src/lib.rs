//! Typely desktop: the Tauri shell and trusted executor around the shared TypeScript engine.
//! The webviews run the engine; this process owns settings, API keys, every network call and
//! all interaction with other applications (selection capture, paste).

mod commands;
mod diag;
mod endpoints;
mod languagetool;
mod ollama;
mod panel;
mod platform;
mod secrets;
mod settings;
mod shortcut;
mod transport;

use std::sync::{Arc, Mutex};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

use crate::panel::PanelState;
use crate::secrets::{KeyringStore, SecretStore};
use crate::settings::SettingsStore;
use crate::transport::{HttpExecutor, InFlight};

pub struct AppState {
    pub settings: SettingsStore,
    pub secrets: Box<dyn SecretStore>,
    pub http: HttpExecutor,
    pub inflight: InFlight,
    pub panel: PanelState,
    pub shortcut: Mutex<Option<tauri_plugin_global_shortcut::Shortcut>>,
    /// Why the saved shortcut is not active, if registration failed at startup.
    pub shortcut_error: Mutex<Option<String>>,
    /// The local grammar server, started on demand.
    pub languagetool: Arc<languagetool::LanguageTool>,
}

fn show_main(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Typely", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Typely", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::with_id("typely")
        .tooltip("Typely")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch only brings the running instance forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app)
        }))
        .plugin(shortcut::plugin())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            app.manage(AppState {
                settings: SettingsStore::open(&config_dir),
                secrets: Box::new(KeyringStore),
                http: HttpExecutor::new()?,
                inflight: InFlight::default(),
                panel: PanelState::default(),
                shortcut: Mutex::new(None),
                shortcut_error: Mutex::new(None),
                languagetool: Arc::default(),
            });
            Arc::clone(&app.state::<AppState>().languagetool).watch();
            let handle = app.handle().clone();
            let accelerator = handle.state::<AppState>().settings.get().desktop.shortcut;
            if let Err(error) = shortcut::register(&handle, &accelerator) {
                *handle.state::<AppState>().shortcut_error.lock().unwrap() = Some(error);
            }
            build_tray(&handle)?;
            if !std::env::args().any(|a| a == "--hidden") {
                show_main(&handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing the settings window keeps Typely running in the tray for the shortcut.
            WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
            }
            WindowEvent::Focused(false) if window.label() == panel::PANEL_LABEL => {
                panel::hide(window.app_handle());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings_get,
            commands::settings_save,
            commands::secret_set,
            commands::secret_delete,
            commands::secret_status,
            commands::provider_request,
            commands::provider_stream,
            commands::provider_cancel,
            commands::spell_check,
            ollama::ollama_detect,
            panel::panel_ready,
            panel::panel_hide,
            panel::panel_replace,
            panel::panel_copy,
            commands::languagetool_status,
            commands::languagetool_start,
            commands::languagetool_stop,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Typely")
        .run(|app, event| {
            // The grammar server goes with Typely (the job object also covers a crash).
            if let RunEvent::Exit = event {
                app.state::<AppState>().languagetool.stop();
            }
        });
}
