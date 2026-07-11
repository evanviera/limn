import type { Card, Member } from "../types";
import { MENTION_PATTERN, matchMention } from "./mentions.js";

export type InboxItemKind = "mention" | "comment" | "assigned" | "completed" | "moved";

export interface InboxItem {
  id: string;
  kind: InboxItemKind;
  card: Card;
  createdAt: string;
  label: string;
  snippet?: string;
}

export const INBOX_SEEN_AT_PREFIX = "limn:inbox:seenAt:";

export function inboxSeenAtKey(workspacePath: string, memberId: string): string {
  return `${INBOX_SEEN_AT_PREFIX}${workspacePath}:${memberId}`;
}

function mentionTargetsMember(body: string, activeMemberId: string, members: Member[]): boolean {
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const token = match[0].slice(1);
    const resolved = matchMention(token, members);
    if (resolved?.id === activeMemberId || (!members.length && token.toLowerCase() === activeMemberId.toLowerCase())) {
      return true;
    }
  }
  return false;
}

export function buildInboxItems(cards: Card[], activeMemberId: string, members: Member[] = []): InboxItem[] {
  if (!activeMemberId) return [];

  const items: InboxItem[] = [];
  for (const card of cards) {
    if (card.archived) continue;
    const assignedToActiveMember = card.assignees.includes(activeMemberId);

    for (const comment of card.comments) {
      if (comment.authorId === activeMemberId) continue;

      const isMention = mentionTargetsMember(comment.body, activeMemberId, members);
      if (isMention || assignedToActiveMember) {
        items.push({
          id: `${isMention ? "mention" : "comment"}:${card.id}:${comment.id}`,
          kind: isMention ? "mention" : "comment",
          card,
          createdAt: comment.createdAt,
          label: `${comment.authorName || "Someone"} ${isMention ? "mentioned you" : "commented"}`,
          snippet: comment.body.replace(/\s+/g, " ").trim()
        });
      }
    }

    if (!assignedToActiveMember) continue;
    for (const event of card.activity) {
      if (event.type === "assigned" || event.type === "completed" || event.type === "moved") {
        const label = event.type === "assigned" ? "Assigned to you" : event.type === "completed" ? "Completed your card" : "Moved your card";
        items.push({ id: `activity:${card.id}:${event.id}`, kind: event.type, card, createdAt: event.createdAt, label });
      }
    }
  }

  return items.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
}

export function isInboxItemUnread(item: Pick<InboxItem, "createdAt">, seenAt: string): boolean {
  return !seenAt || item.createdAt > seenAt;
}

export function inboxUnreadCount(items: Array<Pick<InboxItem, "createdAt">>, seenAt: string): number {
  return items.filter((item) => isInboxItemUnread(item, seenAt)).length;
}
