// Reusable, typed three-way merge engine for Limn's local-first workspace files.
//
// This module is the foundation for conflict-aware writes. It is deliberately
// framework-agnostic and free of file IO: it takes three versions of an entity
// — the common `base` (what we last saw on disk), `ours` (the local edit), and
// `theirs` (the current disk state) — and produces a best-effort merge plus a
// record of which fields could not be reconciled automatically.
//
// The design is entity-agnostic: every Limn element type (cards, boards,
// settings, members, and future kinds) is merged by composing a handful of
// field-level policies:
//
//   - scalar fields          -> threeWayScalar  (last-writer-wins, base-aware)
//   - set-like arrays        -> threeWayStringSet (labels / assignees)
//   - append/keyed arrays    -> threeWayListById  (comments / activity / lists…)
//
// Only *free text that both sides rewrote* (a card's title/body, a board's name)
// is treated as an unmergeable "hard" conflict. Everything structured merges
// automatically, so the common case never bothers the user. Text/body conflicts
// are surfaced as conflict records (and, by the caller, conflict copies) rather
// than being resolved with a CRDT — that heavier machinery is future work.

import type {
  Board,
  BoardList,
  Card,
  Comment,
  Member,
  MembersFile,
  SavedView,
  Subtask,
  WorkspaceSettings,
} from "../types";

export type EntityKind = "card" | "board" | "settings" | "members";

// The outcome of merging one entity. `clean` means the result is safe to write
// without user involvement; when it is false, `conflicts` names the free-text
// fields that both sides changed differently and the caller should preserve the
// local version (e.g. as a conflict copy) rather than silently discard it.
export interface EntityMergeResult<T> {
  value: T;
  clean: boolean;
  conflicts: string[];
}

interface ScalarMerge<T> {
  value: T;
  conflict: boolean;
}

// Order-insensitive structural equality, good enough for comparing parsed items
// whose keys are produced in a stable order by the storage layer.
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Three-way scalar merge. Resolves to the side that changed; when both changed
// to different values it keeps `theirs` (the current disk value) but flags the
// conflict so the caller can decide whether losing our value matters.
export function threeWayScalar<T>(base: T, ours: T, theirs: T, eq: (a: T, b: T) => boolean = Object.is): ScalarMerge<T> {
  if (eq(ours, theirs)) {
    return { value: ours, conflict: false };
  }
  if (eq(theirs, base)) {
    return { value: ours, conflict: false }; // only we changed it
  }
  if (eq(ours, base)) {
    return { value: theirs, conflict: false }; // only they changed it
  }
  return { value: theirs, conflict: true }; // both changed differently
}

// Three-way merge of a string array treated as a set (labels, assignees). Adds
// from either side are unioned; a removal by either side wins over a concurrent
// keep. Always automatic — set merges are commutative and never lose intent in
// a way that needs a human. Order is stable: our order first, then their extras.
export function threeWayStringSet(base: string[], ours: string[], theirs: string[]): string[] {
  const baseSet = new Set(base);
  const ourSet = new Set(ours);
  const theirSet = new Set(theirs);

  const removed = new Set<string>();
  for (const value of baseSet) {
    if (!ourSet.has(value) || !theirSet.has(value)) {
      removed.add(value);
    }
  }

  const result: string[] = [];
  const seen = new Set<string>();
  const consider = (value: string) => {
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    if (baseSet.has(value)) {
      if (!removed.has(value)) {
        result.push(value);
      }
    } else {
      result.push(value); // newly added by a side
    }
  };
  for (const value of ours) {
    consider(value);
  }
  for (const value of theirs) {
    consider(value);
  }
  return result;
}

interface ListMergeOptions<T> {
  id: (item: T) => string;
  // Reconcile an item present on both sides. `base` is undefined when the item
  // did not exist at the common ancestor (i.e. both sides added the same id).
  mergeItem: (base: T | undefined, ours: T, theirs: T) => T;
  // Optional final ordering. When omitted, items keep our order, then their
  // additions are appended — good for manually ordered collections.
  compare?: (a: T, b: T) => number;
}

