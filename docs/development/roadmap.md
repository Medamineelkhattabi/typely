# TYPELY — Roadmap & Development Checklist

Legend: `[x]` done and verified · `[~]` in progress · `[ ]` not started.
An item is only checked when it is implemented **and** tested; "compiles" is not done.

## Phase 0 — Discovery & architecture ✅

- [x] Inspect environment (see [setup.md](setup.md#environment-snapshot))
- [x] Validate architecture, record decisions (ADR-001 … ADR-012)
- [x] Verify provider structured-output APIs against current docs (OpenAI, Anthropic, Gemini, Ollama)
- [x] Threat model
- [x] Repository structure, tooling (npm workspaces, TypeScript strict, Biome, Vitest)

## Phase 1 — Shared core

- [x] `schemas`: operations, languages, requests, results, issues, settings, LLM output contract
- [x] Language profiles: French, English, Arabic (stop-words, scripts, rules, prompt guidance)
- [x] Language detection with confidence, mixed-language flag, user override
- [x] Protected spans (URLs, e-mails, inline/fenced code, mentions, hashtags)
- [x] Layer 1 local rules + safe fix application
- [x] Word-level diff (Myers, `Intl.Segmenter`, RTL-safe)
- [x] Operation definitions & prompt builder (8 operations)
- [x] JSON extraction, validation, single repair attempt
- [x] Guards: language drift, lost protected tokens, over-editing on `fix`
- [x] Provider adapters: OpenAI, OpenAI-compatible, Anthropic, Gemini, Ollama (+ `listModels`)
- [x] Transport interface, `DirectTransport` with endpoint-id secret resolution
- [x] Retry with backoff + provider fallback chain + cancellation
- [x] LanguageTool client (Layer 2) + merge with local issues
- [x] Engine: `check()` and `run()` with consent gate and size limits
- [x] Unit tests for all of the above
- [x] Dev CLI (`npm run typely`) to exercise the engine against a real provider
- [x] Live validation against a real provider: Ollama, gemma3:1b and qwen3.5:2b, fr/en/ar ([ollama-benchmark.md](ollama-benchmark.md))
- [x] Local-model resource policy: unload after use, no reasoning, temperature 0.2, compact prompt

## Phase 2 — Windows MVP

Prerequisite: Rust toolchain + MSVC Build Tools (see setup.md). Desktop app: [apps/desktop](../../apps/desktop).

- [~] Tauri 2 scaffold (`apps/desktop`), Cargo workspace, CI build — scaffold and workspace done; `npm run check` runs fmt, clippy and cargo test; GitHub Actions runs it on Windows for every push and pull request
- [x] Rust: settings store, keyring secrets, `provider_request` command (reqwest), auth-scheme contract test (ADR-017)
- [~] Rust: single instance, tray, autostart toggle — single instance and tray implemented, not manually tested; no autostart toggle yet
- [~] Global shortcut (configurable, conflict detection) — works in Notepad; invalid shortcuts refused; a shortcut taken by another app is reported but that case is not manually tested
- [~] Selection capture: UI Automation → clipboard fallback with snapshot/restore — UI Automation verified in Notepad; the clipboard fallback is implemented but was not exercised in a real app
- [x] Floating panel: positioning, focus handling, states (loading / result / error / no selection)
- [~] Replace selection (refocus + paste + clipboard restore), copy, retry, rewrite options — Replace, undo, clipboard restore, re-run, Professional and Copy verified in Notepad
- [~] Main window: dashboard, writing assistant (diff view), providers, languages, shortcuts, privacy, general — assistant, local AI, providers (with consent and write-only keys), privacy and general done; no dashboard or languages page
- [ ] `packages/ui` shared components (only those reused by the extension)
- [ ] Localise shared local-rule messages by `rule_id` (currently English; ADR-014)
- [~] Desktop tests: shortcut, capture in Notepad / Word / Outlook / Teams / browser, clipboard restore, elevated-app failure path — Notepad, Brave (text input) and an Electron web view verified (2026-11-03, [log](desktop-testing.md)); Office, Teams, other browsers and elevated apps not tested
- [x] Local AI: detect an installed Ollama (never bundle it), show its status, recommend `OLLAMA_IGPU_ENABLE=1` and `OLLAMA_NO_CLOUD=1`
- [x] Gate 1B-class local models to `fix`; other operations need the quality model or are labelled experimental
- [x] Show guard warnings (`language_changed`, `excessive_changes`, `protected_token_lost`) before _Replace_ (and `ai_rejected`, verified with a real injection)
- [ ] Decide on hint placement for the compact prompt (qwen3.5 echoed the hint block)
- [x] Validate a 4B-class model on the iGPU: gemma3:4b, no damaging failures, ~17 s, 4.5 GB ([report](ollama-benchmark.md#gemma34b-validation-2026-11-03))
- [x] Two-tier local setup in the UI: gemma3:1b for `fix`, gemma3:4b for the other operations; 1B-only on ≤ 16 GB machines
- [ ] Language-aware routing (send Arabic corrections to the quality model)
- [ ] Measure dropping model-written explanations for local `fix` (estimated 4B: ~11–14 s instead of ~17 s)
- [x] 2-second target, engine side (ADR-016): 5-minute warm window, plain-text output for local models, local pre-pass, `onLocalPreview`, `onPartialText` streaming
- [x] Off-task rejection for corrections (prompt-injection defence that works regardless of the prompt)
- [x] `excessive_changes` now measured per character (no false positives on Arabic or dense fixes)
- [x] Desktop panel: show the local result at once, stream AI text, then the final result; event-based streaming in the Tauri transport (Tauri channel, ADR-017)
- [ ] Re-measure end-to-end latency with the laptop idle (not charging, stray process stopped); evaluate a full-attention 1B model (e.g. llama3.2:1b, needs a download) for prompt-cache reuse
- [ ] **MVP usability gate** before Phase 3

## Phase 3 — Browser extension

- [ ] MV3 scaffold (`apps/extension`), Vite build, Chrome + Edge
- [ ] Service worker running the engine; companion (native messaging) and standalone transports
- [ ] `native/bridge` Rust host + per-user registry install for Chrome and Edge
- [ ] Editable-field detection, sensitive-field exclusion, allow/blocklist
- [ ] Selection toolbar (Correct, Rewrite, Professional, Concise, Clarity, Translate, Explain)
- [ ] Inline indicators (Shadow-DOM overlay, debounced `check()`)
- [ ] Replacement preserving undo (`setRangeText`, `execCommand('insertText')`, `beforeinput`)
- [ ] Site adapters, tested in order: ChatGPT, Teams web, Gmail, Outlook web, LinkedIn, WhatsApp Web, Google Docs (investigation)
- [ ] Playwright e2e on local fixtures replicating each editor (ProseMirror, Lexical, Draft.js, Quill, CKEditor) + manual checklist on live sites

## Phase 4 — Advanced capabilities

- [~] Richer local Layer 1: spell checking done (bundled SCOWL English list + Windows spell checker for installed languages, ADR-018); grammar beyond the rules still open
- [ ] Self-hosted LanguageTool guide (Docker) and settings UI
- [ ] Translation UX, target-language memory per site/app
- [ ] Prompt-improvement UX tuned for ChatGPT and Gemini
- [ ] Usage statistics + user-editable price table for cost estimates
- [ ] Operation-specific models, fallback configuration UI
- [ ] Gemini native schema enforcement (revisit ADR-009)

## Phase 5 — Production readiness

- [ ] Security review against threat model; `npm audit`, `cargo audit`
- [ ] Performance budget: idle RAM, startup time, extension content-script cost
- [ ] Local error log + export
- [ ] Windows installer (NSIS/MSI via Tauri bundler), code signing, updater
- [ ] Chrome Web Store and Edge Add-ons packages, privacy policy
- [ ] Complete user & developer documentation

## Recommended MVP scope

Desktop shortcut flow (select → Ctrl+Shift+Space → panel → Fix / Rewrite / Professional
/ Concise / Translate → Replace or Copy) with one cloud provider **or** Ollama, French /
English / Arabic, hybrid mode, consent gate, keyring storage. Extension and inline
indicators follow once the desktop MVP is validated in daily use.
