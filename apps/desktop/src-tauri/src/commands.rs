//! Commands for settings, secrets and provider requests. Which window may call which command
//! is decided by `capabilities/*.json`.

use std::collections::BTreeMap;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, State};

use crate::AppState;
use crate::endpoints::{Endpoint, endpoints_from_settings};
use crate::secrets::{SecretState, StoredSecret, secret_for, state_for};
use crate::settings::AppSettings;
use crate::transport::{ErrorKind, HttpRequest, HttpResponse, StreamMessage, TransportError};

pub const SETTINGS_CHANGED_EVENT: &str = "settings://changed";

#[derive(Serialize)]
pub struct SettingsView {
    settings: AppSettings,
    #[serde(skip_serializing_if = "Option::is_none")]
    warning: Option<String>,
    /// Set when the saved shortcut could not be registered at startup.
    #[serde(skip_serializing_if = "Option::is_none")]
    shortcut_error: Option<String>,
}

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> SettingsView {
    SettingsView {
        settings: state.settings.get(),
        warning: state.settings.load_warning().map(str::to_owned),
        shortcut_error: state
            .shortcut_error
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone(),
    }
}

#[tauri::command]
pub fn settings_save(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    settings.validate()?;
    if state.settings.get().desktop.shortcut != settings.desktop.shortcut {
        // Register the new shortcut first: if another app owns it, nothing is saved.
        crate::shortcut::register(&app, &settings.desktop.shortcut)?;
    }
    *state
        .shortcut_error
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = None;
    let saved = state.settings.save(settings)?;
    let _ = app.emit(SETTINGS_CHANGED_EVENT, &saved);
    Ok(saved)
}

fn endpoint(state: &AppState, endpoint_id: &str) -> Result<Endpoint, TransportError> {
    endpoints_from_settings(&state.settings.get().engine)
        .remove(endpoint_id)
        .ok_or_else(|| {
            TransportError::new(
                ErrorKind::NotConfigured,
                format!("Unknown endpoint '{endpoint_id}'"),
            )
        })
}

/// Stores an API key for an endpoint, bound to the endpoint's current origin. Write-only: no
/// command ever returns a key.
#[tauri::command]
pub fn secret_set(
    state: State<'_, AppState>,
    endpoint_id: String,
    secret: String,
) -> Result<(), String> {
    let endpoint = endpoint(&state, &endpoint_id).map_err(|e| e.message)?;
    let secret = secret.trim().to_owned();
    if secret.is_empty() || secret.len() > 4096 || secret.chars().any(char::is_control) {
        return Err("Invalid API key".to_owned());
    }
    state.secrets.set(
        &endpoint_id,
        &StoredSecret {
            origin: endpoint.origin(),
            secret,
        },
    )
}

#[tauri::command]
pub fn secret_delete(state: State<'_, AppState>, endpoint_id: String) -> Result<(), String> {
    state.secrets.delete(&endpoint_id)
}

/// Key state of every configured endpoint that uses auth.
#[tauri::command]
pub fn secret_status(state: State<'_, AppState>) -> Result<BTreeMap<String, SecretState>, String> {
    let mut status = BTreeMap::new();
    for (id, endpoint) in endpoints_from_settings(&state.settings.get().engine) {
        if endpoint.auth == crate::endpoints::AuthScheme::None {
            continue;
        }
        let stored = state.secrets.get(&id)?;
        status.insert(id, state_for(stored.as_ref(), &endpoint.origin()));
    }
    Ok(status)
}

async fn run_request(
    state: &AppState,
    endpoint_id: &str,
    request: HttpRequest,
    request_id: Option<String>,
    on_line: Option<&(dyn Fn(String) + Send + Sync)>,
) -> Result<HttpResponse, TransportError> {
    let endpoint = endpoint(state, endpoint_id)?;
    let secret = if endpoint.auth == crate::endpoints::AuthScheme::None {
        None
    } else {
        let stored = state
            .secrets
            .get(endpoint_id)
            .map_err(|m| TransportError::new(ErrorKind::NotConfigured, m))?;
        secret_for(stored, &endpoint.origin())
    };
    let timeout = Duration::from_millis(state.settings.get().engine.limits.request_timeout_ms);
    let guard = state.inflight.register(request_id);
    state
        .http
        .execute(
            endpoint_id,
            &endpoint,
            secret,
            request,
            timeout,
            &guard.token,
            on_line,
        )
        .await
}

#[tauri::command]
pub async fn provider_request(
    state: State<'_, AppState>,
    endpoint_id: String,
    request: HttpRequest,
    request_id: Option<String>,
) -> Result<HttpResponse, TransportError> {
    run_request(&state, &endpoint_id, request, request_id, None).await
}

/// Streams a 2xx body line by line (Ollama NDJSON) through `on_line`, then sends `End`.
#[tauri::command]
pub async fn provider_stream(
    state: State<'_, AppState>,
    endpoint_id: String,
    request: HttpRequest,
    request_id: Option<String>,
    on_line: Channel<StreamMessage>,
) -> Result<HttpResponse, TransportError> {
    let sink = on_line.clone();
    let forward = move |line: String| {
        let _ = sink.send(StreamMessage::Line { line });
    };
    let result = run_request(&state, &endpoint_id, request, request_id, Some(&forward)).await;
    let _ = on_line.send(StreamMessage::End);
    result
}

#[tauri::command]
pub fn provider_cancel(state: State<'_, AppState>, request_id: String) {
    state.inflight.cancel(&request_id);
}
