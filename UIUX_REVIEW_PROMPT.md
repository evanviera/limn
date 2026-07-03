# UI/UX Review Pass — Limn

You are doing an extensive UI/UX audit of Limn, a Tauri + React 19 desktop Kanban app. Your goal: make sure every piece of **text, every checkbox, every interactive control, and all visual feedback** is clear, readable, consistent, and modern. This is a polish pass, not a rewrite — preserve the existing dark aesthetic and information architecture.

## The codebase (read these first)

- The UI is split across `src/App.tsx` (the root `App` component — state, workspace lifecycle, view routing) and `src/components/*.tsx` (`BoardView` incl. `TaskCardBody`/`MemberDots`, `CardEditor`, `MembersView`, `SettingsView`, `dialogs.tsx` for `TextDialog`/`ConfirmDialog`/`EmptyState`, `RichNoteText`, `icons.tsx`, `contextMenu.tsx`, `WindowsTitlebar`). Pure logic/hooks live in `src/lib/*.ts`. See [`docs/architecture.md`](docs/architecture.md).
- Styling is vanilla CSS split across `src/styles/*.css`, imported in cascade order by the `src/styles.css` barrel. Design tokens are CSS custom properties in `:root` at the top of `src/styles/tokens.css`.
- **Dark theme only.** Do not add a light theme. Keep the burgundy accent (`--accent: #832021`).
- E2E test harness exists: run with `?limnE2e`; selectors use `data-testid`. There is a `product-tester` skill for driving the UI.

## How to work

1. **See it before you change it.** Launch the app and walk through every surface (use the `product-tester` skill / e2e harness). Take screenshots of: welcome screen, board view, a card with subtasks, the card editor, members view, settings, both dialogs (`TextDialog`, `ConfirmDialog`), banners/errors, and a card mid-drag.
2. Audit against the checklist below, surface by surface.
3. Produce a **findings report first** — grouped by severity (Blocking / Should-fix / Polish), each with the file + line, what's wrong, and the proposed fix. Wait for confirmation before large changes; apply trivially-safe fixes directly and note them.
4. Make changes token-first: prefer adjusting/adding CSS custom properties and reusing existing classes over one-off inline styles. Keep the existing spacing and radius conventions.
5. Re-screenshot after changes to prove the before/after.

## What to audit

### Text & readability
- **Typography scale is ad-hoc** — sizes like `0.68rem`, `0.72rem`, `0.82rem`, `0.86rem` are scattered and some are very small. Establish a coherent type scale (tokens like `--text-xs/sm/base/lg`) and apply it. Flag anything under ~12px that carries real information.
- Check contrast of `--text-muted` (#9aa1ad) and `--text-faint` (#747c8a) against their backgrounds — verify WCAG AA (4.5:1 body, 3:1 large). Fix any that fail.
- Line-height, line-length, and truncation: do long card titles, board names, labels, subtask text, and notes wrap/ellipsize gracefully? No clipping or overflow.
- Consistent capitalization, button verb tense, and microcopy. Empty states and error banners should be friendly and specific, not generic.
- Font weights are all over the place (500/600/650/700/800) — consolidate to a sensible set.

### Checkboxes & form controls
- Subtask checkboxes (`.card-subtasks`, `.card-subtask`) and the card-editor completion checkbox and assignee checkboxes: are hit targets large enough (≥ ~16–20px box, comfortable click area)? Are checked/unchecked/hover/focus states all visually distinct and obvious?
- Completed states: `.task-card.completed`, `.card-subtask.completed` (strikethrough + muted). Confirm the completed treatment reads clearly without being so dim it's unreadable.
- All inputs (text, date, textarea, color picker, labels field): consistent height, padding, border, focus ring. Verify `--input-bg` fields look intentional and have visible focus.
- Native `<input type="date">` and color pickers in a dark theme often look out of place — check and improve their appearance.

### Visual feedback & states
- **Every interactive element needs hover + focus-visible + active states.** Audit buttons (`.primary`, default, destructive Archive/Delete), cards, columns, sidebar items, links, checkboxes, dialog buttons. Focus rings must be visible for keyboard users (`--focus`).
- **Drag-and-drop feedback**: drag source opacity, drop-target highlighting on columns (`.column:hover`/`:focus-within`), the drag preview, and cursor changes (`grab`/`grabbing`). Make the active drop target unmistakable.
- **Loading & async**: today there are no spinners/skeletons beyond an "Opening Limn…" message. Add lightweight loading/disabled feedback for async actions (open workspace, reload from disk, save, Slack post) so nothing feels frozen.
- **Transitions**: only `.card-subtask` has one. Add subtle, consistent transitions (hover, dialog/panel open, checkbox toggle) — fast (~120–180ms), tasteful, not flashy. Respect `prefers-reduced-motion`.
- **Destructive actions** (delete board/list/card, archive, remove member): confirm `ConfirmDialog` styling clearly signals danger (use `--danger` tokens) and the confirm button is distinguishable from cancel.
- **Banners/toasts** (`.banner`, `.error-banner`): clear success/warning/error differentiation, dismissible, not jarring.

### Consistency & modern feel
- Spacing rhythm: gaps and padding use many magic numbers (2/3/4/5/6/7/8/10/12/14/18px). Tighten toward a consistent scale.
- Border radii are mixed (3/4/5/6/7px). Standardize.
- Alignment and vertical rhythm across cards, the editor panel, and dialogs.
- Member avatars (`MemberDots`, `.avatar`) and the member color palette — legible initials, sufficient contrast, no overlap clipping.
- Sidebar active state, header layout, and the card editor panel should feel cohesive with the board.

### Accessibility (carry alongside the visual work)
- Keyboard nav: can you reach and operate every control (create/rename/delete, drag alternative, dialogs, checkboxes) without a mouse? Dialogs trap focus and close on Escape.
- `aria-*`, `role`, labels on icon-only buttons, `aria-invalid`/`aria-describedby` on form errors. Fill gaps.
- Don't rely on color alone (e.g. completed = green) — pair with icon/strikethrough.

## Constraints
- Edit the component the change belongs to (`src/App.tsx` or a `src/components/*.tsx`) and the matching `src/styles/*.css` partial — don't concentrate unrelated changes into one file, and don't add rules to the `src/styles.css` barrel. Keep each file focused (see [`docs/architecture.md`](docs/architecture.md)).
- Don't break `data-testid` attributes or the e2e harness.
- No new dependencies or UI libraries without asking.
- Preserve the dark, burgundy-accented identity.

## Deliverable
A severity-grouped findings report, the applied changes (token-first), and before/after screenshots of each surface demonstrating the improvements.
