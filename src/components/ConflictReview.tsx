import { useEffect, useRef, useState } from "react";
import { useModalKeys } from "../lib/useModalKeys";
import type { ReviewConflict } from "../lib/conflicts";

export type ConflictChoice = "mine" | "merged" | "discard";

const KIND_LABELS: Record<ReviewConflict["kind"], string> = {
  card: "Card",
  board: "Board",
  settings: "Settings",
  members: "Members",
};

// The in-app conflict review surface: a prop-driven modal that lists preserved
// conflict copies, compares each against the current on-disk entity field by
// field, and offers keep-mine / use-merged / keep-current (discard) resolutions.
// All IO — enumerating, writing the chosen version, discarding the artifact —
// lives in the caller; this component only presents and dispatches the choice.
export function ConflictReview({
  conflicts,
  onResolve,
  onClose,
}: {
  conflicts: ReviewConflict[];
  onResolve: (conflict: ReviewConflict, choice: ConflictChoice) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(conflicts[0]?.relativePath ?? null);
  useModalKeys(dialogRef, onClose);

  // Keep a valid selection as conflicts are resolved out from under us.
  useEffect(() => {
    if (conflicts.length === 0) {
      setSelectedPath(null);
      return;
    }
    if (!conflicts.some((conflict) => conflict.relativePath === selectedPath)) {
      setSelectedPath(conflicts[0].relativePath);
    }
  }, [conflicts, selectedPath]);

  const selected = conflicts.find((conflict) => conflict.relativePath === selectedPath) ?? null;

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        aria-labelledby="conflict-review-title"
        aria-modal="true"
        className="conflict-review"
        data-testid="conflict-review"
        ref={dialogRef}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id="conflict-review-title">Review conflicts</h2>
          <button data-testid="conflict-review-close" type="button" onClick={onClose}>
            Close
          </button>
        </header>

        {conflicts.length === 0 ? (
          <p className="conflict-empty" data-testid="conflict-review-empty">
            No conflicts to review. Everything on disk is reconciled.
          </p>
        ) : (
          <div className="conflict-review-body">
            <ul className="conflict-list" aria-label="Open conflicts">
              {conflicts.map((conflict) => (
                <li key={conflict.relativePath}>
                  <button
                    className={conflict.relativePath === selectedPath ? "conflict-item active" : "conflict-item"}
                    data-testid="conflict-item"
                    type="button"
                    onClick={() => setSelectedPath(conflict.relativePath)}
                  >
                    <span className="conflict-item-title">{conflict.title}</span>
                    <span className="conflict-item-kind">
                      {KIND_LABELS[conflict.kind]}
                      {conflict.currentMissing ? " · deleted on disk" : ""}
                      {!conflict.parsed ? " · unreadable" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {selected && (
              <div className="conflict-detail" data-testid="conflict-detail">
                <div className="conflict-detail-head">
                  <h3>{selected.title}</h3>
                  <code className="conflict-path">{selected.relativePath}</code>
                </div>

                {selected.parsed ? (
                  <>
                    <div className="conflict-compare-head" aria-hidden="true">
                      <span>Field</span>
                      <span>Your copy</span>
                      <span>{selected.currentMissing ? "On disk (deleted)" : "Current on disk"}</span>
                    </div>
                    <dl className="conflict-compare">
                      {selected.fields.map((row) => (
                        <div
                          className={row.differs ? "conflict-row differs" : "conflict-row"}
                          key={row.label}
                        >
                          <dt>{row.label}</dt>
                          <dd className="conflict-mine">{row.mine || "—"}</dd>
                          <dd className="conflict-theirs">{selected.currentMissing ? "—" : row.theirs || "—"}</dd>
                        </div>
                      ))}
                    </dl>
                  </>
                ) : (
                  <div className="conflict-raw">
                    <p className="conflict-note">
                      This copy could not be parsed. Review it in the workspace folder, then discard it.
                    </p>
                    <pre>{selected.rawContent}</pre>
                  </div>
                )}

                {selected.currentMissing && selected.parsed && (
                  <p className="conflict-note">
                    No current version exists on disk — it was deleted. Keep this copy to restore it, or
                    discard it to leave it deleted.
                  </p>
                )}

                <div className="conflict-actions">
                  {selected.mine && (
                    <button
                      className="primary"
                      data-testid="conflict-keep-mine"
                      type="button"
                      onClick={() => onResolve(selected, "mine")}
                    >
                      {selected.currentMissing ? "Restore this copy" : "Keep this copy"}
                    </button>
                  )}
                  {selected.merged && (
                    <button
                      data-testid="conflict-keep-merged"
                      type="button"
                      onClick={() => onResolve(selected, "merged")}
                    >
                      Use merged version
                    </button>
                  )}
                  <button
                    className={selected.mine ? "" : "primary"}
                    data-testid="conflict-discard"
                    type="button"
                    onClick={() => onResolve(selected, "discard")}
                  >
                    {selected.currentMissing ? "Discard copy" : "Keep current version"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
