// Pure logic for the in-app conflict review surface.
//
// A "conflict artifact" is a preserved `_conflict_` copy that the conflict-aware
// save/delete pipeline dropped on disk when it could not safely reconcile a
// change: the local (losing) version of a hard title/body clash, or the disk
// version that blocked a version-checked delete. The Tauri `list_conflicts`
// command enumerates them (see storage.listConflicts); this module turns each raw
// artifact into a reviewable, typed `ReviewConflict` — classifying its entity
// kind, parsing it, matching it against the current on-disk entity, building a
// field-by-field comparison, and proposing a lossless auto-merge via the shared
// merge engine. It performs no IO; the caller writes resolutions back through the
// normal conflict-aware save path.

import { mergeBoard, mergeCard, mergeMembers, mergeSettings, sameJson } from "./merge.js";
import { parseBoardJson, parseCard, parseMembersJson, parseSettingsJson } from "../storage.js";
import type { Board, Card, ConflictFile, MembersFile, WorkspaceSettings } from "../types";

export type ConflictKind = "card" | "board" | "settings" | "members";

// A typed resolution the caller can write back through the matching save
// function. `base` is the current on-disk entity so the conflict-aware save can
// three-way-merge if disk moved again between review and resolve.
export type ResolveEntity =
  | { kind: "card"; card: Card; base: Card | undefined }
  | { kind: "board"; board: Board; base: Board | undefined }
  | { kind: "settings"; settings: WorkspaceSettings; base: WorkspaceSettings | undefined }
  | { kind: "members"; members: MembersFile; base: MembersFile | undefined };

// One row of the side-by-side comparison shown in the review UI.
export interface ConflictField {
  label: string;
  mine: string;
  theirs: string;
  differs: boolean;
}

export interface ReviewConflict {
  relativePath: string;
  fileName: string;
  kind: ConflictKind;
  entityId: string;
  // Human label for the conflict list (card title / board name / entity kind).
  title: string;
  // True when the preserved copy parsed cleanly.
  parsed: boolean;
  // True when there is no live on-disk counterpart (e.g. the entity was deleted).
  currentMissing: boolean;
  fields: ConflictField[];
  rawContent: string;
  // "Keep this copy": write the preserved version. Null when it did not parse.
  mine: ResolveEntity | null;
  // "Use merged version": a lossless union of both sides. Null when unavailable
  // or identical to the current on-disk entity (so we don't offer a no-op).
  merged: ResolveEntity | null;
}

// The current on-disk workspace state the artifacts are compared against.
export interface WorkspaceEntities {
  cards: Card[];
  boards: Board[];
  settings: WorkspaceSettings | null;
  membersFile: MembersFile;
}

const CONFLICT_MARKER = "_conflict_";

// Classify an artifact by its file name. write_conflict_copy names copies
// `<stem>_conflict_<stamp>.<ext>`, so the stem is the original file's base name:
// a card/board id, or the literal "settings"/"members".
function classify(fileName: string): { kind: ConflictKind; stem: string; ext: string } | null {
  const marker = fileName.indexOf(CONFLICT_MARKER);
  const dot = fileName.lastIndexOf(".");
  if (marker === -1 || dot === -1 || dot < marker) {
    return null;
  }
  const stem = fileName.slice(0, marker);
  const ext = fileName.slice(dot + 1);
  if (ext === "md") {
    return { kind: "card", stem, ext };
  }
  if (stem === "settings") {
    return { kind: "settings", stem, ext };
  }
  if (stem === "members") {
    return { kind: "members", stem, ext };
  }
  return { kind: "board", stem, ext };
}

function field(label: string, mine: string, theirs: string | undefined): ConflictField {
  const theirsText = theirs ?? "";
  return { label, mine, theirs: theirsText, differs: mine !== theirsText };
}

function cardFields(mine: Card, theirs: Card | null): ConflictField[] {
  return [
    field("Title", mine.title, theirs?.title),
    field("Notes", mine.body, theirs?.body),
    field("List", mine.listId, theirs?.listId),
    field("Due", mine.due || "—", theirs ? theirs.due || "—" : undefined),
    field("Labels", mine.labels.join(", ") || "—", theirs ? theirs.labels.join(", ") || "—" : undefined),
    field("Assignees", mine.assignees.join(", ") || "—", theirs ? theirs.assignees.join(", ") || "—" : undefined),
    field("Comments", String(mine.comments.length), theirs ? String(theirs.comments.length) : undefined),
    field("Updated", mine.updatedAt, theirs?.updatedAt),
  ];
}

function boardFields(mine: Board, theirs: Board | null): ConflictField[] {
  const columns = (board: Board) => board.lists.map((list) => list.name).join(", ") || "—";
  return [
    field("Name", mine.name, theirs?.name),
    field("Columns", columns(mine), theirs ? columns(theirs) : undefined),
    field("Updated", mine.updatedAt, theirs?.updatedAt),
  ];
}

function settingsFields(mine: WorkspaceSettings, theirs: WorkspaceSettings | null): ConflictField[] {
  return [
    field("Workspace name", mine.workspaceName, theirs?.workspaceName),
    field("Slack webhook", mine.slackWebhookUrl || "—", theirs ? theirs.slackWebhookUrl || "—" : undefined),
    field("Categories", String(mine.boardGroups.length), theirs ? String(theirs.boardGroups.length) : undefined),
    field("Saved views", String(mine.savedViews.length), theirs ? String(theirs.savedViews.length) : undefined),
    field("Updated", mine.updatedAt, theirs?.updatedAt),
  ];
}

