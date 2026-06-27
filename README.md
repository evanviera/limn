# Limn

Limn is a local-first Trello-style task board for small trusted teams. Workspaces are normal folders, so they can be synced with iCloud Drive, Dropbox, Google Drive, Syncthing, or any other folder sync tool.

## Storage Layout

Each workspace folder contains:

```text
.workspace/
  settings.json
  members.json
boards/
  board_<id>.json
cards/
  card_<id>.md
```

Board files are JSON. Card files are Markdown with frontmatter so the data remains readable and editable outside the app.

## Development

Install dependencies:

```sh
npm install
```

Run the Tauri app:

```sh
npm run tauri:dev
```

Build:

```sh
npm run tauri:build
```

## Usage

1. Launch Limn.
2. Create or open a workspace folder.
3. Add workspace members.
4. Create a board, add lists, then create cards.
5. Drag cards between lists or edit them in the card detail panel.
6. Add a Slack incoming webhook URL in settings to send completion and assignment updates.

## Slack

Limn posts through the Tauri backend so browser CORS does not block incoming webhook calls. When a card is marked complete, Limn posts:

```text
✅ Task completed: <card title>
Assigned to: <assignees>
Board: <board name>
```

It also posts simple alerts when a card is assigned or moved to a list named `Done`.

## Known Limitations

- This MVP is designed for small trusted teams and has no account system or permissions.
- File sync conflicts are handled with simple conflict copies when a card changed on disk since it was opened.
- Due-date reminders are not implemented as a background daemon. They are future work because reliable reminders require background scheduling beyond the current MVP scope.
- Drag and drop moves cards between columns, but does not yet support precise in-column reordering.

## Future Work

- Board import/export helpers.
- Better conflict review UI for conflict copy files.
- Due-date reminder scheduling.
- Search and filters.
- Card attachments.
