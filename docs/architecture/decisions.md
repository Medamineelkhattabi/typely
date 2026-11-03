# Architecture Decision Records

Format: context → decision → consequences. Status is `accepted` unless noted.

---

## ADR-001 — Monorepo with npm workspaces and a Cargo workspace

**Context.** Node 24 / npm 11 are installed; pnpm, Yarn and Bun are not. The repo holds
TypeScript packages, a Tauri app and (later) a Rust native-messaging host.

**Decision.** npm workspaces for TypeScript (`packages/*`, `apps/*`). A Cargo workspace
will be added in Phase 2 for `apps/desktop/src-tauri` and `native/bridge`.

**Consequences.** No extra package manager to install. Library packages ship TypeScript
source (`exports` → `src/index.ts`); the desktop app and extension bundle them with Vite.
There is no library build step to keep in sync.

---

## ADR-002 — The correction engine is TypeScript and runs inside each surface

**Context.** The brief forbids duplicated correction logic and wants a shared engine for
desktop and extension. Options considered:

1. Python (FastAPI + Pydantic) local service used by both surfaces.
2. Rust engine compiled natively and to WASM.
3. TypeScript engine bundled into the desktop webview and the extension service worker.

**Decision.** Option 3.

**Rationale.** Both surfaces already execute JavaScript; the engine's work is prompt
assembly, JSON validation, text rules and diffing — not CPU-bound. A Python service
would add a 40–80 MB bundled runtime, a second long-running process, port management,
and slower startup, contradicting the idle-memory goal. A Rust/WASM engine is viable but
slows iteration on prompt and rule logic that will change often.

**Consequences.** Python/Pydantic is not used in the MVP. If a server-side component is
ever needed (team policies, shared dictionaries), it will be justified separately.

---

## ADR-003 — No standalone backend service; Rust is the trusted executor

**Context.** The brief suggests `services/backend` for sensitive provider config and API
calls.

**Decision.** The trusted executor is the Tauri Rust process (desktop) and a small Rust
native-messaging host `typely-bridge.exe` (extension companion mode). No HTTP server on
localhost.

**Rationale.** A localhost HTTP service is reachable by any local process and by web
pages (DNS rebinding, CSRF against `127.0.0.1`) unless carefully hardened. Native
Messaging is restricted by Chrome to the extension IDs listed in the host manifest, and
Tauri IPC is restricted to the app's own webviews by capabilities.

---

## ADR-004 — Adapter/transport split; secrets resolved by endpoint id

**Decision.** Provider adapters produce `{method, path, body}`; transports execute them
for an endpoint id whose `baseUrl`, auth scheme and secret are held on the trusted side.

**Consequences.** UI code and content scripts cannot exfiltrate a key to another host,
even if compromised. Rust needs a tiny auth-scheme mapping (4 cases) that mirrors
`AUTH_SCHEMES` in `provider-adapters`; a contract test will pin it.

---

## ADR-005 — Zod 4 schemas as the single source of truth

**Decision.** `packages/schemas` defines all shapes with Zod 4 and exports inferred
types. The JSON Schema sent to LLMs is hand-written to stay inside the intersection of
what OpenAI strict mode, Anthropic `output_config.format` and Ollama `format` accept
(all fields required, `additionalProperties: false`, no numeric/string constraints) and a
unit test checks it stays in sync with the Zod schema.

---

## ADR-006 — Custom language detector for the initial languages

**Context.** General detectors (franc, cld3) are unreliable on the short texts typical of
chat messages and do not handle "French with English technical words" as French.

**Decision.** A deterministic detector: script analysis (Arabic block) + per-language
stop-word and diacritic scoring from `LanguageProfile` modules, with a confidence score
and a mixed-language flag. Users can override detection per request.

**Consequences.** Adding a language = adding a profile (stop-words, characteristic
characters, rules, prompt guidance). Languages without a profile are reported as `und`
and the LLM is asked to detect them.

---

## ADR-007 — Layered grammar checking; no LLM per keystroke

**Decision.** Inline checks (`engine.check`) use only Layer 1 (local rules) and Layer 2
(LanguageTool, if configured), debounced. LLM calls happen only on explicit user action.

**Consequences.** Inline indicators are fast and free; deeper fixes come from explicit
operations. Hunspell dictionaries and Harper (Rust/WASM, English) are candidates for a
richer local Layer 1 in Phase 4; licences (fr: MPL, ar: GPL variants) must be reviewed
before bundling.

