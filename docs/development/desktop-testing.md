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
it cannot. Re-tested by the user after the fix: works.

## Spell checking (2026-11-03, ADR-018)

User report: "imlpressive" was not corrected (gemma3:1b and gemma3:4b both returned the text
unchanged). After the local spell-check layer, in Notepad with the shortcut: the instant local
fixes already show "impressive", and the final result explains it ("Spelling: imlpressive →
impressive"). A one-word selection (language undetermined) is fixed too. The Windows spell
checker was verified from Rust with French (`recu` → reçu, `etait` → était,
`interessant` → intéressant); English uses the bundled list because no English Windows
language pack is installed on this machine.

**All actions.** With the same sentence, Professional on gemma3:4b (CLI, same engine and
word list) received "impressive" instead of "imlpressive" and listed the spelling fix first.
The panel path for non-Correct actions was not re-run by hand.

## Grammar and paste reliability (2026-11-03)

**Grammar.** User report: "Hello, there is a lot of issue." came back unchanged. Local rules,
gemma3:1b and gemma3:4b all returned it as is. Measured on 8 cases (3 with grammar errors, 5
that must stay unchanged, including jargon, French and a prompt injection):

| Correction wording                                          | gemma3:1b    | gemma3:4b                                                         |
| ----------------------------------------------------------- | ------------ | ----------------------------------------------------------------- |
| Previous ("minimal changes… return correct text unchanged") | 1 of 3 fixed | 2 of 3 fixed                                                      |
| New ("correct every error… change only what is wrong")      | 1 of 3 fixed | **3 of 3 fixed**, 5 of 5 kept                                     |
| New + an example in the prompt                              | 1 of 3       | 3 of 3, but leaked the example into a correct sentence (rejected) |

gemma3:1b cannot fix "a lot of issue" or "We has three meeting" with any wording. After a
second user report ("There is a lot of issue."), number agreement after quantifiers became
local rules (ADR-019): instant and model-independent. The panel
now offers **Check again with gemma3:4b** after a correction by a small model; verified in
Notepad: "Hello, there are a lot of issues." (18.6 s cold, 2–7 s warm).

**Paste.** Replace logged success in Notepad while nothing was pasted. Notepad is a WinUI app:
keys go through an input-site window, and a Ctrl+V sent ~35 ms after reactivation was
dropped (a Ctrl+V sent later by hand worked). A 120 ms settle helped only 2 runs in 3.
Delayed clipboard rendering was tried to detect the paste, but Windows' clipboard watcher
requests the data on its own, so it cannot tell a paste from a watcher. Standard edit
controls (Edit, RichEdit, Notepad's RichEditD2DPT) now get WM_PASTE, which does not depend on
keyboard routing: verified on Notepad by sending it directly. The end-to-end Replace through
the panel with this change still needs a manual run.

**Teams.** Replace refused twice ("could not put the cursor back in the original text
field"). The focus check now waits for the app to restore its own focus and recognises a
recreated control by its fingerprint (process, control type, ids, position). Not re-tested in
Teams yet.

## Grammar checker (LanguageTool, 2026-11-03)

Through the panel in Notepad, with LanguageTool installed portably and turned on:
- Nothing runs at Typely startup (no Java process).
- First shortcut press: LanguageTool starts in the background; the correction does not wait
  and the panel shows "The grammar checker is starting; it will be used from the next
  correction." It listens on 127.0.0.1 only; ~0.5 GB during warm-up.
- About 20 s later, the same sentence: "I has a apple and I could of eaten it yesterday." →
  "I have an apple and I could have eaten it yesterday.", with LanguageTool's explanations,
  2.4 s including the model. Replace pasted it (read back from the window).
- French ("Il faut que tu vien demain, je les ai vu a la gare.") first showed only "à": two
  correct fixes 18 characters apart were held back as "conflicting". The conflict check now
  only covers adjacent words. In the panel it then still missed "viens": Windows' French spell
  checker flagged "vien" first as an uncertain suggestion, which hid LanguageTool's clear fix.
  Overlapping findings now prefer a clear fix over a suggestion. Re-run in the panel:
  "Il faut que tu viens demain, je les ai vu à la gare." ("vu" is left: LanguageTool offers
  "vus" or "vues", which needs a human).
- User test in WhatsApp right after the checker had stopped: only "à" (from the model), because
  that correction started the checker. The panel now re-checks by itself once it is ready;
  in Notepad, cold start: first "à" only with the note, then without any action "viens" and
  "à", and "vu" listed under "To check" with "vus" and "vues". Choosing "vus" then Replace
  pasted "Il faut que tu viens demain, je les ai vus à la gare."

## Browser (user test, 2026-11-03, after the focus fix)

From the diagnostics log (capture method, app, outcome):

| Where                                         | Capture       | Replace |
| --------------------------------------------- | ------------- | ------- |
| Brave, `<input type="text">` (French text)    | UI Automation | ✅      |
| Electron app, embedded web view, `<textarea>` | UI Automation | ✅      |

Brave's textarea and contenteditable fields and the password-field refusal were not logged,
so they remain unverified.

## Not verified yet

- Browser: Edge and Chrome; textarea and contenteditable fields in Brave; rich editors
  (Gmail, ChatGPT, Teams web).
- The clipboard fallback (Ctrl+C) in an app without UI Automation text support.
- Password fields (the UI Automation `IsPassword` refusal) in a real app.
- Elevated (administrator) target windows; a shortcut already taken by another app.
- Word, Outlook, Teams; multi-monitor and mixed-DPI placement.
- Tray menu and single-instance relaunch.
