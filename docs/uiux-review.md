# Limn UI/UX upgrade

The experience now uses a consistent, quieter visual system across workspace
navigation, boards, cards, dialogs, search, archive, members, settings, and inbox.
The existing workflows and workspace file formats are preserved.

## Design changes

- Neutral charcoal and soft off-white themes with a restrained green accent.
- Clear sans-serif hierarchy, more readable secondary text, rounded controls,
  softer shadows, and consistent spacing.
- Board lists have distinct surfaces; cards, labels, completion states, and drag
  feedback remain easy to distinguish.
- Workspace tabs and navigation use quieter selection treatments. Archive counts
  use a neutral badge so reminders retain their emphasis.
- Dialogs have one Cancel action and an accessible close control.
- Welcome and inbox empty states explain the next action clearly.
- Small windows use a compact navigation strip, preserve board space, hide the
  desktop sidebar divider, and keep editors within the viewport. Search summaries
  and facets use two columns on narrow screens.

## Interaction fixes

- Workspace tabs support Left/Right, Home/End, and Enter/Space activation.
- Modal focus captures the opener before autofocus runs and returns to it on close.
  Nested confirmations retain focus in the topmost dialog; hidden and disabled
  controls are excluded from the tab loop.
- Missing typography, spacing, and focus tokens are defined. Editable notes,
  discussion fields, and editor dividers now use valid focus colors.
- Modal fade animations use valid CSS shorthand. Reduced-motion preferences remain
  respected, and app/editor height follows the dynamic viewport.
- Navigation exposes its selected destination to assistive technology.
- The browser entry point includes the existing app icon, removing the missing
  favicon request.

## Verification

The user story is: open a workspace, organize boards, create and edit cards,
interact with their details, persist changes, and return to the saved work.

- Production TypeScript/Vite build: passed.
- Storage and serialization checks: passed.
- Rust backend tests: 26 passed.
- Full Playwright suite: 84 passed; the opt-in QA sweep is skipped by default.
  The QA sweep was also run separately and passed.
- New browser regressions cover keyboard workspace switching, modal focus return,
  nested confirmation focus, and saving/reopening cards at 390px.
- Visual review covered both themes and board, card-view, editor, search, archive,
  inbox, members, settings, and welcome surfaces.
- Board/card/editor/search layouts reviewed at 1440, 1024, 800, 520, and 390px.
  No document or editor horizontal overflow at the four narrower sizes; no page
  errors or browser console errors in the review.
- Sampled text-token contrast exceeds 4.5:1 in both themes, including secondary
  sidebar text and primary/destructive button labels.

Browser tests use the repository's DEV IPC harness. Rust tests exercise backend
commands independently; native macOS/Windows window rendering, packaging, and
signing were not exercised in this Linux environment.
