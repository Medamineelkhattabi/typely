//! Settings persistence. The structs mirror `EngineSettingsSchema` in `packages/schemas`
//! (snake_case, unknown keys rejected) plus the desktop-only section defined in
//! `apps/desktop/src/settings.ts`. Both sides parse `tests/fixtures/settings.json`.

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use url::Url;

pub const SETTINGS_VERSION: u32 = 1;
const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    Openai,
    OpenaiCompatible,
    Anthropic,
    Gemini,
    Ollama,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    Fix,
    Rewrite,
    Professional,
    Concise,
    Friendly,
    Clarity,
    Translate,
    Prompt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum CorrectionMode {
    Local,
    Ai,
    #[default]
    Hybrid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JsonMode {
    JsonSchema,
    JsonObject,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptProfile {
    Full,
    Compact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputFormat {
    Json,
    Text,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderConfig {
    pub id: String,
    pub kind: ProviderKind,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    pub model: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub consent_granted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub json_mode: Option<JsonMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep_alive_seconds: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_profile: Option<PromptProfile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_format: Option<OutputFormat>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LanguageToolConfig {
    #[serde(default)]
    pub enabled: bool,
    pub base_url: String,
    #[serde(default)]
    pub consent_granted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct PrivacySettings {
    #[serde(default)]
    pub cloud_processing_allowed: bool,
    #[serde(default)]
    pub store_history: bool,
    #[serde(default)]
    pub blocked_sites: Vec<String>,
    #[serde(default)]
    pub allowed_sites: Vec<String>,
    #[serde(default)]
    pub disabled_apps: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Limits {
    #[serde(default = "Limits::max_input_chars")]
    pub max_input_chars: u64,
    #[serde(default = "Limits::request_timeout_ms")]
    pub request_timeout_ms: u64,
    #[serde(default = "Limits::max_retries")]
    pub max_retries: u64,
}

impl Limits {
    fn max_input_chars() -> u64 {
        20_000
    }
    fn request_timeout_ms() -> u64 {
        45_000
    }
    fn max_retries() -> u64 {
        1
    }
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            max_input_chars: Self::max_input_chars(),
            request_timeout_ms: Self::request_timeout_ms(),
            max_retries: Self::max_retries(),
        }
    }
}

fn auto() -> String {
    "auto".to_owned()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EngineSettings {
    #[serde(default)]
    pub default_mode: CorrectionMode,
    #[serde(default = "auto")]
    pub preferred_language: String,
    #[serde(default)]
    pub providers: Vec<ProviderConfig>,
    #[serde(default)]
    pub provider_order: Vec<String>,
    #[serde(default)]
    pub operation_providers: BTreeMap<Operation, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub languagetool: Option<LanguageToolConfig>,
    #[serde(default)]
    pub disabled_rules: Vec<String>,
    #[serde(default)]
    pub privacy: PrivacySettings,
    #[serde(default)]
    pub limits: Limits,
}

impl Default for EngineSettings {
    fn default() -> Self {
        EngineSettings {
            default_mode: CorrectionMode::Hybrid,
            preferred_language: auto(),
            providers: Vec::new(),
            provider_order: Vec::new(),
            operation_providers: BTreeMap::new(),
            languagetool: None,
            disabled_rules: Vec::new(),
            privacy: PrivacySettings::default(),
            limits: Limits::default(),
        }
    }
}

pub const DEFAULT_SHORTCUT: &str = "Ctrl+Shift+Space";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DesktopSettings {
    #[serde(default = "DesktopSettings::shortcut")]
    pub shortcut: String,
    #[serde(default = "DesktopSettings::default_operation")]
    pub default_operation: Operation,
    #[serde(default = "DesktopSettings::translate_target")]
    pub translate_target: String,
}

impl DesktopSettings {
    fn shortcut() -> String {
        DEFAULT_SHORTCUT.to_owned()
    }
    fn default_operation() -> Operation {
        Operation::Fix
    }
    fn translate_target() -> String {
        "en".to_owned()
    }
}

impl Default for DesktopSettings {
    fn default() -> Self {
        DesktopSettings {
            shortcut: Self::shortcut(),
            default_operation: Self::default_operation(),
            translate_target: Self::translate_target(),
        }
    }
}

fn settings_version() -> u32 {
    SETTINGS_VERSION
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppSettings {
    #[serde(default = "settings_version")]
    pub version: u32,
    #[serde(default)]
    pub engine: EngineSettings,
    #[serde(default)]
    pub desktop: DesktopSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            version: SETTINGS_VERSION,
            engine: EngineSettings::default(),
            desktop: DesktopSettings::default(),
        }
    }
}

fn is_valid_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 64
        && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-' || *b == b'_')
}

/// Same shape as `LanguageCodeSchema`: `fr`, `en-GB`, `ary` or `und`.
pub fn is_language_code(code: &str) -> bool {
    let (lang, region) = match code.split_once('-') {
        Some((l, r)) => (l, Some(r)),
        None => (code, None),
    };
    let lang_ok = (2..=3).contains(&lang.len()) && lang.bytes().all(|b| b.is_ascii_lowercase());
    let region_ok =
        region.is_none_or(|r| r.len() == 2 && r.bytes().all(|b| b.is_ascii_uppercase()));
    code == "und" || (lang_ok && region_ok)
}

fn check_http_url(url: &str, what: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|e| format!("{what}: invalid URL ({e})"))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host().is_none() {
        return Err(format!("{what}: only http(s) URLs are allowed"));
    }
    Ok(())
}

impl AppSettings {
    /// The checks of `EngineSettingsSchema` (plus the desktop section). Settings are validated
    /// again here because the webview is not trusted to have done it.
    pub fn validate(&self) -> Result<(), String> {
        if self.version != SETTINGS_VERSION {
            return Err(format!("Unsupported settings version {}", self.version));
        }
        let e = &self.engine;
        if e.preferred_language != "auto" && !is_language_code(&e.preferred_language) {
            return Err(format!(
                "Invalid preferred language '{}'",
                e.preferred_language
            ));
        }
        let mut ids = HashSet::new();
        for p in &e.providers {
            if !is_valid_id(&p.id) {
                return Err(format!("Invalid provider id '{}'", p.id));
            }
            if !ids.insert(p.id.as_str()) {
                return Err(format!("Duplicate provider id '{}'", p.id));
            }
            if p.label.is_empty() || p.label.chars().count() > 80 {
                return Err(format!(
                    "Provider '{}': label must be 1–80 characters",
                    p.id
                ));
            }
            if p.model.is_empty() {
                return Err(format!("Provider '{}': model is required", p.id));
            }
            match &p.base_url {
                Some(url) => check_http_url(url, &format!("Provider '{}'", p.id))?,
                None if p.kind == ProviderKind::OpenaiCompatible => {
                    return Err(format!(
                        "Provider '{}' (openai_compatible) requires base_url",
                        p.id
                    ));
                }
                None => {}
            }
            if p.temperature.is_some_and(|t| !(0.0..=2.0).contains(&t)) {
                return Err(format!("Provider '{}': temperature must be 0–2", p.id));
            }
            if p.max_output_tokens == Some(0) || p.timeout_ms == Some(0) {
                return Err(format!(
                    "Provider '{}': limits must be positive integers",
                    p.id
                ));
            }
            if p.keep_alive_seconds.is_some_and(|k| k > 86_400) {
                return Err(format!(
                    "Provider '{}': keep_alive_seconds must be at most 86400",
                    p.id
                ));
            }
        }
        for id in e
            .provider_order
            .iter()
            .chain(e.operation_providers.values())
        {
            if !ids.contains(id.as_str()) {
                return Err(format!("Unknown provider id '{id}'"));
            }
        }
        if let Some(lt) = &e.languagetool {
            check_http_url(&lt.base_url, "LanguageTool")?;
        }
        if e.limits.max_input_chars == 0 || e.limits.request_timeout_ms == 0 {
            return Err("Limits must be positive integers".to_owned());
        }
        if e.limits.max_retries > 5 {
            return Err("max_retries must be 0–5".to_owned());
        }
        let d = &self.desktop;
        if d.shortcut.trim().is_empty() || d.shortcut.len() > 64 {
            return Err("Invalid shortcut".to_owned());
        }
        if !is_language_code(&d.translate_target) || d.translate_target == "und" {
            return Err(format!(
                "Invalid translation target '{}'",
                d.translate_target
            ));
        }
        Ok(())
    }

    pub fn from_json(json: &str) -> Result<Self, String> {
        let settings: AppSettings =
            serde_json::from_str(json).map_err(|e| format!("Invalid settings: {e}"))?;
        settings.validate()?;
        Ok(settings)
    }
}

/// Settings file in the app config directory, written atomically (temp file + rename).
pub struct SettingsStore {
    path: PathBuf,
    current: RwLock<AppSettings>,
    /// Set when the file on disk could not be used and defaults were loaded instead.
    load_warning: Option<String>,
    /// The file exists but could not be read: saving the defaults would erase it.
    read_failed: bool,
}

/// Reads the settings file, retrying for a moment: right after an update, the installer or
/// an antivirus scan can hold it, and Typely once started with no providers because of it.
fn read_settings(path: &Path) -> std::io::Result<String> {
    let mut attempt = 0;
    loop {
        match fs::read_to_string(path) {
            Err(e) if attempt < 10 => {
                // A first run has no file: a few short tries, not the full second.
                if e.kind() == std::io::ErrorKind::NotFound && attempt >= 2 {
                    return Err(e);
                }
                attempt += 1;
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            result => return result,
        }
    }
}

impl SettingsStore {
    pub fn open(dir: &Path) -> SettingsStore {
        let path = dir.join(SETTINGS_FILE);
        let mut read_failed = false;
        let (current, load_warning) = match read_settings(&path) {
            Ok(json) => match AppSettings::from_json(&json) {
                Ok(settings) => (settings, None),
                Err(error) => {
                    // Keep the unreadable file for the user instead of overwriting it.
                    let backup = path.with_extension("json.invalid");
                    let _ = fs::rename(&path, &backup);
                    (
                        AppSettings::default(),
                        Some(format!(
                            "{error}. Defaults were loaded; the old file was kept as {}.",
                            backup.display()
                        )),
                    )
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                (AppSettings::default(), None)
            }
            Err(error) => {
                read_failed = true;
                (
                    AppSettings::default(),
                    Some(format!(
                        "Typely could not read its settings ({error}), so it is using defaults \
                         for now. Your settings file is untouched: restart Typely to load it."
                    )),
                )
            }
        };
        SettingsStore {
            path,
            current: RwLock::new(current),
            load_warning,
            read_failed,
        }
    }

    pub fn get(&self) -> AppSettings {
        self.current
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn load_warning(&self) -> Option<&str> {
        self.load_warning.as_deref()
    }

    pub fn save(&self, settings: AppSettings) -> Result<AppSettings, String> {
        if self.read_failed {
            return Err(
                "Settings were not loaded at startup; restart Typely before changing them, \
                        so your saved settings are not replaced."
                    .to_owned(),
            );
        }
        settings.validate()?;
        let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("Cannot create settings folder: {e}"))?;
        }
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| format!("Cannot write settings: {e}"))?;
        fs::rename(&tmp, &self.path).map_err(|e| format!("Cannot write settings: {e}"))?;
        *self.current.write().unwrap_or_else(|e| e.into_inner()) = settings.clone();
        Ok(settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_local_only() {
        let s = AppSettings::from_json("{}").unwrap();
        assert!(s.engine.providers.is_empty());
        assert!(!s.engine.privacy.cloud_processing_allowed);
        assert_eq!(s.engine.default_mode, CorrectionMode::Hybrid);
        assert_eq!(s.desktop.shortcut, DEFAULT_SHORTCUT);
    }

    #[test]
    fn rejects_unknown_keys_and_bad_references() {
        assert!(AppSettings::from_json(r#"{"engine":{"api_key":"x"}}"#).is_err());
        assert!(
            AppSettings::from_json(r#"{"engine":{"providers":[{"id":"a","kind":"ollama","label":"A","model":"m","api_key":"x"}]}}"#)
                .is_err()
        );
        assert!(AppSettings::from_json(r#"{"engine":{"provider_order":["nope"]}}"#).is_err());
        assert!(
            AppSettings::from_json(
                r#"{"engine":{"providers":[{"id":"c","kind":"openai_compatible","label":"C","model":"m"}]}}"#
            )
            .is_err()
        );
        assert!(
            AppSettings::from_json(
                r#"{"engine":{"providers":[{"id":"Bad","kind":"ollama","label":"A","model":"m"}]}}"#
            )
            .is_err()
        );
        assert!(
            AppSettings::from_json(
                r#"{"engine":{"providers":[{"id":"a","kind":"openai","label":"A","model":"m","base_url":"file:///c:/x"}]}}"#
            )
            .is_err()
        );
    }

    /// The fixture is in the normalised form `AppSettingsSchema.parse` produces: Rust must
    /// accept it and write it back unchanged (`apps/desktop/test/contract.test.ts`).
    #[test]
    fn round_trips_the_shared_contract_fixture() {
        let json = include_str!("../tests/fixtures/settings.json");
        let parsed = AppSettings::from_json(json).unwrap();
        let expected: serde_json::Value = serde_json::from_str(json).unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), expected);
        let defaults = serde_json::to_value(AppSettings::default()).unwrap();
        assert_eq!(defaults["engine"]["providers"], serde_json::json!([]));
        assert_eq!(
            defaults["engine"]["limits"],
            serde_json::json!({"max_input_chars": 20000, "request_timeout_ms": 45000, "max_retries": 1})
        );
    }

    #[test]
    fn language_codes() {
        for ok in ["fr", "en-GB", "ary", "und"] {
            assert!(is_language_code(ok), "{ok}");
        }
        for bad in ["FR", "en-gb", "e", "english", "en-GBR", ""] {
            assert!(!is_language_code(bad), "{bad}");
        }
    }

    #[test]
    fn save_round_trips_and_replaces_the_file() {
        let dir = std::env::temp_dir().join(format!("typely-settings-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let store = SettingsStore::open(&dir);
        let mut s = store.get();
        s.desktop.shortcut = "Alt+Shift+K".to_owned();
        store.save(s.clone()).unwrap();
        store.save(s.clone()).unwrap();
        let reopened = SettingsStore::open(&dir);
        assert_eq!(reopened.get(), s);
        assert!(reopened.load_warning().is_none());
        fs::write(dir.join(SETTINGS_FILE), "{ not json").unwrap();
        let broken = SettingsStore::open(&dir);
        assert!(broken.load_warning().is_some());
        assert!(dir.join("settings.json.invalid").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unreadable_file_is_never_overwritten() {
        let dir = std::env::temp_dir().join(format!("typely-unreadable-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        // A folder in place of the file: present but unreadable, like a locked file.
        fs::create_dir_all(dir.join(SETTINGS_FILE)).unwrap();
        let store = SettingsStore::open(&dir);
        assert!(store.load_warning().unwrap().contains("restart Typely"));
        assert!(store.save(store.get()).is_err());
        assert!(dir.join(SETTINGS_FILE).is_dir());
        let _ = fs::remove_dir_all(&dir);
    }
}
