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
| Ollama                    | ❌ not installed system-wide (a portable build is used for tests)     | optional local models                      |

Verified 2026-11-03: a Rust release build compiles, links with MSVC and runs (1.3 s).
Windows long-path support is off (`LongPathsEnabled = 0`): keep the repository at a short
path such as `C:\dev\typely`. Cargo fails with "path too long" under deep folders.

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

The desktop app looks for Ollama on `127.0.0.1:11434` only. To start the portable build
with the recommended environment (PowerShell):

```bash
$env:OLLAMA_HOST="127.0.0.1:11434"; $env:OLLAMA_IGPU_ENABLE="1"; $env:OLLAMA_NO_CLOUD="1"; $env:OLLAMA_MODELS="$env:USERPROFILE\typely-bench\models"; & "$env:USERPROFILE\typely-bench\ollama\ollama.exe" serve
```

### Grammar checker (LanguageTool)

Optional, local, started on demand by Typely (ADR-020). Unzip both archives into
`%LOCALAPPDATA%\Typely\languagetool` (no installer, nothing system-wide):

| Component                                                    | File                                                                                                                                                                                        | SHA-256                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Java runtime (Eclipse Temurin 21.0.12.1+1, JRE, Windows x64) | [OpenJDK21U-jre_x64_windows_hotspot_21.0.12.1_1.zip](https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_x64_windows_hotspot_21.0.12.1_1.zip) | `d35f31e712f0fcf6ac5a093edc90204fbff22f720ba3950bd09d331d5e621636`                                       |
| LanguageTool 6.6                                             | [LanguageTool-6.6.zip](https://languagetool.org/download/LanguageTool-6.6.zip) (252 MB)                                                                                                     | `53600506b399bb5ffe1e4c8dec794fd378212f14aaf38ccef9b6f89314d11631` (recorded on download; not published) |

The folder then holds `jdk-21.0.12.1+1-jre` and `LanguageTool-6.6` (about 540 MB). Turn it
on under **Local AI → Grammar checker**.

Desktop settings live in `%APPDATA%\app.typely.desktop\settings.json`, API keys in the
Windows Credential Manager (generic credentials named `<provider id>.app.typely.desktop`).

## Optional LanguageTool server

```bash
docker run -d --name languagetool -p 8081:8010 erikvl87/languagetool
```

(The LanguageTool image is community-maintained; review it before use or build from the
official LanguageTool release.)

## Everyday commands

| Command                           | What it does                                            |
| --------------------------------- | ------------------------------------------------------- |
| `npm test`                        | Run all unit tests (Vitest)                             |
| `npm run typecheck`               | Strict TypeScript check of every package                |
| `npm run lint`                    | Biome lint + format check                               |
| `npm run format`                  | Apply Biome formatting                                  |
| `npm run check`                   | typecheck + lint + test + Rust checks                   |
| `npm run check:rust`              | `cargo fmt --check`, `clippy -D warnings`, `cargo test` |
| `npm run tauri dev`               | Run the desktop app with hot reload                     |
| `npm run tauri build`             | Release build: `target/release/typely.exe`              |
| `npm run typely -- <op> "<text>"` | Run the engine from the terminal (see README)           |