---

## ADR-008 — Privacy enforced inside the engine

**Decision.** A provider is _local_ if it is Ollama or its base URL host is loopback.
Calling a non-local provider (or a non-local LanguageTool endpoint) requires
`privacy.cloudProcessingAllowed === true` **and** the provider's own `consentGranted`.
Otherwise the engine throws `ConsentRequiredError` before any network I/O.

**Consequences.** A UI bug cannot silently send text to the cloud.

---

## ADR-009 — Gemini uses JSON mode + prompt schema, not native schema enforcement

**Context.** Gemini's `generationConfig.responseSchema` and `_responseJsonSchema` are
marked deprecated in the current API reference in favour of a newer `responseFormat`
field whose shape is still settling; the docs now centre on a separate Interactions API.

**Decision.** Use the stable `responseMimeType: "application/json"`, put the schema in
the prompt, and validate locally. Revisit in Phase 4.

---

## ADR-010 — Selection capture: UI Automation first, clipboard fallback

**Decision.** Desktop selection capture tries UI Automation `TextPattern`, then simulated
`Ctrl+C` with clipboard snapshot/restore. Replacement uses clipboard + `Ctrl+V` into the
re-focused original window and restores the clipboard afterwards.

**Consequences.** Works in most Win32/WinUI/Electron/browser apps. Known failures:
elevated (admin) target windows (UIPI blocks injected input from a non-elevated process),
apps that block synthetic input, remote desktop/VM windows, and clipboard managers that
record the temporary content. These produce explicit UI states, never silent failure.

---

## ADR-011 — Biome for linting and formatting

**Decision.** Biome (single binary) instead of ESLint + Prettier + typescript-eslint.

**Rationale.** One dev dependency, fast, sufficient rule set; fewer files synced and
installed. TypeScript strictness is enforced by `tsc`.

---

## ADR-012 — Imports use explicit `.ts` extensions

**Decision.** `allowImportingTsExtensions` + `erasableSyntaxOnly`; relative imports use
`.ts`. Node 24 can then run scripts (dev CLI, smoke tests) directly with built-in type
stripping, and Vite/Vitest handle the same source unchanged.

**Consequences.** No `enum`, `namespace` or parameter properties in source.

---

## ADR-013 — snake_case on the wire, camelCase in code

**Decision.** Every schema in `packages/schemas` (requests, results, settings) uses
snake_case field names, matching the JSON contract in the product brief and `serde`'s
default in Rust. TypeScript locals and internal interfaces stay camelCase.

---

## ADR-014 — Local rules are high-precision and multi-pass

**Decision.** Layer 1 rules only flag what is almost always wrong; anything ambiguous
(several candidate replacements) is reported but never auto-applied. Local fixing runs
up to three passes because one fix can reveal another ("teh the" → "the the" → "the").
Rule messages for shared rules are currently English; UIs will localise them by
`rule_id` in Phase 2.

---

## ADR-015 — Local-model policy

Status: accepted; the keep-alive part is superseded by ADR-016 (5-minute warm window).

**Context.** The Ollama benchmark
([ollama-benchmark.md](../development/ollama-benchmark.md)) on the reference laptop
(i7-1355U, Iris Xe) found:
- the cloud prompt costs ~13 s of CPU prompt processing;
- reasoning models think by default, taking 200 s for one sentence;
- Ollama keeps models loaded for 5 minutes and samples at temperature 0.8.

**Decision.** For Ollama, the adapter defaults to `keep_alive: 0` (unload after every
request), `think: false` and temperature 0.2. Prompts for local endpoints use a
**compact profile**: no schema dump (Ollama enforces it through `format`), shorter rules,
and at most 3 explanations for corrections and none for rewrites. Highlights come from
the engine's own diff. Each default is overridable per provider (`keep_alive_seconds`,
`thinking`, `temperature`, `prompt_profile`). Prompts are built per provider inside the
fallback chain.

**Consequences.**
- Corrections are 2.5–3× faster and repeatable.
- Typely holds no model memory while idle; every request pays the load time (~2–3 s with a 1B model).
- 1–2B local models are limited to simple corrections; see roadmap gating.

---

## ADR-016 — Warm local model, plain-text output, streaming (2-second target)

