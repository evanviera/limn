import { useEffect, useRef } from "react";
import type { ReleaseNote } from "../lib/releaseNotes";
import { Icon } from "./icons.js";
import { useModalKeys } from "../lib/useModalKeys.js";

export function WhatsNewDialog({ notes, onClose }: { notes: ReleaseNote[]; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  useModalKeys(dialogRef, onClose);
  useEffect(() => { doneRef.current?.focus(); }, []);

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div aria-labelledby="whats-new-title" aria-modal="true" className="text-dialog whats-new" data-testid="whats-new-dialog"
        ref={dialogRef} role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2 id="whats-new-title">What's new in Limn {notes[0]?.version}</h2>
          <button aria-label="Close dialog" className="icon-button" type="button" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="whats-new-body">
          {notes.map((note, index) => (
            <section key={note.version}>
              {(notes.length > 1 || index > 0) && <h3>Version {note.version}</h3>}
              <ul>
                {note.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          ))}
        </div>
        <footer>
          <button ref={doneRef} className="primary" data-testid="whats-new-close" type="button" onClick={onClose}>Got it</button>
        </footer>
      </div>
    </div>
  );
}
