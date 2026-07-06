import { invoke } from "./ipc.js";
import { EMPTY_FILTER } from "./lib/filter.js";
import { mergeBoard, mergeCard, mergeMembers, mergeSettings, type EntityMergeResult } from "./lib/merge.js";
import { resolveConflictWrite, type ConflictWriteAdapter, type SaveOutcome } from "./lib/mergeWrite.js";
import type { Attachment, Board, BoardGroup, Card, CardFilter, Comment, ConflictFile, DeleteResult, Member, MembersFile, SavedView, SlackNotificationSettings, Subtask, SubtaskListItem, WorkspaceFiles, WorkspaceSettings, WriteResult } from "./types";

export type { SaveOutcome } from "./lib/mergeWrite.js";

const SCHEMA_VERSION = 1;

const DEFAULT_SLACK_NOTIFICATIONS: SlackNotificationSettings = {
  cardMovedToDone: true,
  cardCompleted: true,
  cardAssigned: true,
  subtaskCompleted: true
};

export interface WorkspaceData {
  settings: WorkspaceSettings;
  membersFile: MembersFile;
  boards: Board[];
  cards: Card[];
  diagnostics: string[];
}

export async function pickWorkspaceFolder(): Promise<string | null> {
  return invoke<string | null>("pick_workspace_folder");
}

export async function loadWorkspace(path: string): Promise<WorkspaceData> {
  const files = await invoke<WorkspaceFiles>("load_workspace", { path });
  return parseWorkspace(files);
}

export async function saveLastWorkspace(path: string): Promise<void> {
  await invoke("save_last_workspace", { path });
}

export async function getLastWorkspace(): Promise<string | null> {
  return invoke<string | null>("get_last_workspace");
}

export async function watchWorkspace(path: string): Promise<void> {
  await invoke("watch_workspace", { path });
}

// A pretty-printed JSON workspace file (boards, settings, members).
function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// Every entity save runs through the same conflict-aware pipeline: an optimistic
// compare-and-swap write, and — only when the disk copy changed under us — a
// typed three-way merge (base = what we last loaded, ours = the local edit,
// theirs = disk). Clean merges land silently; a hard conflict preserves our
// version as a copy. See src/lib/merge.ts and src/lib/mergeWrite.ts.
async function saveEntity<T>(opts: {
  path: string;
  ours: T;
  base: T | undefined;
  serialize: (entity: T) => string;
  parse: (raw: string) => T | null;
  merge: (base: T, ours: T, theirs: T) => EntityMergeResult<T>;
  versionOf: (entity: T) => string;
  write: (content: string, expectedVersion: string | undefined) => Promise<WriteResult>;
  conflictDir: "cards" | ".workspace/conflicts";
  conflictName: string;
}): Promise<SaveOutcome> {
  const { path, ours, base } = opts;
  const ourContent = opts.serialize(ours);
  const expected = base ? opts.versionOf(base) || undefined : undefined;

  const adapter: ConflictWriteAdapter = {
    async write(content, expectedVersion) {
      const result = await opts.write(content, expectedVersion);
      return { conflict: result.conflict, currentContent: result.current_content ?? null };
    },
    merge(theirsRaw) {
      const theirs = opts.parse(theirsRaw);
      if (!theirs || !base) {
        // No common base, or disk is unparseable: keep the local version intact
        // via a conflict copy rather than risk discarding it in a bad merge.
        return { content: ourContent, conflict: true, theirsVersion: theirs ? opts.versionOf(theirs) || undefined : undefined };
      }
      const merged = opts.merge(base, ours, theirs);
      return { content: opts.serialize(merged.value), conflict: !merged.clean, theirsVersion: opts.versionOf(theirs) || undefined };
    },
    ours() {
      return ourContent;
    },
    async writeConflictCopy(content) {
      return writeConflictCopy(path, opts.conflictDir, opts.conflictName, content);
    }
  };

  return resolveConflictWrite(ourContent, expected, adapter);
}

async function writeConflictCopy(path: string, relativeDir: string, fileName: string, content: string): Promise<string> {
  return invoke<string>("write_conflict_copy", { path, relativeDir, fileName, content });
}