// Three-way merge of a collection keyed by a stable id (comments, activity,
// subtasks, attachments, board lists, board groups, saved views, members).
// Additions from either side are unioned; a deletion by one side is honoured
// unless the other side edited that item (in which case the edit is preserved
// so nothing is silently lost); items present on both sides are reconciled by
// `mergeItem`. This never produces a hard conflict.
export function threeWayListById<T>(base: T[], ours: T[], theirs: T[], opts: ListMergeOptions<T>): T[] {
  const { id, mergeItem, compare } = opts;
  const baseMap = new Map(base.map((item) => [id(item), item]));
  const ourMap = new Map(ours.map((item) => [id(item), item]));
  const theirMap = new Map(theirs.map((item) => [id(item), item]));

  const orderedIds: string[] = [];
  const seen = new Set<string>();
  const pushId = (key: string) => {
    if (!seen.has(key)) {
      seen.add(key);
      orderedIds.push(key);
    }
  };
  for (const item of ours) {
    pushId(id(item));
  }
  for (const item of theirs) {
    pushId(id(item));
  }

  const out: T[] = [];
  for (const key of orderedIds) {
    const baseItem = baseMap.get(key);
    const ourItem = ourMap.get(key);
    const theirItem = theirMap.get(key);
    if (ourItem && theirItem) {
      out.push(mergeItem(baseItem, ourItem, theirItem));
    } else if (ourItem && !theirItem) {
      // Missing from theirs: keep it if it is new or we edited it since base;
      // otherwise theirs deleted it and we honour that.
      if (baseItem === undefined || !sameJson(ourItem, baseItem)) {
        out.push(ourItem);
      }
    } else if (!ourItem && theirItem) {
      if (baseItem === undefined || !sameJson(theirItem, baseItem)) {
        out.push(theirItem);
      }
    }
  }

  if (compare) {
    out.sort(compare);
  }
  return out;
}

// Pick the surviving version of an item that both sides changed: prefer the one
// unchanged-vs-base's counterpart, then fall back to `theirs`. Shared by the
// keyed-list mergers whose items are otherwise treated as opaque.
function preferChanged<T>(base: T | undefined, ours: T, theirs: T): T {
  if (base && sameJson(ours, base)) {
    return theirs;
  }
  if (base && sameJson(theirs, base)) {
    return ours;
  }
  return sameJson(ours, theirs) ? ours : theirs;
}

const byCreatedAtAsc = (a: { createdAt: string }, b: { createdAt: string }) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
const byCreatedAtDesc = (a: { createdAt: string }, b: { createdAt: string }) => -byCreatedAtAsc(a, b);
const byAddedAtAsc = (a: { addedAt: string }, b: { addedAt: string }) => (a.addedAt < b.addedAt ? -1 : a.addedAt > b.addedAt ? 1 : 0);

function mergeComment(base: Comment | undefined, ours: Comment, theirs: Comment): Comment {
  if (base && sameJson(ours, base)) {
    return theirs;
  }
  if (base && sameJson(theirs, base)) {
    return ours;
  }
  if (sameJson(ours, theirs)) {
    return ours;
  }
  // Both edited the same comment: the later edit wins so no one's revision is
  // lost outright.
  const ourStamp = ours.editedAt ?? ours.createdAt;
  const theirStamp = theirs.editedAt ?? theirs.createdAt;
  return theirStamp >= ourStamp ? theirs : ours;
}

function mergeSubtask(base: Subtask | undefined, ours: Subtask, theirs: Subtask): Subtask {
  if (base && sameJson(ours, base)) {
    return theirs;
  }
  if (base && sameJson(theirs, base)) {
    return ours;
  }
  if (sameJson(ours, theirs)) {
    return ours;
  }
  return {
    id: ours.id,
    title: threeWayScalar(base?.title ?? ours.title, ours.title, theirs.title).value,
    completed: threeWayScalar(base?.completed ?? ours.completed, ours.completed, theirs.completed).value,
    url: threeWayScalar(base?.url ?? ours.url, ours.url, theirs.url).value,
    items: threeWayListById(base?.items ?? [], ours.items, theirs.items, {
      id: (item) => item.id,
      mergeItem: (b, o, t) => preferChanged(b, o, t),
    }),
  };
}

