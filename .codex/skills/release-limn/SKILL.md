---
name: release-limn
description: Release automation for the Limn Tauri app. Use when Codex needs to cut a Limn production release, bump all versioned files, run release validation, commit the release prep, create the vX.Y.Z tag, and push main plus the tag. Do not watch GitHub Actions or verify the updater feed unless the user explicitly asks.
---

# Release Limn

## Overview

Cut Limn releases through the repo's release path. Treat signing and updater keys as existing infrastructure; do not generate or rotate keys during a normal release.

## Quick Start

From the Limn repo root:

```sh
.codex/skills/release-limn/scripts/cut-release.sh 0.1.3
```

The script bumps all versioned files through `npm run release:version`, runs the release checks, commits `Prepare vX.Y.Z release`, creates tag `vX.Y.Z`, and pushes `main` plus the tag. The Release workflow is expected to create a non-draft GitHub release (`releaseDraft: false`) so the release goes directly to production after the workflow uploads assets, but the user will monitor that workflow manually by default.

Use `--skip-e2e` only when the user explicitly accepts that risk. Use `--no-push` for a local rehearsal that still commits and tags.

## Release Workflow

1. Establish the target version.
   - Use an explicit version from the user when provided.
   - If the user says "next release" or similar, inspect `package.json` and propose the next patch version unless context clearly calls for minor or major.
   - Use bare semver for the script argument, such as `0.1.3`; the script also accepts `v0.1.3`.

2. Inspect repository state before changing files.
   - Confirm the current branch is `main`.
   - Confirm the worktree is clean. Stop if unrelated changes exist.
   - Confirm `origin` points at `evanviera/limn`.
   - Confirm the local and remote tag do not already exist.

3. Run the bundled script.
   - Prefer `.codex/skills/release-limn/scripts/cut-release.sh <version>`.
   - Let it run all checks unless the user explicitly asks to skip a check.
   - If a check fails, do not tag or push. Fix the cause or report the blocker.

4. After the tag push, stop instead of watching GitHub Actions.
   - Do not run `gh run watch`.
   - Do not repeatedly poll `gh run list`, `gh run view`, the release page, or the updater feed.
   - If useful, provide the manual follow-up commands below and let the user run them.

5. Manual post-release checks for the user.
   - Find the run for the tag: `gh run list --workflow Release --limit 10`.
   - Confirm both macOS and Windows jobs pass in GitHub Actions.
   - Inspect the release: `gh release view vX.Y.Z --json isDraft,isPrerelease,assets,url,tagName,name`.
   - Confirm `isDraft` and `isPrerelease` are both `false`.
   - Verify the updater feed:

```sh
curl -sL https://github.com/evanviera/limn/releases/latest/download/latest.json
```

6. Report the outcome.
   - Include the version, commit hash, tag, and push result.
   - State that GitHub Actions and updater-feed verification are left for the user's manual follow-up unless the user explicitly asked Codex to verify them.
   - If GitHub CLI network access is blocked before the push completes, stop and give the exact commands still needed.

## Versioned Files

The release version must be synchronized in:

- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`

Do not edit these manually for a normal release. Use `npm run release:version -- <semver>` directly or let `scripts/cut-release.sh` call it.

## Signing Assumptions

The Release workflow expects these GitHub Actions secrets to already exist:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`
- `KEYCHAIN_PASSWORD`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the updater key is password-protected

Do not create a new Developer ID certificate, updater key, or keychain password during routine version releases.
