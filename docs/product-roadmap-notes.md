# Product Roadmap Notes

These notes capture current product thinking for Limn as a local-first task manager. They are intentionally lightweight: a place to return to when deciding what to build next, not a committed release plan.

## Current Product Shape

Limn already has a coherent MVP spine:

- Local-first workspaces stored as normal folders.
- Boards, lists, and cards with readable JSON/Markdown files.
- Members, labels, due dates, subtasks, notes, and card activity.
- Folder-sync compatibility through iCloud Drive, Dropbox, Google Drive, Syncthing, or similar tools.
- Slack notifications for assignment and completion events.

The main product risk is not card-editing depth. The larger gap is helping users find, prioritize, recover, and coordinate work once a workspace grows beyond a few boards.

## Key Missing Features

### Search, Filters, and Saved Views

Users need to find cards by text, assignee, label, due date, completion state, archived state, and board. Saved views such as "My Tasks", "Due Soon", and "Recently Updated" would likely matter more than adding more card fields.

### Precise Card Ordering

Kanban boards rely on ordering inside a list as an implicit priority system. Limn supports dragging cards between lists, but precise in-list reordering should become a core board behavior.

**Shipped.** Cards now carry a manual `order` and can be dragged to any position within a list (an insertion line marks where the card will land). Sorting is order-first with due date as the tiebreaker, so an un-curated list still reads in due-date priority until someone reorders it: cards default to order `0` ("unordered"), and the first in-list drag renormalizes the affected list to spaced, distinct orders. Placement uses fractional midpoints so a typical reorder rewrites only the moved card. The `order` lives in each card's Markdown frontmatter. Still open: cross-list drop position is honored, but reordering via the card editor's List dropdown appends rather than prompting for a position.

### Archive and Recovery UI

Archived cards need a visible recovery path: archive browser, unarchive, and possibly recently deleted/trash. Without that, archive acts like a one-way hiding mechanism.

### Due-Date Workflow

Due dates need overdue/upcoming grouping, reminders, and possibly calendar export. Without a workflow around them, due dates are mostly passive metadata.

**Shipped.** Due dates are now active. Board cards show a colour-coded due chip (overdue/today/soon), and a new cross-board **Due dates** view groups every card by how soon it is due (Overdue → Today → Due soon → Upcoming → No due date), with a "show completed" filter and click-through to the card. Reminders surface as a red count badge on the Due nav item (overdue + due-today) and a notice when a workspace with overdue work is opened. The card editor gained Today/Tomorrow/Next week/Clear shortcuts plus a live status hint. Calendar export writes an all-day `.ics` (one VEVENT per dated card) into `exports/limn-due-dates.ics` inside the workspace, keeping it in the local-first, folder-synced model. Still open: reminders are in-app only (no OS/Slack push, which would need a background scheduler).

### Conflict Review and Version History

Because Limn is local-first and folder-synced, conflict handling is a core product concern. Users need to compare conflict copies, choose a version, and understand what changed.

### Attachments

Real tasks collect screenshots, PDFs, logs, design files, and other artifacts. A local attachments folder would fit Limn's storage model well.

### Comments or Discussion Notes

Activity records system events, but teams also need human discussion: comments, mentions, decisions, and Slack-friendly references back to the card.

**Shipped.** Each card now has a Discussion section (threaded comments with author attribution, edit/delete of your own, and @mention highlighting of known members). Because comments must be attributable, each person first picks who they are from the project's members via the sidebar identity control; that choice is device-local (stored per workspace in `localStorage`, never synced), so everyone sharing a folder keeps their own identity. Comments live in each card's Markdown frontmatter alongside activity/subtasks/attachments. Still open as follow-ups: @mention autocomplete in the composer and optional Slack notifications when someone is mentioned.

### Recurring Tasks and Templates

Small teams often repeat the same checklists for releases, onboarding, QA passes, publishing, and operations. Card or board templates would reduce repeated setup.

### Import, Export, and Backup Tools

Limn's readable local files are a differentiator, so import/export should reinforce that. Useful tools include CSV import/export, Trello import, board export, workspace backup, and Markdown bundle export.

### Cross-Board Overview

A dashboard could summarize assigned work, blocked work, overdue work, recently changed cards, and cards without owners. This becomes important when Limn is used for more than one active board.

## Product Direction

Limn should not rush into accounts, cloud hosting, or heavyweight permissions unless the target shifts away from small trusted teams. Its strongest differentiator is the local-first, readable-files model.

The next major product step should make larger workspaces navigable and safer:

1. Search, filters, and saved views.
2. Precise card ordering.
3. Archive recovery.
4. Conflict review and version history.
5. Due-date workflow.

