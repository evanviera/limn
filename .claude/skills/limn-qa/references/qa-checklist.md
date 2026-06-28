# Limn QA checklist

Work through this surface by surface. For each item, either record a finding (with evidence + source location) or confirm it passes. This is an audit, not a fix list — never edit app code.

## Surfaces to cover

1. **Welcome** (`welcome-open-workspace`) — first-run empty state.
2. **Board shell** — sidebar (brand, `open-workspace`, board list, `create-board`, `nav-members`, `nav-settings`), header.
3. **Board view** — empty board, board with lists, lists with cards, completed cards.
4. **Card editor** (modal) — title, board/list selects, due date, completed checkbox, labels, assignees, sub-tasks (toggle/title/url/open/remove), notes, Archive/Delete/Close/Save.
5. **Dialogs** — `TextDialog` (create/rename board & list, add card) and `ConfirmDialog` (destructive delete/archive).
6. **Members** (`nav-members`) — empty state, add member, member list, avatars/initials, remove.
7. **Settings** (`nav-settings`) — workspace name, Slack webhook, reload workspace, save.
8. **Banners/errors** — `.banner`, `.error-banner`, `dismiss-banner`.
9. **Drag-and-drop** — card move between lists, drop targets, preview, cursors.

## Functional correctness

- [ ] Every primary action completes and persists (verify via `snapshot(page)`): create/rename/delete board & list, add/edit/archive/delete card, toggle subtask, add/remove member, save settings.
- [ ] Card edits round-trip: reopen the card and confirm fields match what was saved.
- [ ] Optimistic-write conflict path produces a sane result (use `window.__LIMN_E2E__.externalEditCard` to force it) — no silent data loss.
- [ ] Slack post: success path records the message; `/fail` webhook surfaces an error banner, not a crash.
- [ ] No `console.error` / `pageerror` during any flow (`diagnostics.json`).
- [ ] Deleting a list archives its cards (per the confirm copy) — verify it actually does.

## Visual & UX

- [ ] Hover, `:focus-visible`, and `:active` states exist and are distinct for every interactive element (buttons, cards, sidebar items, checkboxes, links, dialog buttons).
- [ ] Completed treatment (`.task-card.completed`, `.card-subtask.completed`) reads clearly — strikethrough/icon, not color alone, and not so dim it's unreadable.
- [ ] Drag feedback is unmistakable: source opacity, drop-target highlight, preview, `grab`/`grabbing` cursors.
- [ ] Loading/disabled feedback on async actions (open workspace, reload, save, Slack) — nothing looks frozen.
- [ ] Transitions are subtle and consistent; `prefers-reduced-motion` is respected.
- [ ] Destructive confirm clearly signals danger and the confirm button is distinct from cancel.
- [ ] Spacing, radii, and font weights are consistent; flag obvious one-offs.

## Content & microcopy

- [ ] Labels, button verbs, and capitalization are consistent.
- [ ] Empty states and errors are specific and friendly, not generic.
- [ ] Long titles/board names/labels/subtasks/notes wrap or ellipsize — no clipping or overflow.
- [ ] No placeholder/lorem/dev text leaking into the UI.

## Responsive

- [ ] At 1024px (and narrower if relevant): columns overflow gracefully (scroll, not clip); the card editor modal and dialogs stay usable; sidebar doesn't collapse content.

## Accessibility

- [ ] Full keyboard operability of every control, including a drag alternative.
- [ ] Focus rings visible for keyboard users on every focusable element.
- [ ] Dialogs trap focus and close on Escape; focus returns sensibly on close.
- [ ] Icon-only buttons have `aria-label`/`title`; form errors use `aria-invalid`/`aria-describedby`.
- [ ] Contrast meets WCAG AA (body 4.5:1, large 3:1) — scrutinize `--text-muted` and `--text-faint`.
- [ ] State is never conveyed by color alone (completed, danger, active).
- [ ] ARIA snapshots (`aria-*.yaml`) show meaningful roles/names — no unlabeled controls or generic "button".
