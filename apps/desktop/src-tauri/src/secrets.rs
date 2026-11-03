//! API keys, stored in the Windows Credential Manager through `keyring`. A secret is bound to
//! the origin it was saved for: if the endpoint's base URL later points to another host, the
//! key is not sent (a compromised webview could otherwise redirect it by editing settings).
//! Nothing here ever returns a secret to a webview.

#[cfg(test)]
use std::collections::HashMap;
#[cfg(test)]
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

const SERVICE: &str = "app.typely.desktop";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredSecret {
    pub origin: String,
    pub secret: String,
}

pub trait SecretStore: Send + Sync {
    fn get(&self, endpoint_id: &str) -> Result<Option<StoredSecret>, String>;
    fn set(&self, endpoint_id: &str, value: &StoredSecret) -> Result<(), String>;
    fn delete(&self, endpoint_id: &str) -> Result<(), String>;
}

/// Windows Credential Manager (generic credentials, target `<endpoint id>.app.typely.desktop`).
pub struct KeyringStore;

impl KeyringStore {
    fn entry(endpoint_id: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, endpoint_id)
            .map_err(|e| format!("Credential store unavailable: {e}"))
    }
}

impl SecretStore for KeyringStore {
    fn get(&self, endpoint_id: &str) -> Result<Option<StoredSecret>, String> {
        match Self::entry(endpoint_id)?.get_password() {
            Ok(json) => serde_json::from_str(&json)
                .map(Some)
                .map_err(|_| format!("The stored key for '{endpoint_id}' is unreadable")),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("Cannot read the key for '{endpoint_id}': {e}")),
        }
    }

    fn set(&self, endpoint_id: &str, value: &StoredSecret) -> Result<(), String> {
        let json = serde_json::to_string(value).map_err(|e| e.to_string())?;
        Self::entry(endpoint_id)?
            .set_password(&json)
            .map_err(|e| format!("Cannot store the key for '{endpoint_id}': {e}"))
    }

    fn delete(&self, endpoint_id: &str) -> Result<(), String> {
        match Self::entry(endpoint_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Cannot delete the key for '{endpoint_id}': {e}")),
        }
    }
}

/// In-memory store for tests.
#[cfg(test)]
#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, StoredSecret>>);

#[cfg(test)]
impl SecretStore for MemoryStore {
    fn get(&self, endpoint_id: &str) -> Result<Option<StoredSecret>, String> {
        Ok(self.0.lock().unwrap().get(endpoint_id).cloned())
    }
    fn set(&self, endpoint_id: &str, value: &StoredSecret) -> Result<(), String> {
        self.0
            .lock()
            .unwrap()
            .insert(endpoint_id.to_owned(), value.clone());
        Ok(())
    }
    fn delete(&self, endpoint_id: &str) -> Result<(), String> {
        self.0.lock().unwrap().remove(endpoint_id);
        Ok(())
    }
}

/// What the settings UI may know about a key: whether one exists and still matches its host.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SecretState {
    Missing,
    Stored,
    /// Saved for another host; it will not be sent until it is entered again.
    OriginChanged,
}

pub fn state_for(stored: Option<&StoredSecret>, origin: &str) -> SecretState {
    match stored {
        None => SecretState::Missing,
        Some(s) if s.origin == origin => SecretState::Stored,
        Some(_) => SecretState::OriginChanged,
    }
}

/// The secret to attach for `origin`, if one was saved for exactly that origin.
pub fn secret_for(stored: Option<StoredSecret>, origin: &str) -> Option<String> {
    stored.filter(|s| s.origin == origin).map(|s| s.secret)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_are_bound_to_their_origin() {
        let store = MemoryStore::default();
        let value = StoredSecret {
            origin: "https://api.openai.com".into(),
            secret: "sk-test".into(),
        };
        store.set("openai", &value).unwrap();
        let got = store.get("openai").unwrap();
        assert_eq!(
            state_for(got.as_ref(), "https://api.openai.com"),
            SecretState::Stored
        );
        assert_eq!(
            state_for(got.as_ref(), "https://evil.example"),
            SecretState::OriginChanged
        );
        assert_eq!(secret_for(got.clone(), "https://evil.example"), None);
        assert_eq!(
            secret_for(got, "https://api.openai.com").as_deref(),
            Some("sk-test")
        );
        store.delete("openai").unwrap();
        assert_eq!(store.get("openai").unwrap(), None);
    }
}
