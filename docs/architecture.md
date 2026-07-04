# Architecture & code organization

Limn is a Tauri + React (TypeScript) desktop app. This document maps the codebase
and records the conventions that keep files focused. **Read the "Keeping files
focused" section before adding code to an existing large file.**

## Frontend (`src/`)

| Path | Responsibility |
| --- | --- |
| `main.tsx` | Entry point. Mounts `<App>` and imports the stylesheet. |
| `App.tsx` | **Root component only.** App state, workspace lifecycle, IPC wiring, view routing, and the global context-menu / dialog / banner plumbing. It should host the `App` component and a couple of module-level helpers — nothing else. |
| `components/` | Presentational & interactive React components, each fully driven by props. |
| `lib/` | Pure logic, formatting, and hooks (no component JSX). |
| `storage.ts` | Workspace persistence + serialization: IPC wrappers, model factories, and card/workspace parse/serialize. |
| `ipc.ts`, `types.ts`, `updater.ts`, `testHarness.ts` | IPC shim, shared types, updater client, and the E2E test harness bridge. |

### `src/components/`

- `icons.tsx` — `Icon`, `Spinner`, `LinkIcon`, and the `IconName` union.
- `contextMenu.tsx` — `ContextMenu` component, its item/state types, and the
  text-input context-menu helpers (`isEditableTextControl`, `textControlContextItems`, …).
- `dialogs.tsx` — `EmptyState`, `TextDialog`, `ConfirmDialog` and their state types.
- `RichNoteText.tsx` — renders card note text (inline links / bold / italic).
- `BoardView.tsx` — board columns, drag-and-drop, `TaskCardBody`, `MemberDots`.
- `CardAttachments.tsx` — the card editor's attachments section (list / add / open / remove), fully prop-driven.
- `AttachmentImagePreview.tsx` — the inline image thumbnail shown for image attachments (loads bytes via `useAttachmentObjectUrl`).
- `AttachmentLightbox.tsx` — the full-screen image viewer opened by clicking an image attachment; arrow keys / chevrons flip through the card's image attachments.
- `CardComments.tsx` — the card editor's discussion section: threaded comments, composer, @mention highlighting, and the "who are you?" identity prompt, fully prop-driven.
- `MembersView.tsx`, `SettingsView.tsx`, `CardEditor.tsx`, `WindowsTitlebar.tsx` — the remaining views.

### `src/lib/`

- `constants.ts` — shared constants and small shared types (`memberColors`, `MAX_NAME_LENGTH`, `ThemeMode`, `SlackNotificationKey`, …).
- `format.ts` — formatting/util helpers (`countLabel`, `initials`, `slackTag`, `compareCardsByDueDate`, `upsertById`, `readStoredThemeMode`, …).
- `identity.ts` — the device-local "active member" (who *you* are for comment attribution). Stored in `localStorage` keyed by workspace path, **never** in the synced workspace files, so each person on a shared folder keeps their own identity.
- `mentions.ts` — pure @mention matching (`matchMention`, `MENTION_SPLIT_PATTERN`, `mentionToken`) used to highlight member references in comments.
- `noteFormat.ts` — note markdown parse/serialize + contenteditable DOM helpers.
- `updateMessages.ts` — updater banner/settings message builders and `UpdateStatus`.
- `useModalKeys.ts` — modal focus-trap / Escape hook and the modal stack.
- `useAttachmentObjectUrl.ts` — loads an image attachment's bytes into an object URL (with cleanup), shared by the thumbnail and the lightbox.
- `attachments.ts` — image-extension detection helpers (`isImageAttachment`, `latestImageAttachment`, `attachmentFileExtension`).

## Styles (`src/styles.css` → `src/styles/`)

`src/styles.css` is a thin `@import` **barrel** — it only lists the partials in
cascade order. Never add rules to it. Rules live in `src/styles/`:

`tokens.css` (design tokens) → `base.css` (element resets, buttons, inputs) →
`shell.css` (titlebar, sidebar, header) → `board.css` → `feedback.css`
(banners/empty states) → `settings.css` → `dialogs.css` → `card-editor.css` →
`comments.css` (card discussion + @mentions) → `responsive.css` (media queries).

Order matters: the barrel concatenates these, so keep cascade-sensitive rules in
order and add new partials to the barrel at the right position.

## Backend (`src-tauri/src/`)

- `lib.rs` — Tauri bootstrap `run()`, the `#[tauri::command]` IPC handlers, and
  the workspace/filesystem helpers + data structs. Attachments are copied into
  `attachments/<cardId>/` in the workspace and referenced from each card's
  frontmatter; the folder is removed when its card is deleted.
- `menu.rs` — the native application menu (`build_app_menu` + `item`).
- `tests.rs` — `#[cfg(test)]` integration tests (workspace round-trips, Slack posts).

## End-to-end tests (`tests/e2e/`)

- `harness.ts` — shared Playwright page helpers.
- Feature specs: `board.spec.ts`, `card-editor.spec.ts`, `notes.spec.ts`,
  `integrations.spec.ts` (Slack + updater), plus `qa-sweep.spec.ts`.

## Keeping files focused

Files grow silently; splitting them later is tedious, so split **before** a file
gets unwieldy:

- **Soft cap ≈ 600 lines** for a source file; a single genuinely-cohesive
  component/module may reach ≈ 900. When a file approaches that, split it before
  adding more.
- `App.tsx` stays the orchestration root. New UI → `src/components/`; new pure
  logic or hooks → `src/lib/`. Sub-components should take everything via props so
  they move out mechanically.
- **CSS:** add rules to the matching `src/styles/*.css` partial, or create a new
  partial and wire it into the `styles.css` barrel in cascade order.
- **Rust:** keep `lib.rs` for `run()` + commands; give any new cohesive subsystem
  (like the menu) its own module; keep tests in `tests.rs`.
- **E2E:** add a test to the matching feature spec, or create a new `*.spec.ts`.
  Do not rebuild a monolithic `smoke.spec.ts`.
- **`storage.ts` is intentionally one module** — its factory and parsing halves
  call each other, so a naive split creates an import cycle. If it must grow,
  first extract the shared low-level helpers (id/timestamp generation) into their
  own module so the two halves depend on that instead of each other.

Prefer **mechanical extraction** (move a self-contained function/component to a
new file and import it back) over restructuring logic — it's the safe way to
shed lines without changing behavior.

## Verifying changes

Run the checks relevant to what you touched (all four before a release):

```sh
npm run build:web        # tsc typecheck + vite production build
npm run test:storage     # storage/serialization unit tests (Node)
(cd src-tauri && cargo test)   # Rust command + integration tests
npx playwright test      # end-to-end smoke suite
```
