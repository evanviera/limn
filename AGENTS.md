# AGENTS.md

Guidance for Codex and other coding agents working in this repo.

The full agent guidance lives in **[CLAUDE.md](CLAUDE.md)** and the codebase map in
**[docs/architecture.md](docs/architecture.md)**. Read both before making changes.

Key rule: **keep single files focused — split before they swell.** Soft cap ≈ 600
lines per source file. New UI → `src/components/`; new pure logic/hooks →
`src/lib/`; CSS rules → the right `src/styles/*.css` partial (never `styles.css`,
which is only an `@import` barrel); Rust subsystems → their own module (not a
bigger `lib.rs`); e2e tests → the matching feature spec.

Verify with:

```sh
npm run build:web && npm run test:storage && (cd src-tauri && cargo test) && npx playwright test
```
