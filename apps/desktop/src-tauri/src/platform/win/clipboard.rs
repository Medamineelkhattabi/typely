//! Clipboard snapshot/restore (threat model T4). Every HGLOBAL format is copied byte for byte;
//! enhanced metafiles are deep-copied (Office puts them on the clipboard). Formats that cannot
//! be copied make the snapshot "unrestorable", and callers then refuse to touch the clipboard.

use std::thread::sleep;
use std::time::Duration;

use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND};
use windows::Win32::Graphics::Gdi::{CopyEnhMetaFileW, DeleteEnhMetaFile, HENHMETAFILE};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData,
    GetClipboardSequenceNumber, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{
    GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, HWND_MESSAGE, WINDOW_EX_STYLE, WINDOW_STYLE,
};
use windows::core::{PCWSTR, w};

const CF_BITMAP: u32 = 2;
const CF_METAFILEPICT: u32 = 3;
const CF_PALETTE: u32 = 9;
const CF_UNICODETEXT: u32 = 13;
const CF_ENHMETAFILE: u32 = 14;
const CF_OWNERDISPLAY: u32 = 0x0080;
const CF_DSPBITMAP: u32 = 0x0082;
const CF_DSPMETAFILEPICT: u32 = 0x0083;
const CF_DSPENHMETAFILE: u32 = 0x008E;

/// Formats that keep temporary content out of Win+V history and the cloud clipboard.
const PRIVACY_FORMATS: [PCWSTR; 3] = [
    w!("ExcludeClipboardContentFromMonitorProcessing"),
    w!("CanIncludeInClipboardHistory"),
    w!("CanUploadToCloudClipboard"),
];

pub fn sequence_number() -> u32 {
    // SAFETY: no arguments, no preconditions.
    unsafe { GetClipboardSequenceNumber() }
}

/// A message-only window: `SetClipboardData` fails without a clipboard owner window.
pub struct Owner(HWND);

impl Owner {
    pub fn new() -> Result<Owner, String> {
        // SAFETY: creates a message-only window of a system class; destroyed in Drop.
        let hwnd = unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE(0),
                w!("STATIC"),
                w!("Typely clipboard"),
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                Some(HWND_MESSAGE),
                None,
                None,
                None,
            )
        }
        .map_err(|e| format!("Cannot create clipboard window: {e}"))?;
        Ok(Owner(hwnd))
    }
}

impl Drop for Owner {
    fn drop(&mut self) {
        // SAFETY: the window was created by this thread in `Owner::new`.
        let _ = unsafe { DestroyWindow(self.0) };
    }
}

struct Open;

impl Open {
    /// Another application may hold the clipboard for a moment; retry briefly.
    fn new(owner: &Owner) -> Result<Open, String> {
        for _ in 0..25 {
            // SAFETY: `owner.0` is a live window owned by this thread.
            if unsafe { OpenClipboard(Some(owner.0)) }.is_ok() {
                return Ok(Open);
            }
            sleep(Duration::from_millis(10));
        }
        Err("The clipboard is busy (another app has it open)".to_owned())
    }
}

impl Drop for Open {
    fn drop(&mut self) {
        // SAFETY: the clipboard was opened by `Open::new` on this thread.
        let _ = unsafe { CloseClipboard() };
    }
}

enum Saved {
    Global(u32, Vec<u8>),
    EnhMetaFile(HENHMETAFILE),
}

pub struct Snapshot {
    items: Vec<Saved>,
    /// Some content could not be copied; restoring would lose it.
    pub unrestorable: bool,
}

impl Drop for Snapshot {
    fn drop(&mut self) {
        for item in self.items.drain(..) {
            if let Saved::EnhMetaFile(h) = item {
                // SAFETY: an un-restored copy made by CopyEnhMetaFileW is still owned here.
                let _ = unsafe { DeleteEnhMetaFile(Some(h)) };
            }
        }
    }
}

fn read_global(handle: HANDLE) -> Option<Vec<u8>> {
    let global = HGLOBAL(handle.0);
    // SAFETY: `handle` is clipboard data for an HGLOBAL format, valid while the clipboard is
    // open; it is only read between GlobalLock and GlobalUnlock.
    unsafe {
        let size = GlobalSize(global);
        let ptr = GlobalLock(global) as *const u8;
        if ptr.is_null() {
            return None;
        }
        let bytes = std::slice::from_raw_parts(ptr, size).to_vec();
        let _ = GlobalUnlock(global);
        Some(bytes)
    }
}

fn write_global(format: u32, bytes: &[u8]) -> Result<(), String> {
    // SAFETY: allocates and fills a movable block; on success the clipboard owns it, otherwise
    // it is freed here.
    unsafe {
        let global = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1))
            .map_err(|e| format!("Out of memory: {e}"))?;
        let ptr = GlobalLock(global) as *mut u8;
        if ptr.is_null() {
            let _ = GlobalFree(Some(global));
            return Err("Out of memory".to_owned());
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        let _ = GlobalUnlock(global);
        if SetClipboardData(format, Some(HANDLE(global.0))).is_err() {
            let _ = GlobalFree(Some(global));
            return Err("Cannot write to the clipboard".to_owned());
        }
    }
    Ok(())
}

