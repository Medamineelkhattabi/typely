# Contributing to Typely

Thanks for helping make writing better everywhere.

## Set up

1. Install Node.js ≥ 24, and for the desktop app the Rust toolchain and MSVC Build Tools
   ([setup guide](docs/development/setup.md)).
2. Keep the repository at a short path outside cloud-synced folders, for example
   `C:\dev\typely`.
3. Install dependencies:

```bash
npm install
```

## Before you open a pull request

Run the full check. It must pass:

```bash
npm run check
```

It runs the TypeScript typecheck, Biome lint and format check, all Vitest tests,
`cargo fmt --check`, `cargo clippy -D warnings` and `cargo test`.

## Conventions

- **TypeScript**: strict mode, `.ts` import extensions, no `enum` or `namespace`
  ([ADR-012](docs/architecture/decisions.md)). snake_case for data that crosses a boundary,
  camelCase in code ([ADR-013](docs/architecture/decisions.md)).
- **Rust**: `rustfmt`, no clippy warnings, a `SAFETY:` comment on every `unsafe` block.
- **Dependencies**: exact versions, released at least two weeks ago.
- **Commits**: small and focused, with a message that explains why.
- **Privacy**: never log, store or send user text. Never let an API key reach a webview.
  Read the [threat model](docs/security/threat-model.md) before touching capture, paste,
  transports or secrets.
- **Claims**: mark a roadmap item done only when it is implemented and tested, and record
  manual tests in the [desktop test log](docs/development/desktop-testing.md).

## Architecture decisions

Larger changes start with an ADR in [decisions.md](docs/architecture/decisions.md):
context, decision, consequences.
