import type { Member } from "../types";
import { matchMention, MENTION_PATTERN } from "./mentions.js";

// Pure helpers for composing Slack incoming-webhook messages. Sending lives in
// App (via the `post_slack` IPC command); this module only builds text.

// Slack won't make a custom-scheme link (`limn://…`) clickable, so messages link
// to a small page on the Limn site that hands the card id to the app. The page
// only forwards the id; no card data travels in the URL.
export const CARD_OPEN_BASE_URL = "https://limn.forme.md/open/card/";

export function cardOpenUrl(cardId: string): string {
  return `${CARD_OPEN_BASE_URL}${encodeURIComponent(cardId)}`;
}

// Slack's mrkdwn treats `&`, `<` and `>` as control characters. Escape any
// user-written text (card titles, board names, comments) so a title like
// "<draft>" shows as typed instead of breaking the message.
export function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A Slack link line that opens the card in Limn.
export function slackOpenLink(cardId: string): string {
  return `<${cardOpenUrl(cardId)}|Open in Limn>`;
}

// Join a headline and detail lines into one message, ending with the card link.
// Empty lines are dropped so optional details (like "By:") can be passed as "".
export function slackCardMessage(cardId: string, lines: string[]): string {
  return [...lines.filter(Boolean), slackOpenLink(cardId)].join("\n");
}

// Members @mentioned in a comment, in order of first mention, without
// duplicates and without the comment's author (no one needs a ping for
// mentioning themselves).
export function mentionedMembers(body: string, members: Member[], authorId?: string): Member[] {
  const found: Member[] = [];
  for (const token of body.match(MENTION_PATTERN) ?? []) {
    const member = matchMention(token.slice(1), members);
    if (member && member.id !== authorId && !found.some((item) => item.id === member.id)) {
      found.push(member);
    }
  }
  return found;
}

// Keep comment excerpts short so a long comment doesn't flood the channel.
export function commentExcerpt(body: string, max = 200): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export const SLACK_TEST_MESSAGE = "👋 Limn is connected. Card updates for this workspace will appear here.";
