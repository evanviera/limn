# Limn QA findings report

**Date:** 2026-06-27 · **Build:** `main` @ ae751d3 · **Method:** Playwright against the `?limnE2e` harness (Vite dev), scripted evidence sweep (`qa-sweep`) + interactive probes (`qa-probe`, throwaway).

## Summary

Limn is in good health. The scripted sweep drove every representative surface (welcome → board → card editor → dialogs → members → settings) and the harness snapshot confirms **every primary action completed and persisted**: create board, add lists, add/edit card with subtasks/labels/due/completion, mark complete, move a card by drag, add a member, edit settings. **Zero `console.error` and zero `pageerror`** across the whole run (`diagnostics.json`). Drag-and-drop feedback is genuinely polished (dimmed source, burgundy drop-target highlight, shadowed live preview, `grab`/`grabbing` cursors — see `probe-05-mid-drag.png`), the dark/burgundy token system is applied consistently, completed state is conveyed by **icon + strikethrough + colored rail** (not color alone), reduced-motion is respected, and most icon-only controls carry `aria-label`/`title`.

No **blocking** issues were found — no crashes, no data loss observed, every control is keyboard-reachable, and every dialog can be dismissed. The findings are concentrated in **modal/focus management for accessibility** and **input hardening** (no length/duplicate guards, a few microcopy mismatches).

**Counts:** 🔴 Blocking **0** · 🟠 Should-fix **5** · 🟡 Polish **5**

> **Resolution (2026-06-27):** All 10 findings have been addressed in `src/App.tsx` / `src/styles.css`. `tsc --noEmit` is clean and the full Playwright sweep (`QA_SWEEP=1`) passes. Summary of fixes:
>
> - **Stacked-modal Escape / focus trap:** `useModalKeys` now keeps a module-level `modalStack`; only the topmost dialog handles Escape/Tab. The hook also captures `document.activeElement` on open and restores it on close, and the card editor moves initial focus into itself (`tabIndex={-1}` + focus on mount).
> - **Card `role="button"` with interactive descendants:** the card `<article>` is now a plain container (no `role`/`tabIndex`/`onKeyDown`); the title is a real `.card-open` `<button>` that is the keyboard "open card" target. Mouse click-anywhere-to-open is preserved.
> - **Sidebar overflow:** `.sidebar button` now `overflow:hidden; white-space:nowrap; text-overflow:ellipsis`.
> - **Dialog names:** `TextDialog` and `ConfirmDialog` reference their heading via `aria-labelledby`.
> - **Input hardening:** the dialog input has `maxLength={80}`; board/list create+rename reject duplicate names via a `validate` hook.
> - **Error copy:** user-facing banners use `errorText(reason)` (message only, no `Error:` prefix).
> - **Delete-board copy:** now reads "…and all its cards?".
> - **Settings save:** posts a "Settings saved." notice.
> - **Concurrent card edit:** a silent watch refresh that changes the open card now posts "This card changed on disk…".

### Coverage / what could NOT be tested
- **Real Tauri file I/O & native folder picker** — mocked by the harness (`pick_workspace_folder` returns the fixed `/mock/limn-e2e-workspace`). File reads/writes, watch events, and OS dialogs are not exercised.
- **Real Slack HTTP** — `post_slack` is mocked; the `/fail` path throws synthetically. The success/failure *UI* was verified, not the network call.
- **True optimistic write-conflict UI** — the conflict-copy branch exists in code (`src/App.tsx:161`, harness `src/testHarness.ts:156`) but I **could not force it through the live UI**: the `workspace-changed` watcher calls `refreshWorkspace(false)`, which updates the in-memory card's `updatedAt` to match disk *before* save, so the expected/actual guard never diverges in this flow. Reported as a coverage gap, not a pass.
- **`prefers-reduced-motion`** — the media query is present (`src/styles.css:1197`) but I did not toggle the OS setting to visually confirm.
- `window.prompt`/`window.confirm` are stubbed by the harness; the app's real dialogs are React components, so this is not an app concern.

