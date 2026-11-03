//! Selection capture through UI Automation (`TextPattern.GetSelection` on the focused element).

use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
    SAFEARRAY,
};
use windows::Win32::System::Ole::{
    SafeArrayAccessData, SafeArrayDestroy, SafeArrayGetLBound, SafeArrayGetUBound,
    SafeArrayUnaccessData,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomation2, IUIAutomationElement, IUIAutomationTextPattern,
    IUIAutomationTextRange, UIA_TextPatternId,
};
use windows::core::Interface;

use crate::platform::Rect;

pub enum Outcome {
    /// The focused control is a password field: nothing may be captured.
    Password,
    Selection {
        text: String,
        rect: Option<Rect>,
        element: FocusedElement,
    },
    /// No usable selection through UI Automation; `rect` is the focused control's bounds.
    Nothing {
        rect: Option<Rect>,
        element: Option<FocusedElement>,
    },
}

/// What identifies a control when its UI Automation object has been recreated (web views
/// such as Teams rebuild them): the same process, control type, ids and position.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Fingerprint {
    process_id: i32,
    control_type: i32,
    automation_id: String,
    class_name: String,
    rect: Option<Rect>,
}

impl Fingerprint {
    fn of(element: &IUIAutomationElement) -> Option<Fingerprint> {
        // SAFETY: COM calls on a live element.
        unsafe {
            Some(Fingerprint {
                process_id: element.CurrentProcessId().ok()?,
                control_type: element.CurrentControlType().ok()?.0,
                automation_id: element
                    .CurrentAutomationId()
                    .map(|s| s.to_string())
                    .unwrap_or_default(),
                class_name: element
                    .CurrentClassName()
                    .map(|s| s.to_string())
                    .unwrap_or_default(),
                rect: element_rect(element),
            })
        }
    }

    /// Same control: everything matches, and the position within a few pixels.
    fn matches(&self, other: &Fingerprint) -> bool {
        let near = |a: Option<Rect>, b: Option<Rect>| match (a, b) {
            (Some(a), Some(b)) => {
                (a.left - b.left).abs() <= 4
                    && (a.top - b.top).abs() <= 4
                    && (a.right - b.right).abs() <= 4
                    && (a.bottom - b.bottom).abs() <= 4
            }
            _ => false,
        };
        self.process_id == other.process_id
            && self.control_type == other.control_type
            && self.automation_id == other.automation_id
            && self.class_name == other.class_name
            && near(self.rect, other.rect)
    }
}

/// The control that had keyboard focus at capture time. UI Automation client objects are
/// free-threaded, and both the capture and the replace thread run in the MTA.
#[derive(Debug, Clone)]
pub struct FocusedElement {
    element: IUIAutomationElement,
    fingerprint: Option<Box<Fingerprint>>,
    /// The control's own window, when it has one (classic Win32 controls do).
    native_window: isize,
}

impl FocusedElement {
    fn new(element: IUIAutomationElement) -> FocusedElement {
        let fingerprint = Fingerprint::of(&element).map(Box::new);
        // SAFETY: COM call on a live element.
        let native_window = unsafe { element.CurrentNativeWindowHandle() }
            .map(|h| h.0 as isize)
            .unwrap_or(0);
        FocusedElement {
            element,
            fingerprint,
            native_window,
        }
    }

    /// The window of a standard edit control (Edit, RichEdit, including Notepad's
    /// RichEditD2DPT), which can be sent WM_PASTE instead of a simulated Ctrl+V.
    pub fn edit_control(&self) -> Option<isize> {
        let class = self.fingerprint.as_ref()?.class_name.to_ascii_lowercase();
        let editable = class == "edit" || class.starts_with("richedit");
        (editable && self.native_window != 0).then_some(self.native_window)
    }
}

// SAFETY: UI Automation client interfaces are agile; they are only used from MTA threads.
unsafe impl Send for FocusedElement {}
// SAFETY: as above; the element is only read (compared, focused).
unsafe impl Sync for FocusedElement {}

fn automation() -> Option<IUIAutomation> {
    // SAFETY: COM is initialised on the calling thread by `Com::init`.
    unsafe {
        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
        // A hung target app must not freeze Typely for long.
        if let Ok(automation2) = automation.cast::<IUIAutomation2>() {
            let _ = automation2.SetConnectionTimeout(1_000);
            let _ = automation2.SetTransactionTimeout(1_000);
        }
        Some(automation)
    }
}

