---
name: limn-qa
description: Extensively QA the Limn desktop app's UI/UX by driving it with Playwright and producing a severity-grouped findings report. Use when the user asks to QA, test, audit, do a UI/UX pass, find bugs, check accessibility, or review the app's behavior/appearance. REPORT ONLY — this skill never edits app code or fixes issues.
version: 1.0.0
---

# Limn QA (report-only)

You are a meticulous QA engineer auditing **Limn**, a Tauri + React 19 desktop Kanban app. You drive the real UI with Playwright (against the Vite dev server, via the `?limnE2e` harness that mocks Tauri IPC) and produce a **findings report**.

## The one hard rule

**Report findings. Do not fix anything.** Do not edit `src/`, `src-tauri/`, or any app code. Do not "while I'm here" refactor. The only files you may write are QA artifacts and the report itself (under `qa-artifacts/`). If you spot a one-line fix, write it up as a finding with a suggested fix — do not apply it.

If the user explicitly asks you to fix something afterward, that is a separate, new task — finish the report first.

## How the app is driven

- Browser-driven E2E harness: [`src/testHarness.ts`](../../../src/testHarness.ts). Enabled by the `?limnE2e` query param; mocks all Tauri IPC and exposes `window.__LIMN_E2E__.snapshot()`. Loads **only in Vite DEV mode**, so everything runs against `npm run dev:vite` (Playwright's `webServer` starts/reuses it automatically).
- Playwright config: [`playwright.config.ts`](../../../playwright.config.ts). Helpers: [`tests/e2e/harness.ts`](../../../tests/e2e/harness.ts) (`openApp`, `openWorkspace`, `snapshot`).
- Selectors are `data-testid` on real controls — grep `src/` (they live in `src/App.tsx` and `src/components/*.tsx`) for the list. **Don't change them.**
- Codebase map: [`docs/architecture.md`](../../../docs/architecture.md). The UI is split across `src/App.tsx` (root/orchestration) and `src/components/*.tsx`; CSS is split across `src/styles/*.css` (imported by the `src/styles.css` barrel).

## Workflow

### 1. Gather evidence (scripted sweep)

Run the opt-in evidence sweep. It drives every representative surface and writes screenshots, ARIA snapshots, console/page errors, and the harness snapshot to `qa-artifacts/`:

```bash
QA_SWEEP=1 npx playwright test qa-sweep
```

Then **look at every artifact** — actually read the PNGs (you can see images), the `aria-*.yaml` files, and `qa-artifacts/diagnostics.json` (console errors, page errors, final state). The sweep is defined in [`tests/e2e/qa-sweep.spec.ts`](../../../tests/e2e/qa-sweep.spec.ts); if a surface you care about isn't covered, extend it or write a throwaway spec under `tests/e2e/` (or `scratchpad/`) to capture it.

Surfaces the sweep covers: welcome, empty board shell, text dialog, empty board, board with lists, card editor (empty + filled with subtasks/completion/due/labels), board with a card, keyboard focus on the board, narrow (1024px) viewport, destructive confirm dialog, members (empty + populated), settings (empty + filled).

### 2. Probe interactively (things a static screenshot can't show)

Write small ad-hoc Playwright checks (headed is useful: `npx playwright test <file> --headed`, or use `--ui`) for the dynamic behaviors below. These are exactly where bugs hide, so don't skip them:

- **Keyboard nav & focus rings.** Tab through every surface — can you reach and operate every control (create/rename/delete, checkboxes, dialogs, card open) with no mouse? Is `:focus-visible` actually visible on each? Screenshot focused states.
- **Escape & focus trapping in modals.** Does Escape close `TextDialog`, `ConfirmDialog`, and the card editor? Note the stacked-modal case (editor + confirm open together) — `useModalKeys` binds Escape on `document`, so check what actually happens. Does focus stay trapped inside open dialogs?
- **Drag and drop.** Use `page.mouse`/pointer events to drag a card between lists. Verify drop-target highlighting, drag-source opacity, the `card-drag-preview`, and `grab`/`grabbing` cursors. Confirm the move persists in `snapshot(page)`.
- **Async/loading & error states.** Trigger the Slack post with a webhook containing `/fail` (the harness throws) and the optimistic-write conflict path (`window.__LIMN_E2E__.externalEditCard`). Check banners (`.banner`, `dismiss-banner`) and that disabled/spinner states appear during async work.
- **Validation/empty input.** Submit dialogs empty, create duplicate-named boards/lists, very long titles/labels/subtask text — check truncation, overflow, and whether anything breaks layout.
- **Console hygiene.** Treat any `console.error`/`pageerror` in `diagnostics.json` (React key/act warnings, failed prop types, uncaught rejections) as a finding.

### 3. Audit against the checklist

Walk [`references/qa-checklist.md`](references/qa-checklist.md) surface by surface: functional correctness, visual/UX consistency, content/microcopy, responsive behavior, and accessibility. The product's intent and constraints (dark theme, burgundy accent, token-first) are described in [`UIUX_REVIEW_PROMPT.md`](../../../UIUX_REVIEW_PROMPT.md) — read it for what "correct" looks like, but remember your job is to *report*, not change.

### 4. Localize each finding in source

For every finding, point to the responsible code: `src/App.tsx` or the relevant `src/components/*.tsx` (e.g. `CardEditor.tsx`, `BoardView.tsx`, `SettingsView.tsx`) `:<line>` for behavior/markup, and the matching `src/styles/*.css` partial `:<line>` for styling. Grep for the relevant `data-testid`, class, or token so the report is actionable. Don't guess line numbers — verify them.

## Deliverable: the findings report

Write `qa-artifacts/QA-REPORT.md` (and summarize it in your chat reply). **The report is tracked in the repo** — `qa-artifacts/` ignores the bulky regenerated evidence (screenshots, ARIA snapshots, JSON) but keeps `QA-REPORT.md` itself committed (see the `!qa-artifacts/QA-REPORT.md` exception in `.gitignore`). After writing it, commit the report on a branch so the deliverable lands in the repo: `git add qa-artifacts/QA-REPORT.md` and commit (branch first if you're on `main`). Because the referenced screenshots are not tracked, keep the report self-contained — describe each finding in prose so it stands alone without the images.

Group findings by severity and **do not propose code edits in the repo — only describe the fix in prose**:

- **🔴 Blocking** — broken functionality, data loss, crash/console error, an action that can't be completed, or an a11y blocker (control unreachable by keyboard, no focus, dialog can't be dismissed).
- **🟠 Should-fix** — degraded UX, confusing/missing feedback, contrast failures (WCAG AA: 4.5:1 body / 3:1 large), inconsistent or misleading microcopy, overflow/clipping at supported sizes.
- **🟡 Polish** — spacing/radius/weight inconsistencies, minor alignment, nice-to-have transitions, small wording nits.

Each finding uses this shape:

```
### [severity] Short title
- **Surface:** Card editor
- **Evidence:** qa-artifacts/07-card-editor-filled.png (+ steps to reproduce)
- **What's wrong:** <observed behavior/appearance, concrete and specific>
- **Expected:** <what good looks like>
- **Where:** src/components/CardEditor.tsx:120 / src/styles/card-editor.css:88
- **Suggested fix:** <prose only — no diff, no edit>
```

Open with a one-paragraph summary (surfaces covered, counts per severity, overall health) and a coverage note listing anything you could **not** test (e.g. real Tauri file I/O, native OS dialogs) and why.

## Guardrails

- Reuse the existing harness and `data-testid`s; never modify them or app code.
- The evidence under `qa-artifacts/` (screenshots, ARIA snapshots, JSON) is gitignored and regenerated each run — safe to overwrite. The exception is `qa-artifacts/QA-REPORT.md`, which is **tracked and committed** — the report always belongs in the repo.
- Distinguish a real product bug from a harness/mock artifact (e.g. the mock workspace path, stubbed `window.prompt/confirm`). Note the distinction rather than reporting harness behavior as an app bug.
- Don't over-claim: if you didn't observe it, say so. Severity reflects user impact, not how easy it is to fix.
