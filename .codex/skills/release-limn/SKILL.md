---
name: release-limn
description: Release automation for the Limn Tauri app. Use when Codex needs to cut a Limn release, bump all versioned files, run release validation, commit the release prep, create the vX.Y.Z tag, push main and the tag, watch GitHub Actions, publish the draft GitHub release, or verify the updater feed.
---

# Release Limn

## Overview

Cut Limn releases through the repo's release path. Treat signing and updater keys as existing infrastructure; do not generate or rotate keys during a normal release.

## Quick Start

From the Limn repo root:

```sh
.codex/skills/release-limn/scripts/cut-release.sh 0.1.3
```

The script bumps all versioned files through `npm run release:version`, runs the release checks, commits `Prepare vX.Y.Z release`, creates tag `vX.Y.Z`, and pushes `main` plus the tag.

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

4. After the tag push, watch the Release workflow.
   - Use `gh run list --workflow Release --limit 10` to find the run for tag `vX.Y.Z`.
   - Use `gh run watch <run-id> --exit-status`.
   - Confirm both macOS and Windows jobs pass.

5. Publish and verify the GitHub release.
   - Inspect the draft: `gh release view vX.Y.Z --json isDraft,assets,url,tagName,name`.
   - Publish only after the workflow is green: `gh release edit vX.Y.Z --draft=false`.
   - Verify the updater feed:

```sh
curl -sL https://github.com/evanviera/limn/releases/latest/download/latest.json
```

6. Report the outcome.
   - Include the version, commit hash, tag, workflow result, release URL, and updater feed verification.
   - If GitHub CLI network access is blocked, stop and give the exact commands still needed.

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