---

## 🟠 Should-fix

### 🟠 Escape on stacked modals dismisses the wrong layer, orphaning the destructive confirm
- **Surface:** Card editor + Delete-card confirm (stacked)
- **Evidence:** `probe-02-after-escape.png`; `probe-stackedEscape.json` → `{ confirmStillOpenAfterEscape: true, editorStillOpenAfterEscape: false }`. Repro: open a card → click **Delete** → press **Escape** once.
- **What's wrong:** With the card editor open and its "Delete card" confirm on top, a single Escape closes the **editor underneath** and leaves the **destructive confirm dialog floating** over the now-empty board. Both `CardEditor` and `ConfirmDialog` register their own `keydown`/Escape listener on `document` via `useModalKeys`, so Escape fires both `onClose` handlers; the net result targets the background modal instead of the topmost one. Tab is also trapped by both containers simultaneously in this state.
- **Expected:** Escape dismisses only the topmost dialog (the confirm), leaving the editor open. Only one modal should own keyboard handling at a time (e.g. a shared modal stack, or scoping the listener to the most recently opened dialog).
- **Where:** `src/App.tsx:1565` (`useModalKeys`, Escape at 1567–1571); bound by `CardEditor` at `src/App.tsx:1184` and `ConfirmDialog` at `src/App.tsx:1512`.
- **Suggested fix:** Track a modal stack (or a "topmost modal" ref) so only the last-opened dialog responds to Escape/Tab; alternatively have `useModalKeys` no-op when a dialog deeper in the stack is open. The confirm remains dismissable via its Cancel button, so this is degraded UX rather than a hard block.

### 🟠 Focus is not returned to the opener when a modal closes
- **Surface:** Card editor, TextDialog, ConfirmDialog
- **Evidence:** `probe-focusReturn.json` → `{ focusedBeforeOpen: "card-…", focusedAfterClose: "BODY" }`. Repro: focus a card with the keyboard, Enter to open the editor, Close — focus lands on `<body>`.
- **What's wrong:** After any modal closes, focus drops to `document.body` instead of returning to the control that opened it. Keyboard and screen-reader users lose their place and must Tab from the top of the page again.
- **Expected:** On close, restore focus to the triggering element (the card, the "Add list" button, etc.).
- **Where:** `src/App.tsx:1565` (`useModalKeys` has no focus save/restore); openers e.g. card `onKeyDown`/`onClick` at `src/App.tsx:891`.
- **Suggested fix:** In `useModalKeys` (or each modal), capture `document.activeElement` on mount and call `.focus()` on it during cleanup; also move initial focus into the dialog on open.

