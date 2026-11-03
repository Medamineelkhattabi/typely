fn main() {
    // App commands are not callable from a window unless its capability grants them.
    let commands = &[
        "settings_get",
        "settings_save",
        "secret_set",
        "secret_delete",
        "secret_status",
        "provider_request",
        "provider_stream",
        "provider_cancel",
        "ollama_detect",
        "panel_ready",
        "panel_hide",
        "panel_replace",
        "panel_copy",
        "spell_check",
    ];
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(commands)),
    )
    .expect("failed to run tauri-build");
}