**Context.** The user set a 2-second response target. Measurements on the reference laptop
([ollama-benchmark.md](../development/ollama-benchmark.md#latency-against-the-2-second-target-2026-11-03)):
- loading gemma3:1b alone takes 2.2 s, so a cold request can never meet the target;
- JSON output with explanations doubles or triples generation time.

**Decision** (user-approved 2026-11-03):
- **Warm window:** Ollama keeps the model for **5 minutes** after the last request (`keep_alive_seconds` default 300; 0 restores immediate unload). Still nothing is loaded at startup or by inline checks.
- **Plain-text output:** local providers default to `output_format: "text"`. The model returns only the resulting text; the engine cleans it, derives explanations from its own diff, and reuses local-rule messages and categories where the fragments match. Cloud providers keep JSON.
- **Local pre-pass:** in hybrid correction, the deterministic fixes are applied before the text is sent to a plain-text model (no hint list, shorter prompt), and are reported immediately through `onLocalPreview` (< 50 ms).
- **Streaming:** `onPartialText` streams the model's text. `Transport.stream` is optional, and `DirectTransport` implements it for NDJSON. The Tauri transport will need an event-based equivalent in Phase 2.
- **Off-task rejection** (see T5 in the threat model): for corrections, output that changes the language or rewrites more than half the characters is discarded in favour of the local result (`ai_rejected` warning).

**Consequences.**
- Repeat corrections within 5 minutes skip the load. Up to ~1.4 GB (1B) stays resident while warm, at ~0% CPU.
- Whether 2 s is met depends on message length and on the laptop's power and thermal state. See the measurements below.
- gemma3 uses sliding-window attention, so Ollama cannot reuse a partially matching cached prompt: instructions are re-read on every request.

---

## ADR-017 — Desktop trusted executor details

Status: accepted (Phase 2, 2026-11-03).

**Context.** ADR-004 and ADR-016 left the desktop transport, key storage and panel mechanics
to Phase 2.

**Decision.**
- **Endpoints come from Rust's own settings copy.** The webview names an endpoint id; Rust
  derives the base URL and auth scheme from the settings file it persists (validated again on
  every save), never from request arguments.
- **Keys are bound to an origin.** A key is stored in the Windows Credential Manager together
  with the origin of the endpoint it was entered for. If the base URL is later changed to
  another host, the key is not sent until the user enters it again. Keys are never sent over
  plain HTTP to a non-loopback host. No command returns a key.
- **Streaming uses a Tauri channel, not global events.** `provider_stream` pushes each NDJSON
  line over an `ipc::Channel` scoped to the calling webview, then an `end` marker (the
  command's result can arrive before the last line). `provider_cancel` aborts by request id,
  including a cancel that arrives before the request registered.
- **The panel is activated with `SetForegroundWindow`,** not Tauri's `set_focus`, which on
  Windows injects an Alt keypress that reaches the source app (menu key tips, menu bar).
  Our process may take the foreground because it just received the hotkey.
- **Replace pastes into the recorded window only** for the capture that produced the text
  (capture id); the webview never sees the window handle.
- **No installer yet.** `bundle.active` is off so `tauri build` downloads no bundler tools;
  installers come with signing in Phase 5.

**Consequences.** A compromised webview can still change consent settings or send text to an
endpoint the user configured, but it cannot read a key or move one to another host.

---

## ADR-018 — Local spell checking in Layer 1

Status: accepted (2026-11-03).

**Context.** A user's sentence kept the typo "imlpressive": gemma3:1b and gemma3:4b both
returned it unchanged, and Layer 1 only knew a curated list of common misspellings. Clearer
prompt wording did not help. A fix that depends on a model noticing is not dependable.

**Decision.**
- The engine accepts an optional `Speller`. Its findings join the local rules, so they show
  in the instant preview and are applied before a plain-text model sees the text.
- **English:** a bundled SCOWL word list (US and British spellings, 113 k words, 516 KB
  front-coded, permissive licence; see THIRD_PARTY_NOTICES.md), decoded on first use.
- **Other languages:** the Windows spell checker for the languages installed in Windows
  (`spell_check` command, local).
- **One policy for both** (`spellingIssue`), stricter than "one edit away". A fix is applied
  automatically only when it is typo-shaped and unambiguous: two adjacent letters swapped, a
  doubled letter added or dropped, a stray consonant next to a neighbouring key on QWERTY or
  AZERTY (never the first or last letter), missing accents added, or Windows' own confident
  replacement. Other candidates are suggested, never applied. Unknown words with no close
  candidate (names, jargon) are left alone. Acronyms, mid-sentence capitalised words,
  identifiers and, for the English list, accented words are not checked.

- **Every action, not only Correct** (hybrid mode): rewrites, tone changes, translation and
  prompt improvement start from the locally fixed text, and the model's output is spell-checked
  again, in the target language for Translate. Model-only mode (`ai`) is left untouched.

**Consequences.**
- On 20,000 words of this repository's docs and source, every automatic fix was a real typo;
  jargon such as Ollama, keyring, rustup or kubectl was left alone.
- English spell checking works without a Windows language pack. French and Arabic depend on
  Windows having that language installed.
- The first check after start-up takes ~70–120 ms to decode the list (~10 MB in memory);
  later checks take under 1 ms.
- Replaces the Phase 4 Hunspell/Harper evaluation for English. French and Arabic
  dictionaries no longer need a licence review, as Windows provides them.

---

## ADR-019 — English number agreement as local rules

Status: accepted (2026-11-03).

**Context.** "There is a lot of issue." stayed unchanged: gemma3:1b, the fast model for
Correct, cannot fix number agreement with any prompt wording, and the deeper check on
gemma3:4b costs a click and several seconds for a very common mistake.

**Decision.** Two English rules in Layer 1, so the fix is instant and needs no model:
- `EN_QUANTIFIER_PLURAL`: a singular noun after a quantifier becomes plural ("several bug" →
  "several bugs", "three meeting tomorrow" → "three meetings"). Quantifiers that also take
  uncountable nouns ("a lot of", "lots of", "plenty of") only pluralise common countable nouns
  from a curated list ("a lot of information" stays). Only nouns right before the end of a
  clause, a conjunction or a time word are touched. Not "both" and not digits, which matched
  verbs, versions and labels in real text.
- `EN_THERE_IS_PLURAL`: "there is/was/'s" before a quantified plural noun becomes "there
  are/were"; "news", "series" and similar are excluded.

**Consequences.** On ~20,000 words of this repository's docs and code, the only match is a
real error. Rarer shapes ("These issue are fixed") are left to the model and the deeper check.

---

## ADR-020 — LanguageTool as the local grammar layer, started on demand

Status: accepted (2026-11-03, user choice: portable, on demand).

**Context.** The user wants to rely on the panel for English and French grammar. Handwritten
rules cannot cover that; LanguageTool has thousands of rules for both, and the engine already
supported it as Layer 2 (ADR-007) without a local server.

**Decision.**
- **Portable install, no system change:** a Temurin JRE and LanguageTool in
  `%LOCALAPPDATA%\Typely\languagetool` (setup.md), not bundled with Typely.
- **Rust manages the process** (`languagetool.rs`): loopback port 18081, hidden window,
  512 MB heap cap, serial GC. Started when the panel opens (an explicit action), warmed up
  for English and French in the background, stopped after 10 idle minutes or with Typely; a
  job object kills it even if Typely crashes. Nothing runs at startup.
- **Never waited for:** until it is ready, the transport answers at once and the engine goes
  on with its other layers; the panel says the grammar checker is starting.
- **What may be applied automatically** (`isSafeLanguageToolFix`, schema field
  `auto_fix`): grammar, agreement and confusion rules. Spelling (Typely's dictionary is
  stricter with names), spacing and casing (Typely's own rules), commas, style, US/UK
  preferences and capitalised words in mid-sentence are suggestions only, and so are two
  grammar fixes on adjacent words (they can contradict: "This are" → "These is").

**Consequences.**
- Measured: ready in 6.3 s, first English check 10.9 s (rule loading), then ~0.1 s per check;
  French ~1.2–2 s for its first checks. ~0.4–0.5 GB while running, nothing when stopped.
- Real-text precision: on this repository's English docs, 0 automatic LanguageTool fixes;
  on typical errors it fixes "I has a apple" → "I have an apple", "tu vien" → "tu viens",
  "je les ai vu" → "vus", "a la gare" → "à la gare".
- The first correction after starting cannot include LanguageTool: the panel shows it at once,
  then checks the same text again by itself when the server is ready (about 20 s).
- Findings that need a human decision ("vu" → vus | vues) are returned as `suggestions` on
  the result; the panel lists them under "To check" and applies the candidate the user picks.
- Typely does not download LanguageTool itself yet; an in-app installer is future work.
