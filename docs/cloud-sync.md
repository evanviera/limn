# Using Limn with a cloud-sync folder (Dropbox, Google Drive, iCloud, OneDrive…)

Limn is local-first: a workspace is just a folder of readable files. That makes it
tempting to put the folder inside a cloud-sync service so the same boards follow
you across machines. This works, but there is one setting that matters a lot for
performance.

## The "online-only" gotcha

Dropbox (Smart Sync), Google Drive, OneDrive (Files On-Demand), and iCloud all
support keeping files **online-only**: the file appears in the folder but its
contents live in the cloud until something reads them. The first time a program
reads an online-only file, the OS **blocks that read while it downloads the file**.

A Limn workspace can contain hundreds of small card files. If they are all
online-only, opening the workspace has to download each one — and a slow or flaky
connection turns that into a long wait. This is the classic "spinning ball, so I
quit the app" symptom.

## What Limn does to help

Limn is built to stay responsive even on a cloud vault:

- **Progressive open.** Limn loads the small files first (settings, board columns)
  and paints the board **immediately**, then streams the cards in behind a
  "Loading cards… N of M" indicator. You see your boards right away instead of a
  blank spinner.
- **Parallel, timeout-bounded reads.** Card files are read concurrently, so
  online-only placeholders hydrate in parallel rather than one slow download at a
  time. Any single file that can't download in time is skipped with a warning
  instead of hanging the whole load — and you can **Cancel** the card phase at any
  point and reload later.
- **A cloud-storage hint.** When your workspace path looks like a sync folder,
  Limn shows a one-time banner recommending you keep the folder available offline.
- **Incremental refresh.** When files change on disk (e.g. another device synced),
  Limn re-reads only what changed instead of the whole vault, which also keeps the
  file watcher from thrashing while a sync client rewrites many files.

## Recommended setup (do this once)

Set your Limn workspace folder to **"Always keep on this device"** (a.k.a. *keep
offline* / *pin* / *make available offline*). This keeps a real local copy that
syncs in the background, so Limn never has to download a file just to open it.

| Service | Where to set it |
| --- | --- |
| **Dropbox** | Right-click the folder → **Smart Sync → Local** (or Make available offline). |
| **Google Drive** | Right-click the folder → **Offline access → Available offline**. |
| **OneDrive** | Right-click the folder → **Always keep on this device**. |
| **iCloud Drive** | Right-click the folder → **Keep Downloaded**. |

After this, the online-only slow path never triggers and Limn opens at local-disk
speed while still syncing across your machines.

## A note on conflicts

Two machines editing the same workspace can still write the same file around the
same time. That is a separate concern from download speed, and Limn already
handles it with a three-way merge and preserved conflict copies — see
[architecture.md](architecture.md) and the conflict-review surface in the app.
