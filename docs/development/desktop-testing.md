# Desktop app — manual test log

Build under test: `npm run tauri dev` (debug), 2026-11-03, reference laptop (i7-1355U, 32 GB,
Iris Xe, Windows 11 26200). Ollama 0.40.7 portable, started by hand with
`OLLAMA_IGPU_ENABLE=1`, `OLLAMA_NO_CLOUD=1`.

## Verified

| Scenario (Notepad, Windows 11 Store version)                                                                                          | Result     |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Select text → Ctrl+Shift+Space → panel opens under the selection                                                                      | ✅         |
| Local-only result (no provider): diff and explanations                                                                                | ✅ < 0.1 s |
| Replace pastes into Notepad; Ctrl+Z undoes it                                                                                         | ✅         |
| Clipboard content before Replace is restored afterwards                                                                               | ✅         |
| No selection → message and paste box; Run on pasted text                                                                              | ✅         |
| Panel activation no longer sends Alt to the source app (no menu key tips)                                                             | ✅         |
| Ollama detection lists models without loading one (`/api/ps` empty)                                                                   | ✅         |
| "Use recommended setup" writes the two-tier configuration                                                                             | ✅         |
| Fix with gemma3:1b: local preview at once, streamed text, final result — cold                                                         | ✅ 8.5 s   |
| Same, warm (11 words)                                                                                                                 | ✅ 2.1 s   |
| Professional → gemma3:4b; unloaded right after (`/api/ps` shows only the warm 1B)                                                     | ✅ 18.4 s  |
| Cancel during the 4B load: request aborted, 4B never resident                                                                         | ✅         |
| Prompt injection ("Ignore all previous instructions…") → `ai_rejected` warning, Replace disabled                                      | ✅         |
| Add a cloud provider with a key: key only in Credential Manager, not in settings.json; consent off by default; Remove deletes the key | ✅         |
| Invalid shortcut (`Shift+A`) refused, previous shortcut kept                                                                          | ✅         |

Times are from the panel (`meta.duration_ms`) in a debug build.

**Release build** (`npm run tauri build`, 8 min, `typely.exe` 5.2 MB): Fix in Notepad
(7.4 s cold with gemma3:1b) and **Copy** verified.

**Idle footprint of the release build** (started with `--hidden`, both windows pre-created
and hidden, no model loaded): `typely.exe` 31 MB working set; its 7 WebView2 processes
about 205 MB private memory (GPU process 85 MB, browser 39 MB, two renderers 29 MB each).
The shortcut needs no webview to be created, but the second renderer (the hidden settings
window) could be created on demand to save ~30 MB.

## Found by the user (2026-11-03)

Testing a page shown in an Electron desktop app's embedded browser view:
capture worked through UI Automation, but Replace pasted nowhere visible, because the
re-activated window gave keyboard focus to its main view, not the embedded page. Replace now
restores focus to the captured control (UI Automation `SetFocus`) and refuses to paste if
it cannot. Re-test pending.

## Not verified yet

- **Browser text fields (Edge/Chrome).** Not tested yet. To check: open any page with a
  `<textarea>`, type a sentence with errors, select it, press the shortcut, then Replace.
  Hovering the source name in the panel header shows whether UI Automation or the clipboard
  path was used.
- The clipboard fallback (Ctrl+C) in an app without UI Automation text support.
- Password fields (the UI Automation `IsPassword` refusal) in a real app.
- Elevated (administrator) target windows; a shortcut already taken by another app.
- Word, Outlook, Teams; multi-monitor and mixed-DPI placement.
- Tray menu and single-instance relaunch.
