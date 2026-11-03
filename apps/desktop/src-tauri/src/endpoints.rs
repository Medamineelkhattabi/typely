//! Endpoint table of the trusted executor. Mirrors `AUTH_SCHEMES`, `DEFAULT_BASE_URLS` and
//! `joinEndpointUrl` in `packages/provider-adapters/src/endpoints.ts`; the contract test in
//! `tests/contract.rs` pins both sides to `tests/fixtures/endpoints-contract.json`.

use std::collections::HashMap;

use serde::Serialize;
use url::Url;

use crate::settings::{EngineSettings, ProviderKind};

/// Endpoint id of the LanguageTool server (same constant as the engine).
pub const LANGUAGETOOL_ENDPOINT_ID: &str = "languagetool";

/// Header names only a transport may set.
pub const SECRET_HEADER_NAMES: &[&str] =
    &["authorization", "x-api-key", "x-goog-api-key", "api-key"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AuthScheme {
    None,
    Bearer { optional: bool },
    Header { name: &'static str, optional: bool },
    FormField { name: &'static str, optional: bool },
}

impl AuthScheme {
    pub fn is_optional(&self) -> bool {
        match self {
            AuthScheme::None => true,
            AuthScheme::Bearer { optional }
            | AuthScheme::Header { optional, .. }
            | AuthScheme::FormField { optional, .. } => *optional,
        }
    }
}

pub fn auth_scheme(kind: ProviderKind) -> AuthScheme {
    match kind {
        ProviderKind::Openai => AuthScheme::Bearer { optional: false },
        ProviderKind::OpenaiCompatible => AuthScheme::Bearer { optional: true },
        ProviderKind::Anthropic => AuthScheme::Header {
            name: "x-api-key",
            optional: false,
        },
        // A header rather than `?key=`, so keys never appear in URLs or logs.
        ProviderKind::Gemini => AuthScheme::Header {
            name: "x-goog-api-key",
            optional: false,
        },
        ProviderKind::Ollama => AuthScheme::None,
    }
}

pub const LANGUAGETOOL_AUTH: AuthScheme = AuthScheme::FormField {
    name: "apiKey",
    optional: true,
};

pub fn default_base_url(kind: ProviderKind) -> Option<&'static str> {
    match kind {
        ProviderKind::Openai => Some("https://api.openai.com/v1"),
        ProviderKind::OpenaiCompatible => None,
        ProviderKind::Anthropic => Some("https://api.anthropic.com"),
        ProviderKind::Gemini => Some("https://generativelanguage.googleapis.com/v1beta"),
        ProviderKind::Ollama => Some("http://localhost:11434"),
    }
}

#[derive(Debug, Clone)]
pub struct Endpoint {
    pub base_url: Url,
    pub auth: AuthScheme,
}

impl Endpoint {
    /// Origin a stored secret is bound to (`scheme://host:port`).
    pub fn origin(&self) -> String {
        self.base_url.origin().ascii_serialization()
    }

    pub fn is_loopback(&self) -> bool {
        is_loopback_url(&self.base_url)
    }
}

/// Endpoint table derived from the settings the Rust side persisted itself. The webview only
/// ever names an endpoint id; it can never choose the host a secret is sent to.
pub fn endpoints_from_settings(settings: &EngineSettings) -> HashMap<String, Endpoint> {
    let mut endpoints = HashMap::new();
    for provider in &settings.providers {
        let base = provider
            .base_url
            .as_deref()
            .or_else(|| default_base_url(provider.kind));
        if let Some(base_url) = base.and_then(|b| Url::parse(b).ok()) {
            endpoints.insert(
                provider.id.clone(),
                Endpoint {
                    base_url,
                    auth: auth_scheme(provider.kind),
                },
            );
        }
    }
    if let Some(lt) = &settings.languagetool
        && let Ok(base_url) = Url::parse(&lt.base_url)
    {
        endpoints.insert(
            LANGUAGETOOL_ENDPOINT_ID.to_owned(),
            Endpoint {
                base_url,
                auth: LANGUAGETOOL_AUTH,
            },
        );
    }
    endpoints
}

pub fn is_loopback_url(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(d)) => {
            let d = d.to_ascii_lowercase();
            d == "localhost" || d.ends_with(".localhost")
        }
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    }
}

