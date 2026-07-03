import type { Member } from "../types";

// A mention is an "@" followed by a run of name-safe characters. The pattern is
// used both to highlight mentions when rendering a comment and to split comment
// text into mention / plain-text segments. Kept deliberately simple: it matches a
// single whitespace-free token, so "@Ada Lovelace" matches the "@Ada" token and
// resolves via the member's first name.
export const MENTION_PATTERN = /@[A-Za-z0-9._-]+/g;

// A comment token like "@ada" splits into segments with a capturing split so the
// delimiter (the mention) is preserved in the resulting array.
export const MENTION_SPLIT_PATTERN = /(@[A-Za-z0-9._-]+)/g;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

// Resolve a mention token (without the leading "@") to a member, or null when it
// doesn't name anyone on the project. Matches the member id, full name, the
// space-stripped full name, or the first word of the name so "@ada", "@Ada",
// and "@AdaLovelace" all resolve to "Ada Lovelace".
export function matchMention(token: string, members: Member[]): Member | null {
  const needle = normalize(token);
  if (!needle) {
    return null;
  }

  return (
    members.find((member) => {
      const name = normalize(member.name);
      return (
        normalize(member.id) === needle ||
        name === needle ||
        name.replace(/\s+/g, "") === needle ||
        name.split(/\s+/)[0] === needle
      );
    }) ?? null
  );
}

// The mention token a member should be referenced by in composed text. Prefers a
// single-word first name; falls back to the space-stripped full name.
export function mentionToken(member: Member): string {
  const firstWord = member.name.trim().split(/\s+/)[0];
  return firstWord || member.name.replace(/\s+/g, "") || member.id;
}
