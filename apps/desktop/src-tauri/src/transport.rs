//! Rust side of the TypeScript `Transport` interface (see `apps/desktop/src/tauri-transport.ts`).
//! Behaves like `DirectTransport`: requests are relative to an endpoint id, auth is attached
//! here from the credential store, secret headers sent by the webview are dropped, redirects
//! are not followed, and only transport failures are errors (any HTTP status is returned).

use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::endpoints::{AuthScheme, Endpoint, SECRET_HEADER_NAMES, join_endpoint_url};

/// Responses above this size are refused (T6: size limits on provider output).
const MAX_BODY_BYTES: usize = 16 * 1024 * 1024;
const MAX_LINE_BYTES: usize = 1024 * 1024;
/// Headers a caller may not set, besides the secret ones.
const RESERVED_HEADERS: &[&str] = &[
    "host",
    "content-length",
    "content-type",
    "transfer-encoding",
    "connection",
    "cookie",
    "proxy-authorization",
];

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
pub enum HttpMethod {
    #[serde(rename = "GET")]
    Get,
    #[serde(rename = "POST")]
    Post,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Encoding {
    Json,
    Form,
}

/// `ProviderHttpRequest` (camelCase: it is a TypeScript interface, not a wire schema).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HttpRequest {
    pub method: HttpMethod,
    pub path: String,
    #[serde(default)]
    pub body: Option<Value>,
    #[serde(default)]
    pub encoding: Option<Encoding>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<Value>,
}

/// Mirrors the transport-level subset of `ProviderErrorKind`.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    Network,
    Timeout,
    Cancelled,
    NotConfigured,
    BadRequest,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TransportError {
    pub kind: ErrorKind,
    pub message: String,
}

impl TransportError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        TransportError {
            kind,
            message: message.into(),
        }
    }
}

/// One message of a streamed response. `End` is sent last so the webview knows every line
/// arrived before it handles the command's result.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamMessage {
    Line { line: String },
    End,
}

/// Cancellation tokens of running requests, by request id. A cancel that arrives before its
/// request is registered is remembered, so the request starts already cancelled.
#[derive(Default)]
pub struct InFlight(Mutex<HashMap<String, CancellationToken>>);

pub struct InFlightGuard<'a> {
    owner: &'a InFlight,
    id: Option<String>,
    pub token: CancellationToken,
}

impl Drop for InFlightGuard<'_> {
    fn drop(&mut self) {
        if let Some(id) = &self.id {
            self.owner.lock().remove(id);
        }
    }
}

impl InFlight {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, CancellationToken>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn register(&self, id: Option<String>) -> InFlightGuard<'_> {
        let token = match &id {
            Some(id) => self.lock().entry(id.clone()).or_default().clone(),
            None => CancellationToken::new(),
        };
        InFlightGuard {
            owner: self,
            id,
            token,
        }
    }

    pub fn cancel(&self, id: &str) {
        let mut map = self.lock();
        if map.len() > 256 {
            map.retain(|_, t| !t.is_cancelled());
        }
        map.entry(id.to_owned()).or_default().cancel();
    }
}

pub struct HttpExecutor {
    client: reqwest::Client,
    /// Loopback endpoints (Ollama) never go through a system proxy.
    loopback_client: reqwest::Client,
}

impl HttpExecutor {
    pub fn new() -> Result<Self, String> {
        let build = |no_proxy: bool| {
            let builder = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .user_agent(concat!("Typely/", env!("CARGO_PKG_VERSION")));
            let builder = if no_proxy {
                builder.no_proxy()
            } else {
                builder
            };
            builder.build().map_err(|e| e.to_string())
        };
        Ok(HttpExecutor {
            client: build(false)?,
            loopback_client: build(true)?,
        })
    }

