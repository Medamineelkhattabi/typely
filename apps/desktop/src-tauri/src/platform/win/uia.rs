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

/// The control that had keyboard focus at capture time. UI Automation client objects are
/// free-threaded, and both the capture and the replace thread run in the MTA.
#[derive(Debug, Clone)]
pub struct FocusedElement(IUIAutomationElement);

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
        automation
            .GetFocusedElement()
            .and_then(|now| automation.CompareElements(&now, &element.0))
            .map(|same| same.as_bool())
            .unwrap_or(false)
    };
    if has_focus() {
        return Ok(());
    }
    // SAFETY: as above.
    let _ = unsafe { element.0.SetFocus() };
    for _ in 0..20 {
        if has_focus() {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(15));
    }
    Err(lost())
}

struct Com;
impl Com {
    fn init() -> Option<Com> {
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
                element: Some(FocusedElement(element)),
            };
        };
        let Ok(ranges) = pattern.GetSelection() else {
            return Outcome::Nothing {
                rect,
                element: Some(FocusedElement(element)),
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
                element: Some(FocusedElement(element)),
            };
        }
        Outcome::Selection {
            text,
            rect: selection_rect.or(rect),
            element: FocusedElement(element),
        }
    }
}
