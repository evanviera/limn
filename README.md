# Limn

Limn is a local-first Trello-style task board for small trusted teams. Workspaces are normal folders, so they can be synced with iCloud Drive, Dropbox, Google Drive, Syncthing, or any other folder sync tool.

> **Syncing a workspace via the cloud?** Keep the folder **available offline** so Limn never has to download "online-only" files just to open. See [docs/cloud-sync.md](docs/cloud-sync.md).

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

## Project Structure

See [docs/architecture.md](docs/architecture.md) for the codebase map and the conventions that keep files focused. In brief: the React frontend is split across `src/App.tsx` (root/orchestration), `src/components/*.tsx`, and `src/lib/*.ts`; CSS lives in `src/styles/*.css` (imported by the `src/styles.css` barrel); the Rust backend is `src-tauri/src/` (`lib.rs`, `menu.rs`, `tests.rs`). **Keep single files focused — split before they swell** rather than growing one file unbounded.

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

This local build does not create signed updater artifacts, so it does not require a Tauri updater signing key.

## Releases and Updates

Limn uses Tauri's updater with GitHub Releases. Release builds run on macOS and Windows, then upload signed updater metadata to `latest.json`, which the desktop app checks at startup and from Settings.

Before tagging a release, update all version fields:

```sh
npm run release:version -- 0.2.0
git tag v0.2.0
git push origin v0.2.0
```

The release workflow requires `TAURI_SIGNING_PRIVATE_KEY` in GitHub Actions secrets. If the key has a password, also set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; otherwise leave it empty.

To run the same signed updater-artifact build locally, set those environment variables and run:

```sh
npm run tauri:build:release
```

The draft release should include macOS install/update assets and a Windows installer asset, typically the Tauri NSIS `.exe`.

### Windows Signing

Windows release builds should be Authenticode-signed before publishing. This is separate from the Tauri updater signature: the updater key proves update metadata/artifacts are valid to Limn, while Authenticode signing identifies the Windows executable and installer to Windows and Microsoft Defender SmartScreen.

Unsigned Windows installers can be installed, but users should expect the "Windows protected your PC" / unknown publisher warning. An EV code signing certificate usually receives immediate SmartScreen reputation. A standard OV code signing certificate is cheaper, but may still show SmartScreen warnings until the certificate or submitted file earns reputation.

Once a Windows certificate is available, configure the release workflow to sign the Tauri Windows artifacts using the certificate provider's supported flow, such as importing a PFX into the Windows runner certificate store, using Azure Key Vault, or setting Tauri's Windows `signCommand`.

## Usage

1. Launch Limn.
2. Create or open a workspace folder.
3. Add workspace members.
4. Create a board, add lists, then create cards.
5. Drag cards between lists or edit them in the card detail panel.
6. Add a Slack incoming webhook URL in settings to send completion and assignment updates.

## Slack

Limn posts through the Tauri backend so browser CORS does not block incoming webhook calls. Workspace settings include toggles for each Slack notification type. When a card is marked complete, Limn posts:

```text
✅ Task completed: <card title>
Assigned to: <assignees>
Board: <board name>
```

It also posts simple alerts when a card is assigned, moved to a list named `Done`, or when a card step is marked complete.
If an assigned member has a Slack handle configured in Members, Limn uses that handle in the `Assigned to` line so Slack can tag them.

## Known Limitations

- This MVP is designed for small trusted teams and has no account system or permissions.
- File sync conflicts are handled with simple conflict copies when a card changed on disk since it was opened.
- Due-date reminders are not implemented as a background daemon. They are future work because reliable reminders require background scheduling beyond the current MVP scope.
- Drag and drop moves cards between columns, but does not yet support precise in-column reordering.

## Future Work

- See [Product Roadmap Notes](docs/product-roadmap-notes.md) for broader product direction and missing feature analysis.
- Board import/export helpers.
- Better conflict review UI for conflict copy files.
- Due-date reminder scheduling.
- Search and filters.
- Card attachments.