    /// Executes `request` against `endpoint`. With `on_line`, a 2xx body is split into lines
    /// passed to the callback and the returned body is `None`.
    #[allow(clippy::too_many_arguments)]
    pub async fn execute(
        &self,
        endpoint_id: &str,
        endpoint: &Endpoint,
        secret: Option<String>,
        request: HttpRequest,
        default_timeout: Duration,
        cancel: &CancellationToken,
        on_line: Option<&(dyn Fn(String) + Send + Sync)>,
    ) -> Result<HttpResponse, TransportError> {
        let url = join_endpoint_url(&endpoint.base_url, &request.path)
            .map_err(|m| TransportError::new(ErrorKind::BadRequest, m))?;

        let mut headers = HeaderMap::new();
        for (name, value) in &request.headers {
            let lower = name.to_ascii_lowercase();
            if SECRET_HEADER_NAMES.contains(&lower.as_str())
                || RESERVED_HEADERS.contains(&lower.as_str())
            {
                continue;
            }
            let name = HeaderName::from_bytes(lower.as_bytes())
                .map_err(|_| TransportError::new(ErrorKind::BadRequest, "Invalid header name"))?;
            let value = HeaderValue::from_str(value)
                .map_err(|_| TransportError::new(ErrorKind::BadRequest, "Invalid header value"))?;
            headers.insert(name, value);
        }
        headers.insert(ACCEPT, HeaderValue::from_static("application/json"));

        let mut form: Option<Vec<(String, String)>> = None;
        let mut body: Option<Vec<u8>> = None;
        if let Some(value) = &request.body {
            if request.encoding == Some(Encoding::Form) {
                form = Some(form_fields(value)?);
            } else {
                body = Some(serde_json::to_vec(value).map_err(|e| {
                    TransportError::new(ErrorKind::BadRequest, format!("Invalid body: {e}"))
                })?);
                headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
            }
        }

        apply_auth(
            endpoint_id,
            endpoint,
            secret.as_deref(),
            &mut headers,
            form.as_mut(),
        )?;
        if let Some(fields) = form {
            let encoded = url::form_urlencoded::Serializer::new(String::new())
                .extend_pairs(fields)
                .finish();
            body = Some(encoded.into_bytes());
            headers.insert(
                CONTENT_TYPE,
                HeaderValue::from_static("application/x-www-form-urlencoded"),
            );
        }

        let client = if endpoint.is_loopback() {
            &self.loopback_client
        } else {
            &self.client
        };
        let method = match request.method {
            HttpMethod::Get => reqwest::Method::GET,
            HttpMethod::Post => reqwest::Method::POST,
        };
        let mut builder = client.request(method, url).headers(headers);
        if let Some(body) = body {
            builder = builder.body(body);
        }
        let timeout = request
            .timeout_ms
            .map(Duration::from_millis)
            .unwrap_or(default_timeout);

        let work = async {
            let response = builder
                .send()
                .await
                .map_err(|e| TransportError::new(ErrorKind::Network, describe(&e)))?;
            let status = response.status();
            let response_headers: BTreeMap<String, String> = response
                .headers()
                .iter()
                .map(|(k, v)| {
                    (
                        k.as_str().to_owned(),
                        String::from_utf8_lossy(v.as_bytes()).into_owned(),
                    )
                })
                .collect();
            let mut stream = response.bytes_stream();
            if let (Some(on_line), true) = (on_line, status.is_success()) {
                let mut buffer: Vec<u8> = Vec::new();
                while let Some(chunk) = stream.next().await {
                    let chunk = chunk.map_err(|e| {
                        TransportError::new(
                            ErrorKind::Network,
                            format!("Failed reading stream: {}", describe(&e)),
                        )
                    })?;
                    buffer.extend_from_slice(&chunk);
                    while let Some(nl) = buffer.iter().position(|b| *b == b'\n') {
                        let line: Vec<u8> = buffer.drain(..=nl).collect();
                        emit_line(&line, on_line);
                    }
                    if buffer.len() > MAX_LINE_BYTES {
                        return Err(TransportError::new(
                            ErrorKind::Network,
                            "Stream line too long",
                        ));
                    }
                }
                emit_line(&buffer, on_line);
                return Ok(HttpResponse {
                    status: status.as_u16(),
                    headers: response_headers,
                    body: None,
                });
            }
            let mut bytes: Vec<u8> = Vec::new();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| {
                    TransportError::new(
                        ErrorKind::Network,
                        format!("Failed reading response: {}", describe(&e)),
                    )
                })?;
                if bytes.len() + chunk.len() > MAX_BODY_BYTES {
                    return Err(TransportError::new(
                        ErrorKind::Network,
                        "Response too large",
                    ));
                }
                bytes.extend_from_slice(&chunk);
            }
            Ok(HttpResponse {
                status: status.as_u16(),
                headers: response_headers,
                body: parse_body(&bytes),
            })
        };

        tokio::select! {
            biased;
            _ = cancel.cancelled() => Err(TransportError::new(ErrorKind::Cancelled, "Request cancelled")),
            result = tokio::time::timeout(timeout, work) => result.unwrap_or_else(|_| {
                Err(TransportError::new(
                    ErrorKind::Timeout,
                    format!("No response within {} ms", timeout.as_millis()),
                ))
            }),
        }
    }
}

