//! Typely desktop: the Tauri shell and trusted executor around the shared TypeScript engine.
//! The webviews run the engine; this process owns settings, API keys and every network call.

mod commands;
mod endpoints;
mod secrets;
mod settings;
mod transport;

use tauri::Manager;

use crate::secrets::{KeyringStore, SecretStore};
use crate::settings::SettingsStore;
use crate::transport::{HttpExecutor, InFlight};

pub struct AppState {
    pub settings: SettingsStore,
    pub secrets: Box<dyn SecretStore>,
    pub http: HttpExecutor,
    pub inflight: InFlight,
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            app.manage(AppState {
                settings: SettingsStore::open(&config_dir),
                secrets: Box::new(KeyringStore),
                http: HttpExecutor::new()?,
                inflight: InFlight::default(),
            });
            if let Some(main) = app.get_webview_window("main") {
                main.show()?;
            }
            Ok(())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Typely");
}
