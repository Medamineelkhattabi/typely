//! Typely desktop: the Tauri shell and trusted executor around the shared TypeScript engine.

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(main) = app.get_webview_window("main") {
                main.show()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Typely");
}
