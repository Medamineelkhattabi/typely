//! Foreground window, process identity and elevation, focus restore, monitor geometry.

use std::thread::sleep;
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    ClientToScreen, GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromPoint,
};
use windows::Win32::Security::{GetTokenInformation, TOKEN_ELEVATION, TOKEN_QUERY, TokenElevation};
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentProcessId, OpenProcess, OpenProcessToken, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, QueryFullProcessImageNameW,
    WaitForInputIdle,
};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::{
    GUITHREADINFO, GetCursorPos, GetForegroundWindow, GetGUIThreadInfo, GetWindowThreadProcessId,
    IsIconic, IsWindow, SMTO_ABORTIFHUNG, SW_RESTORE, SendMessageTimeoutW, SetForegroundWindow,
    ShowWindow, WM_PASTE,
};
use windows::core::PWSTR;

use crate::platform::{Rect, Target};

pub fn hwnd_of(target: &Target) -> HWND {
    HWND(target.hwnd as *mut core::ffi::c_void)
}

/// The foreground window and its process id.
pub fn foreground() -> Option<(HWND, u32)> {
    // SAFETY: plain queries; a null HWND is handled.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        (pid != 0).then_some((hwnd, pid))
    }
}

pub fn own_pid() -> u32 {
    // SAFETY: no preconditions.
    unsafe { GetCurrentProcessId() }
}

struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        // SAFETY: the handle was opened by this module and is closed once.
        let _ = unsafe { CloseHandle(self.0) };
    }
}

fn open_process(pid: u32) -> Option<Handle> {
    // SAFETY: requests limited query rights only.
    unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }
        .ok()
        .map(Handle)
}

/// Executable file name, e.g. `notepad.exe` (shown in the panel; never sent anywhere).
pub fn process_name(pid: u32) -> Option<String> {
    let process = open_process(pid)?;
    let mut buffer = [0u16; 1024];
    let mut len = buffer.len() as u32;
    // SAFETY: `buffer` and `len` describe a writable buffer of `len` UTF-16 units.
    unsafe {
        QueryFullProcessImageNameW(
            process.0,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut len,
        )
    }
    .ok()?;
    let path = String::from_utf16_lossy(&buffer[..len as usize]);
    path.rsplit(['\\', '/']).next().map(str::to_owned)
}

fn token_elevated(process: HANDLE) -> Option<bool> {
    let mut token = HANDLE::default();
    // SAFETY: opens the process token for query; closed by the Handle guard.
    unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) }.ok()?;
    let token = Handle(token);
    let mut elevation = TOKEN_ELEVATION::default();
    let mut returned = 0u32;
    // SAFETY: `elevation` is a TOKEN_ELEVATION buffer of the size passed.
    unsafe {
        GetTokenInformation(
            token.0,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut core::ffi::c_void),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        )
    }
    .ok()?;
    Some(elevation.TokenIsElevated != 0)
}

pub fn self_elevated() -> bool {
    // SAFETY: the pseudo-handle of the current process needs no closing.
    token_elevated(unsafe { GetCurrentProcess() }).unwrap_or(false)
}

/// Whether `pid` runs elevated. A token we may not open is treated as elevated: that is what
/// UIPI looks like from a normal process.
pub fn is_elevated(pid: u32) -> bool {
    match open_process(pid) {
        Some(process) => token_elevated(process.0).unwrap_or(true),
        None => true,
    }
}

/// Gives a just-activated window time to accept input. Measured 2026-11-03: Notepad ignored a
/// Ctrl+V sent ~35 ms after it was brought back to the front, and accepted the same keystroke
/// once it had settled. Waits a short moment, then until the app is idle (bounded).
pub fn settle(target: &Target) {
    sleep(Duration::from_millis(120));
    // SAFETY: SYNCHRONIZE + limited query rights only; the handle is closed by `Handle`.
    if let Ok(process) = unsafe {
        OpenProcess(
            PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
            false,
            target.pid,
        )
    } {
        let process = Handle(process);
        // SAFETY: valid process handle; returns at once for non-GUI or idle processes.
        let _ = unsafe { WaitForInputIdle(process.0, 300) };
    }
}

