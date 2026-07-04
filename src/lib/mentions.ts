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

// The name-safe characters a mention token is made of — the run that follows the
// "@" while the composer's autocomplete is active. Mirrors MENTION_PATTERN.
const MENTION_TOKEN_CHAR = /[A-Za-z0-9._-]/;

// An in-progress "@mention" the caret is currently sitting inside, located so the
// composer can offer suggestions and replace the token when one is chosen.
export interface MentionQuery {
  // Text typed after "@" and before the caret, e.g. "gr" for "@gr|".
  query: string;
  // Index of the "@" in the source text.
  start: number;
  // Caret index (end of the token being typed).
  end: number;
}

// Find the "@mention" the caret is inside, or null when it isn't in one. A mention
// starts at "@" that sits at the start of the text or right after whitespace, and
// runs through name-safe characters up to the caret — so "a@b" (an email) and a
// token with a space in it don't trigger suggestions.
export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  if (caret < 1 || caret > text.length) {
    return null;
  }
  let index = caret - 1;
  while (index >= 0 && MENTION_TOKEN_CHAR.test(text[index]!)) {
    index -= 1;
  }
  if (index < 0 || text[index] !== "@") {
    return null;
  }
  if (index > 0 && !/\s/.test(text[index - 1]!)) {
    return null;
  }
  return { query: text.slice(index + 1, caret), start: index, end: caret };
}

// Members that match an in-progress mention query, best first: whole-word and
// compact-name prefixes rank above looser substring hits. An empty query lists
// everyone (alphabetically) so typing a bare "@" opens the full roster.
export function suggestMembers(query: string, members: Member[], limit = 6): Member[] {
  const needle = normalize(query);
  const ranked: Array<{ member: Member; rank: number }> = [];
  for (const member of members) {
    const rank = rankMember(needle, member);
    if (rank >= 0) {
      ranked.push({ member, rank });
    }
  }
  ranked.sort((a, b) => a.rank - b.rank || a.member.name.localeCompare(b.member.name));
  return ranked.slice(0, Math.max(0, limit)).map((entry) => entry.member);
}

function rankMember(needle: string, member: Member): number {
  if (!needle) {
    return 2;
  }
  const name = normalize(member.name);
  const compact = name.replace(/\s+/g, "");
  const words = name.split(/\s+/);
  const handle = member.slackHandle?.toLowerCase().replace(/^@/, "");
  if (
    words.some((word) => word.startsWith(needle)) ||
    compact.startsWith(needle) ||
    normalize(member.id).startsWith(needle) ||
    handle?.startsWith(needle)
  ) {
    return 0;
  }
  if (name.includes(needle) || handle?.includes(needle)) {
    return 1;
  }
  return -1;
}

// Replace the in-progress mention token with the chosen member's reference,
// leaving a trailing space so typing can continue. Returns the new text and where
// the caret should land.
export function applyMention(
  text: string,
  range: MentionQuery,
  member: Member
): { text: string; caret: number } {
  const inserted = `@${mentionToken(member)} `;
  const next = text.slice(0, range.start) + inserted + text.slice(range.end);
  return { text: next, caret: range.start + inserted.length };
}
