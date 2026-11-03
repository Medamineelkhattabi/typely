//! Detects a running Ollama on loopback. Only lists models (`/api/tags`, `/api/ps`): this never
//! loads a model. Called when the user opens or refreshes the local-AI settings.

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::State;
use tokio_util::sync::CancellationToken;
use url::Url;

use crate::AppState;
use crate::endpoints::{AuthScheme, Endpoint};
use crate::transport::{HttpMethod, HttpRequest};

pub const OLLAMA_URL: &str = "http://127.0.0.1:11434";

#[derive(Debug, Serialize, PartialEq)]
pub struct OllamaModel {
    pub name: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct OllamaStatus {
    pub base_url: String,
    pub running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub models: Vec<OllamaModel>,
    /// Models currently in memory (normally none, or one in its 5-minute warm window).
    pub loaded: Vec<String>,
    /// Physical memory of this machine, to decide whether the 4B model is offered.
    pub total_memory_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn parse_models(body: &Value) -> Vec<OllamaModel> {
    body.get("models")
        .and_then(Value::as_array)
        .map(|models| {
            models
                .iter()
                .filter_map(|m| {
                    Some(OllamaModel {
                        name: m
                            .get("name")
                            .or_else(|| m.get("model"))?
                            .as_str()?
                            .to_owned(),
                        size_bytes: m.get("size").and_then(Value::as_u64).unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub async fn ollama_detect(state: State<'_, AppState>) -> Result<OllamaStatus, String> {
    let endpoint = Endpoint {
        base_url: Url::parse(OLLAMA_URL).map_err(|e| e.to_string())?,
        auth: AuthScheme::None,
    };
    let get = |path: &str| {
        let request = HttpRequest {
            method: HttpMethod::Get,
            path: path.to_owned(),
            body: None,
            encoding: None,
            headers: Default::default(),
            timeout_ms: Some(2_000),
        };
        let endpoint = endpoint.clone();
        let http = &state.http;
        async move {
            http.execute(
                "ollama-detect",
                &endpoint,
                None,
                request,
                Duration::from_secs(2),
                &CancellationToken::new(),
                None,
            )
            .await
        }
    };
    let mut status = OllamaStatus {
        base_url: OLLAMA_URL.to_owned(),
        running: false,
        version: None,
        models: Vec::new(),
        loaded: Vec::new(),
        total_memory_bytes: crate::platform::total_memory_bytes(),
        error: None,
    };
    match get("/api/version").await {
        Ok(r) if r.status == 200 => {
            status.running = true;
            status.version = r
                .body
                .as_ref()
                .and_then(|b| b.get("version"))
                .and_then(Value::as_str)
                .map(str::to_owned);
        }
        Ok(r) => status.error = Some(format!("Unexpected HTTP {} from {OLLAMA_URL}", r.status)),
        Err(e) => status.error = Some(e.message),
    }
    if status.running {
        if let Ok(r) = get("/api/tags").await
            && let Some(body) = &r.body
        {
            status.models = parse_models(body);
        }
        if let Ok(r) = get("/api/ps").await
            && let Some(body) = &r.body
        {
            status.loaded = parse_models(body).into_iter().map(|m| m.name).collect();
        }
    }
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tags() {
        let body = serde_json::json!({"models": [
            {"name": "gemma3:1b", "model": "gemma3:1b", "size": 815319791u64},
            {"model": "gemma3:4b", "size": 3338801804u64},
            {"size": 1}
        ]});
        assert_eq!(
            parse_models(&body),
            vec![
                OllamaModel {
                    name: "gemma3:1b".into(),
                    size_bytes: 815319791
                },
                OllamaModel {
                    name: "gemma3:4b".into(),
                    size_bytes: 3338801804
                },
            ]
        );
        assert!(parse_models(&serde_json::json!({})).is_empty());
    }
}
