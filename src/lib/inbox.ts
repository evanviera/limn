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

export interface InboxReadState {
  seenAt: string;
  readItemIds: string[];
}

export const EMPTY_INBOX_READ_STATE: InboxReadState = { seenAt: "", readItemIds: [] };

export function inboxSeenAtKey(workspacePath: string, memberId: string): string {
  return `${INBOX_SEEN_AT_PREFIX}${workspacePath}:${memberId}`;
}

// Inbox read state is device-local, just like the active identity. Older builds
// stored a bare ISO timestamp under this key; accept that shape so existing read
// history survives the move to per-item state.
export function parseInboxReadState(value: string | null): InboxReadState {
  if (!value) {
    return EMPTY_INBOX_READ_STATE;
  }
  try {
    const parsed = JSON.parse(value) as Partial<InboxReadState>;
    return {
      seenAt: typeof parsed.seenAt === "string" ? parsed.seenAt : "",
      readItemIds: Array.isArray(parsed.readItemIds)
        ? [...new Set(parsed.readItemIds.filter((id): id is string => typeof id === "string"))]
        : []
    };
  } catch {
    return { seenAt: value, readItemIds: [] };
  }
}

export function serializeInboxReadState(state: InboxReadState): string {
  return JSON.stringify(state);
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

export function isInboxItemUnread(item: Pick<InboxItem, "id" | "createdAt">, state: InboxReadState): boolean {
  return !state.readItemIds.includes(item.id) && (!state.seenAt || item.createdAt > state.seenAt);
}

export function inboxUnreadCount(items: Array<Pick<InboxItem, "id" | "createdAt">>, state: InboxReadState): number {
  return items.filter((item) => isInboxItemUnread(item, state)).length;
}

export function markInboxItemRead(state: InboxReadState, itemId: string): InboxReadState {
  if (state.readItemIds.includes(itemId)) {
    return state;
  }
  return { ...state, readItemIds: [...state.readItemIds, itemId] };
}

export function markAllInboxItemsRead(state: InboxReadState, items: Array<Pick<InboxItem, "createdAt">>): InboxReadState {
  const newestItemAt = items.reduce(
    (latest, item) => item.createdAt > latest ? item.createdAt : latest,
    state.seenAt
  );
  return { seenAt: newestItemAt, readItemIds: [] };
}