fn privacy_formats() -> Vec<u32> {
    PRIVACY_FORMATS
        .iter()
        // SAFETY: registers (or looks up) a named format; the names are static strings.
        .map(|name| unsafe { RegisterClipboardFormatW(*name) })
        .filter(|f| *f != 0)
        .collect()
}

pub fn snapshot(owner: &Owner) -> Result<Snapshot, String> {
    let _open = Open::new(owner)?;
    let mut snapshot = Snapshot {
        items: Vec::new(),
        unrestorable: false,
    };
    let mut format = 0;
    loop {
        // SAFETY: the clipboard is open on this thread.
        format = unsafe { EnumClipboardFormats(format) };
        if format == 0 {
            break;
        }
        match format {
            // Synthesised by Windows from CF_DIB / CF_ENHMETAFILE when restored.
            CF_BITMAP | CF_METAFILEPICT | CF_PALETTE => {}
            CF_ENHMETAFILE => {
                // SAFETY: the clipboard is open; the handle is an HENHMETAFILE for this format,
                // and the copy is owned by the snapshot.
                let copy = unsafe {
                    GetClipboardData(format)
                        .map(|h| CopyEnhMetaFileW(HENHMETAFILE(h.0), PCWSTR::null()))
                };
                match copy {
                    Ok(h) if !h.is_invalid() => snapshot.items.push(Saved::EnhMetaFile(h)),
                    _ => snapshot.unrestorable = true,
                }
            }
            CF_OWNERDISPLAY
            | CF_DSPBITMAP
            | CF_DSPMETAFILEPICT
            | CF_DSPENHMETAFILE
            | 0x0200..=0x03FF => snapshot.unrestorable = true,
            _ => {
                // SAFETY: the clipboard is open; other standard and registered formats are
                // HGLOBAL-based.
                match unsafe { GetClipboardData(format) }
                    .ok()
                    .and_then(read_global)
                {
                    Some(bytes) => snapshot.items.push(Saved::Global(format, bytes)),
                    // Delayed rendering that failed: the content is gone either way.
                    None => snapshot.unrestorable = true,
                }
            }
        }
    }
    Ok(snapshot)
}

/// Puts the snapshot back, kept out of clipboard history (it is already there once).
pub fn restore(owner: &Owner, mut snapshot: Snapshot) -> Result<(), String> {
    let _open = Open::new(owner)?;
    // SAFETY: the clipboard is open on this thread and owned by `owner`.
    unsafe { EmptyClipboard() }.map_err(|e| format!("Cannot restore the clipboard: {e}"))?;
    let privacy = privacy_formats();
    let mut present = Vec::new();
    for item in snapshot.items.drain(..) {
        match item {
            Saved::Global(format, bytes) => {
                present.push(format);
                write_global(format, &bytes)?;
            }
            Saved::EnhMetaFile(h) => {
                // SAFETY: ownership of the metafile passes to the clipboard on success.
                if unsafe { SetClipboardData(CF_ENHMETAFILE, Some(HANDLE(h.0))) }.is_err() {
                    // SAFETY: still ours when SetClipboardData failed.
                    let _ = unsafe { DeleteEnhMetaFile(Some(h)) };
                }
            }
        }
    }
    for format in privacy.into_iter().filter(|f| !present.contains(f)) {
        let _ = write_global(format, &0u32.to_le_bytes());
    }
    Ok(())
}

/// Replaces the clipboard with `text`. `private` keeps it out of history and cloud sync.
pub fn set_text(owner: &Owner, text: &str, private: bool) -> Result<(), String> {
    let _open = Open::new(owner)?;
    // SAFETY: the clipboard is open on this thread and owned by `owner`.
    unsafe { EmptyClipboard() }.map_err(|e| format!("Cannot write to the clipboard: {e}"))?;
    let wide: Vec<u8> = text
        .encode_utf16()
        .chain(std::iter::once(0))
        .flat_map(u16::to_le_bytes)
        .collect();
    write_global(CF_UNICODETEXT, &wide)?;
    if private {
        for format in privacy_formats() {
            write_global(format, &0u32.to_le_bytes())?;
        }
    }
    Ok(())
}

pub fn get_text(owner: &Owner) -> Result<Option<String>, String> {
    let _open = Open::new(owner)?;
    // SAFETY: the clipboard is open on this thread.
    let Ok(handle) = (unsafe { GetClipboardData(CF_UNICODETEXT) }) else {
        return Ok(None);
    };
    let Some(bytes) = read_global(handle) else {
        return Ok(None);
    };
    let units: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| u16::from_le_bytes(*c))
        .take_while(|u| *u != 0)
        .collect();
    Ok(Some(String::from_utf16_lossy(&units)))
}