export async function saveSettings(path: string, settings: WorkspaceSettings, base?: WorkspaceSettings): Promise<SaveOutcome> {
  return saveEntity({
    path,
    ours: settings,
    base,
    serialize: serializeJson,
    parse: parseSettingsJson,
    merge: mergeSettings,
    versionOf: (value) => value.updatedAt,
    write: (content, expectedVersion) => invoke<WriteResult>("write_workspace_settings", { path, content, expectedVersion }),
    conflictDir: ".workspace/conflicts",
    conflictName: "settings.json"
  });
}

export async function saveMembers(path: string, membersFile: MembersFile, base?: MembersFile): Promise<SaveOutcome> {
  return saveEntity({
    path,
    ours: membersFile,
    base,
    serialize: serializeJson,
    parse: parseMembersJson,
    merge: mergeMembers,
    versionOf: (value) => value.updatedAt,
    write: (content, expectedVersion) => invoke<WriteResult>("write_members", { path, content, expectedVersion }),
    conflictDir: ".workspace/conflicts",
    conflictName: "members.json"
  });
}

export async function saveBoard(path: string, board: Board, base?: Board): Promise<SaveOutcome> {
  return saveEntity({
    path,
    ours: board,
    base,
    serialize: serializeJson,
    parse: parseBoardJson,
    merge: mergeBoard,
    versionOf: (value) => value.updatedAt,
    write: (content, expectedVersion) => invoke<WriteResult>("write_board_file", { path, fileName: boardFileName(board.id), content, expectedVersion }),
    conflictDir: ".workspace/conflicts",
    conflictName: boardFileName(board.id)
  });
}

// Version-checked delete: refuses to remove a board another device has edited
// since we loaded it, preserving that copy and reporting the conflict through the
// same SaveOutcome vocabulary as writes (a clean delete reports "written").
export async function deleteBoard(path: string, board: Board): Promise<SaveOutcome> {
  const result = await invoke<DeleteResult>("delete_board_file", {
    path,
    fileName: boardFileName(board.id),
    expectedVersion: board.updatedAt || undefined
  });
  return deleteOutcome(result);
}

function deleteOutcome(result: DeleteResult): SaveOutcome {
  return result.conflict ? { status: "conflict", copyPath: result.copy_path ?? undefined } : { status: "written" };
}

// List every preserved conflict artifact (card duplicates and .workspace/conflicts
// copies) for the in-app review surface.
export async function listConflicts(path: string): Promise<ConflictFile[]> {
  return invoke<ConflictFile[]>("list_conflicts", { path });
}

// Discard a single conflict artifact after the user resolves it.
export async function discardConflict(path: string, relativePath: string): Promise<void> {
  await invoke("delete_conflict_file", { path, relativePath });
}

export async function saveCard(path: string, card: Card, base?: Card): Promise<SaveOutcome> {
  return saveEntity({
    path,
    ours: card,
    base,
    serialize: serializeCard,
    parse: (raw) => parseCard(raw, card.fileName),
    merge: mergeCard,
    versionOf: (value) => value.updatedAt,
    write: (content, expectedVersion) => invoke<WriteResult>("write_card_file", { path, fileName: card.fileName, content, expectedUpdatedAt: expectedVersion }),
    conflictDir: "cards",
    conflictName: card.fileName
  });
}

export function parseBoardJson(raw: string): Board | null {
  const result = safeJson<Board | null>(raw, null);
  return result.ok && result.value?.id ? normalizeBoard(result.value) : null;
}

export function parseSettingsJson(raw: string): WorkspaceSettings | null {
  const result = safeJson<Partial<WorkspaceSettings>>(raw, {});
  return result.ok ? normalizeWorkspaceSettings(result.value) : null;
}

export function parseMembersJson(raw: string): MembersFile | null {
  const result = safeJson<Partial<MembersFile>>(raw, {});
  return result.ok ? normalizeMembersFile(result.value) : null;
}

function normalizeMembersFile(value: Partial<MembersFile>): MembersFile {
  return {
    schemaVersion: typeof value.schemaVersion === "number" ? value.schemaVersion : SCHEMA_VERSION,
    members: normalizeMembers(value.members),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : ""
  };
}

