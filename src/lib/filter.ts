import type { ArchivedFilter, Card, CardFilter, CompletionFilter, DueFilterKind, FilterSort } from "../types";
import { compareCardsByDueDate, describeDue } from "./dueDate.js";

// Sentinel stored in `CardFilter.assignees` to match cards with no assignee.
// Member ids are prefixed (`member_…`) so this literal can never collide.
export const UNASSIGNED_ASSIGNEE = "__unassigned__";

// The neutral starting point for the filter: no text, every board, active
// (not completed, not archived) cards, most-recently-updated first. `filterIsActive`
// treats a filter equal to this as "not filtering".
export const EMPTY_FILTER: CardFilter = {
  text: "",
  boardId: "",
  assignees: [],
  labels: [],
  due: "any",
  completion: "active",
  archived: "active",
  sort: "updated"
};

export interface PresetDefinition {
  id: string;
  name: string;
  // Builds the preset's filter. `activeMemberId` scopes personal presets like
  // "My tasks" to whoever is using this device.
  build: (activeMemberId: string) => CardFilter;
  // Personal presets are meaningless without a chosen identity.
  requiresIdentity?: boolean;
}

// Built-in presets surfaced above the saved views. They are computed (never
// stored), so "My tasks" always tracks the current device identity.
export const FILTER_PRESETS: PresetDefinition[] = [
  {
    id: "my-tasks",
    name: "My tasks",
    requiresIdentity: true,
    build: (activeMemberId) => ({ ...EMPTY_FILTER, assignees: activeMemberId ? [activeMemberId] : [], sort: "due" })
  },
  {
    id: "due-soon",
    name: "Due soon",
    build: () => ({ ...EMPTY_FILTER, due: "soon", sort: "due" })
  },
  {
    id: "recently-updated",
    name: "Recently updated",
    build: () => ({ ...EMPTY_FILTER, sort: "updated" })
  }
];

// Every distinct label used across the given cards, sorted case-insensitively.
// Drives the label filter's option list.
export function collectLabels(cards: Card[]): string[] {
  const seen = new Map<string, string>();
  for (const card of cards) {
    for (const label of card.labels) {
      const key = label.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, label);
      }
    }
  }
  return Array.from(seen.values()).sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
}

// True when the filter would narrow results at all (i.e. it differs from
// EMPTY_FILTER). Used to enable "Clear" and "Save view".
export function filterIsActive(filter: CardFilter): boolean {
  return (
    filter.text.trim() !== "" ||
    filter.boardId !== "" ||
    filter.assignees.length > 0 ||
    filter.labels.length > 0 ||
    filter.due !== EMPTY_FILTER.due ||
    filter.completion !== EMPTY_FILTER.completion ||
    filter.archived !== EMPTY_FILTER.archived ||
    filter.sort !== EMPTY_FILTER.sort
  );
}

function matchesText(card: Card, text: string): boolean {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return true;
  }
  const haystack = `${card.title}\n${card.body}\n${card.labels.join(" ")}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function matchesAssignees(card: Card, assignees: string[]): boolean {
  if (assignees.length === 0) {
    return true;
  }
  return assignees.some((id) =>
    id === UNASSIGNED_ASSIGNEE ? card.assignees.length === 0 : card.assignees.includes(id)
  );
}

function matchesLabels(card: Card, labels: string[]): boolean {
  if (labels.length === 0) {
    return true;
  }
  const cardLabels = new Set(card.labels.map((label) => label.toLowerCase()));
  return labels.some((label) => cardLabels.has(label.toLowerCase()));
}

function matchesCompletion(card: Card, completion: CompletionFilter): boolean {
  if (completion === "active") {
    return !card.completed;
  }
  if (completion === "completed") {
    return card.completed;
  }
  return true;
}

function matchesArchived(card: Card, archived: ArchivedFilter): boolean {
  if (archived === "active") {
    return !card.archived;
  }
  if (archived === "archived") {
    return card.archived;
  }
  return true;
}

// Day-delta based due matching so each option means exactly what its label says.
export function matchesDue(card: Card, kind: DueFilterKind, now: Date = new Date()): boolean {
  if (kind === "any") {
    return true;
  }
  const days = describeDue(card.due, now).days;
  if (kind === "none") {
    return days === null;
  }
  if (days === null) {
    return false;
  }
  switch (kind) {
    case "has":
      return true;
    case "overdue":
      return days < 0;
    case "today":
      return days === 0;
    case "soon":
      // Everything needing attention within the coming week — overdue, today,
      // and the next seven days.
      return days <= 7;
    case "later":
      return days > 7;
    default:
      return true;
  }
}

function compareBySort(sort: FilterSort): (left: Card, right: Card) => number {
  switch (sort) {
    case "created":
      return (left, right) => right.createdAt.localeCompare(left.createdAt) || left.title.localeCompare(right.title);
    case "due":
      return compareCardsByDueDate;
    case "title":
      return (left, right) => left.title.localeCompare(right.title) || right.updatedAt.localeCompare(left.updatedAt);
    case "updated":
    default:
      return (left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title);
  }
}

// Apply a filter to a card list: keep the matches, then sort. Pure and
// deterministic (ties broken by title) so it is unit-testable in isolation.
export function filterCards(cards: Card[], filter: CardFilter, now: Date = new Date()): Card[] {
  const matched = cards.filter(
    (card) =>
      matchesArchived(card, filter.archived) &&
      matchesCompletion(card, filter.completion) &&
      (filter.boardId === "" || card.boardId === filter.boardId) &&
      matchesAssignees(card, filter.assignees) &&
      matchesLabels(card, filter.labels) &&
      matchesDue(card, filter.due, now) &&
      matchesText(card, filter.text)
  );
  return matched.sort(compareBySort(filter.sort));
}