/// Makes sure keyboard focus is back on the captured control before pasting. A window can be
/// in front with focus elsewhere (e.g. a web view inside an Electron app gives focus back to
/// the app's main view), and pasting there would put the text in the wrong field.
///
/// Apps often restore their own focus a moment after being activated (Teams does), so this
/// first waits, then asks for focus, and accepts a recreated control by its fingerprint.
pub fn restore_focus(element: &FocusedElement) -> Result<(), String> {
    let lost = || {
        "Typely could not put the cursor back in the original text field, so nothing was pasted. Use Copy instead.".to_owned()
    };
    let Some(_com) = Com::init() else {
        return Err(lost());
    };
    let Some(automation) = automation() else {
        return Err(lost());
    };
    // SAFETY: COM calls on live interfaces from an MTA thread.
    let has_focus = || unsafe {
        let Ok(now) = automation.GetFocusedElement() else {
            return false;
        };
        if automation
            .CompareElements(&now, &element.element)
            .map(|same| same.as_bool())
            .unwrap_or(false)
        {
            return true;
        }
        match (&element.fingerprint, Fingerprint::of(&now)) {
            (Some(captured), Some(current)) => captured.matches(&current),
            _ => false,
        }
    };
    let wait = |rounds: u32| {
        for _ in 0..rounds {
            if has_focus() {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        false
    };
    // ~250 ms for the app to restore focus itself, then ~750 ms after asking for it.
    if wait(10) {
        return Ok(());
    }
    // SAFETY: as above.
    let _ = unsafe { element.element.SetFocus() };
    if wait(30) {
        return Ok(());
    }
    Err(lost())
}

pub(super) struct Com;
impl Com {
    pub(super) fn init() -> Option<Com> {
        // SAFETY: initialises COM for this (worker) thread; balanced in Drop.
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .ok()
            .map(|()| Com)
    }
}
impl Drop for Com {
    fn drop(&mut self) {
        // SAFETY: balances the successful CoInitializeEx above.
        unsafe { CoUninitialize() };
    }
}

fn element_rect(element: &IUIAutomationElement) -> Option<Rect> {
    // SAFETY: COM call on a live element.
    let r = unsafe { element.CurrentBoundingRectangle() }.ok()?;
    (r.right > r.left && r.bottom > r.top).then_some(Rect {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
    })
}

/// Union of the range's line rectangles (screen coordinates, as x, y, w, h doubles).
fn range_rect(range: &IUIAutomationTextRange) -> Option<Rect> {
    // SAFETY: the SAFEARRAY returned by GetBoundingRectangles is a 1-D array of f64 owned by
    // us; it is accessed between Access/Unaccess and destroyed once.
    unsafe {
        let array: *mut SAFEARRAY = range.GetBoundingRectangles().ok()?;
        if array.is_null() {
            return None;
        }
        let mut rect: Option<Rect> = None;
        if let (Ok(lower), Ok(upper)) = (SafeArrayGetLBound(array, 1), SafeArrayGetUBound(array, 1))
        {
            let count = (upper - lower + 1).max(0) as usize;
            let mut data: *mut core::ffi::c_void = std::ptr::null_mut();
            if count >= 4 && SafeArrayAccessData(array, &mut data).is_ok() {
                let values = std::slice::from_raw_parts(data as *const f64, count);
                for &[x, y, w, h] in values.as_chunks::<4>().0 {
                    if w <= 0.0 && h <= 0.0 {
                        continue;
                    }
                    let line = Rect {
                        left: x as i32,
                        top: y as i32,
                        right: (x + w) as i32,
                        bottom: (y + h) as i32,
                    };
                    rect = Some(match rect {
                        None => line,
                        Some(r) => Rect {
                            left: r.left.min(line.left),
                            top: r.top.min(line.top),
                            right: r.right.max(line.right),
                            bottom: r.bottom.max(line.bottom),
                        },
                    });
                }
                let _ = SafeArrayUnaccessData(array);
            }
        }
        let _ = SafeArrayDestroy(array);
        rect
    }
}

pub fn focused_selection() -> Outcome {
    let Some(_com) = Com::init() else {
        return Outcome::Nothing {
            rect: None,
            element: None,
        };
    };
    // SAFETY: COM is initialised on this thread; every interface is used while alive.
    unsafe {
        let Some(automation) = automation() else {
            return Outcome::Nothing {
                rect: None,
                element: None,
            };
        };
        let Ok(element) = automation.GetFocusedElement() else {
            return Outcome::Nothing {
                rect: None,
                element: None,
            };
        };
        if element
            .CurrentIsPassword()
            .map(|b| b.as_bool())
            .unwrap_or(false)
        {
            return Outcome::Password;
        }
        let rect = element_rect(&element);
        let Ok(pattern) =
            element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
        else {
            return Outcome::Nothing {
                rect,
                element: Some(FocusedElement::new(element)),
            };
        };
        let Ok(ranges) = pattern.GetSelection() else {
            return Outcome::Nothing {
                rect,
                element: Some(FocusedElement::new(element)),
            };
        };
        let count = ranges.Length().unwrap_or(0);
        let mut text = String::new();
        let mut selection_rect = None;
        for i in 0..count {
            let Ok(range) = ranges.GetElement(i) else {
                continue;
            };
            if let Ok(part) = range.GetText(-1) {
                text.push_str(&part.to_string());
            }
            if selection_rect.is_none() {
                selection_rect = range_rect(&range);
            }
        }
        if text.trim().is_empty() {
            return Outcome::Nothing {
                rect,
                element: Some(FocusedElement::new(element)),
            };
        }
        Outcome::Selection {
            text,
            rect: selection_rect.or(rect),
            element: FocusedElement::new(element),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn print(rect: Rect) -> Fingerprint {
        Fingerprint {
            process_id: 42,
            control_type: 50004,
            automation_id: "ckeditor".into(),
            class_name: String::new(),
            rect: Some(rect),
        }
    }

    const AT: Rect = Rect {
        left: 100,
        top: 600,
        right: 900,
        bottom: 660,
    };

    #[test]
    fn a_recreated_control_in_the_same_place_matches() {
        let moved = Rect {
            left: 102,
            top: 598,
            right: 901,
            bottom: 662,
        };
        assert!(print(AT).matches(&print(moved)));
    }

    #[test]
    fn another_field_does_not_match() {
        let elsewhere = Rect {
            left: 100,
            top: 80,
            right: 900,
            bottom: 120,
        };
        assert!(!print(AT).matches(&print(elsewhere)));
        let mut other_app = print(AT);
        other_app.process_id = 7;
        assert!(!print(AT).matches(&other_app));
        let mut other_id = print(AT);
        other_id.automation_id = "search".into();
        assert!(!print(AT).matches(&other_id));
        let mut no_rect = print(AT);
        no_rect.rect = None;
        assert!(!print(AT).matches(&no_rect));
    }
}