// Version-checked delete: refuses to remove a card another device has edited
// since we loaded it, preserving that copy and reporting the conflict. See
// deleteBoard.
export async function deleteCard(path: string, card: Card): Promise<SaveOutcome> {
  const result = await invoke<DeleteResult>("delete_card_file", {
    path,
    fileName: card.fileName,
    expectedUpdatedAt: card.updatedAt || undefined
  });
  return deleteOutcome(result);
}

// Open a native file picker for attachments and return the chosen absolute
// source paths (empty when the dialog is cancelled).
export async function pickAttachmentFiles(): Promise<string[]> {
  return invoke<string[]>("pick_attachment_files");
}

// Copy a source file into attachments/<cardId>/<storedName> and return its size
// in bytes. The frontend owns id/name generation so the stored file name is
// deterministic and collision-free.
export async function addAttachmentFile(path: string, cardId: string, storedName: string, sourcePath: string): Promise<number> {
  return invoke<number>("add_attachment", { path, cardId, storedName, sourcePath });
}

export async function deleteAttachmentFile(path: string, cardId: string, storedName: string): Promise<void> {
  await invoke("delete_attachment", { path, cardId, storedName });
}

export async function openAttachmentFile(path: string, cardId: string, storedName: string): Promise<void> {
  await invoke("open_attachment", { path, cardId, storedName });
}

// Reveal the attachment in the OS file manager (selecting it in Finder/Explorer
// where supported, otherwise opening its containing folder).
export async function revealAttachmentFile(path: string, cardId: string, storedName: string): Promise<void> {
  await invoke("reveal_attachment", { path, cardId, storedName });
}

// A small, cached, downscaled version of an image attachment — used for the board
// covers and attachment rows so a huge original never has to cross IPC or be
// decoded at full resolution just to paint a tiny thumbnail. The bytes arrive as a
// raw binary buffer (never a JSON number array), which keeps large images cheap.
export async function loadAttachmentThumbnail(path: string, cardId: string, storedName: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("read_attachment_thumbnail", { path, cardId, storedName });
}

// A cached, fit-to-screen version of an image attachment — used by the lightbox so
// opening a huge image decodes a few megapixels instead of tens. The untouched
// original stays reachable through "Open in default app".
export async function loadAttachmentLargePreview(path: string, cardId: string, storedName: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("read_attachment_large_preview", { path, cardId, storedName });
}

// The last path segment of an OS path, used to show the original file name.
export function attachmentDisplayName(sourcePath: string): string {
  const base = sourcePath.split(/[\\/]/).pop() ?? sourcePath;
  return base.trim() || "file";
}

// A disk-safe, collision-free file name: the attachment id prefixes a sanitized
// copy of the original name so two files named "screenshot.png" never clash and
// the result is always a single, separator-free path segment.
export function attachmentStoredName(id: string, fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "");
  return `${id}-${cleaned || "file"}`;
}

export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return "";
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export async function openExternal(url: string): Promise<void> {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    return;
  }
  await invoke("open_external", { url: normalized });
}

export async function openWorkspaceFolder(path: string): Promise<void> {
  await invoke("open_workspace_folder", { path });
}

// Write an iCalendar export into the workspace's `exports/` folder and return the
// workspace-relative path of the file. Keeping the .ics inside the synced folder
// fits Limn's local-first, readable-file model (calendars can subscribe to it).
export async function exportCalendar(path: string, content: string): Promise<string> {
  return invoke<string>("export_calendar", { path, content });
}

export async function postSlack(webhookUrl: string, message: string): Promise<void> {
  if (!webhookUrl.trim()) {
    return;
  }
  await invoke("post_slack", { webhookUrl, message });
}

export function createDefaultSettings(workspaceName: string): WorkspaceSettings {
  const now = timestamp();
  return {
    schemaVersion: SCHEMA_VERSION,
    workspaceName,
    slackWebhookUrl: "",
    slackNotifications: { ...DEFAULT_SLACK_NOTIFICATIONS },
    boardGroups: [],
    savedViews: [],
    createdAt: now,
    updatedAt: now
  };
}

export function createBoard(name: string): Board {
  const now = timestamp();
  const id = makeId("board");
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    lists: [
      { id: "todo", name: "To Do" },
      { id: "in-progress", name: "In Progress" },
      { id: "done", name: "Done" }
    ],
    createdAt: now,
    updatedAt: now
  };
}

