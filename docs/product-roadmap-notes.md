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

### Archive and Recovery UI

Archived cards need a visible recovery path: archive browser, unarchive, and possibly recently deleted/trash. Without that, archive acts like a one-way hiding mechanism.

### Due-Date Workflow

Due dates need overdue/upcoming grouping, reminders, and possibly calendar export. Without a workflow around them, due dates are mostly passive metadata.

### Conflict Review and Version History

Because Limn is local-first and folder-synced, conflict handling is a core product concern. Users need to compare conflict copies, choose a version, and understand what changed.

### Attachments

Real tasks collect screenshots, PDFs, logs, design files, and other artifacts. A local attachments folder would fit Limn's storage model well.

### Comments or Discussion Notes

Activity records system events, but teams also need human discussion: comments, mentions, decisions, and Slack-friendly references back to the card.

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