// --- Per-entity mergers -----------------------------------------------------

export function mergeCard(base: Card, ours: Card, theirs: Card): EntityMergeResult<Card> {
  const conflicts: string[] = [];

  const title = threeWayScalar(base.title, ours.title, theirs.title);
  if (title.conflict) {
    conflicts.push("title");
  }
  const body = threeWayScalar(base.body, ours.body, theirs.body);
  if (body.conflict) {
    conflicts.push("body");
  }

  const value: Card = {
    id: ours.id,
    title: title.value,
    // Structural / positional fields last-writer-wins to the disk value on a
    // genuine clash; the local edit is still preserved via the conflict copy
    // whenever a hard (title/body) conflict co-occurs.
    boardId: threeWayScalar(base.boardId, ours.boardId, theirs.boardId).value,
    listId: threeWayScalar(base.listId, ours.listId, theirs.listId).value,
    due: threeWayScalar(base.due, ours.due, theirs.due).value,
    order: threeWayScalar(base.order, ours.order, theirs.order).value,
    completed: threeWayScalar(base.completed, ours.completed, theirs.completed).value,
    archived: threeWayScalar(base.archived, ours.archived, theirs.archived).value,
    assignees: threeWayStringSet(base.assignees, ours.assignees, theirs.assignees),
    labels: threeWayStringSet(base.labels, ours.labels, theirs.labels),
    activity: threeWayListById(base.activity, ours.activity, theirs.activity, {
      id: (item) => item.id,
      mergeItem: (_b, _o, t) => t, // activity events are immutable once created
      compare: byCreatedAtDesc,
    }),
    subtasks: threeWayListById(base.subtasks, ours.subtasks, theirs.subtasks, {
      id: (item) => item.id,
      mergeItem: mergeSubtask,
    }),
    attachments: threeWayListById(base.attachments, ours.attachments, theirs.attachments, {
      id: (item) => item.id,
      mergeItem: (_b, _o, t) => t, // attachment records are immutable
      compare: byAddedAtAsc,
    }),
    comments: threeWayListById(base.comments, ours.comments, theirs.comments, {
      id: (item) => item.id,
      mergeItem: mergeComment,
      compare: byCreatedAtAsc,
    }),
    body: body.value,
    createdAt: theirs.createdAt || ours.createdAt,
    updatedAt: laterStamp(ours.updatedAt, theirs.updatedAt),
    fileName: ours.fileName,
  };

  return { value, clean: conflicts.length === 0, conflicts };
}

function mergeBoardList(base: BoardList | undefined, ours: BoardList, theirs: BoardList): BoardList {
  if (base && sameJson(ours, base)) {
    return theirs;
  }
  if (base && sameJson(theirs, base)) {
    return ours;
  }
  return { id: ours.id, name: threeWayScalar(base?.name ?? ours.name, ours.name, theirs.name).value };
}

export function mergeBoard(base: Board, ours: Board, theirs: Board): EntityMergeResult<Board> {
  const conflicts: string[] = [];
  const name = threeWayScalar(base.name, ours.name, theirs.name);
  if (name.conflict) {
    conflicts.push("name");
  }

  const value: Board = {
    schemaVersion: threeWayScalar(base.schemaVersion, ours.schemaVersion, theirs.schemaVersion).value,
    id: ours.id,
    name: name.value,
    groupId: threeWayScalar(base.groupId, ours.groupId, theirs.groupId).value,
    // Lists merge by id: renames reconcile per-list, adds union, deletes are
    // honoured, and our column order is preserved (a remote-only reorder yields
    // to ours until the next reload — no columns are ever lost).
    lists: threeWayListById(base.lists, ours.lists, theirs.lists, {
      id: (item) => item.id,
      mergeItem: mergeBoardList,
    }),
    createdAt: theirs.createdAt || ours.createdAt,
    updatedAt: laterStamp(ours.updatedAt, theirs.updatedAt),
  };

  return { value, clean: conflicts.length === 0, conflicts };
}

