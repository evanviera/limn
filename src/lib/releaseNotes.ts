// "What's new" notes, newest first. Shown once after Limn updates (see
// useWhatsNew) and from Help > What's New in Limn.
//
// When preparing a release, add an entry for the new version here. Keep each
// line short, plain and user-facing: what changed and where to find it.

export interface ReleaseNote {
  version: string;
  items: string[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "0.9.6",
    items: [
      "After an update, Limn now shows what changed, once. Reopen it any time from Help > What's New in Limn.",
      "Compact completed in the View menu now does what it says: it folds done steps into “N completed” on each card. Turn it off to keep them in place. The old setting that shrinks whole cards is now called Compact done cards.",
      "Long links in a card's step list no longer push their link mark onto a line of its own."
    ]
  },
  {
    version: "0.9.5",
    items: [
      "Color is back: people, due dates, links and step progress each have their own color, so cards are easier to scan.",
      "Prefer the calm look? Turn on Quiet mode in the board's View menu.",
      "Four new themes between Dark and Light: Graphite, Storm, Ash and Fog. Pick one from the theme button in the sidebar.",
      "Done steps fold into “N completed” on each card."
    ]
  }
];

/** Compares dotted version numbers: negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Notes for versions after `lastSeen`, up to and including `current`, newest first. */
export function notesSince(lastSeen: string | null, current: string): ReleaseNote[] {
  return RELEASE_NOTES.filter(note => compareVersions(note.version, current) <= 0
    && (lastSeen === null || compareVersions(note.version, lastSeen) > 0));
}
