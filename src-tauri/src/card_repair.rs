// Lossless auto-repair for card files that were cut off on this computer.
//
// Cloud sync clients occasionally leave a local card file truncated (seen with
// Google Drive for desktop: the server copy was intact while the local file
// stopped mid-line). Guessing at the missing tail and writing it back would
// upload a damaged card over the good server copy, so repair here is strictly
// lossless:
//
// - Every intact card this device reads or writes is kept as a snapshot in the
//   app's data folder (never in the synced workspace).
// - A card file missing its closing frontmatter is restored only when it is a
//   byte-for-byte prefix of its snapshot *and* that prefix already includes the
//   complete `updatedAt` line. `updatedAt` changes on every save, so this proves
//   the snapshot is the very version that was cut off — the restore writes back
//   exactly what the file should contain.
// - The damaged original is kept in `.workspace/damaged/`, and the file is
//   re-read just before writing so a sync that fixed it in the meantime wins.
//
// Anything else is left untouched for the frontend to report.

use super::{atomic_write, TextFile};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};

static SNAPSHOT_ROOT: OnceLock<PathBuf> = OnceLock::new();

// Called once from app setup; until then (and in tests) snapshots are disabled.
pub fn init_snapshot_root(dir: PathBuf) {
    let _ = SNAPSHOT_ROOT.set(dir);
}

// A card is intact when its frontmatter is closed. Truncation almost always cuts
// the (long, JSON-heavy) frontmatter, so this is the damage signal.
pub fn is_intact_card(content: &str) -> bool {
    let mut lines = content.lines();
    lines.next() == Some("---") && lines.any(|line| line == "---")
}

fn workspace_snapshot_dir(store: &Path, workspace: &str) -> PathBuf {
    // FNV-1a: stable across Rust releases, unlike `DefaultHasher`.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in workspace.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    store.join(format!("{hash:016x}"))
}

// Whether `damaged` is a cut-off copy of exactly the version in `snapshot`: a
// strict prefix that still contains the complete `updatedAt` line.
pub fn is_truncation_of(damaged: &str, snapshot: &str) -> bool {
    damaged.len() < snapshot.len()
        && snapshot.starts_with(damaged)
        && damaged
            .split_inclusive('\n')
            .any(|line| line.starts_with("updatedAt:") && line.ends_with('\n'))
}

// Record intact cards as snapshots and restore damaged ones in place. `files` is
// (file name, content) for cards just read from `root`; a restored entry's
// content is replaced with the recovered card. Returns user-facing warnings for
// each restore. Snapshot IO failures are ignored: snapshots are best effort.
pub fn snapshot_and_restore(
    store: &Path,
    workspace: &str,
    root: &Path,
    files: &mut [(&str, &mut String)],
) -> Vec<String> {
    let dir = workspace_snapshot_dir(store, workspace);
    let _ = fs::create_dir_all(&dir);
    let mut warnings = Vec::new();

    for (file_name, content) in files.iter_mut() {
        let file_name: &str = file_name;
        if file_name.starts_with('.') {
            continue;
        }
        let snapshot_path = dir.join(file_name);
        let snapshot = fs::read_to_string(&snapshot_path).ok();

        if is_intact_card(content) {
            if snapshot.as_deref() != Some(content.as_str()) {
                let _ = fs::write(&snapshot_path, content.as_bytes());
            }
            continue;
        }

        let Some(snapshot) = snapshot.filter(|snapshot| is_intact_card(snapshot)) else {
            continue;
        };
        if !is_truncation_of(content, &snapshot) {
            continue;
        }
        if let Ok(backup) = restore_card(root, file_name, content, &snapshot) {
            warnings.push(format!(
                "cards/{file_name} was cut off on this computer (likely by a sync app) and has been restored from Limn's local copy of the same version. The damaged file was saved to {backup}."
            ));
            **content = snapshot;
        }
    }
    warnings
}

// Back up the damaged file and write the snapshot over it, but only if the file
// on disk is still the damaged copy. Returns the backup's workspace-relative path.
fn restore_card(
    root: &Path,
    file_name: &str,
    damaged: &str,
    snapshot: &str,
) -> Result<String, String> {
    let target = root.join("cards").join(file_name);
    if fs::read_to_string(&target).ok().as_deref() != Some(damaged) {
        return Err("card changed on disk".to_string());
    }
    let stem = file_name.strip_suffix(".md").unwrap_or(file_name);
    let stamp = chrono::Utc::now().format("%Y%m%d%H%M%S%f");
    let backup = format!(".workspace/damaged/{stem}_damaged_{stamp}.md");
    atomic_write(&root.join(&backup), damaged.to_string())?;
    atomic_write(&target, snapshot.to_string())?;
    Ok(backup)
}

// Snapshot + restore for a batch of freshly read card files, off the async
// runtime; restored entries get their recovered content. No-op until
// `init_snapshot_root` has run.
pub async fn process_loaded_cards(
    workspace: &str,
    root: &Path,
    cards: &mut [TextFile],
) -> Vec<String> {
    let Some(store) = SNAPSHOT_ROOT.get() else {
        return Vec::new();
    };
    let workspace = workspace.to_string();
    let root = root.to_path_buf();
    let mut batch: Vec<(String, String)> = cards
        .iter()
        .map(|file| (file.file_name.clone(), file.content.clone()))
        .collect();
    let task = tokio::task::spawn_blocking(move || {
        let mut files: Vec<(&str, &mut String)> = batch
            .iter_mut()
            .map(|(name, content)| (name.as_str(), content))
            .collect();
        let warnings = snapshot_and_restore(store, &workspace, &root, &mut files);
        (batch, warnings)
    });
    let Ok((batch, warnings)) = task.await else {
        return Vec::new();
    };
    for (card, (_, content)) in cards.iter_mut().zip(batch) {
        card.content = content;
    }
    warnings
}

// Keep the snapshot current after this device writes a card.
pub fn record_written_card(workspace: &str, file_name: &str, content: &str) {
    let Some(store) = SNAPSHOT_ROOT.get() else {
        return;
    };
    if !is_intact_card(content) {
        return;
    }
    let dir = workspace_snapshot_dir(store, workspace);
    if fs::create_dir_all(&dir).is_ok() {
        let _ = fs::write(dir.join(file_name), content.as_bytes());
    }
}
