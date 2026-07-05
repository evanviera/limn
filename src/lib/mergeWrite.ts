// Generic conflict-aware write orchestration.
//
// This is the retry loop that turns the raw "optimistic compare-and-swap" write
// primitive (implemented in Rust) plus the pure merge engine (`merge.ts`) into a
// safe save. It is entity-agnostic and IO-injected: the caller supplies a small
// adapter describing how to attempt a write, how to three-way-merge disk content
// with the pending local edit, and how to preserve the local version as a copy.
// Keeping it pure makes the retry/fallback behaviour unit-testable without Tauri.
//
// Contract, in order of preference:
//   1. No remote change  -> write straight through ("written").
//   2. Remote changed, merge is clean -> write the merged result ("merged").
//   3. Remote changed, merge has a hard (free-text) conflict -> preserve our
//      version as a conflict copy AND still write the best-effort merge so safe
//      additions land ("conflict").
//   4. The file was deleted remotely while we edited it -> restore our version
//      rather than lose the edit ("restored").

export type SaveStatus = "written" | "merged" | "conflict" | "restored";

export interface SaveOutcome {
  status: SaveStatus;
  // Workspace-relative path of the conflict copy, present only for "conflict".
  copyPath?: string;
}

// The result of one compare-and-swap attempt.
export interface WriteAttempt {
  conflict: boolean;
  // On conflict: the current on-disk content to merge against, or null when the
  // file was deleted remotely. Ignored when `conflict` is false.
  currentContent: string | null;
}

export interface ConflictWriteAdapter {
  // Attempt to write `content`, but only if the file's current version still
  // equals `expectedVersion`. `undefined` means an unconditional write (creates
  // and first-time saves). Resolves to whether a conflict was detected.
  write(content: string, expectedVersion: string | undefined): Promise<WriteAttempt>;
  // Three-way-merge our pending edit against `theirs` (raw disk content).
  // Returns the serialized merged content, whether a hard conflict remains, and
  // the disk version we merged against (used as the compare-and-swap token for
  // the retry so we only overwrite exactly what we merged).
  merge(theirs: string): { content: string; conflict: boolean; theirsVersion: string | undefined };
  // Serialize our own version, written verbatim as the conflict copy.
  ours(): string;
  // Persist a conflict copy and return its workspace-relative path.
  writeConflictCopy(content: string): Promise<string>;
}

export async function resolveConflictWrite(
  ourContent: string,
  expectedVersion: string | undefined,
  adapter: ConflictWriteAdapter,
  maxRetries = 5,
): Promise<SaveOutcome> {
  let attempt = await adapter.write(ourContent, expectedVersion);
  if (!attempt.conflict) {
    return { status: "written" };
  }

  let copyPath: string | undefined;
  for (let i = 0; i < maxRetries; i++) {
    if (attempt.currentContent === null) {
      // Deleted remotely while we were editing: restoring our version is the
      // non-destructive choice.
      await adapter.write(ourContent, undefined);
      return { status: "restored" };
    }

    const merged = adapter.merge(attempt.currentContent);
    if (merged.conflict && copyPath === undefined) {
      // Preserve the local version once, up front, before we touch disk.
      copyPath = await adapter.writeConflictCopy(adapter.ours());
    }

    attempt = await adapter.write(merged.content, merged.theirsVersion);
    if (!attempt.conflict) {
      return copyPath === undefined ? { status: "merged" } : { status: "conflict", copyPath };
    }
    // Someone wrote again between our read and our retry; loop and re-merge.
  }

  // Exhausted retries against a rapidly-changing file: guarantee no data loss by
  // preserving our version even if we never landed the merge.
  if (copyPath === undefined) {
    copyPath = await adapter.writeConflictCopy(adapter.ours());
  }
  return { status: "conflict", copyPath };
}
