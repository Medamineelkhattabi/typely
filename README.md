# TYPELY

An AI-powered universal writing assistant for Windows and Chromium browsers. Typely
corrects, rewrites and translates text wherever you type, without copying it into a
separate app.

> **Status: Phase 1 (shared core) done.** The correction engine, provider adapters and
> schemas are implemented and tested. The desktop app (Phase 2) and browser extension
> (Phase 3) are not built yet. See the [roadmap](docs/development/roadmap.md).

## What exists today

| Package                                                   | Purpose                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@typely/schemas`](packages/schemas)                     | Zod schemas for requests, results, settings and the LLM JSON contract                                                                       |
| [`@typely/provider-adapters`](packages/provider-adapters) | OpenAI, OpenAI-compatible, Anthropic, Gemini and Ollama adapters; secret-isolating transport; retry and fallback chain; LanguageTool client |
| [`@typely/correction-engine`](packages/correction-engine) | Language detection (fr/en/ar), local rules, 8 writing operations, prompt building, response validation and repair, safety guards, word diff |

Highlights:

- **Eight operations**: `fix`, `rewrite`, `professional`, `concise`, `friendly`,
  `clarity`, `translate`, `prompt`.
- **Three modes**: `local` (deterministic rules, plus LanguageTool if configured, with no
  LLM), `ai`, and `hybrid` (the default: local findings feed the LLM, and local rules
  run again on the output).
- **Privacy by default**: cloud processing is off until the user enables it globally
  _and_ per provider. The engine enforces this itself, before any network call.
- **Keys never reach the engine.** Transports resolve secrets by endpoint id, so UI code
  cannot send a key to a host it chooses.
- **Guards** warn when the model changes the language, drops URLs/code/numbers, or
  rewrites too much during a simple correction.

## Quick start

Requires Node.js ≥ 24.

```bash
npm install
```

```bash
npm run check
```

Run the engine from a terminal. With no provider configured, only local rules are used:

```bash
npm run typely -- fix "i think teh the report is ready , can you check it?it is due tomorrow"
```

With a local Ollama model (text stays on your machine):

```bash
TYPELY_PROVIDER=ollama TYPELY_MODEL=llama3.2 npm run typely -- professional "hey can u send me the file asap"
```

With a cloud provider you must explicitly allow cloud processing:

```bash
TYPELY_PROVIDER=anthropic TYPELY_MODEL=<model-id> TYPELY_CLOUD_CONSENT=1 ANTHROPIC_API_KEY=... npm run typely -- translate --to ar "See you tomorrow at the meeting"
```

Other options: `--mode local|ai|hybrid`, `--lang fr` (override detection), `--json`
(full result), `--check` (inline-check issues only). See
[scripts/typely-cli.ts](scripts/typely-cli.ts) for every environment variable.

## Using the engine in code

```ts
import { CorrectionEngine, endpointsFromSettings } from "@typely/correction-engine";
import { DirectTransport } from "@typely/provider-adapters";

const settings = {
  providers: [{ id: "local", kind: "ollama", label: "Ollama", model: "llama3.2" }],
};
const transport = new DirectTransport({
  endpoints: endpointsFromSettings(settings),
  getSecret: async () => undefined, // resolve keys from a secure store
});
const engine = new CorrectionEngine({ settings, transport });

const result = await engine.run({ operation: "fix", text: "Je suis allé a la réunion hier." });
// result.corrected_text, result.explanation, result.changes (diff), result.warnings
```

`DirectTransport` is only for trusted contexts (Node, the extension service worker).
The desktop app will use a transport that delegates to Rust, and the extension's
companion mode will delegate to a native-messaging host.

## Documentation

- [Architecture](docs/architecture/architecture.md)
- [Architecture decisions](docs/architecture/decisions.md)
- [Threat model](docs/security/threat-model.md)
- [Roadmap and checklist](docs/development/roadmap.md)
- [Development setup](docs/development/setup.md)

## Repository layout

```
packages/
  schemas/             shared data contracts
  provider-adapters/   AI providers, transports, LanguageTool
  correction-engine/   the engine
tests/integration/     cross-package tests
scripts/               developer CLI
docs/                  architecture, security, roadmap
```

`apps/desktop`, `apps/extension`, `packages/ui` and `native/bridge` will be added in
Phases 2–3.
