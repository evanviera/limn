import type { Board, Card, MembersFile, WorkspaceFiles, WorkspaceSettings, WriteResult } from "./types";
import type { DownloadProgress } from "./updater";

type HarnessEvent<T = unknown> = { event: string; id: number; payload: T };
type Handler<T = unknown> = (event: HarnessEvent<T>) => void;

interface HarnessFile {
  file_name: string;
  content: string;
}

interface HarnessSnapshot {
  settings: WorkspaceSettings;
  members: MembersFile;
  boards: HarnessFile[];
  cards: HarnessFile[];
  attachments: Array<{ path: string; size: number }>;
  exports: Array<{ path: string; content: string }>;
  lastWorkspace: string | null;
  externalLinks: string[];
  loadWorkspaceCount: number;
  slack: Array<{ webhookUrl: string; message: string }>;
  updater: {
    mode: UpdaterMode;
    installed: boolean;
    restarted: boolean;
  };
}

type UpdaterMode = "none" | "available" | "install-fail";

const workspacePath = "/mock/limn-e2e-workspace";
const now = "2026-06-27T12:00:00.000Z";
const settings: WorkspaceSettings = {
  schemaVersion: 1,
  workspaceName: "limn-e2e-workspace",
  slackWebhookUrl: "",
  slackNotifications: {
    cardMovedToDone: true,
    cardCompleted: true,
    cardAssigned: true,
    subtaskCompleted: true
  },
  boardGroups: [],
  savedViews: [],
  createdAt: now,
  updatedAt: now
};

const members: MembersFile = { schemaVersion: 1, members: [], updatedAt: now };
const boards = new Map<string, string>();
const cards = new Map<string, string>();
// Attachment files keyed by `${cardId}/${storedName}` → byte size. There is no
// real filesystem in the harness, so this stands in for attachments/<cardId>/.
const attachments = new Map<string, number>();
// Files written by exports (e.g. the .ics calendar), keyed by relative path.
const exports = new Map<string, string>();
const attachmentPickQueue: string[][] = [];
const listeners = new Map<string, Set<Handler<any>>>();
const externalLinks: string[] = [];
const slack: Array<{ webhookUrl: string; message: string }> = [];
const promptQueue: Array<string | null> = [];
const confirmQueue: boolean[] = [];
const updater = {
  mode: "none" as UpdaterMode,
  installed: false,
  restarted: false
};
let lastWorkspace: string | null = null;
let loadWorkspaceCount = 0;

if (new URLSearchParams(window.location.search).has("resetLimnE2e")) {
  sessionStorage.removeItem("limn-e2e-state");
} else {
  const saved = sessionStorage.getItem("limn-e2e-state");
  if (saved) {
    const restored = JSON.parse(saved) as HarnessSnapshot;
    Object.assign(settings, restored.settings);
    members.members = restored.members.members;
    boards.clear();
    cards.clear();
    for (const file of restored.boards) {
      boards.set(file.file_name, file.content);
    }
    for (const file of restored.cards) {
      cards.set(file.file_name, file.content);
    }
    attachments.clear();
    for (const item of restored.attachments ?? []) {
      attachments.set(item.path, item.size);
    }
    exports.clear();
    for (const item of restored.exports ?? []) {
      exports.set(item.path, item.content);
    }
    externalLinks.splice(0, externalLinks.length, ...(restored.externalLinks ?? []));
    slack.splice(0, slack.length, ...restored.slack);
    Object.assign(updater, restored.updater ?? { mode: "none", installed: false, restarted: false });
    lastWorkspace = restored.lastWorkspace;
    loadWorkspaceCount = restored.loadWorkspaceCount ?? 0;
  }
}

function emit<T = unknown>(event: string, payload?: T) {
  updateDebugState();
  for (const handler of listeners.get(event) ?? []) {
    handler({ event, id: Date.now(), payload });
  }
}

function snapshot(): HarnessSnapshot {
  return {
    settings: JSON.parse(JSON.stringify(settings)) as WorkspaceSettings,
    members: JSON.parse(JSON.stringify(members)) as MembersFile,
    boards: [...boards.entries()].sort().map(([file_name, content]) => ({ file_name, content })),
    cards: [...cards.entries()].sort().map(([file_name, content]) => ({ file_name, content })),
    attachments: [...attachments.entries()].sort().map(([path, size]) => ({ path, size })),
    exports: [...exports.entries()].sort().map(([path, content]) => ({ path, content })),
    lastWorkspace,
    externalLinks: [...externalLinks],
    loadWorkspaceCount,
    slack: [...slack],
    updater: { ...updater }
  };
}

