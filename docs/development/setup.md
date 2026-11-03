# Development Setup

## Environment snapshot

Taken 2026-11-02 on the primary development machine; toolchain rows updated 2026-11-03.

| Tool                      | Status                                                                | Needed for                                 |
| ------------------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| Windows 11 Pro 26200      | ✅                                                                    | —                                          |
| Node.js 24.20 / npm 11.19 | ✅                                                                    | all TypeScript packages                    |
| Git 2.55                  | ✅ repo-local identity (confirmed)                                    | version control                            |
| Python 3.12               | ✅                                                                    | not required (ADR-002)                     |
| Docker 29.7               | ✅                                                                    | optional self-hosted LanguageTool          |
| WebView2 runtime 156      | ✅                                                                    | Tauri desktop                              |
| Chrome 155, Edge 156      | ✅                                                                    | extension testing                          |
| Rust (rustup/cargo)       | ✅ rustup 1.29.2, rustc/cargo 1.99.1, `stable-x86_64-pc-windows-msvc` | Phase 2 desktop, Phase 3 bridge            |
| MSVC C++ Build Tools      | ✅ VS Build Tools 2022 17.14, MSVC 14.44, Windows SDK 10.0.26100      | Rust on Windows (`x86_64-pc-windows-msvc`) |
| Ollama                    | ❌ not installed                                                      | optional local models                      |

Verified 2026-11-03: a Rust release build compiles, links with MSVC and runs (1.3 s).
Windows long-path support is off (`LongPathsEnabled = 0`): keep the repository at a short
path such as `C:\dev	ypely`. Cargo fails with "path too long" under deep folders.

### Repository location

Keep the working copy out of cloud-synced folders (OneDrive, Dropbox): `node_modules` and
Rust's `target/` hold tens of thousands of files, and sync locking breaks `cargo`, `npm` and
file watchers.

## Toolchain requirements for Phase 2

All of these are system-wide installs: approve and run them yourself.

| Component                 | Exact requirement                                                                                                                                                                                                                                                  | Why                                                                                                                                                                                            | Disk                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Microsoft C++ Build Tools | **Visual Studio Build Tools 2022** (17.14.x, winget `Microsoft.VisualStudio.2022.BuildTools`), workload **Desktop development with C++** (`Microsoft.VisualStudio.Workload.VCTools`) with its recommended components: MSVC v143 x64/x86 tools and a Windows 11 SDK | Rust's `x86_64-pc-windows-msvc` target links with MSVC; Tauri's own prerequisite. 2022 rather than 2026 (18.x) because it has the widest support across Rust crates (`cc`, `windows-rs`) today | ~6–8 GB                                  |
| Rust                      | `rustup` (winget `Rustlang.Rustup`, 1.29.x), **stable** toolchain, default host `x86_64-pc-windows-msvc`                                                                                                                                                           | Tauri core, global shortcut, UI Automation, clipboard, keyring                                                                                                                                 | ~1.5 GB, plus 2–4 GB per Tauri `target/` |
| WebView2 Runtime          | Evergreen, already installed (156)                                                                                                                                                                                                                                 | Tauri renders its UI with the system WebView2                                                                                                                                                  | —                                        |
| VBSCRIPT optional feature | Only when building `.msi` installers (Phase 5)                                                                                                                                                                                                                     | WiX MSI bundling                                                                                                                                                                               | —                                        |

Install commands (elevated PowerShell, one at a time, in this order):

```bash
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

```bash
winget install --id Rustlang.Rustup
```

Then, in a **new** terminal:

```bash
rustup default stable-msvc
```

```bash
rustup show
```

Expected: `stable-x86_64-pc-windows-msvc` listed as the default toolchain, and
`rustc --version` / `cargo --version` both working.

## Local models (optional)

Ollama is **not** required to develop Typely. The benchmark in
[ollama-benchmark.md](ollama-benchmark.md) used the portable build (no installer, no
service, no autostart): `ollama-windows-amd64.zip` v0.40.7 extracted to
`%USERPROFILE%\typely-bench\ollama`, started on demand with `OLLAMA_MODELS` pointing to
the same folder.

## Optional LanguageTool server

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
