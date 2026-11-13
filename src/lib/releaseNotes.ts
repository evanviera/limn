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
    version: "0.9.7",
    items: [
      "Slack messages now include an “Open in Limn” link that jumps straight to the card.",
      "@mention someone in a comment and Limn pings them in Slack. Turn it off in Settings.",
      "Send test message: check your Slack webhook from Settings before you rely on it."
    ]
  },
  {
    version: "0.9.6",
    items: [
      "A fresh look: a cleaner, calmer design with a new blue accent and app icon.",
      "Six color themes: Dark, Graphite, Storm, Ash, Fog and Light. Pick one from the theme button in the sidebar.",
      "Quiet mode: prefer a calmer board? Turn it on in View.",
      "Compact completed: fold finished steps into “N completed” on each card, or turn it off to keep them in place (View)."
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