/// Pastes into a standard edit control with WM_PASTE. Unlike a simulated Ctrl+V it does not
/// depend on keyboard focus having settled (WinUI apps such as Notepad route keys through an
/// input site window and dropped early keystrokes), it is synchronous, and it stays undoable.
/// Only for a window of the target process.
pub fn paste_into(target: &Target, control: isize) -> Result<(), String> {
    let hwnd = HWND(control as *mut core::ffi::c_void);
    let mut pid = 0u32;
    // SAFETY: plain window queries and a synchronous message with a timeout.
    unsafe {
        if !IsWindow(Some(hwnd)).as_bool() {
            return Err("The text field is gone".to_owned());
        }
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid != target.pid {
            return Err("The text field now belongs to another program".to_owned());
        }
        let mut result = 0usize;
        let sent = SendMessageTimeoutW(
            hwnd,
            WM_PASTE,
            WPARAM(0),
            LPARAM(0),
            SMTO_ABORTIFHUNG,
            2_000,
            Some(&mut result),
        );
        if sent.0 == 0 {
            return Err("The app did not respond to the paste".to_owned());
        }
    }
    Ok(())
}

/// Brings the recorded window back and checks it really is in front and still belongs to the
/// same process before any keystroke is sent (threat model T8).
pub fn focus(target: &Target) -> Result<(), String> {
    let hwnd = hwnd_of(target);
    // SAFETY: plain window-manager calls on a handle that is checked with IsWindow first.
    unsafe {
        if !IsWindow(Some(hwnd)).as_bool() {
            return Err("The original window was closed".to_owned());
        }
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        let _ = SetForegroundWindow(hwnd);
    }
    let start = Instant::now();
    loop {
        if let Some((fg, pid)) = foreground()
            && fg == hwnd
        {
            if pid != target.pid {
                return Err("The original window now belongs to another program".to_owned());
            }
            return Ok(());
        }
        if start.elapsed() > Duration::from_millis(800) {
            return Err("Windows did not bring the original window back to the front".to_owned());
        }
        sleep(Duration::from_millis(15));
    }
}

/// Brings one of our own windows to the front. Used instead of Tauri's `set_focus`, which on
/// Windows injects an Alt keypress that lands in the source app (menu key tips, menu bar).
/// Allowed without that trick because our process just received the hotkey.
pub fn activate(hwnd: isize) -> bool {
    // SAFETY: `hwnd` is a window handle of this process.
    unsafe { SetForegroundWindow(HWND(hwnd as *mut core::ffi::c_void)) }.as_bool()
}

/// The text caret of the window's thread, in screen coordinates.
pub fn caret_rect(target: &Target) -> Option<Rect> {
    let hwnd = hwnd_of(target);
    // SAFETY: GUITHREADINFO is initialised with its size; the caret window is checked.
    unsafe {
        let thread = GetWindowThreadProcessId(hwnd, None);
        let mut info = GUITHREADINFO {
            cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
            ..Default::default()
        };
        GetGUIThreadInfo(thread, &mut info).ok()?;
        if info.hwndCaret.is_invalid() {
            return None;
        }
        let r = info.rcCaret;
        let mut top_left = POINT {
            x: r.left,
            y: r.top,
        };
        let mut bottom_right = POINT {
            x: r.right,
            y: r.bottom,
        };
        if !ClientToScreen(info.hwndCaret, &mut top_left).as_bool()
            || !ClientToScreen(info.hwndCaret, &mut bottom_right).as_bool()
        {
            return None;
        }
        Some(Rect {
            left: top_left.x,
            top: top_left.y,
            right: bottom_right.x,
            bottom: bottom_right.y,
        })
    }
}

pub fn cursor_pos() -> (i32, i32) {
    let mut p = POINT::default();
    // SAFETY: writes the cursor position into `p`.
    let _ = unsafe { GetCursorPos(&mut p) };
    (p.x, p.y)
}

/// Work area (screen minus taskbar) and scale factor of the monitor nearest to a point.
pub fn monitor_at(x: i32, y: i32) -> (Rect, f64) {
    // SAFETY: MONITORINFO is initialised with its size; the monitor handle comes from Windows.
    unsafe {
        let monitor = MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let work: RECT = if GetMonitorInfoW(monitor, &mut info).as_bool() {
            info.rcWork
        } else {
            RECT {
                left: 0,
                top: 0,
                right: 1280,
                bottom: 720,
            }
        };
        let (mut dpi_x, mut dpi_y) = (96u32, 96u32);
        let scale = if GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y).is_ok()
        {
            f64::from(dpi_x) / 96.0
        } else {
            1.0
        };
        (
            Rect {
                left: work.left,
                top: work.top,
                right: work.right,
                bottom: work.bottom,
            },
            scale,
        )
    }
}

pub fn total_memory_bytes() -> u64 {
    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    // SAFETY: MEMORYSTATUSEX is initialised with its size.
    match unsafe { GlobalMemoryStatusEx(&mut status) } {
        Ok(()) => status.ullTotalPhys,
        Err(_) => 0,
    }
}