### 🟠 Cards use `role="button"` but contain interactive descendants (checkboxes, links)
- **Surface:** Board card
- **Evidence:** `aria-confirm-dialog.yaml` → `button "Write the launch email (completed)"` nests a `list` of `checkbox` items and a heading; `08-board-with-card.png`.
- **What's wrong:** The card `<article role="button" tabIndex=0>` wraps real subtask `<input type="checkbox">`s and subtask `<a>` links. Interactive controls inside a `button` role is invalid ARIA — screen readers may not reliably expose or operate the nested controls, and the "activate card vs. toggle subtask" intent is ambiguous to assistive tech (it works with a mouse only because of `stopPropagation`).
- **Expected:** A card opener that doesn't swallow nested interactive semantics — e.g. the card is a plain container with a dedicated "Open card" button/affordance, or the subtasks/links are not descendants of a `role="button"`.
- **Where:** `src/App.tsx:883` (`<article role="button">`) containing `TaskCardBody` checkboxes at `src/App.tsx:964` and link at `src/App.tsx:974`.
- **Suggested fix:** Make the card a non-button container and add an explicit focusable "open" target, or render the on-card subtask toggles as non-interactive (display-only) and edit them only in the editor. Keyboard reachability of the inner checkboxes is otherwise fine (they're real inputs).

### 🟠 Long board names overflow and clip in the sidebar (no truncation)
- **Surface:** Sidebar board nav
- **Evidence:** `probe-09-long-and-dupe.png` — a 160-character board name runs the full sidebar width and is clipped at both edges with no ellipsis. `probe-validation.json` confirms the 160-char name was accepted.
- **What's wrong:** `.sidebar button` (board nav items) has no `overflow`/`white-space`/`text-overflow`, so long names bleed past the panel and clip rather than ellipsizing. The board page `<h1>` *does* truncate correctly (`src/styles.css:496`), so the sidebar is the inconsistent one.
- **Expected:** Board nav labels ellipsize on one line like the brand/heading do.
- **Where:** `src/styles.css:397` (`.sidebar button`, missing overflow handling); markup at `src/App.tsx:503`.
- **Suggested fix:** Add `overflow: hidden; white-space: nowrap; text-overflow: ellipsis;` to the board nav buttons (and `display:block`/min-width:0 as needed). Pairs with the input-hardening polish item below.

### 🟠 Dialogs have no accessible name (announced as generic "dialog")
- **Surface:** TextDialog (create/rename board & list, add card), ConfirmDialog
- **Evidence:** `aria-text-dialog.yaml` and `aria-confirm-dialog.yaml` both show a bare `- dialog:` node with no name, while the card editor correctly shows `dialog "Edit card"`.
- **What's wrong:** `TextDialog` (`<form role="dialog">`) and `ConfirmDialog` (`<div role="dialog">`) set `aria-modal` but no `aria-label`/`aria-labelledby`, so screen readers announce only "dialog" with no title. The visible `<h2>` ("Create board", "Delete card") is present but not associated.
- **Expected:** Each dialog is named by its heading on open.
- **Where:** `src/App.tsx:1440` (TextDialog `<form role="dialog">`), `src/App.tsx:1516` (ConfirmDialog `<div role="dialog">` — has `aria-describedby` but no labelling).
- **Suggested fix:** Give each heading an `id` and reference it via `aria-labelledby` on the dialog element (the card editor already does the equivalent with `aria-label="Edit card"`).

---

## 🟡 Polish

### 🟡 No length or duplicate-name guard on boards and lists
- **Surface:** Create/rename board & list dialogs
- **Evidence:** `probe-validation.json` → a 160-char board name accepted; two boards both named "Dupe" created (`dupeAllowed: 2`). The sweep likewise produced two "To Do" lists on one board (`aria-card-editor.yaml` List combobox shows duplicate "To Do").
- **What's wrong:** No max length and no de-duplication, so identical board/list names coexist (ambiguous in the sidebar and in the card editor's List dropdown) and arbitrarily long names are stored.
- **Expected:** A sane `maxLength` and at least a soft warning (or auto-suffix) on duplicate names.
- **Where:** `src/App.tsx:169` (`addBoard`), `src/App.tsx:216` (`addList`), `src/storage.ts:114` (`createBoard`); dialog input `src/App.tsx:1464` (no `maxLength`).
- **Suggested fix:** Add `maxLength` to the dialog input and a duplicate check in the submit handlers (prose only — no edit applied).

### 🟡 Slack failure banner leaks a raw `Error:` prefix
- **Surface:** Error banner (async Slack post)
- **Evidence:** `probe-06-slack-fail.png`; `probe-slackFail.json` → `"Slack notification failed: Error: Slack webhook returned 500"` with `class="banner banner-error"`.
- **What's wrong:** The banner works and is styled correctly, but the copy includes the stringified `Error:` object prefix, which reads like a leaked internal.
- **Expected:** "Slack notification failed: Slack webhook returned 500" (message only).
- **Where:** `src/App.tsx:425` (`setError(\`Slack notification failed: ${String(reason)}\`)`). Same `String(reason)` pattern at lines 302/322/343/359.
- **Suggested fix:** Use `reason instanceof Error ? reason.message : String(reason)` when composing user-facing error text.

