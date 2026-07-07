import type { Board, Card, MembersFile, WorkspaceFiles, WorkspaceSettings, WriteResult } from "./types";
import type { DownloadProgress } from "./updater";

type HarnessEvent<T = unknown> = { event: string; id: number; payload: T };
type Handler<T = unknown> = (event: HarnessEvent<T>) => void;

interface HarnessFile {
  file_name: string;
  content: string;
}

interface HarnessSnapshot {
  // The active workspace's contents. The harness supports several open
  // workspaces (see `stores`); snapshot always reflects whichever is active so
  // single-workspace tests read exactly what they wrote.
  settings: WorkspaceSettings;
  members: MembersFile;
  boards: HarnessFile[];
  cards: HarnessFile[];
  // Preserved conflict artifacts under .workspace/conflicts/ (card copies that
  // live in cards/ are part of `cards`). Keyed by workspace-relative path.
  conflicts: HarnessFile[];
  attachments: Array<{ path: string; size: number }>;
  exports: Array<{ path: string; content: string }>;
  lastWorkspace: string | null;
  // The open workspace tabs and which one is active, mirroring the real
  // get_open_workspaces command.
  openWorkspaces: { active: string | null; paths: string[] };
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

const DEFAULT_WORKSPACE_PATH = "/mock/limn-e2e-workspace";
const now = "2026-06-27T12:00:00.000Z";

// A single mock workspace's mutable contents. There is no real filesystem, so
// these maps stand in for the on-disk boards/, cards/, attachments/<cardId>/,
// exports/, and .workspace/conflicts/ folders.
interface WorkspaceStore {
  settings: WorkspaceSettings;
  members: MembersFile;
  boards: Map<string, string>;
  cards: Map<string, string>;
  conflictFiles: Map<string, string>;
  attachments: Map<string, number>;
  exports: Map<string, string>;
  loadWorkspaceCount: number;
}

function workspaceBaseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function makeStore(path: string): WorkspaceStore {
  return {
    settings: {
      schemaVersion: 1,
      workspaceName: workspaceBaseName(path),
      slackWebhookUrl: "",
      slackMovedToListNames: "Done",
      slackNotifications: {
        cardCompleted: true,
        cardAssigned: true,
        subtaskCompleted: true
      },
      boardGroups: [],
      savedViews: [],
      createdAt: now,
      updatedAt: now
    },
    members: { schemaVersion: 1, members: [], updatedAt: now },
    boards: new Map<string, string>(),
    cards: new Map<string, string>(),
    conflictFiles: new Map<string, string>(),
    attachments: new Map<string, number>(),
    exports: new Map<string, string>(),
    loadWorkspaceCount: 0
  };
}

const stores = new Map<string, WorkspaceStore>();
stores.set(DEFAULT_WORKSPACE_PATH, makeStore(DEFAULT_WORKSPACE_PATH));
// The workspace every path-bearing IPC command reads/writes. Set from the
// command's `path` argument (mirroring the real backend, which is told which
// workspace each call targets).
let activePath = DEFAULT_WORKSPACE_PATH;

function storeFor(path: string): WorkspaceStore {
  let store = stores.get(path);
  if (!store) {
    store = makeStore(path);
    stores.set(path, store);
  }
  return store;
}

function active(): WorkspaceStore {
  return storeFor(activePath);
}

// Paths that the next `pick_workspace_folder` calls should return, letting a
// test open a specific (second, third, …) workspace. Falls back to the default
// path so existing single-workspace tests need no setup.
const workspacePickQueue: string[] = [];
const listeners = new Map<string, Set<Handler<any>>>();
const externalLinks: string[] = [];
const slack: Array<{ webhookUrl: string; message: string }> = [];
const promptQueue: Array<string | null> = [];
const confirmQueue: boolean[] = [];
const attachmentPickQueue: string[][] = [];
const updater = {
  mode: "none" as UpdaterMode,
  installed: false,
  restarted: false
};
// The persisted open-tab state, mirroring get_open_workspaces / save_open_workspaces.
const openWorkspacesState: { active: string | null; paths: string[] } = { active: null, paths: [] };

if (new URLSearchParams(window.location.search).has("resetLimnE2e")) {
  sessionStorage.removeItem("limn-e2e-state");
} else {
  const saved = sessionStorage.getItem("limn-e2e-state");
  if (saved) {
    const restored = JSON.parse(saved) as HarnessSnapshot;
    // Only the active workspace's contents are persisted across reloads (a real
    // filesystem keeps every folder; the harness keeps just the active one). It
    // rehydrates into the default store, matching a fresh launch reopening it.
    const store = storeFor(DEFAULT_WORKSPACE_PATH);
    Object.assign(store.settings, restored.settings);
    store.members.members = restored.members.members;
    store.boards.clear();
    store.cards.clear();
    for (const file of restored.boards) {
      store.boards.set(file.file_name, file.content);
    }
    for (const file of restored.cards) {
      store.cards.set(file.file_name, file.content);
    }
    store.conflictFiles.clear();
    for (const file of restored.conflicts ?? []) {
      store.conflictFiles.set(file.file_name, file.content);
    }
    store.attachments.clear();
    for (const item of restored.attachments ?? []) {
      store.attachments.set(item.path, item.size);
    }
    store.exports.clear();
    for (const item of restored.exports ?? []) {
      store.exports.set(item.path, item.content);
    }
    store.loadWorkspaceCount = restored.loadWorkspaceCount ?? 0;
    externalLinks.splice(0, externalLinks.length, ...(restored.externalLinks ?? []));
    slack.splice(0, slack.length, ...restored.slack);
    Object.assign(updater, restored.updater ?? { mode: "none", installed: false, restarted: false });
    if (restored.openWorkspaces) {
      openWorkspacesState.active = restored.openWorkspaces.active;
      openWorkspacesState.paths = [...restored.openWorkspaces.paths];
    }
  }
}

function emit<T = unknown>(event: string, payload?: T) {
  updateDebugState();
  for (const handler of listeners.get(event) ?? []) {
    handler({ event, id: Date.now(), payload });
  }
}

function snapshot(): HarnessSnapshot {
  const store = active();
  return {
    settings: JSON.parse(JSON.stringify(store.settings)) as WorkspaceSettings,
    members: JSON.parse(JSON.stringify(store.members)) as MembersFile,
    boards: [...store.boards.entries()].sort().map(([file_name, content]) => ({ file_name, content })),
    cards: [...store.cards.entries()].sort().map(([file_name, content]) => ({ file_name, content })),
    conflicts: [...store.conflictFiles.entries()].sort().map(([file_name, content]) => ({ file_name, content })),
    attachments: [...store.attachments.entries()].sort().map(([path, size]) => ({ path, size })),
    exports: [...store.exports.entries()].sort().map(([path, content]) => ({ path, content })),
    lastWorkspace: openWorkspacesState.active,
    openWorkspaces: { active: openWorkspacesState.active, paths: [...openWorkspacesState.paths] },
    externalLinks: [...externalLinks],
    loadWorkspaceCount: store.loadWorkspaceCount,
    slack: [...slack],
    updater: { ...updater }
  };
}

function loadFiles(store: WorkspaceStore): WorkspaceFiles {
  return {
    settings: `${JSON.stringify(store.settings, null, 2)}\n`,
    members: `${JSON.stringify(store.members, null, 2)}\n`,
    boards: [...store.boards.entries()].sort().map(([file_name, content]) => ({ file_name, content })),
    cards: [...store.cards.entries()].sort().map(([file_name, content]) => ({ file_name, content })),
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

// Point the harness at the workspace a path-bearing command targets, mirroring
// the real backend (each IPC call names its workspace path).
function useWorkspace(args: Record<string, unknown> | undefined): WorkspaceStore {
  if (typeof args?.path === "string" && args.path) {
    activePath = args.path;
  }
  return active();
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

// Mirror the Rust write_conflict_copy naming and placement: card copies land in
// cards/ (surfacing as a recoverable duplicate); everything else in
// .workspace/conflicts/. Returns the workspace-relative path.
function preserveConflictCopy(store: WorkspaceStore, relativeDir: string, fileName: string, content: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const ext = fileName.split(".").pop() ?? "md";
  const copyName = `${stem}_conflict_${Date.now()}${Math.random().toString(36).slice(2, 6)}.${ext}`;
  if (relativeDir === "cards") {
    store.cards.set(copyName, content);
    emit("workspace-changed");
  } else {
    store.conflictFiles.set(copyName, content);
    updateDebugState();
  }
  return `${relativeDir}/${copyName}`;
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
        return (workspacePickQueue.shift() ?? DEFAULT_WORKSPACE_PATH) as T;
      case "get_open_workspaces":
        return { active: openWorkspacesState.active, paths: [...openWorkspacesState.paths] } as T;
      case "save_open_workspaces": {
        // Deliberately does not call updateDebugState (matching the historical
        // save_last_workspace): the open-tab list persists to sessionStorage only
        // alongside a real workspace mutation, so a reload with no writes returns
        // to the welcome screen.
        openWorkspacesState.paths = Array.isArray(args?.paths)
          ? (args.paths as unknown[]).filter((path): path is string => typeof path === "string")
          : [];
        openWorkspacesState.active = typeof args?.active === "string" && args.active ? args.active : null;
        if (openWorkspacesState.active) {
          activePath = openWorkspacesState.active;
        }
        return undefined as T;
      }
      case "find_card_workspace": {
        // Mirror the backend: return the first given path whose store holds a
        // card file named <cardId>.md (cards are keyed by `<id>.md`).
        const cardId = typeof args?.cardId === "string" ? args.cardId : "";
        const paths = Array.isArray(args?.paths)
          ? (args.paths as unknown[]).filter((path): path is string => typeof path === "string")
          : [];
        const fileName = `${cardId}.md`;
        const found = cardId
          ? paths.find((path) => stores.get(path)?.cards.has(fileName)) ?? null
          : null;
        return found as T;
      }
      case "watch_workspace":
        useWorkspace(args);
        return undefined as T;
      case "load_workspace": {
        const store = useWorkspace(args);
        store.loadWorkspaceCount += 1;
        return loadFiles(store) as T;
      }
      case "write_workspace_settings": {
        const store = useWorkspace(args);
        const content = contentArg(args);
        const conflict = casResult(".workspace/settings.json", `${JSON.stringify(store.settings, null, 2)}\n`, expectedVersionArg(args));
        if (conflict) {
          return conflict as T;
        }
        for (const key of Object.keys(store.settings)) {
          delete (store.settings as unknown as Record<string, unknown>)[key];
        }
        Object.assign(store.settings, JSON.parse(content) as WorkspaceSettings);
        emit("workspace-changed");
        return { relative_path: ".workspace/settings.json", conflict: false } satisfies WriteResult as T;
      }
      case "write_members": {
        const store = useWorkspace(args);
        const content = contentArg(args);
        const conflict = casResult(".workspace/members.json", `${JSON.stringify(store.members, null, 2)}\n`, expectedVersionArg(args));
        if (conflict) {
          return conflict as T;
        }
        const parsed = JSON.parse(content) as MembersFile;
        store.members.members = parsed.members;
        store.members.updatedAt = parsed.updatedAt;
        emit("workspace-changed");
        return { relative_path: ".workspace/members.json", conflict: false } satisfies WriteResult as T;
      }
      case "write_board_file": {
        const store = useWorkspace(args);
        const fileName = fileNameArg(args);
        const conflict = casResult(`boards/${fileName}`, store.boards.get(fileName), expectedVersionArg(args));
        if (conflict) {
          return conflict as T;
        }
        store.boards.set(fileName, contentArg(args));
        emit("workspace-changed");
        return { relative_path: `boards/${fileName}`, conflict: false } satisfies WriteResult as T;
      }
      case "delete_board_file": {
        const store = useWorkspace(args);
        const fileName = fileNameArg(args);
        const expected = expectedVersionArg(args);
        const current = store.boards.get(fileName);
        if (current !== undefined && expected !== undefined && versionOf(current) !== expected) {
          const copyPath = preserveConflictCopy(store, ".workspace/conflicts", fileName, current);
          return { conflict: true, copy_path: copyPath } as T;
        }
        store.boards.delete(fileName);
        emit("workspace-changed");
        return { conflict: false, copy_path: null } as T;
      }
      case "write_card_file": {
        const store = useWorkspace(args);
        const fileName = fileNameArg(args);
        const content = contentArg(args);
        const expected = typeof args?.expectedUpdatedAt === "string" ? args.expectedUpdatedAt : undefined;
        const current = store.cards.get(fileName);
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
        store.cards.set(fileName, content);
        emit("workspace-changed");
        return { relative_path: `cards/${fileName}`, conflict: false } satisfies WriteResult as T;
      }
      case "write_conflict_copy": {
        const store = useWorkspace(args);
        const relativeDir = String(args?.relativeDir ?? "");
        const fileName = fileNameArg(args);
        const content = contentArg(args);
        return preserveConflictCopy(store, relativeDir, fileName, content) as T;
      }
      case "delete_card_file": {
        const store = useWorkspace(args);
        const fileName = fileNameArg(args);
        const expected = typeof args?.expectedUpdatedAt === "string" ? args.expectedUpdatedAt : undefined;
        const current = store.cards.get(fileName);
        // Mirror the Rust conditional delete: refuse when disk moved on under us,
        // preserving the current copy instead of discarding another device's edit.
        if (current !== undefined && expected !== undefined && versionOf(current) !== expected) {
          const copyPath = preserveConflictCopy(store, ".workspace/conflicts", fileName, current);
          return { conflict: true, copy_path: copyPath } as T;
        }
        store.cards.delete(fileName);
        // Attachments are cleaned up only when the card is actually removed.
        const cardId = fileName.replace(/\.md$/, "");
        for (const key of [...store.attachments.keys()]) {
          if (key.startsWith(`${cardId}/`)) {
            store.attachments.delete(key);
          }
        }
        emit("workspace-changed");
        return { conflict: false, copy_path: null } as T;
      }
      case "list_conflicts": {
        const store = useWorkspace(args);
        const cardCopies = [...store.cards.entries()]
          .filter(([file_name]) => file_name.includes("_conflict_"))
          .map(([file_name, content]) => ({ relative_path: `cards/${file_name}`, file_name, content }));
        const workspaceCopies = [...store.conflictFiles.entries()].map(([file_name, content]) => ({
          relative_path: `.workspace/conflicts/${file_name}`,
          file_name,
          content,
        }));
        return [...cardCopies, ...workspaceCopies].sort((a, b) => a.relative_path.localeCompare(b.relative_path)) as T;
      }
      case "delete_conflict_file": {
        const store = useWorkspace(args);
        const relativePath = String(args?.relativePath ?? "");
        const fileName = relativePath.split("/").pop() ?? "";
        if (relativePath.startsWith("cards/")) {
          store.cards.delete(fileName);
        } else if (relativePath.startsWith(".workspace/conflicts/")) {
          store.conflictFiles.delete(fileName);
        }
        emit("workspace-changed");
        return undefined as T;
      }
      case "pick_attachment_files":
        return (attachmentPickQueue.shift() ?? []) as T;
      case "add_attachment": {
        const store = useWorkspace(args);
        const cardId = String(args?.cardId ?? "");
        const storedName = String(args?.storedName ?? "");
        const source = String(args?.sourcePath ?? "");
        // Deterministic stand-in size so tests can assert against it.
        const size = source.length + 1024;
        store.attachments.set(`${cardId}/${storedName}`, size);
        updateDebugState();
        return size as T;
      }
      case "delete_attachment": {
        const store = useWorkspace(args);
        const cardId = String(args?.cardId ?? "");
        const storedName = String(args?.storedName ?? "");
        store.attachments.delete(`${cardId}/${storedName}`);
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
        const store = useWorkspace(args);
        const cardId = String(args?.cardId ?? "");
        const storedName = String(args?.storedName ?? "");
        if (!store.attachments.has(`${cardId}/${storedName}`)) {
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
        externalLinks.push(`file://${typeof args?.path === "string" ? args.path : activePath}`);
        updateDebugState();
        return undefined as T;
      case "export_calendar": {
        const store = useWorkspace(args);
        store.exports.set("exports/limn-due-dates.ics", contentArg(args));
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
    active().boards.set(fileName, `${JSON.stringify(board, null, 2)}\n`);
    emit("workspace-changed");
  },
  externalEditCard(fileName: string, content: string, silent = false) {
    active().cards.set(fileName, content);
    if (silent) {
      // Change disk without waking the watcher, so the app keeps a stale version
      // — used to exercise version-checked deletes racing a remote edit.
      updateDebugState();
    } else {
      emit("workspace-changed");
    }
  },
  corruptCard(fileName: string) {
    active().cards.set(fileName, "not frontmatter");
    emit("workspace-changed");
  },
  queueWorkspacePick(path: string) {
    workspacePickQueue.push(path);
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
    | { type: "queueWorkspacePick"; path: string }
    | { type: "dropFiles"; paths: string[]; x?: number; y?: number }
    | { type: "setUpdaterMode"; mode: UpdaterMode }
    | { type: "resetSlack" }
    | { type: "emitDeepLink"; url: string }
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
    case "queueWorkspacePick":
      window.__LIMN_E2E__?.queueWorkspacePick(detail.path);
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
    case "emitDeepLink":
      // Stand in for the OS handing the app a limn://card/<id> link.
      emit("deep-link", detail.url);
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
      externalEditCard(fileName: string, content: string, silent?: boolean): void;
      corruptCard(fileName: string): void;
      queueWorkspacePick(path: string): void;
      resetSlack(): void;
      setUpdaterMode(mode: UpdaterMode): void;
    };
  }
}