fn apply_auth(
    endpoint_id: &str,
    endpoint: &Endpoint,
    secret: Option<&str>,
    headers: &mut HeaderMap,
    form: Option<&mut Vec<(String, String)>>,
) -> Result<(), TransportError> {
    if endpoint.auth == AuthScheme::None {
        return Ok(());
    }
    let Some(secret) = secret.filter(|s| !s.is_empty()) else {
        if endpoint.auth.is_optional() {
            return Ok(());
        }
        return Err(TransportError::new(
            ErrorKind::NotConfigured,
            format!("No API key configured for '{endpoint_id}'"),
        ));
    };
    if endpoint.base_url.scheme() != "https" && !endpoint.is_loopback() {
        return Err(TransportError::new(
            ErrorKind::NotConfigured,
            format!("API keys are only sent over HTTPS ('{endpoint_id}')"),
        ));
    }
    let header = |value: String| {
        let mut v = HeaderValue::from_str(&value)
            .map_err(|_| TransportError::new(ErrorKind::NotConfigured, "Invalid API key"))?;
        v.set_sensitive(true);
        Ok::<_, TransportError>(v)
    };
    match &endpoint.auth {
        AuthScheme::None => {}
        AuthScheme::Bearer { .. } => {
            headers.insert(AUTHORIZATION, header(format!("Bearer {secret}"))?);
        }
        AuthScheme::Header { name, .. } => {
            headers.insert(*name, header(secret.to_owned())?);
        }
        AuthScheme::FormField { name, .. } => {
            // Without a form body there is nowhere safe to put the key; never the URL.
            let Some(form) = form else {
                return Err(TransportError::new(
                    ErrorKind::NotConfigured,
                    "Form-field auth requires a form body",
                ));
            };
            form.retain(|(k, _)| k != name);
            form.push(((*name).to_owned(), secret.to_owned()));
        }
    }
    Ok(())
}

fn form_fields(body: &Value) -> Result<Vec<(String, String)>, TransportError> {
    let Value::Object(map) = body else {
        return Err(TransportError::new(
            ErrorKind::BadRequest,
            "Form body must be an object",
        ));
    };
    let mut fields = Vec::new();
    for (key, value) in map {
        let text = match value {
            Value::Null => continue,
            Value::String(s) => s.clone(),
            Value::Bool(_) | Value::Number(_) => value.to_string(),
            _ => {
                return Err(TransportError::new(
                    ErrorKind::BadRequest,
                    "Form fields must be scalars",
                ));
            }
        };
        fields.push((key.clone(), text));
    }
    Ok(fields)
}

fn emit_line(raw: &[u8], on_line: &(dyn Fn(String) + Send + Sync)) {
    let line = String::from_utf8_lossy(raw);
    let line = line.trim();
    if !line.is_empty() {
        on_line(line.to_owned());
    }
}

fn parse_body(bytes: &[u8]) -> Option<Value> {
    if bytes.is_empty() {
        return None;
    }
    Some(
        serde_json::from_slice(bytes)
            .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(bytes).into_owned())),
    )
}