export function createCard(boardId: string, listId: string, title: string): Card {
  const now = timestamp();
  const id = makeId("card");
  return {
    id,
    title,
    boardId,
    listId,
    assignees: [],
    labels: [],
    due: "",
    order: 0,
    completed: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    activity: [
      {
        id: makeId("activity"),
        type: "created",
        message: "Created card",
        createdAt: now
      }
    ],
    subtasks: [],
    attachments: [],
    comments: [],
    body: "",
    fileName: `${id}.md`
  };
}

// Build a discussion comment. The author's display name is snapshotted here so a
// later member rename/removal doesn't orphan the comment's attribution.
export function createComment(authorId: string, authorName: string, body: string): Comment {
  return {
    id: makeId("comment"),
    authorId,
    authorName,
    body,
    createdAt: timestamp()
  };
}

export function cardFileName(id: string): string {
  return `${id}.md`;
}

export function boardFileName(id: string): string {
  return `${id}.json`;
}

export function makeId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

export function timestamp(): string {
  return new Date().toISOString();
}

export function addActivity(card: Card, type: Card["activity"][number]["type"], message: string): Card {
  const now = timestamp();
  return {
    ...card,
    updatedAt: now,
    activity: [
      {
        id: makeId("activity"),
        type,
        message,
        createdAt: now
      },
      ...card.activity
    ]
  };
}

export function parseWorkspace(files: WorkspaceFiles): WorkspaceData {
  const diagnostics = [...(files.warnings ?? [])];
  const settingsResult = safeJson<Partial<WorkspaceSettings> & { slackNotifications?: unknown }>(files.settings, createDefaultSettings("Limn Workspace"));
  const membersResult = safeJson<Partial<MembersFile>>(files.members, { schemaVersion: SCHEMA_VERSION, members: [], updatedAt: "" });
  const settings = normalizeWorkspaceSettings(settingsResult.value);
  const membersFile = membersResult.value;
  const boards: Board[] = [];
  const cards: Card[] = [];

  if (!settingsResult.ok) {
    diagnostics.push(".workspace/settings.json is invalid JSON; defaults are being shown until the file is fixed or saved.");
  }

  if (!membersResult.ok) {
    diagnostics.push(".workspace/members.json is invalid JSON; members are being shown as empty until the file is fixed or saved.");
  }

  for (const file of files.boards) {
    const result = safeJson<Board | null>(file.content, null);
    if (result.ok && result.value?.id) {
      boards.push(normalizeBoard(result.value));
    } else {
      diagnostics.push(`boards/${file.file_name} could not be loaded.`);
    }
  }

  for (const file of files.cards) {
    const card = parseCard(file.content, file.file_name);
    if (card?.id) {
      cards.push(card);
    } else {
      diagnostics.push(`cards/${file.file_name} could not be loaded.`);
    }
  }

  return {
    settings,
    membersFile: normalizeMembersFile(membersFile),
    boards,
    cards,
    diagnostics
  };
}

function normalizeWorkspaceSettings(settings: Partial<WorkspaceSettings> & { slackNotifications?: unknown }): WorkspaceSettings {
  const fallback = createDefaultSettings("Limn Workspace");
  return {
    schemaVersion: typeof settings.schemaVersion === "number" ? settings.schemaVersion : fallback.schemaVersion,
    workspaceName: typeof settings.workspaceName === "string" ? settings.workspaceName : fallback.workspaceName,
    slackWebhookUrl: typeof settings.slackWebhookUrl === "string" ? settings.slackWebhookUrl : fallback.slackWebhookUrl,
    slackNotifications: normalizeSlackNotifications(settings.slackNotifications),
    boardGroups: normalizeBoardGroups(settings.boardGroups),
    savedViews: normalizeSavedViews((settings as { savedViews?: unknown }).savedViews),
    createdAt: typeof settings.createdAt === "string" ? settings.createdAt : fallback.createdAt,
    updatedAt: typeof settings.updatedAt === "string" ? settings.updatedAt : fallback.updatedAt
  };
}