/// Joins a base URL and a relative path, refusing anything that could change the origin or
/// escape the base path. This is what keeps a secret bound to its configured host.
pub fn join_endpoint_url(base: &Url, path: &str) -> Result<Url, String> {
    if !path.starts_with('/') || path.starts_with("//") || path.contains('\\') {
        return Err(format!("Invalid endpoint path '{path}'"));
    }
    let base_path = base.path().trim_end_matches('/');
    let origin = base.origin().ascii_serialization();
    let joined = Url::parse(&format!("{origin}{base_path}{path}"))
        .map_err(|e| format!("Invalid endpoint path '{path}': {e}"))?;
    if joined.origin() != base.origin() || !joined.path().starts_with(&format!("{base_path}/")) {
        return Err(format!("Endpoint path '{path}' escapes base URL"));
    }
    Ok(joined)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn joins_relative_paths() {
        let base = url("https://api.openai.com/v1");
        assert_eq!(
            join_endpoint_url(&base, "/chat/completions")
                .unwrap()
                .as_str(),
            "https://api.openai.com/v1/chat/completions"
        );
        let base = url("http://localhost:11434/");
        assert_eq!(
            join_endpoint_url(&base, "/api/tags?x=1").unwrap().as_str(),
            "http://localhost:11434/api/tags?x=1"
        );
    }

    #[test]
    fn refuses_paths_that_change_the_host_or_escape_the_base() {
        let base = url("https://api.openai.com/v1");
        for path in [
            "chat",
            "//evil.example/x",
            "/\\evil.example",
            "/../x",
            "/%2e%2e/x",
            "/./../x",
        ] {
            assert!(join_endpoint_url(&base, path).is_err(), "accepted {path}");
        }
        // An '@' in the path stays in the path.
        let joined = join_endpoint_url(&base, "/@evil.example").unwrap();
        assert_eq!(joined.host_str(), Some("api.openai.com"));
    }

    #[test]
    fn detects_loopback_hosts() {
        for u in [
            "http://localhost:1",
            "http://LOCALHOST",
            "http://a.localhost",
            "http://127.0.0.1",
            "http://127.4.5.6",
            "http://[::1]:8080",
        ] {
            assert!(is_loopback_url(&url(u)), "{u}");
        }
        for u in [
            "http://localhost.evil.example",
            "http://10.0.0.1",
            "https://api.openai.com",
        ] {
            assert!(!is_loopback_url(&url(u)), "{u}");
        }
    }

    /// Pins this table to `AUTH_SCHEMES` / `DEFAULT_BASE_URLS` in provider-adapters; the
    /// TypeScript side checks the same fixture (`apps/desktop/test/contract.test.ts`).
    #[test]
    fn matches_the_shared_contract_fixture() {
        use serde_json::{Value, json};
        let fixture: Value =
            serde_json::from_str(include_str!("../tests/fixtures/endpoints-contract.json"))
                .unwrap();
        let kinds = [
            ("openai", ProviderKind::Openai),
            ("openai_compatible", ProviderKind::OpenaiCompatible),
            ("anthropic", ProviderKind::Anthropic),
            ("gemini", ProviderKind::Gemini),
            ("ollama", ProviderKind::Ollama),
        ];
        let mut auth = serde_json::Map::new();
        let mut urls = serde_json::Map::new();
        for (name, kind) in kinds {
            auth.insert(
                name.into(),
                serde_json::to_value(auth_scheme(kind)).unwrap(),
            );
            urls.insert(name.into(), json!(default_base_url(kind)));
        }
        assert_eq!(fixture["auth_schemes"], Value::Object(auth));
        assert_eq!(fixture["default_base_urls"], Value::Object(urls));
        assert_eq!(
            fixture["languagetool_auth"],
            serde_json::to_value(LANGUAGETOOL_AUTH).unwrap()
        );
        assert_eq!(fixture["secret_header_names"], json!(SECRET_HEADER_NAMES));
    }
}
