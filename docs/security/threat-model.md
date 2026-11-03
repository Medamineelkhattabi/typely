# TYPELY — Threat Model

Status: Phase 0 baseline (2026-11-02). Method: assets → trust boundaries → STRIDE-style
threats → mitigations → residual risk. Revisit at the end of every phase.

## 1. Assets

| Asset                                                                           | Sensitivity                                                 |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Provider API keys (OpenAI, Anthropic, Gemini, compatible, LanguageTool premium) | High — direct financial cost, account abuse                 |
| Text the user writes or selects                                                 | High — may contain personal, corporate or confidential data |
| Content of pages/apps the user did _not_ select                                 | High — must never be collected                              |
| Settings (allow/blocklists, provider config)                                    | Medium                                                      |
| Clipboard contents (restored after temporary use)                               | High — may hold passwords or secrets                        |

## 2. Trust boundaries

```
 [Web page JS] ─┬─ (DOM only) ─► [Content script, isolated world] ─(runtime msg)─► [Service worker]
                │                                                                    │
                │                                         (native messaging, stdio)  │
                ▼                                                                    ▼
 [Other local processes] ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ► [typely-bridge.exe]
                                                                                     │
 [Desktop webview (React)] ─(Tauri IPC, capability-scoped)─► [Tauri Rust core] ─────┤
                                                                                     ▼
                                                  [Windows Credential Manager]   [AI providers / LanguageTool]
```

Untrusted: web pages, the text itself (it may contain prompt-injection), provider
responses, other local processes. Trusted: Rust core, bridge, service worker, our own
webviews.

## 3. Threats and mitigations

### T1 — API key theft by a web page or compromised content script

- Keys never enter content scripts or desktop webviews (ADR-004).
- Companion mode: keys stay in Windows Credential Manager; only the bridge reads them.
- Standalone mode: keys kept in `chrome.storage.session` with access level
  `TRUSTED_CONTEXTS` (content scripts cannot read it); cleared on browser restart.
  Residual: a malicious extension update or local malware with user privileges can read
  keys — inherent to any client-side key storage.
- Endpoint-id indirection prevents redirecting a key to an attacker host.
- Desktop (implemented, ADR-017): a key is stored with the origin it was entered for and is
  not sent if the endpoint later points elsewhere, nor over plain HTTP to a remote host.
  The `secret_*` commands are write-only and granted to the settings window only.

### T2 — Silent exfiltration of user text to the cloud

- Engine-level consent gate (ADR-008); visible "processing with <provider>" indicator in
  every surface.
- Only the selected text / active field is sent; no page scraping, no conversation
  history.
- No telemetry; no server operated by Typely.

### T3 — Capturing sensitive fields (passwords, payment, OTP)

- Extension ignores `input[type=password|hidden|email|tel|number]`, fields with
  `autocomplete` in {`current-password`, `new-password`, `one-time-code`, `cc-*`},
  `aria-hidden` and `data-typely="off"` fields, and blocklisted sites.
- Desktop: UI Automation `IsPassword` property checked; capture refused for password
  controls (no clipboard fallback either). Clipboard fallback is only triggered by explicit
  user shortcut.

### T4 — Clipboard leakage

- Clipboard used only on explicit action; previous content snapshotted (all formats
  Typely can round-trip: text, HTML, RTF, files list, image) and restored after a short
  delay; if a format cannot be restored the user is warned _before_ the operation.
- Windows clipboard-history exclusion formats
  (`ExcludeClipboardContentFromMonitorProcessing`, `CanIncludeInClipboardHistory = 0`)
  set on temporary content so it is not recorded by Win+V history or cloud clipboard.
- Implemented (Phase 2): HGLOBAL formats are copied byte for byte and enhanced metafiles
  deep-copied. Owner-display and private GDI formats count as unrestorable; then the
  clipboard is not touched at all (capture offers the paste box, Replace asks for Copy).
  The clipboard is not restored if another program wrote to it in the meantime.
- Residual: on the Ctrl+C capture path the _source app_ writes the selection to the
  clipboard, so Win+V history may record it. Only content Typely writes carries the
  exclusion formats.

### T5 — Prompt injection through the corrected text

- Text is wrapped as inert data with explicit instructions that it must be transformed,
  not obeyed; the output is constrained to a JSON contract and validated.
- Output can only ever be _proposed_ to the user — no tool use, no automatic actions,
  never silent replacement.
- Guards flag suspicious outputs (language drift, lost URLs/code, excessive rewriting on
  `fix`).
- **Measured 2026-11-03:** gemma3:1b followed injected instructions with every prompt
  wording tried. It wrote a poem, answered "Paris", replied "OK" to a fake `SYSTEM:` line,
  and translated text it was asked to correct. Prompt wording is therefore not a defence
  for small local models. The engine now **rejects** any correction whose output changes
  the language or rewrites more than half the characters, and returns the deterministic
  result instead (`ai_rejected`). All four real attacks were rejected; legitimate dense
  corrections (Arabic hamza, English homophones) were not. Rewrite-type operations cannot
  use this check (they change text by design), so they rely on the guards' warnings and
  the user's review before _Replace_.

### T6 — Malicious or malformed provider responses

- Strict Zod validation; size limits; no HTML rendering of model output (rendered as text).

### T7 — Local process abusing the trusted executor

- No localhost HTTP server (ADR-003). Native messaging host manifest restricts
  `allowed_origins` to Typely's extension ID(s). Tauri capabilities restrict IPC to app
  windows; CSP blocks remote scripts in webviews.

### T8 — Injected keystrokes into the wrong window

- Replacement re-focuses the _recorded_ window handle and verifies it is foreground and
  the same process before sending `Ctrl+V`; otherwise it aborts and offers Copy.
  Implemented; the check is repeated after the clipboard is prepared, and elevated targets
  are detected up front.
- The focused control is recorded at capture (UI Automation) and must have keyboard focus
  again before pasting: a window can come back with focus elsewhere (an Electron app gave
  it to its chat box instead of an embedded web view). Typely calls `SetFocus` on it and
  pastes nothing if that fails.

### T9 — Supply chain

- Minimal dependencies, lockfile committed, `npm audit` / `cargo audit` in CI,
  versions pinned at least two weeks old, Tauri updater artifacts signed.

### T10 — Extension over-permission

- `host_permissions` limited to `<all_urls>` only because the product is universal; the
  content script is inert until a field is focused on an allowed site; optional
  per-site activation mode available. No `tabs`, `history`, `cookies`, `webRequest`.

## 4. Integration-specific limitations (to be completed as integrations are tested)

| Integration                    | Limitation                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Google Docs                    | Canvas-rendered editor; DOM text is not the document. Requires the accessibility/annotated-canvas mode or the desktop shortcut path. |
| Elevated Windows apps          | UIPI blocks synthetic input from a non-elevated Typely.                                                                              |
| Remote desktop / VMs           | Selection lives in another machine; clipboard path only.                                                                             |
| Microsoft Teams (desktop, new) | WebView2-based; UI Automation exposure varies by build — clipboard path as fallback.                                                 |

## 5. Open items

- Code-signing certificate for the Windows installer and native host (SmartScreen).
- Chrome Web Store / Edge Add-ons privacy disclosures.
- Decide whether to support enterprise policy (registry/GPO) for allowlists.
