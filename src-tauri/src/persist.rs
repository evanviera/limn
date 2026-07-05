// Conflict-aware persistence primitives shared by every workspace write.
//
// The frontend owns the typed three-way merge (see `src/lib/merge.ts`); this
// module is the generic, format-agnostic half that runs on disk: an optimistic
// compare-and-swap write plus a conflict-copy writer. Keeping the version check
// here (rather than per entity in `lib.rs`) means cards, boards, settings,
// members, and any future element type all reuse the same safe write path.

use super::{atomic_write, display_err, extract_frontmatter_value};
use serde::Serialize;
use std::{fs, path::Path};

#[derive(Serialize)]
pub struct WriteResult {
    pub relative_path: String,
    pub conflict: bool,
    // Current on-disk content when a conflict is detected, so the caller can run
    // a three-way merge and retry. `None` on a clean write; also `None` together
    // with `conflict: true` when the file was deleted remotely.
    pub current_content: Option<String>,
}

pub enum WriteOutcome {
    Written,
    Conflict(Option<String>),
}

#[derive(Serialize)]
pub struct DeleteResult {
    pub conflict: bool,
    // Present only on a conflict: the workspace-relative path where the current
    // on-disk version was preserved so the caller can surface / review it.
    pub copy_path: Option<String>,
}

// A preserved conflict artifact surfaced to the in-app review UI.
#[derive(Serialize)]
pub struct ConflictFile {
    // Workspace-relative path, e.g. "cards/card_x_conflict_1.md" or
    // ".workspace/conflicts/board_y_conflict_2.json".
    pub relative_path: String,
    pub file_name: String,
    pub content: String,
}

// The optimistic-concurrency token for a workspace file: its `updatedAt`, read
// from Markdown frontmatter (cards) or top-level JSON (boards/settings/members).
pub fn file_version(content: &str) -> Option<String> {
    if content.trim_start().starts_with("---") {
        extract_frontmatter_value(content, "updatedAt")
    } else {
        serde_json::from_str::<serde_json::Value>(content)
            .ok()
            .and_then(|value| {
                value
                    .get("updatedAt")
                    .and_then(|updated| updated.as_str())
                    .map(ToOwned::to_owned)
            })
    }
}

// Write `content` to `target`, but only if the file's current version still
// matches `expected_version`. When it does not, nothing is written and the disk
// content is returned so the caller can merge. A missing file paired with an
// expected version is reported as a remote deletion (conflict, no content).
pub fn conditional_write(
    target: &Path,
    content: &str,
    expected_version: Option<&str>,
) -> Result<WriteOutcome, String> {
    if let Some(expected) = expected_version {
        if target.exists() {
            let current = fs::read_to_string(target).map_err(display_err)?;
            if file_version(&current).as_deref() != Some(expected) {
                return Ok(WriteOutcome::Conflict(Some(current)));
            }
        } else {
            return Ok(WriteOutcome::Conflict(None));
        }
    }

    atomic_write(target, content.to_string())?;
    Ok(WriteOutcome::Written)
}

// Delete `target`, but only if its current version still matches
// `expected_version`. Mirrors `conditional_write`: when the on-disk version has
// moved on under us we refuse the delete — so we never silently discard another
// device's edit — preserve the current disk content as a conflict copy in
// `conflict_dir`, and report the conflict. A missing file is treated as an
// already-completed delete (idempotent): there is nothing left to lose.
// `expected_version: None` forces an unconditional delete.
pub fn conditional_delete(
    root: &Path,
    target: &Path,
    conflict_dir: &str,
    file_name: &str,
    expected_version: Option<&str>,
) -> Result<DeleteResult, String> {
    if !target.exists() {
        return Ok(DeleteResult {
            conflict: false,
            copy_path: None,
        });
    }
    if let Some(expected) = expected_version {
        let current = fs::read_to_string(target).map_err(display_err)?;
        if file_version(&current).as_deref() != Some(expected) {
            let copy_path = write_conflict_copy(root, conflict_dir, file_name, &current)?;
            return Ok(DeleteResult {
                conflict: true,
                copy_path: Some(copy_path),
            });
        }
    }

    fs::remove_file(target).map_err(display_err)?;
    Ok(DeleteResult {
        conflict: false,
        copy_path: None,
    })
}

// Enumerate every preserved conflict artifact so the app can review them:
// anything under `.workspace/conflicts/`, plus the `cards/*_conflict_*.md`
// copies that live beside their card. Unreadable files are skipped rather than
// failing the whole listing.
pub fn list_conflicts(root: &Path) -> Result<Vec<ConflictFile>, String> {
    let mut out = Vec::new();
    collect_conflicts(
        &root.join(".workspace/conflicts"),
        ".workspace/conflicts",
        None,
        &mut out,
    )?;
    collect_conflicts(&root.join("cards"), "cards", Some("_conflict_"), &mut out)?;
    out.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(out)
}

fn collect_conflicts(
    dir: &Path,
    relative_dir: &str,
    name_filter: Option<&str>,
    out: &mut Vec<ConflictFile>,
) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(display_err)? {
        let entry = entry.map_err(display_err)?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_string();
        // Skip in-flight atomic-write temp files and only keep matches when a
        // marker (like "_conflict_") is required.
        if file_name.starts_with('.') {
            continue;
        }
        if name_filter.is_some_and(|marker| !file_name.contains(marker)) {
            continue;
        }
        if let Ok(content) = fs::read_to_string(&path) {
            out.push(ConflictFile {
                relative_path: format!("{relative_dir}/{file_name}"),
                file_name,
                content,
            });
        }
    }
    Ok(())
}

// Remove a single conflict artifact once the user has resolved it. Only paths
// inside the two known conflict locations are accepted, and only `_conflict_`
// copies (never a live card/board/settings file), so this can never delete real
// workspace data.
pub fn delete_conflict(root: &Path, relative_path: &str) -> Result<(), String> {
    let (dir, file_name) = relative_path
        .rsplit_once('/')
        .ok_or_else(|| "Invalid conflict path".to_string())?;
    if !matches!(dir, "cards" | ".workspace/conflicts") {
        return Err("Unsupported conflict directory".to_string());
    }
    if file_name.is_empty()
        || file_name.contains('\\')
        || file_name.starts_with('.')
        || !file_name.contains("_conflict_")
    {
        return Err("Invalid conflict file".to_string());
    }
    let target = root.join(dir).join(file_name);
    if target.exists() {
        fs::remove_file(target).map_err(display_err)?;
    }
    Ok(())
}

// Preserve a losing/local version alongside the workspace as
// `<relative_dir>/<stem>_conflict_<timestamp>.<ext>`, returning its
// workspace-relative path. `relative_dir` is a fixed, caller-supplied location
// (e.g. "cards" or ".workspace/conflicts"), never user input.
pub fn write_conflict_copy(
    root: &Path,
    relative_dir: &str,
    file_name: &str,
    content: &str,
) -> Result<String, String> {
    let (stem, ext) = file_name
        .rsplit_once('.')
        .ok_or_else(|| "Conflict copy needs a file extension".to_string())?;
    let stamp = chrono::Utc::now().format("%Y%m%d%H%M%S%f");
    let copy_name = format!("{stem}_conflict_{stamp}.{ext}");
    atomic_write(&root.join(relative_dir).join(&copy_name), content.to_string())?;
    Ok(format!("{relative_dir}/{copy_name}"))
}