function loadFiles(): WorkspaceFiles {
  return {
    settings: `${JSON.stringify(settings, null, 2)}\n`,
    members: `${JSON.stringify(members, null, 2)}\n`,
    boards: [...boards.entries()].sort().map(([file_name, content]) => ({ file_name, content })),
    cards: [...cards.entries()].sort().map(([file_name, content]) => ({ file_name, content })),
    warnings: []
  };
}

function updateDebugState() {
  sessionStorage.setItem("limn-e2e-state", JSON.stringify(snapshot()));
  let element = document.getElementById("limn-e2e-snapshot");
  if (!element) {
    element = document.createElement("script") as HTMLScriptElement;
    element.id = "limn-e2e-snapshot";
    (element as HTMLScriptElement).type = "application/json";
    document.body.appendChild(element);
  }
  element.textContent = JSON.stringify(snapshot());
}

function fileNameArg(args: Record<string, unknown> | undefined): string {
  const fileName = args?.fileName;
  if (typeof fileName !== "string") {
    throw new Error("Missing fileName");
  }
  return fileName;
}

function contentArg(args: Record<string, unknown> | undefined): string {
  const content = args?.content;
  if (typeof content !== "string") {
    throw new Error("Missing content");
  }
  return content;
}

// Mirrors the Rust `file_version` helper: the optimistic-concurrency token is the
// entity's `updatedAt`, read from Markdown frontmatter or top-level JSON.
function versionOf(content: string): string | null {
  if (content.trimStart().startsWith("---")) {
    const match = content.match(/^updatedAt:\s*(.+)$/m);
    return match?.[1]?.trim().replace(/^"|"$/g, "") ?? null;
  }
  try {
    const value = JSON.parse(content) as { updatedAt?: unknown };
    return typeof value.updatedAt === "string" ? value.updatedAt : null;
  } catch {
    return null;
  }
}

// The harness stand-in for the Rust compare-and-swap: refuse the write and hand
// back the current content when the expected version no longer matches disk.
function casResult(relativePath: string, current: string | undefined, expected: string | undefined): WriteResult | null {
  if (expected !== undefined && current !== undefined && versionOf(current) !== expected) {
    return { relative_path: relativePath, conflict: true, current_content: current };
  }
  return null;
}

function expectedVersionArg(args: Record<string, unknown> | undefined): string | undefined {
  return typeof args?.expectedVersion === "string" ? args.expectedVersion : undefined;
}

