import { useEffect, useState } from "react";
import { notesSince, type ReleaseNote } from "./releaseNotes.js";

const LAST_SEEN_KEY = "limn-last-seen-version";
// Installs from before this feature have no last-seen version. If they have
// used Limn before (any saved preference), treat them as coming from 0.9.5 so
// they still see what's new; a brand-new install sees nothing.
const LEGACY_LAST_SEEN = "0.9.5";

function readLastSeen(): string | null {
  try {
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("resetLimnE2e")) {
      localStorage.removeItem(LAST_SEEN_KEY);
    }
    const stored = localStorage.getItem(LAST_SEEN_KEY);
    if (stored) return stored;
    for (let index = 0; index < localStorage.length; index += 1) {
      if (localStorage.key(index)?.startsWith("limn-")) return LEGACY_LAST_SEEN;
    }
  } catch { /* Blocked storage: behave like a fresh install. */ }
  return null;
}

function writeLastSeen(version: string): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, version);
  } catch { /* Not remembering only means the notes may show again. */ }
}

/**
 * The "What's new" window: opens once on the first launch of a new version
 * (when there are notes for it) and on demand from the Help menu.
 */
export function useWhatsNew(currentVersion: string) {
  // Read during the first render, before any effect saves a preference, so a
  // brand-new install isn't mistaken for an older one.
  const [lastSeen] = useState(readLastSeen);
  const [notes, setNotes] = useState<ReleaseNote[] | null>(() => {
    const unseen = lastSeen === null ? [] : notesSince(lastSeen, currentVersion);
    return unseen.length > 0 ? unseen : null;
  });

  useEffect(() => {
    if (!notes) writeLastSeen(currentVersion);
    // Only on launch: closing the window records the version itself.
  }, [currentVersion]);

  return {
    notes,
    showAll: () => setNotes(notesSince(null, currentVersion)),
    close: () => {
      writeLastSeen(currentVersion);
      setNotes(null);
    }
  };
}