function normalizeSavedViews(value: unknown): SavedView[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const view = item as Partial<Record<keyof SavedView, unknown>>;
    if (typeof view.id !== "string" || typeof view.name !== "string" || seen.has(view.id)) {
      return [];
    }
    seen.add(view.id);

    return [{
      id: view.id,
      name: view.name,
      filter: normalizeCardFilter(view.filter),
      createdAt: typeof view.createdAt === "string" ? view.createdAt : timestamp(),
      updatedAt: typeof view.updatedAt === "string" ? view.updatedAt : timestamp()
    }];
  });
}

function normalizeCardFilter(value: unknown): CardFilter {
  const filter = value && typeof value === "object" ? value as Partial<Record<keyof CardFilter, unknown>> : {};
  return {
    text: typeof filter.text === "string" ? filter.text : EMPTY_FILTER.text,
    boardId: typeof filter.boardId === "string" ? filter.boardId : EMPTY_FILTER.boardId,
    assignees: stringArray(filter.assignees),
    labels: stringArray(filter.labels),
    due: oneOf(filter.due, ["any", "overdue", "today", "soon", "later", "has", "none"] as const, EMPTY_FILTER.due),
    completion: oneOf(filter.completion, ["active", "completed", "any"] as const, EMPTY_FILTER.completion),
    archived: oneOf(filter.archived, ["active", "archived", "any"] as const, EMPTY_FILTER.archived),
    sort: oneOf(filter.sort, ["updated", "created", "due", "title"] as const, EMPTY_FILTER.sort)
  };
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function normalizeSlackNotifications(value: unknown): SlackNotificationSettings {
  const settings = value && typeof value === "object" ? value as Partial<Record<keyof SlackNotificationSettings, unknown>> : {};
  return {
    cardMovedToDone: booleanOrDefault(settings.cardMovedToDone, DEFAULT_SLACK_NOTIFICATIONS.cardMovedToDone),
    cardCompleted: booleanOrDefault(settings.cardCompleted, DEFAULT_SLACK_NOTIFICATIONS.cardCompleted),
    cardAssigned: booleanOrDefault(settings.cardAssigned, DEFAULT_SLACK_NOTIFICATIONS.cardAssigned),
    subtaskCompleted: booleanOrDefault(settings.subtaskCompleted, DEFAULT_SLACK_NOTIFICATIONS.subtaskCompleted)
  };
}

function normalizeMembers(value: unknown): Member[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const member = item as Partial<Record<keyof Member, unknown>>;
    if (typeof member.id !== "string" || typeof member.name !== "string" || typeof member.color !== "string") {
      return [];
    }

    return [{
      id: member.id,
      name: member.name,
      color: member.color,
      slackHandle: typeof member.slackHandle === "string" ? member.slackHandle : undefined
    }];
  });
}

function normalizeBoard(board: Partial<Board> & { lists?: unknown }): Board {
  return {
    schemaVersion: typeof board.schemaVersion === "number" ? board.schemaVersion : SCHEMA_VERSION,
    id: typeof board.id === "string" ? board.id : makeId("board"),
    name: typeof board.name === "string" ? board.name : "Untitled board",
    groupId: typeof board.groupId === "string" && board.groupId.trim() ? board.groupId : undefined,
    lists: normalizeBoardLists(board.lists),
    createdAt: typeof board.createdAt === "string" ? board.createdAt : timestamp(),
    updatedAt: typeof board.updatedAt === "string" ? board.updatedAt : timestamp()
  };
}

function normalizeBoardLists(value: unknown): Board["lists"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const list = item as Partial<Record<keyof Board["lists"][number], unknown>>;
    if (typeof list.id !== "string" || typeof list.name !== "string") {
      return [];
    }

    return [{ id: list.id, name: list.name, ...(list.collapsed === true ? { collapsed: true } : {}) }];
  });
}

function normalizeBoardGroups(value: unknown): BoardGroup[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const group = item as Partial<Record<keyof BoardGroup, unknown>>;
    if (typeof group.id !== "string" || typeof group.name !== "string" || seen.has(group.id)) {
      return [];
    }
    seen.add(group.id);

    return [{
      id: group.id,
      name: group.name,
      createdAt: typeof group.createdAt === "string" ? group.createdAt : timestamp(),
      updatedAt: typeof group.updatedAt === "string" ? group.updatedAt : timestamp()
    }];
  });
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function safeJson<T>(content: string, fallback: T): { ok: boolean; value: T } {
  try {
    return { ok: true, value: JSON.parse(content) as T };
  } catch {
    return { ok: false, value: fallback };
  }
}