function membersFields(mine: MembersFile, theirs: MembersFile | null): ConflictField[] {
  const names = (file: MembersFile) => file.members.map((member) => member.name).join(", ") || "—";
  return [field("Members", names(mine), theirs ? names(theirs) : undefined)];
}

// A synthetic common ancestor that makes the shared merge engine produce a
// lossless union: list/set fields start empty so every item on either side is an
// "add" (nothing is dropped), while scalar/text fields start from the copy so
// they resolve to the current on-disk value (the more recent shared state). The
// result therefore keeps the current entity's title/body/structure and folds in
// any labels, comments, subtasks, columns, or members present only in the copy.
function mergedCard(copy: Card, current: Card): Card {
  const base: Card = { ...copy, assignees: [], labels: [], activity: [], subtasks: [], attachments: [], comments: [] };
  return mergeCard(base, copy, current).value;
}

function mergedBoard(copy: Board, current: Board): Board {
  const base: Board = { ...copy, lists: [] };
  return mergeBoard(base, copy, current).value;
}

function mergedSettings(copy: WorkspaceSettings, current: WorkspaceSettings): WorkspaceSettings {
  const base: WorkspaceSettings = { ...copy, boardGroups: [], savedViews: [] };
  return mergeSettings(base, copy, current).value;
}

function mergedMembers(copy: MembersFile, current: MembersFile): MembersFile {
  const base: MembersFile = { ...copy, members: [] };
  return mergeMembers(base, copy, current).value;
}

// Turn one raw artifact into a reviewable conflict, or null when its file name is
// not a recognizable conflict copy.
export function buildConflict(file: ConflictFile, entities: WorkspaceEntities): ReviewConflict | null {
  const info = classify(file.file_name);
  if (!info) {
    return null;
  }

  const shared = {
    relativePath: file.relative_path,
    fileName: file.file_name,
    kind: info.kind,
    entityId: info.stem,
    rawContent: file.content,
  };

  if (info.kind === "card") {
    const copy = parseCard(file.content, `${info.stem}.md`);
    const current = entities.cards.find((card) => card.id === info.stem) ?? null;
    if (!copy) {
      return { ...shared, title: info.stem, parsed: false, currentMissing: !current, fields: [], mine: null, merged: null };
    }
    const merged = current ? mergedCard(copy, current) : null;
    return {
      ...shared,
      title: copy.title || info.stem,
      parsed: true,
      currentMissing: !current,
      fields: cardFields(copy, current),
      mine: { kind: "card", card: copy, base: current ?? undefined },
      merged: merged && !sameJson(merged, current) ? { kind: "card", card: merged, base: current ?? undefined } : null,
    };
  }

  if (info.kind === "board") {
    const copy = parseBoardJson(file.content);
    const current = entities.boards.find((board) => board.id === info.stem) ?? null;
    if (!copy) {
      return { ...shared, title: info.stem, parsed: false, currentMissing: !current, fields: [], mine: null, merged: null };
    }
    const merged = current ? mergedBoard(copy, current) : null;
    return {
      ...shared,
      title: copy.name || info.stem,
      parsed: true,
      currentMissing: !current,
      fields: boardFields(copy, current),
      mine: { kind: "board", board: copy, base: current ?? undefined },
      merged: merged && !sameJson(merged, current) ? { kind: "board", board: merged, base: current ?? undefined } : null,
    };
  }

  if (info.kind === "settings") {
    const copy = parseSettingsJson(file.content);
    const current = entities.settings;
    if (!copy) {
      return { ...shared, title: "Workspace settings", parsed: false, currentMissing: !current, fields: [], mine: null, merged: null };
    }
    const merged = current ? mergedSettings(copy, current) : null;
    return {
      ...shared,
      title: "Workspace settings",
      parsed: true,
      currentMissing: !current,
      fields: settingsFields(copy, current),
      mine: { kind: "settings", settings: copy, base: current ?? undefined },
      merged: merged && !sameJson(merged, current) ? { kind: "settings", settings: merged, base: current ?? undefined } : null,
    };
  }

  const copy = parseMembersJson(file.content);
  const current = entities.membersFile;
  if (!copy) {
    return { ...shared, title: "Members", parsed: false, currentMissing: false, fields: [], mine: null, merged: null };
  }
  const merged = mergedMembers(copy, current);
  return {
    ...shared,
    title: "Members",
    parsed: true,
    currentMissing: false,
    fields: membersFields(copy, current),
    mine: { kind: "members", members: copy, base: current },
    merged: !sameJson(merged, current) ? { kind: "members", members: merged, base: current } : null,
  };
}

// Enumerate reviewable conflicts from raw artifacts, dropping any file whose name
// is not a recognizable conflict copy.
export function buildConflicts(files: ConflictFile[], entities: WorkspaceEntities): ReviewConflict[] {
  return files.flatMap((file) => {
    const conflict = buildConflict(file, entities);
    return conflict ? [conflict] : [];
  });
}
