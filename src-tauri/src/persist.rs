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