function mergeSavedView(base: SavedView | undefined, ours: SavedView, theirs: SavedView): SavedView {
  if (base && sameJson(ours, base)) {
    return theirs;
  }
  if (base && sameJson(theirs, base)) {
    return ours;
  }
  if (sameJson(ours, theirs)) {
    return ours;
  }
  return (theirs.updatedAt ?? "") >= (ours.updatedAt ?? "") ? theirs : ours;
}

// Settings never hard-conflict: there is no free-text body to lose, so every
// field auto-resolves. Two people tweaking different settings on a shared folder
// simply get the union of their changes.
export function mergeSettings(base: WorkspaceSettings, ours: WorkspaceSettings, theirs: WorkspaceSettings): EntityMergeResult<WorkspaceSettings> {
  const value: WorkspaceSettings = {
    schemaVersion: threeWayScalar(base.schemaVersion, ours.schemaVersion, theirs.schemaVersion).value,
    workspaceName: threeWayScalar(base.workspaceName, ours.workspaceName, theirs.workspaceName).value,
    slackWebhookUrl: threeWayScalar(base.slackWebhookUrl, ours.slackWebhookUrl, theirs.slackWebhookUrl).value,
    slackNotifications: {
      cardMovedToDone: threeWayScalar(base.slackNotifications.cardMovedToDone, ours.slackNotifications.cardMovedToDone, theirs.slackNotifications.cardMovedToDone).value,
      cardCompleted: threeWayScalar(base.slackNotifications.cardCompleted, ours.slackNotifications.cardCompleted, theirs.slackNotifications.cardCompleted).value,
      cardAssigned: threeWayScalar(base.slackNotifications.cardAssigned, ours.slackNotifications.cardAssigned, theirs.slackNotifications.cardAssigned).value,
      subtaskCompleted: threeWayScalar(base.slackNotifications.subtaskCompleted, ours.slackNotifications.subtaskCompleted, theirs.slackNotifications.subtaskCompleted).value,
    },
    boardGroups: threeWayListById(base.boardGroups, ours.boardGroups, theirs.boardGroups, {
      id: (item) => item.id,
      mergeItem: (b, o, t) => {
        if (b && sameJson(o, b)) {
          return t;
        }
        if (b && sameJson(t, b)) {
          return o;
        }
        return { id: o.id, name: threeWayScalar(b?.name ?? o.name, o.name, t.name).value, createdAt: t.createdAt || o.createdAt, updatedAt: laterStamp(o.updatedAt, t.updatedAt) };
      },
    }),
    savedViews: threeWayListById(base.savedViews, ours.savedViews, theirs.savedViews, {
      id: (item) => item.id,
      mergeItem: mergeSavedView,
    }),
    createdAt: theirs.createdAt || ours.createdAt,
    updatedAt: laterStamp(ours.updatedAt, theirs.updatedAt),
  };

  return { value, clean: true, conflicts: [] };
}

// Members never hard-conflict: additions union, removals are honoured, and a
// concurrent rename of the same member resolves to the later write.
export function mergeMembers(base: MembersFile, ours: MembersFile, theirs: MembersFile): EntityMergeResult<MembersFile> {
  const value: MembersFile = {
    schemaVersion: threeWayScalar(base.schemaVersion, ours.schemaVersion, theirs.schemaVersion).value,
    members: threeWayListById(base.members, ours.members, theirs.members, {
      id: (item) => item.id,
      mergeItem: (b, o, t) => preferChanged<Member>(b, o, t),
    }),
    updatedAt: laterStamp(ours.updatedAt, theirs.updatedAt),
  };
  return { value, clean: true, conflicts: [] };
}

// ISO-8601 timestamps sort lexicographically, so the max is the later moment.
// The merged entity adopts it so its version differs from the disk copy we
// merged against and the compare-and-swap retry writes cleanly.
function laterStamp(a: string, b: string): string {
  return a >= b ? a : b;
}