fn describe(error: &reqwest::Error) -> String {
    let mut message = if error.is_connect() {
        "Network error: connection failed — is the server running?".to_owned()
    } else {
        format!("Network error: {error}")
    };
    let mut source = std::error::Error::source(error);
    while let Some(inner) = source {
        message.push_str(&format!(" ({inner})"));
        source = inner.source();
    }
    message
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::endpoints::AuthScheme;
    use std::sync::{Arc, Mutex as StdMutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use url::Url;

    /// A one-shot HTTP server: records the raw request and answers with `response`.
    async fn serve(response: &'static str, delay: Duration) -> (String, Arc<StdMutex<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Arc::new(StdMutex::new(String::new()));
        let record = seen.clone();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 65536];
            let mut request = Vec::new();
            loop {
                let n = socket.read(&mut buf).await.unwrap();
                request.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&request).to_string();
                if let Some(head_end) = text.find("\r\n\r\n") {
                    let len = text[..head_end]
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length: ")
                                .map(|v| v.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if request.len() >= head_end + 4 + len {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            *record.lock().unwrap() = String::from_utf8_lossy(&request).to_string();
            tokio::time::sleep(delay).await;
            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.shutdown().await;
        });
        (format!("http://{addr}"), seen)
    }

    fn endpoint(base: &str, auth: AuthScheme) -> Endpoint {
        Endpoint {
            base_url: Url::parse(base).unwrap(),
            auth,
        }
    }

    fn post(path: &str, body: Value) -> HttpRequest {
        HttpRequest {
            method: HttpMethod::Post,
            path: path.to_owned(),
            body: Some(body),
            encoding: None,
            headers: BTreeMap::new(),
            timeout_ms: None,
        }
    }

    const OK_JSON: &str = "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 11\r\nconnection: close\r\n\r\n{\"ok\":true}";

    #[tokio::test]
    async fn attaches_auth_and_drops_secret_headers_from_the_caller() {
        let (base, seen) = serve(OK_JSON, Duration::ZERO).await;
        let exec = HttpExecutor::new().unwrap();
        let mut request = post("/v1/messages", serde_json::json!({"a": 1}));
        request
            .headers
            .insert("X-Api-Key".into(), "attacker-chosen".into());
        request
            .headers
            .insert("anthropic-version".into(), "2023-06-01".into());
        let response = exec
            .execute(
                "anthropic",
                &endpoint(
                    &base,
                    AuthScheme::Header {
                        name: "x-api-key",
                        optional: false,
                    },
                ),
                Some("sk-real".into()),
                request,
                Duration::from_secs(5),
                &CancellationToken::new(),
                None,
            )
            .await
            .unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(response.body, Some(serde_json::json!({"ok": true})));
        let raw = seen.lock().unwrap().to_ascii_lowercase();
        assert!(raw.starts_with("post /v1/messages http/1.1"));
        assert!(raw.contains("x-api-key: sk-real"));
        assert!(!raw.contains("attacker-chosen"));
        assert!(raw.contains("anthropic-version: 2023-06-01"));
        assert!(raw.ends_with("{\"a\":1}"));
    }

    #[tokio::test]
    async fn missing_required_key_fails_before_any_network_io() {
        let exec = HttpExecutor::new().unwrap();
        let error = exec
            .execute(
                "openai",
                &endpoint(
                    "https://api.openai.com/v1",
                    AuthScheme::Bearer { optional: false },
                ),
                None,
                post("/chat/completions", serde_json::json!({})),
                Duration::from_secs(5),
                &CancellationToken::new(),
                None,
            )
            .await
            .unwrap_err();
        assert_eq!(error.kind, ErrorKind::NotConfigured);
    }

    #[tokio::test]
    async fn refuses_to_send_a_key_over_plain_http_to_a_remote_host() {
        let exec = HttpExecutor::new().unwrap();
        let error = exec
            .execute(
                "lan",
                &endpoint(
                    "http://192.0.2.10:8080/v1",
                    AuthScheme::Bearer { optional: true },
                ),
                Some("sk".into()),
                post("/chat/completions", serde_json::json!({})),
                Duration::from_secs(5),
                &CancellationToken::new(),
                None,
            )
            .await
            .unwrap_err();
        assert_eq!(error.kind, ErrorKind::NotConfigured);
    }

    #[tokio::test]
    async fn form_auth_goes_into_the_body() {
        let (base, seen) = serve(OK_JSON, Duration::ZERO).await;
        let exec = HttpExecutor::new().unwrap();
        let mut request = post(
            "/v2/check",
            serde_json::json!({"text": "a b", "language": "en", "apiKey": "spoofed"}),
        );
        request.encoding = Some(Encoding::Form);
        exec.execute(
            "languagetool",
            &endpoint(&base, crate::endpoints::LANGUAGETOOL_AUTH),
            Some("lt-key".into()),
            request,
            Duration::from_secs(5),
            &CancellationToken::new(),
            None,
        )
        .await
        .unwrap();
        let raw = seen.lock().unwrap().clone();
        assert!(raw.contains("application/x-www-form-urlencoded"));
        assert!(raw.contains("apiKey=lt-key"));
        assert!(!raw.contains("spoofed"));
        assert!(raw.contains("text=a+b"));
    }

    #[tokio::test]
    async fn streams_lines_and_returns_error_bodies_whole() {
        let ndjson = "HTTP/1.1 200 OK\r\ncontent-type: application/x-ndjson\r\nconnection: close\r\n\r\n{\"d\":\"a\"}\n\n{\"d\":\"b\"}\n{\"done\":true}";
        let (base, _) = serve(ndjson, Duration::ZERO).await;
        let exec = HttpExecutor::new().unwrap();
        let lines = Arc::new(StdMutex::new(Vec::new()));
        let sink = lines.clone();
        let on_line = move |l: String| sink.lock().unwrap().push(l);
        let response = exec
            .execute(
                "ollama",
                &endpoint(&base, AuthScheme::None),
                None,
                post("/api/chat", serde_json::json!({})),
                Duration::from_secs(5),
                &CancellationToken::new(),
                Some(&on_line),
            )
            .await
            .unwrap();
        assert_eq!(response.body, None);
        assert_eq!(
            *lines.lock().unwrap(),
            vec!["{\"d\":\"a\"}", "{\"d\":\"b\"}", "{\"done\":true}"]
        );

        let not_found = "HTTP/1.1 404 Not Found\r\ncontent-type: application/json\r\ncontent-length: 25\r\nconnection: close\r\n\r\n{\"error\":\"model missing\"}";
        let (base, _) = serve(not_found, Duration::ZERO).await;
        let lines = Arc::new(StdMutex::new(Vec::<String>::new()));
        let sink = lines.clone();
        let on_line = move |l: String| sink.lock().unwrap().push(l);
        let response = exec
            .execute(
                "ollama",
                &endpoint(&base, AuthScheme::None),
                None,
                post("/api/chat", serde_json::json!({})),
                Duration::from_secs(5),
                &CancellationToken::new(),
                Some(&on_line),
            )
            .await
            .unwrap();
        assert_eq!(response.status, 404);
        assert_eq!(
            response.body,
            Some(serde_json::json!({"error": "model missing"}))
        );
        assert!(lines.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn redirects_are_not_followed() {
        let redirect = "HTTP/1.1 307 Temporary Redirect\r\nlocation: https://evil.example/\r\ncontent-length: 0\r\nconnection: close\r\n\r\n";
        let (base, _) = serve(redirect, Duration::ZERO).await;
        let exec = HttpExecutor::new().unwrap();
        let response = exec
            .execute(
                "x",
                &endpoint(&base, AuthScheme::None),
                None,
                post("/a", serde_json::json!({})),
                Duration::from_secs(5),
                &CancellationToken::new(),
                None,
            )
            .await
            .unwrap();
        assert_eq!(response.status, 307);
    }

    #[tokio::test]
    async fn timeout_and_cancellation() {
        let exec = HttpExecutor::new().unwrap();
        let (base, _) = serve(OK_JSON, Duration::from_secs(3)).await;
        let mut request = post("/slow", serde_json::json!({}));
        request.timeout_ms = Some(100);
        let error = exec
            .execute(
                "x",
                &endpoint(&base, AuthScheme::None),
                None,
                request,
                Duration::from_secs(5),
                &CancellationToken::new(),
                None,
            )
            .await
            .unwrap_err();
        assert_eq!(error.kind, ErrorKind::Timeout);

        let (base, _) = serve(OK_JSON, Duration::from_secs(3)).await;
        let inflight = InFlight::default();
        // Cancelled before it was registered: starts cancelled.
        inflight.cancel("r1");
        let guard = inflight.register(Some("r1".into()));
        let error = exec
            .execute(
                "x",
                &endpoint(&base, AuthScheme::None),
                None,
                post("/slow", serde_json::json!({})),
                Duration::from_secs(5),
                &guard.token,
                None,
            )
            .await
            .unwrap_err();
        assert_eq!(error.kind, ErrorKind::Cancelled);
        drop(guard);
        assert!(inflight.lock().is_empty());
    }

    #[tokio::test]
    async fn bad_paths_are_rejected() {
        let exec = HttpExecutor::new().unwrap();
        let error = exec
            .execute(
                "x",
                &endpoint("https://api.openai.com/v1", AuthScheme::None),
                None,
                post("//evil.example/x", serde_json::json!({})),
                Duration::from_secs(5),
                &CancellationToken::new(),
                None,
            )
            .await
            .unwrap_err();
        assert_eq!(error.kind, ErrorKind::BadRequest);
    }

    #[test]
    fn request_shape_matches_the_typescript_interface() {
        let parsed: HttpRequest = serde_json::from_str(
            r#"{"method":"POST","path":"/api/chat","body":{"x":1},"headers":{"a":"b"},"timeoutMs":5,"encoding":"json"}"#,
        )
        .unwrap();
        assert_eq!(parsed.timeout_ms, Some(5));
        assert!(serde_json::from_str::<HttpRequest>(r#"{"method":"PUT","path":"/"}"#).is_err());
        assert!(
            serde_json::from_str::<HttpRequest>(r#"{"method":"GET","path":"/","url":"x"}"#)
                .is_err()
        );
    }
}