### 🟡 "Delete board" copy says "visible cards" but all cards are removed
- **Surface:** Delete-board confirm dialog
- **Evidence:** Copy: `Delete board "X" and its visible cards?` (`src/App.tsx:202`) vs. behavior: `cards.filter((card) => card.boardId === board.id)` (`src/App.tsx:206`) deletes every card on the board, archived included.
- **What's wrong:** Microcopy implies only on-board (non-archived) cards are deleted; archived cards on that board are deleted too.
- **Expected:** Either the copy drops "visible" ("…and all its cards?") or the code spares archived cards.
- **Where:** `src/App.tsx:202` / `src/App.tsx:206`.
- **Suggested fix:** Align wording with behavior (prose change to the message string).

### 🟡 Saving settings gives no success confirmation
- **Surface:** Settings
- **Evidence:** `16-settings-filled.png`; "Save settings" persists (verified in `diagnostics.json` harness snapshot) but shows only a transient spinner — no banner/toast — whereas "Reload from disk" *does* post a notice ("Workspace reloaded from disk.").
- **What's wrong:** Inconsistent feedback: a successful save looks like nothing happened.
- **Expected:** A brief "Settings saved." confirmation, matching the reload affordance.
- **Where:** `src/App.tsx:407` (`saveWorkspaceSettings`, no notice) vs. `src/App.tsx:138` (reload notice); button at `src/App.tsx:1140`.
- **Suggested fix:** Set a short-lived info notice on successful save.

### 🟡 No indication when the open card changes underneath you
- **Surface:** Card editor (concurrent external edit)
- **Evidence:** In the conflict probe, an external edit to the open card triggered `refreshWorkspace(false)`, silently updating underlying state while the editor's `draft` stayed stale; no banner appeared (`probe-conflict.json` → `bannerText: null`).
- **What's wrong:** If the card file changes on disk while the editor is open, the editor keeps editing a stale draft with no hint; a subsequent save overwrites the external change without the conflict-copy path triggering (because state was refreshed first — see coverage note).
- **Expected:** Surface a quiet "This card changed on disk" notice when the open card is refreshed, so the user can reload before overwriting.
- **Where:** `src/App.tsx:125` (`refreshWorkspace`, `showNotice=false` for watch-driven refresh), editor draft at `src/App.tsx:1178`/`1183`.
- **Suggested fix:** When a watch refresh changes the currently-open card, set a notice (and/or re-seed the editor draft on confirmation). Low likelihood in single-user local-first use, hence Polish.

---

## Notes on things that PASS (so they're on record)
- **No console/page errors** anywhere in the sweep (`diagnostics.json`).
- **Persistence verified** for board/list/card/member/settings CRUD and drag-move via the harness snapshot.
- **Drag-and-drop** feedback complete and correct (`probe-drag.json`: preview visible, source opacity `0.38`, `is-card-dragging` set, card moved to `in-progress`).
- **Completed treatment** is multi-channel: `✓` glyph + line-through + green inset rail + `sr-only "Completed:"` and `aria-label` "(completed)" (`aria-confirm-dialog.yaml`, `08-board-with-card.png`).
- **Focus-visible styles** are defined comprehensively (`src/styles.css:131` global, `:624` cards) — the actionable a11y gap is focus *return*, not focus *visibility*.
- **Destructive confirms** default focus to Cancel (`src/App.tsx:1506`) and the confirm button is visually distinct (`.danger`, `probe-02-after-escape.png`).
- **Form validation** present and friendly: empty board name → "Board name is required."; members → "Enter a member name." with `aria-invalid`/`aria-describedby` wired (`src/App.tsx:1039`, `:1465`).
- **Narrow 1024px viewport** overflows gracefully (columns scroll horizontally, nothing clipped — `11-board-narrow-1024.png`).