export function parseCard(content: string, fileName: string): Card | null {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return null;
  }
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    return null;
  }

  const frontmatter = normalized.slice(4, end).trim();
  const body = normalized.slice(end + 4).replace(/^\n/, "");
  const values: Record<string, unknown> = {};

  for (const line of frontmatter.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    values[key] = parseFrontmatterValue(raw);
  }

  if (typeof values.id !== "string" || typeof values.title !== "string") {
    return null;
  }

  return {
    id: values.id,
    title: values.title,
    boardId: stringValue(values.boardId),
    listId: stringValue(values.listId),
    assignees: stringArray(values.assignees),
    labels: stringArray(values.labels),
    due: stringValue(values.due),
    order: numberValue(values.order),
    completed: booleanValue(values.completed),
    archived: booleanValue(values.archived),
    createdAt: stringValue(values.createdAt) || timestamp(),
    updatedAt: stringValue(values.updatedAt) || timestamp(),
    activity: activityArray(values.activity),
    subtasks: subtaskArray(values.subtasks),
    attachments: attachmentArray(values.attachments),
    comments: commentArray(values.comments),
    body,
    fileName
  };
}

export function serializeCard(card: Card): string {
  const frontmatter: Record<string, unknown> = {
    id: card.id,
    title: card.title,
    boardId: card.boardId,
    listId: card.listId,
    assignees: card.assignees,
    labels: card.labels,
    due: card.due,
    order: card.order,
    completed: card.completed,
    archived: card.archived,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    activity: card.activity,
    subtasks: card.subtasks,
    attachments: card.attachments,
    comments: card.comments
  };

  const lines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${formatFrontmatterValue(value)}`);
  return `---\n${lines.join("\n")}\n---\n${card.body}`;
}

function parseFrontmatterValue(raw: string): unknown {
  if (raw.startsWith("\"")) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.replace(/^"|"$/g, "");
    }
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try {
      return JSON.parse(raw);
    } catch {
      if (raw.startsWith("[") && raw.endsWith("]")) {
        return raw
          .slice(1, -1)
          .split(",")
          .map((item) => item.trim().replace(/^"|"$/g, ""))
          .filter(Boolean);
      }
    }
  }
  return raw.replace(/^"|"$/g, "");
}

function formatFrontmatterValue(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  return String(value ?? "");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true";
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function activityArray(value: unknown): Card["activity"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((event): event is Card["activity"][number] => {
    if (!event || typeof event !== "object") {
      return false;
    }
    const candidate = event as Partial<Card["activity"][number]>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.type === "string" &&
      typeof candidate.message === "string" &&
      typeof candidate.createdAt === "string"
    );
  });
}

function subtaskArray(value: unknown): Subtask[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .filter((item) => typeof item.id === "string" && typeof item.title === "string")
    .map((item) => ({
      id: item.id as string,
      title: item.title as string,
      completed: booleanValue(item.completed),
      url: stringValue(item.url),
      items: subtaskListItemArray(item.items)
    }));
}

function subtaskListItemArray(value: unknown): SubtaskListItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .filter((item) => typeof item.id === "string" && typeof item.text === "string")
    .map((item) => ({
      id: item.id as string,
      text: item.text as string,
      url: stringValue(item.url)
    }));
}

function attachmentArray(value: unknown): Attachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .filter((item) => typeof item.id === "string" && typeof item.name === "string" && typeof item.storedName === "string")
    .map((item) => ({
      id: item.id as string,
      name: item.name as string,
      storedName: item.storedName as string,
      size: typeof item.size === "number" && Number.isFinite(item.size) ? item.size : 0,
      addedAt: stringValue(item.addedAt) || timestamp()
    }));
}

function commentArray(value: unknown): Comment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .filter((item) => typeof item.id === "string" && typeof item.body === "string")
    .map((item) => {
      const editedAt = stringValue(item.editedAt);
      return {
        id: item.id as string,
        authorId: stringValue(item.authorId),
        authorName: stringValue(item.authorName) || "Unknown",
        body: item.body as string,
        createdAt: stringValue(item.createdAt) || timestamp(),
        ...(editedAt ? { editedAt } : {})
      };
    });
}