function attachmentPreview(storedName: string): ArrayBuffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="48" viewBox="0 0 80 48"><rect width="80" height="48" fill="#2f6fed"/><circle cx="58" cy="16" r="8" fill="#ffd166"/><path d="M0 48 24 24l14 12 12-10 30 22z" fill="#f4f7fb"/></svg>`;
  const extension = storedName.split(".").pop()?.toLowerCase();
  if (!["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"].includes(extension ?? "")) {
    throw new Error("Attachment is not a supported image type");
  }
  // The real commands return raw bytes over IPC as an ArrayBuffer; mirror that.
  return new TextEncoder().encode(svg).buffer;
}

window.__LIMN_TEST_IPC__ = {
  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    switch (command) {
      case "pick_workspace_folder":
        return workspacePath as T;
      case "get_last_workspace":
        return lastWorkspace as T;
      case "save_last_workspace":
        lastWorkspace = typeof args?.path === "string" ? args.path : null;
        return undefined as T;
      case "watch_workspace":
        return undefined as T;
      case "load_workspace":
        loadWorkspaceCount += 1;
        return loadFiles() as T;
      case "write_workspace_settings": {
        const content = contentArg(args);
        const conflict = casResult(".workspace/settings.json", `${JSON.stringify(settings, null, 2)}\n`, expectedVersionArg(args));
        if (conflict) {
          return conflict as T;
        }
        for (const key of Object.keys(settings)) {
          delete (settings as unknown as Record<string, unknown>)[key];
        }
        Object.assign(settings, JSON.parse(content) as WorkspaceSettings);
        emit("workspace-changed");
        return { relative_path: ".workspace/settings.json", conflict: false } satisfies WriteResult as T;
      }
      case "write_members": {
        const content = contentArg(args);
        const conflict = casResult(".workspace/members.json", `${JSON.stringify(members, null, 2)}\n`, expectedVersionArg(args));
        if (conflict) {
          return conflict as T;
        }
        const parsed = JSON.parse(content) as MembersFile;
        members.members = parsed.members;
        members.updatedAt = parsed.updatedAt;
        emit("workspace-changed");
        return { relative_path: ".workspace/members.json", conflict: false } satisfies WriteResult as T;
      }
      case "write_board_file": {
        const fileName = fileNameArg(args);
        const conflict = casResult(`boards/${fileName}`, boards.get(fileName), expectedVersionArg(args));
        if (conflict) {
          return conflict as T;
        }
        boards.set(fileName, contentArg(args));
        emit("workspace-changed");
        return { relative_path: `boards/${fileName}`, conflict: false } satisfies WriteResult as T;
      }
      case "delete_board_file":
        boards.delete(fileNameArg(args));
        emit("workspace-changed");
        return undefined as T;
      case "write_card_file": {
        const fileName = fileNameArg(args);
        const content = contentArg(args);
        const expected = typeof args?.expectedUpdatedAt === "string" ? args.expectedUpdatedAt : undefined;
        const current = cards.get(fileName);
        // Match the Rust CAS: on a version mismatch, refuse and return disk
        // content (or null when the card was deleted remotely) for the caller to
        // three-way-merge. No conflict copy is written here.
        if (expected !== undefined) {
          if (current === undefined) {
            return { relative_path: `cards/${fileName}`, conflict: true, current_content: null } satisfies WriteResult as T;
          }
          if (versionOf(current) !== expected) {
            return { relative_path: `cards/${fileName}`, conflict: true, current_content: current } satisfies WriteResult as T;
          }
        }
        cards.set(fileName, content);
        emit("workspace-changed");
        return { relative_path: `cards/${fileName}`, conflict: false } satisfies WriteResult as T;
      }
      case "write_conflict_copy": {
        const relativeDir = String(args?.relativeDir ?? "");
        const fileName = fileNameArg(args);
        const content = contentArg(args);
        const stem = fileName.replace(/\.[^.]+$/, "");
        const ext = fileName.split(".").pop() ?? "md";
        const copyName = `${stem}_conflict_${Date.now()}.${ext}`;
        // Card copies surface as a recoverable duplicate; other entities would
        // land in .workspace/conflicts (not modelled by the harness snapshot).
        if (relativeDir === "cards") {
          cards.set(copyName, content);
          emit("workspace-changed");
        }
        return `${relativeDir}/${copyName}` as T;
      }
      case "delete_card_file": {
        const fileName = fileNameArg(args);
        cards.delete(fileName);
        const cardId = fileName.replace(/\.md$/, "");
        for (const key of [...attachments.keys()]) {
          if (key.startsWith(`${cardId}/`)) {
            attachments.delete(key);
          }
        }
        emit("workspace-changed");
        return undefined as T;
      }
      case "pick_attachment_files":
        return (attachmentPickQueue.shift() ?? []) as T;
      case "add_attachment": {
        const cardId = String(args?.cardId ?? "");
        const storedName = String(args?.storedName ?? "");
        const source = String(args?.sourcePath ?? "");
        // Deterministic stand-in size so tests can assert against it.
        const size = source.length + 1024;
        attachments.set(`${cardId}/${storedName}`, size);
        updateDebugState();
        return size as T;
      }
      case "delete_attachment": {
        const cardId = String(args?.cardId ?? "");
        const storedName = String(args?.storedName ?? "");
        attachments.delete(`${cardId}/${storedName}`);
        updateDebugState();
        return undefined as T;
      }
      case "open_attachment": {
        const cardId = String(args?.cardId ?? "");
        const storedName = String(args?.storedName ?? "");
        externalLinks.push(`attachment://${cardId}/${storedName}`);
        updateDebugState();
        return undefined as T;
      }
      case "reveal_attachment": {
        const cardId = String(args?.cardId ?? "");
        const storedName = String(args?.storedName ?? "");
        externalLinks.push(`reveal://${cardId}/${storedName}`);
        updateDebugState();
        return undefined as T;
      }
      case "read_attachment_preview":
      case "read_attachment_thumbnail":
      case "read_attachment_large_preview": {
        const cardId = String(args?.cardId ?? "");
        const storedName = String(args?.storedName ?? "");
        if (!attachments.has(`${cardId}/${storedName}`)) {
          throw new Error("Attachment file does not exist");
        }
        return attachmentPreview(storedName) as T;
      }
      case "post_slack":
        if (typeof args?.webhookUrl !== "string" || typeof args?.message !== "string") {
          throw new Error("Missing Slack arguments");
        }
        if (args.webhookUrl.includes("/fail")) {
          throw new Error("Slack webhook returned 500");
        }
        slack.push({ webhookUrl: args.webhookUrl, message: args.message });
        updateDebugState();
        return undefined as T;
      case "open_external":
        if (typeof args?.url !== "string") {
          throw new Error("Missing external URL");
        }
        externalLinks.push(args.url);
        updateDebugState();
        return undefined as T;
      case "open_workspace_folder":
        externalLinks.push(`file://${workspacePath}`);
        updateDebugState();
        return undefined as T;
      case "export_calendar": {
        exports.set("exports/limn-due-dates.ics", contentArg(args));
        updateDebugState();
        return "exports/limn-due-dates.ics" as T;
      }
      case "restart_app":
        updater.restarted = true;
        updateDebugState();
        return undefined as T;
      default:
        throw new Error(`Unhandled test IPC command: ${command}`);
    }
  },
  async listen<T = unknown>(event: string, handler: Handler<T>): Promise<() => void> {
    const handlers = listeners.get(event) ?? new Set<Handler<any>>();
    handlers.add(handler);
    listeners.set(event, handlers);
    return () => handlers.delete(handler);
  }
};

