# Product Roadmap Notes

These notes capture current product thinking for Limn as a local-first task manager. They are intentionally lightweight: a place to return to when deciding what to build next, not a committed release plan.

## Current Product Shape

Limn already has a coherent MVP spine:

- Local-first workspaces stored as normal folders.
- Boards, lists, and cards with readable JSON/Markdown files.
- Members, labels, due dates, subtasks, notes, comments, attachments, and card activity.
- Cross-board filtering, saved views, due reminders, calendar export, and manual card ordering.
- Folder-sync compatibility through iCloud Drive, Dropbox, Google Drive, Syncthing, or similar tools.
- Slack notifications for assignment and completion events.

The main product risk is no longer basic card-editing depth or basic workspace navigation. The larger gap is helping users recover, compare, import/export, and coordinate work once a workspace grows beyond a few boards.

## Key Missing Features

### [x] Search, Filters, and Saved Views

Users need to find cards by text, assignee, label, due date, completion state, archived state, and board. Saved views such as "My Tasks", "Due Soon", and "Recently Updated" would likely matter more than adding more card fields.

**Shipped.** A cross-board **Filter** view (sidebar nav, `Cmd/Ctrl+F`, or the "Filter Cards" menu item) narrows every card by free text (AND-matched across title, notes, and labels) plus structured facets: board, assignee (including an "Unassigned" option), label, due-date window (overdue / today / soon / later / has / no date), completion state, and archived state, with a sort control (recently updated/created, due date, or title). Built-in presets — **My tasks** (scoped to this device's chosen identity), **Due soon**, and **Recently updated** — sit above user **saved views**: any filter can be named and stored in `.workspace/settings.json` (`savedViews`), so it is folder-synced and shared by everyone on the workspace, and can be re-applied, renamed, or deleted. Results open the card editor in its board context. The matching engine is a pure module (`src/lib/filter.ts`), unit-tested alongside storage. Still open: filters are session-local (not encoded in a shareable URL/deep link), and saved views can be created/renamed/deleted but not edited in place (re-save to update).

### [x] Precise Card Ordering

Kanban boards rely on ordering inside a list as an implicit priority system. Limn supports dragging cards between lists, but precise in-list reordering should become a core board behavior.

**Shipped.** Cards now carry a manual `order` and can be dragged to any position within a list (an insertion line marks where the card will land). Sorting is order-first with due date as the tiebreaker, so an un-curated list still reads in due-date priority until someone reorders it: cards default to order `0` ("unordered"), and the first in-list drag renormalizes the affected list to spaced, distinct orders. Placement uses fractional midpoints so a typical reorder rewrites only the moved card. The `order` lives in each card's Markdown frontmatter. Still open: cross-list drop position is honored, but reordering via the card editor's List dropdown appends rather than prompting for a position.

### [ ] Archive and Recovery UI

Archived cards need a visible recovery path: archive browser, unarchive, and possibly recently deleted/trash. Without that, archive acts like a one-way hiding mechanism.

**Partially covered.** The Filter view can include archived cards, so archived work is discoverable, but there is still no dedicated archive browser, unarchive action, or trash/recently deleted workflow.

### [x] Due-Date Workflow

Due dates need searchable due windows, reminders, and possibly calendar export. Without a workflow around them, due dates are mostly passive metadata.

**Shipped.** Due dates are now active. Board cards show a colour-coded due chip (overdue/today/soon), and the cross-board **Filter** view can scope by due date, sort by due date, save due-date views, and open matching cards. Reminders surface as a red count badge on the Filter nav item (overdue + due-today) and a notice when a workspace with overdue work is opened. The card editor gained Today/Tomorrow/Next week/Clear shortcuts plus a live status hint. Calendar export writes an all-day `.ics` (one VEVENT per dated card) into `exports/limn-due-dates.ics` inside the workspace, keeping it in the local-first, folder-synced model. Still open: reminders are in-app only (no OS/Slack push, which would need a background scheduler).

### [ ] Conflict Review and Version History

Because Limn is local-first and folder-synced, conflict handling is a core product concern. Users need to compare conflict copies, choose a version, and understand what changed.

**Largely covered; review UI now shipped.** Writes and deletes both run through a reusable, typed **three-way merge** layer (`src/lib/merge.ts` + `src/lib/mergeWrite.ts`) on top of generic optimistic compare-and-swap primitives in Rust (`src-tauri/src/persist.rs`). Every entity kind — cards, boards, workspace settings, members — is reconciled by composing field policies (scalars, set-like arrays like labels/assignees, keyed/append arrays like comments/activity/lists, deletes/tombstones). When the disk copy changed under a save, structured edits merge automatically and silently (e.g. two people adding different labels, comments, or board columns); only free text that both sides rewrote (a card's title/body, a board's name) is a hard conflict, which preserves the local version as a conflict copy and warns. Settings and members always auto-merge. Remote deletes restore the local edit rather than lose it.

**Conditional deletes.** Deleting a card or board is now version-checked the same way writes are (`conditional_delete`): if another device edited that entity since you loaded it, the delete is *refused* — the current disk copy is preserved under `.workspace/conflicts/` and the outcome is surfaced through the same `SaveOutcome` / `handleSaveOutcome` banner path ("… changed on another device; not deleted, your copy is at <path>"), then the workspace reloads so the entity reappears. Attachment folders are cleaned up only when a card is actually removed, so a refused delete never orphans (or loses) anything. Board deletion refuses per-entity: any card or the board itself that was edited elsewhere is preserved, and the app reloads to show exactly what survived. This closes the last silent-loss hole (previously deletes removed files unconditionally).

**In-app conflict review.** Conflict artifacts are no longer invisible. A Rust `list_conflicts` command enumerates every preserved copy (`.workspace/conflicts/*` and `cards/*_conflict_*.md`); `src/lib/conflicts.ts` classifies and parses each, pairs it with the current on-disk entity, and proposes a lossless auto-merge via the merge engine. A persistent "unresolved conflicts" banner opens a review modal (`src/components/ConflictReview.tsx`) that lists open conflicts and, for each, shows the preserved copy vs the current on-disk entity field by field. Each conflict offers three actions: **keep this copy** (write the preserved version), **use merged version** (write the union that keeps the current text and folds in any structured data unique to the copy), and **keep current / discard copy** (drop the artifact). Resolving writes the chosen/merged result through the normal conflict-aware save path and then discards the artifact (`delete_conflict_file`). An orphaned copy whose entity was deleted can be restored or discarded.

Still open: text/body conflicts are still preserved as whole copies rather than merged via a **CRDT/diff3** (there is no character-level reconciliation of two rewritten paragraphs), there is still no broader **version history / timeline** (only the current conflict artifacts, not an audit trail of past versions), and there is still no **networking/sync** — Limn stays purely local-first over a synced folder. The typed change-record foundation is intended to make future peer-to-peer or encrypted-relay sync a plug-in rather than a rewrite.

### [x] Attachments

Real tasks collect screenshots, PDFs, logs, design files, and other artifacts. A local attachments folder would fit Limn's storage model well.

**Shipped.** Cards now support local file-backed attachments stored under `attachments/<cardId>/` and referenced from each card's Markdown frontmatter. Files can be added from the card editor, dropped onto an open card, or dropped onto a board card. Attachment rows show file names and sizes, non-image files open in the OS default app, image files render thumbnails, board cards use the latest image as a cover preview, and the image lightbox supports keyboard/chevron navigation plus reveal/open actions. Removing an attachment deletes its copied file, and deleting a card removes its attachment folder. Still open: no attachment search/indexing, no bulk export tools beyond the readable workspace folder itself, and no version history for replaced files.

### [x] Comments or Discussion Notes

Activity records system events, but teams also need human discussion: comments, mentions, decisions, and Slack-friendly references back to the card.

**Shipped.** Each card now has a Discussion section (threaded comments with author attribution, edit/delete of your own, and @mention highlighting of known members). Because comments must be attributable, each person first picks who they are from the project's members via the sidebar identity control; that choice is device-local (stored per workspace in `localStorage`, never synced), so everyone sharing a folder keeps their own identity. The comment composer includes @mention autocomplete with keyboard/mouse selection, and comments live in each card's Markdown frontmatter alongside activity/subtasks/attachments. Still open as a follow-up: optional Slack notifications when someone is mentioned.

### [ ] Recurring Tasks and Templates

Small teams often repeat the same checklists for releases, onboarding, QA passes, publishing, and operations. Card or board templates would reduce repeated setup.

### [ ] Import, Export, and Backup Tools

Limn's readable local files are a differentiator, so import/export should reinforce that. Useful tools include CSV import/export, Trello import, board export, workspace backup, and Markdown bundle export.

**Partially covered.** Due-date calendar export exists, but the broader import/export/backup surface is still open.

### [ ] Cross-Board Overview

A dashboard could summarize assigned work, blocked work, overdue work, recently changed cards, and cards without owners. This becomes important when Limn is used for more than one active board.

## Product Direction

Limn should not rush into accounts, cloud hosting, or heavyweight permissions unless the target shifts away from small trusted teams. Its strongest differentiator is the local-first, readable-files model.

The next major product step should make larger workspaces safer and more portable:

1. Archive recovery, including unarchive and recently deleted/trash.
2. Conflict review and version history.
3. Import, export, and backup tools.
4. Recurring tasks and card/board templates.
5. Cross-board overview/dashboard.
