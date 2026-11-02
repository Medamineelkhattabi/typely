# Development Setup

## Environment snapshot

Taken 2026-11-02 on the primary development machine.

| Tool                      | Status                             | Needed for                                 |
| ------------------------- | ---------------------------------- | ------------------------------------------ |
| Windows 11 Pro 26200      | ✅                                 | —                                          |
| Node.js 24.20 / npm 11.19 | ✅                                 | all TypeScript packages                    |
| Git 2.55                  | ✅ (no global identity configured) | version control                            |
| Python 3.12               | ✅                                 | not required (ADR-002)                     |
| Docker 29.7               | ✅                                 | optional self-hosted LanguageTool          |
| WebView2 runtime 156      | ✅                                 | Tauri desktop                              |
| Chrome 155, Edge 156      | ✅                                 | extension testing                          |
| Rust (rustup/cargo)       | ❌ missing                         | Phase 2 desktop, Phase 3 bridge            |
| MSVC C++ Build Tools      | ❌ missing                         | Rust on Windows (`x86_64-pc-windows-msvc`) |
| Ollama                    | ❌ not installed                   | optional local models                      |

### ⚠️ Repository location

The working copy currently sits inside a **OneDrive-synced folder** with spaces in its
path. Before Phase 2 move it to a non-synced path such as `C:\dev\typely`:

- `node_modules` (~tens of thousands of files) and Rust `target/` (several GB) would be
  synced to OneDrive continuously.
- OneDrive file locking intermittently breaks `cargo`, `npm` and file watchers.

## Install commands

Phase 1 (TypeScript core) — already satisfied:

```bash
npm install
```

Phase 2 prerequisites (run in an elevated PowerShell, one at a time):

```bash
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

```bash
winget install --id Rustlang.Rustup
```

```bash
rustup default stable-msvc
```

Optional:

```bash
winget install --id Ollama.Ollama
```

```bash
docker run -d --name languagetool -p 8081:8010 erikvl87/languagetool
```

(The LanguageTool image is community-maintained; review it before use or build from the
official LanguageTool release.)

## Everyday commands

| Command                           | What it does                                  |
| --------------------------------- | --------------------------------------------- |
| `npm test`                        | Run all unit tests (Vitest)                   |
| `npm run typecheck`               | Strict TypeScript check of every package      |
| `npm run lint`                    | Biome lint + format check                     |
| `npm run format`                  | Apply Biome formatting                        |
| `npm run check`                   | typecheck + lint + test                       |
| `npm run typely -- <op> "<text>"` | Run the engine from the terminal (see README) |
