import type { Board, Card } from "../types";

export type ArchiveSort = "recent" | "oldest" | "title";

export interface ArchiveLocation {
  boardName: string;
  listName: string;
  available: boolean;
}

// New archives have an explicit timestamp. For legacy cards, the latest
// archive activity is the best source; updatedAt is a final stable fallback.
export function archiveTimestamp(card: Card): string {
  return card.archivedAt
    || card.activity.find((event) => event.type === "archived")?.createdAt
    || card.updatedAt;
}

export function archiveReason(card: Card): string {
  return card.activity.find((event) => event.type === "archived")?.message ?? "Archived card";
}

export function archiveLocation(card: Card, boards: Board[]): ArchiveLocation {
  const board = boards.find((item) => item.id === card.boardId);
  const list = board?.lists.find((item) => item.id === card.listId);
  return {
    boardName: board?.name ?? "Unknown board",
    listName: list?.name ?? "Deleted list",
    available: Boolean(board && list)
  };
}

export function compareArchivedCards(sort: ArchiveSort): (left: Card, right: Card) => number {
  if (sort === "title") {
    return (left, right) => left.title.localeCompare(right.title) || archiveTimestamp(right).localeCompare(archiveTimestamp(left));
  }
  if (sort === "oldest") {
    return (left, right) => archiveTimestamp(left).localeCompare(archiveTimestamp(right)) || left.title.localeCompare(right.title);
  }
  return (left, right) => archiveTimestamp(right).localeCompare(archiveTimestamp(left)) || left.title.localeCompare(right.title);
}

export function formatArchivedWhen(card: Card, now = new Date()): string {
  const value = new Date(archiveTimestamp(card));
  if (Number.isNaN(value.getTime())) {
    return "Archive date unknown";
  }
  const elapsedMs = Math.max(0, now.getTime() - value.getTime());
  const hours = Math.floor(elapsedMs / 3_600_000);
  if (hours < 1) return "Archived just now";
  if (hours < 24) return `Archived ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `Archived ${days} ${days === 1 ? "day" : "days"} ago`;
  return `Archived ${value.toLocaleDateString(undefined, { month: "short", day: "numeric", year: value.getFullYear() === now.getFullYear() ? undefined : "numeric" })}`;
}
