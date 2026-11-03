//! Synthetic keyboard input for Ctrl+C / Ctrl+V.

use std::thread::sleep;
use std::time::{Duration, Instant};

use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBD_EVENT_FLAGS, KEYBDINPUT,
    KEYEVENTF_KEYUP, SendInput, VIRTUAL_KEY, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
};

const MODIFIERS: [VIRTUAL_KEY; 5] = [VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN];

fn is_down(vk: VIRTUAL_KEY) -> bool {
    // SAFETY: reads the asynchronous key state; no preconditions.
    (unsafe { GetAsyncKeyState(i32::from(vk.0)) } as u16) & 0x8000 != 0
}

fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: if up {
                    KEYEVENTF_KEYUP
                } else {
                    KEYBD_EVENT_FLAGS(0)
                },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// Waits until the user lets go of the shortcut's modifiers: Ctrl+C sent while Shift is still
/// held would be Ctrl+Shift+C (developer tools in browsers).
pub fn wait_for_modifiers_release(timeout: Duration) -> bool {
    let start = Instant::now();
    while MODIFIERS.iter().any(|vk| is_down(*vk)) {
        if start.elapsed() >= timeout {
            return false;
        }
        sleep(Duration::from_millis(10));
    }
    true
}

/// Sends Ctrl+`letter` to the foreground window. Modifiers still held are released first.
pub fn send_ctrl_chord(letter: u8) -> Result<(), String> {
    let letter = VIRTUAL_KEY(u16::from(letter.to_ascii_uppercase()));
    let mut inputs: Vec<INPUT> = MODIFIERS
        .iter()
        .filter(|vk| is_down(**vk))
        .map(|vk| key(*vk, true))
        .collect();
    inputs.extend([
        key(VK_CONTROL, false),
        key(letter, false),
        key(letter, true),
        key(VK_CONTROL, true),
    ]);
    // SAFETY: `inputs` is a valid slice of keyboard INPUT structures.
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize != inputs.len() {
        return Err("Windows blocked the simulated keystroke".to_owned());
    }
    Ok(())
}
