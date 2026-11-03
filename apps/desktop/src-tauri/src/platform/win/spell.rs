//! The Windows spell checker (`ISpellCheckerFactory`): local, free, and available for every
//! language the user has installed in Windows. Runs on a worker thread with COM initialised.

use windows::Win32::Globalization::{
    CORRECTIVE_ACTION_DELETE, CORRECTIVE_ACTION_GET_SUGGESTIONS, CORRECTIVE_ACTION_REPLACE,
    ISpellChecker, ISpellCheckerFactory, SpellCheckerFactory,
};
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, CoCreateInstance, CoTaskMemFree, IEnumString,
};
use windows::core::{HSTRING, PWSTR};

use super::uia::Com;
use crate::platform::{SpellAction, SpellError, SpellResult};

const MAX_ERRORS: usize = 200;
const MAX_SUGGESTIONS: usize = 5;

/// Takes ownership of a COM-allocated string.
fn take(p: PWSTR) -> Option<String> {
    if p.is_null() {
        return None;
    }
    // SAFETY: `p` is a NUL-terminated string allocated with CoTaskMemAlloc, freed once here.
    unsafe {
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as *const core::ffi::c_void));
        s
    }
}

fn strings(e: &IEnumString, limit: usize) -> Vec<String> {
    let mut out = Vec::new();
    while out.len() < limit {
        let mut item = [PWSTR::null()];
        let mut fetched = 0u32;
        // SAFETY: one-element buffer; every returned string is freed by `take`.
        let hr = unsafe { e.Next(&mut item, Some(&mut fetched)) };
        if hr.is_err() || fetched == 0 {
            break;
        }
        if let Some(s) = take(item[0]) {
            out.push(s);
        }
    }
    out
}

/// The installed Windows language that best matches an engine language code: the exact tag,
/// else the base language's main region (fr → fr-FR, en → en-US), else any region.
fn pick_tag(supported: &[String], language: &str) -> Option<String> {
    let lower = language.to_ascii_lowercase();
    if let Some(exact) = supported.iter().find(|t| t.to_ascii_lowercase() == lower) {
        return Some(exact.clone());
    }
    let base = lower.split('-').next().unwrap_or_default();
    let preferred = match base {
        "en" => "en-us".to_owned(),
        "ar" => "ar-sa".to_owned(),
        other => format!("{other}-{other}"),
    };
    supported
        .iter()
        .find(|t| t.to_ascii_lowercase() == preferred)
        .or_else(|| {
            supported
                .iter()
                .find(|t| t.to_ascii_lowercase().starts_with(&format!("{base}-")))
        })
        .cloned()
}

pub fn spell_check(text: &str, language: &str) -> Result<SpellResult, String> {
    let unsupported = SpellResult {
        language_tag: None,
        errors: Vec::new(),
    };
    let Some(_com) = Com::init() else {
        return Ok(unsupported);
    };
    // SAFETY: COM is initialised on this thread; all interfaces are used while alive.
    unsafe {
        let factory: ISpellCheckerFactory =
            CoCreateInstance(&SpellCheckerFactory, None, CLSCTX_INPROC_SERVER)
                .map_err(|e| format!("Windows spell checker unavailable: {e}"))?;
        let supported = factory
            .SupportedLanguages()
            .map(|e| strings(&e, 256))
            .unwrap_or_default();
        let Some(tag) = pick_tag(&supported, language) else {
            return Ok(unsupported);
        };
        let checker: ISpellChecker = factory
            .CreateSpellChecker(&HSTRING::from(tag.as_str()))
            .map_err(|e| format!("Cannot open the {tag} spell checker: {e}"))?;
        let found = checker
            .Check(&HSTRING::from(text))
            .map_err(|e| format!("Spell check failed: {e}"))?;
        let units: Vec<u16> = text.encode_utf16().collect();
        let mut errors = Vec::new();
        while errors.len() < MAX_ERRORS {
            let mut error = None;
            if found.Next(&mut error).is_err() {
                break;
            }
            let Some(error) = error else { break };
            let (Ok(offset), Ok(length), Ok(action)) =
                (error.StartIndex(), error.Length(), error.CorrectiveAction())
            else {
                continue;
            };
            let (start, end) = (offset as usize, (offset + length) as usize);
            let Some(word) = units.get(start..end).map(String::from_utf16_lossy) else {
                continue;
            };
            let action = match action {
                CORRECTIVE_ACTION_REPLACE => SpellAction::Replace,
                CORRECTIVE_ACTION_GET_SUGGESTIONS => SpellAction::Suggest,
                CORRECTIVE_ACTION_DELETE => SpellAction::Delete,
                _ => SpellAction::None,
            };
            let replacement = if action == SpellAction::Replace {
                error.Replacement().ok().and_then(take)
            } else {
                None
            };
            let suggestions = if action == SpellAction::Suggest {
                checker
                    .Suggest(&HSTRING::from(word.as_str()))
                    .map(|e| strings(&e, MAX_SUGGESTIONS))
                    .unwrap_or_default()
            } else {
                Vec::new()
            };
            errors.push(SpellError {
                offset,
                length,
                action,
                replacement,
                suggestions,
            });
        }
        Ok(SpellResult {
            language_tag: Some(tag),
            errors,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_closest_installed_language() {
        let tags: Vec<String> = ["fr-CA", "fr-FR", "en-GB", "en-US", "ar-EG"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(pick_tag(&tags, "fr").as_deref(), Some("fr-FR"));
        assert_eq!(pick_tag(&tags, "fr-CA").as_deref(), Some("fr-CA"));
        assert_eq!(pick_tag(&tags, "en").as_deref(), Some("en-US"));
        assert_eq!(pick_tag(&tags, "ar").as_deref(), Some("ar-EG"));
        assert_eq!(pick_tag(&tags, "de"), None);
    }

    /// Uses the real Windows spell checker when French is installed (it is on the
    /// development machine); passes silently elsewhere.
    #[test]
    fn checks_french_when_installed() {
        let result =
            spell_check("Je voudrais savoir si vous avez recu mon message.", "fr").unwrap();
        if result.language_tag.is_none() {
            return;
        }
        let text = "Je voudrais savoir si vous avez recu mon message.";
        let at = text.find("recu").unwrap() as u32;
        let recu = result
            .errors
            .iter()
            .find(|e| e.offset == at)
            .expect("recu flagged");
        assert_eq!(recu.length, 4);
        assert!(recu.suggestions.iter().any(|s| s == "reçu"), "{recu:?}");
    }
}