window.__LIMN_TEST_UPDATER__ = {
  async check() {
    if (updater.mode === "none") {
      return null;
    }
    return {
      version: "0.2.0",
      currentVersion: "0.1.0",
      body: "Test release notes"
    };
  },
  async install(onProgress?: (progress: DownloadProgress) => void) {
    if (updater.mode === "install-fail") {
      throw new Error("Test install failed");
    }
    onProgress?.({ downloaded: 1024, total: 2048 });
    onProgress?.({ downloaded: 2048, total: 2048 });
    updater.installed = true;
    updateDebugState();
  },
  async restart() {
    updater.restarted = true;
    updateDebugState();
  }
};

window.__LIMN_E2E__ = {
  snapshot,
  externalEditBoard(fileName: string, board: Board) {
    boards.set(fileName, `${JSON.stringify(board, null, 2)}\n`);
    emit("workspace-changed");
  },
  externalEditCard(fileName: string, content: string) {
    cards.set(fileName, content);
    emit("workspace-changed");
  },
  corruptCard(fileName: string) {
    cards.set(fileName, "not frontmatter");
    emit("workspace-changed");
  },
  resetSlack() {
    slack.splice(0, slack.length);
  },
  setUpdaterMode(mode: UpdaterMode) {
    updater.mode = mode;
    updater.installed = false;
    updater.restarted = false;
    updateDebugState();
  }
};

updateDebugState();

function applyCommand(
  detail:
    | { type: "externalEditBoard"; fileName: string; board: Board }
    | { type: "externalEditCard"; fileName: string; content: string }
    | { type: "corruptCard"; fileName: string }
    | { type: "queuePrompt"; value: string | null }
    | { type: "queueConfirm"; value: boolean }
    | { type: "queueAttachmentPick"; paths: string[] }
    | { type: "dropFiles"; paths: string[]; x?: number; y?: number }
    | { type: "setUpdaterMode"; mode: UpdaterMode }
    | { type: "resetSlack" }
) {

  if (!detail) {
    return;
  }

  switch (detail.type) {
    case "externalEditBoard":
      window.__LIMN_E2E__?.externalEditBoard(detail.fileName, detail.board);
      break;
    case "externalEditCard":
      window.__LIMN_E2E__?.externalEditCard(detail.fileName, detail.content);
      break;
    case "corruptCard":
      window.__LIMN_E2E__?.corruptCard(detail.fileName);
      break;
    case "queuePrompt":
      promptQueue.push(detail.value);
      break;
    case "queueConfirm":
      confirmQueue.push(detail.value);
      break;
    case "queueAttachmentPick":
      attachmentPickQueue.push(detail.paths);
      break;
    case "dropFiles":
      // Stand in for the OS dropping files onto the window (see listenFileDrop).
      // Coordinates let tests target a specific board card; they default to the
      // top-left, which resolves to no card (used by the editor-drop test).
      emit("limn://file-drop", { type: "drop", paths: detail.paths, x: detail.x ?? 0, y: detail.y ?? 0 });
      break;
    case "setUpdaterMode":
      window.__LIMN_E2E__?.setUpdaterMode(detail.mode);
      break;
    case "resetSlack":
      window.__LIMN_E2E__?.resetSlack();
      updateDebugState();
      break;
  }
}

function applyHashCommand() {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash.startsWith("limnE2eCommand=")) {
    return;
  }

  const raw = decodeURIComponent(hash.slice("limnE2eCommand=".length));
  applyCommand(JSON.parse(raw) as Parameters<typeof applyCommand>[0]);
}

document.addEventListener("limn-e2e-command", (event) => {
  const detail = (event as CustomEvent).detail as Parameters<typeof applyCommand>[0];
  applyCommand(detail);
});

window.prompt = () => promptQueue.shift() ?? null;
window.confirm = () => confirmQueue.shift() ?? true;

window.addEventListener("hashchange", applyHashCommand);
applyHashCommand();

declare global {
  interface Window {
    __LIMN_E2E__?: {
      snapshot(): HarnessSnapshot;
      externalEditBoard(fileName: string, board: Board): void;
      externalEditCard(fileName: string, content: string): void;
      corruptCard(fileName: string): void;
      resetSlack(): void;
      setUpdaterMode(mode: UpdaterMode): void;
    };
  }
}
