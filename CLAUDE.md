# Limn — working notes for AI agents

Local-first, Trello-style task board. Tauri (Rust) shell + React/TypeScript frontend.

## Where code lives

See **[docs/architecture.md](docs/architecture.md)** for the full map. In short:

- `src/App.tsx` — root component: state, workspace lifecycle, IPC wiring, view routing.
- `src/components/` — React components (each fully prop-driven).
- `src/lib/` — pure logic, formatting, hooks (no component JSX).
- `src/storage.ts` — workspace persistence + serialization.
- `src/styles.css` — an `@import` **barrel**; real CSS lives in `src/styles/*.css`.
- `src-tauri/src/` — `lib.rs` (bootstrap + IPC commands + fs helpers), `menu.rs`, `tests.rs`.
- `tests/e2e/` — feature-grouped Playwright specs (`board`, `card-editor`, `notes`, `integrations`).

## Keep files focused (do not let single files swell)

Files grow silently and are painful to split later. **Split before a file gets large:**

- Soft cap **≈ 600 lines** per source file (≈ 900 for one genuinely cohesive component/module).
- Don't pile new code into `App.tsx` — new UI goes in `src/components/`, new pure logic/hooks in `src/lib/`. Components take everything via props so they extract mechanically.
- Don't add CSS rules to `styles.css` — edit the right `src/styles/*.css` partial, or add a new partial to the barrel in cascade order.
- In Rust, keep `lib.rs` for `run()` + commands; give new subsystems their own module; tests stay in `tests.rs`.
- Add e2e tests to the matching feature spec, not a new monolithic file.

Prefer **mechanical extraction** (move a self-contained unit to a new file, import it back) over refactoring logic.

## Gotchas

- Relative **value** imports use a `.js` extension (e.g. `import { invoke } from "./ipc.js"`). This keeps the Node-based storage test's emitted ESM resolvable. Type-only imports omit the extension.
- `src/storage.ts` is intentionally one module: its factory and parse halves are mutually dependent, so a naive split creates an import cycle. Extract shared id/timestamp helpers first if it must grow.

## Verify after changes

```sh
npm run build:web            # tsc + vite build
npm run test:storage         # storage/serialization tests
(cd src-tauri && cargo test) # Rust tests
npx playwright test          # e2e smoke suite
```
