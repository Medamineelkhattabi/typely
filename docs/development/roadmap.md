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

Prerequisite: Rust toolchain + MSVC Build Tools (see setup.md). Move repo out of OneDrive.

- [ ] Tauri 2 scaffold (`apps/desktop`), Cargo workspace, CI build
- [ ] Rust: settings store, keyring secrets, `provider_request` command (reqwest), auth-scheme contract test
- [ ] Rust: single instance, tray, autostart toggle
- [ ] Global shortcut (configurable, conflict detection)
- [ ] Selection capture: UI Automation → clipboard fallback with snapshot/restore
- [ ] Floating panel: positioning, focus handling, states (loading / result / error / no selection)
- [ ] Replace selection (refocus + paste + clipboard restore), copy, retry, rewrite options
- [ ] Main window: dashboard, writing assistant (diff view), providers, languages, shortcuts, privacy, general
- [ ] `packages/ui` shared components (only those reused by the extension)
- [ ] Localise shared local-rule messages by `rule_id` (currently English; ADR-014)
- [ ] Desktop tests: shortcut, capture in Notepad / Word / Outlook / Teams / browser, clipboard restore, elevated-app failure path
- [ ] Local AI: detect an installed Ollama (never bundle it), show its status, recommend `OLLAMA_IGPU_ENABLE=1` and `OLLAMA_NO_CLOUD=1`
- [ ] Gate 1B-class local models to `fix`; other operations need the quality model or are labelled experimental
- [ ] Show guard warnings (`language_changed`, `excessive_changes`, `protected_token_lost`) before _Replace_
- [ ] Tune `excessive_changes` for short error-dense text and Arabic (false positives in the benchmark)
- [ ] Decide on hint placement for the compact prompt (qwen3.5 echoed the hint block)
- [x] Validate a 4B-class model on the iGPU: gemma3:4b, no damaging failures, ~17 s, 4.5 GB ([report](ollama-benchmark.md#gemma34b-validation-2026-11-03))
- [ ] Two-tier local setup in the UI: gemma3:1b for `fix`, gemma3:4b for the other operations; 1B-only on ≤ 16 GB machines
- [ ] Language-aware routing (send Arabic corrections to the quality model)
- [ ] Measure dropping model-written explanations for local `fix` (estimated 4B: ~11–14 s instead of ~17 s)
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

- [ ] Richer local Layer 1 (Hunspell / Harper evaluation, licence review)
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
