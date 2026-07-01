# Release Testing

This document tracks release and updater checks that cannot be fully covered by local tests.

## Completed Locally

- `npm run build:web`
- `npm run test:storage`
- `cargo check` from `src-tauri`
- `npm run test:e2e`
- Signed local Tauri build with the generated updater key:
  - produced `src-tauri/target/release/bundle/dmg/Limn_0.1.0_aarch64.dmg`
  - produced `src-tauri/target/release/bundle/macos/Limn.app.tar.gz`
  - produced `src-tauri/target/release/bundle/macos/Limn.app.tar.gz.sig`

## Pending GitHub Release Validation

- Add repository secrets:
  - `TAURI_SIGNING_PRIVATE_KEY`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, empty if the key has no password.
  - Windows Authenticode signing secrets after a code signing certificate is purchased. Exact secret names depend on the certificate/provider flow.
- Run `npm run release:version -- <next-version>`.
- Create and push a matching tag, for example `v0.2.0`.
- Confirm the GitHub Actions release workflow succeeds for macOS and Windows.
- Confirm the draft GitHub Release contains:
  - `latest.json`
  - macOS DMG asset
  - updater `.app.tar.gz` asset
  - updater `.app.tar.gz.sig` signature asset
  - Windows installer `.exe` asset
  - Windows updater artifact and signature assets
- Install the previous released build, publish the draft release, and confirm Limn detects the new version from GitHub Releases.
- Install the update from the in-app banner or Settings and confirm Limn restarts into the new version.
- Install the Windows build on a clean Windows machine or VM and confirm workspace creation, board persistence, update detection, no blank console window on launch, and expected SmartScreen/code-signing behavior.
