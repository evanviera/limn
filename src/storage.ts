import { invoke } from "./ipc.js";
import type { Board, Card, MembersFile, Subtask, SubtaskListItem, WorkspaceFiles, WorkspaceSettings, WriteResult } from "./types";

const SCHEMA_VERSION = 1;

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

export async function saveSettings(path: string, settings: WorkspaceSettings): Promise<void> {
  await invoke("write_workspace_settings", {
    path,
    content: `${JSON.stringify(settings, null, 2)}\n`
  });
}

export async function saveMembers(path: string, membersFile: MembersFile): Promise<void> {
  await invoke("write_members", {
    path,
    content: `${JSON.stringify(membersFile, null, 2)}\n`
  });
}

export async function saveBoard(path: string, board: Board): Promise<void> {
  await invoke("write_board_file", {
    path,
    fileName: boardFileName(board.id),
    content: `${JSON.stringify(board, null, 2)}\n`
  });
}

export async function deleteBoard(path: string, boardId: string): Promise<void> {
  await invoke("delete_board_file", {
    path,
    fileName: boardFileName(boardId)
  });
}

export async function saveCard(path: string, card: Card, expectedUpdatedAt?: string): Promise<WriteResult> {
  return invoke<WriteResult>("write_card_file", {
    path,
    fileName: card.fileName,
    content: serializeCard(card),
    expectedUpdatedAt
  });
}

export async function deleteCard(path: string, card: Card): Promise<void> {
  await invoke("delete_card_file", {
    path,
    fileName: card.fileName
  });
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
    body: "",
    fileName: `${id}.md`
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
  const settingsResult = safeJson<WorkspaceSettings>(files.settings, createDefaultSettings("Limn Workspace"));
  const membersResult = safeJson<MembersFile>(files.members, { schemaVersion: SCHEMA_VERSION, members: [] });
  const settings = settingsResult.value;
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
      boards.push(result.value);
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
    membersFile: {
      schemaVersion: membersFile.schemaVersion ?? SCHEMA_VERSION,
      members: Array.isArray(membersFile.members) ? membersFile.members : []
    },
    boards,
    cards,
    diagnostics
  };
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
    completed: booleanValue(values.completed),
    archived: booleanValue(values.archived),
    createdAt: stringValue(values.createdAt) || timestamp(),
    updatedAt: stringValue(values.updatedAt) || timestamp(),
    activity: activityArray(values.activity),
    subtasks: subtaskArray(values.subtasks),
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
    completed: card.completed,
    archived: card.archived,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    activity: card.activity,
    subtasks: card.subtasks
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
