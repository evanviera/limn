import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  CSSProperties,
  FormEvent as ReactFormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode
} from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasDesktopShell, listen, listenFileDrop } from "./ipc";
import {
  addActivity,
  addAttachmentFile,
  attachmentDisplayName,
  attachmentStoredName,
  createBoard,
  createCard,
  createComment,
  createDefaultSettings,
  deleteAttachmentFile,
  deleteBoard,
  deleteCard,
  discardConflict,
  exportCalendar,
  findCardWorkspace,
  getOpenWorkspaces,
  listConflicts,
  loadWorkspace,
  loadWorkspaceCards,
  loadWorkspaceMeta,
  makeId,
  normalizeUrl,
  openAttachmentFile,
  openExternal,
  openWorkspaceFolder,
  pickAttachmentFiles,
  pickWorkspaceFolder,
  postSlack,
  revealAttachmentFile,
  saveBoard,
  saveCard,
  saveMembers,
  saveOpenWorkspaces,
  saveSettings,
  readWorkspaceFiles,
  timestamp,
  watchWorkspace,
  type SaveOutcome
} from "./storage";
import { Attachment, Board, BoardGroup, BoardList, Card, CardFilter, Member, MembersFile, OpenWorkspaceRef, SavedView, Subtask, SubtaskListItem, View, WorkspaceChanged, WorkspaceLoadProgress, WorkspaceSettings } from "./types";
import {
  canUseUpdater,
  checkForUpdate,
  installUpdate,
  restartApp,
  type AppUpdate,
  type DownloadProgress
} from "./updater";

import { BoardView } from "./components/BoardView";
import { CardEditor } from "./components/CardEditor";
import { ConflictReview } from "./components/ConflictReview";
import type { ConflictChoice } from "./components/ConflictReview";
import { buildConflicts } from "./lib/conflicts";
import { parseCardDeepLink } from "./lib/deepLink";
import type { ResolveEntity, ReviewConflict, WorkspaceEntities } from "./lib/conflicts";
import { FilterView } from "./components/FilterView";
import type { FilterRequest } from "./components/FilterView";
import { InboxView } from "./components/InboxView";
import { ConfirmDialog, EmptyState, TextDialog } from "./components/dialogs";
import type { ConfirmDialogState, TextDialogState } from "./components/dialogs";
import { ContextMenu, isEditableTextControl, textControlContextItems } from "./components/contextMenu";
import type { ContextMenuItem, ContextMenuState, OpenContextMenu } from "./components/contextMenu";
import { Spinner } from "./components/icons";
import { MembersView } from "./components/MembersView";
import { SettingsView } from "./components/SettingsView";
import { WindowsTitlebar } from "./components/WindowsTitlebar";
import { WorkspaceTabs } from "./components/WorkspaceTabs";
import { WelcomeScreen, WorkspaceBanners, WorkspaceSidebar } from "./components/WorkspaceChrome.js";
import { LIST_WIDTH_MODE_STORAGE_KEY, LIST_WIDTH_STORAGE_KEY, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, THEME_STORAGE_KEY } from "./lib/constants";
import type { ListWidthMode, SlackNotificationKey, ThemeMode } from "./lib/constants";
import { useResizableSidebar } from "./lib/useResizableSidebar";
import { buildCalendar, dueReminderCount, type CalendarEntry } from "./lib/dueDate";
import { EMPTY_FILTER } from "./lib/filter";
import { buildInboxItems, inboxSeenAtKey, inboxUnreadCount } from "./lib/inbox";
import { listNameTriggersMoveNotification } from "./lib/notifications";
import { compareBoardsByOrder, compareCardsByOrder, nextOrderForList, placeInList } from "./lib/ordering";
import { clampListWidth, countLabel, errorText, initials, readStoredListWidth, readStoredListWidthMode, readStoredThemeMode, sameJson, selectActiveBoardId, slackTag, upsertById, workspaceBaseName } from "./lib/format";
import { readActiveMemberId, resolveActiveMember, writeActiveMemberId } from "./lib/identity";
import { updateBannerMessage } from "./lib/updateMessages";
import type { UpdateStatus } from "./lib/updateMessages";

const WORKSPACE_WATCH_REFRESH_DELAY_MS = 75;
// Above this many changed card files in one watch burst, a single full reload
// (now parallel) is cheaper than many targeted reads, so skip the incremental path.
const INCREMENTAL_REFRESH_MAX_FILES = 40;
const CLOUD_HINT_DISMISS_PREFIX = "limn-cloud-hint-dismissed:";

// Whether the user has dismissed the cloud-storage advisory for this workspace.
function storageHintDismissed(path: string): boolean {
  try {
    return localStorage.getItem(`${CLOUD_HINT_DISMISS_PREFIX}${path}`) === "1";
  } catch {
    return false;
  }
}

function rememberStorageHintDismissed(path: string): void {
  try {
    localStorage.setItem(`${CLOUD_HINT_DISMISS_PREFIX}${path}`, "1");
  } catch {
    // Ignore storage failures — the hint just reappears next open.
  }
}

// Classify a workspace-relative changed path from the watcher. A plain card file
// can be reloaded incrementally; anything else (boards, settings, members, or a
// card conflict copy) needs a full reload to stay correct.
function classifyChangedPath(relativePath: string): { kind: "card"; name: string } | { kind: "full" } {
  const normalized = relativePath.replace(/\\/g, "/");
  const cardMatch = /^cards\/([^/]+\.md)$/.exec(normalized);
  if (cardMatch && !cardMatch[1].includes("_conflict_")) {
    return { kind: "card", name: cardMatch[1] };
  }
  return { kind: "full" };
}

type CardOpenMode = "view" | "edit";

function platformName() {
  const platform = navigator.platform || navigator.userAgent;
  if (/win/i.test(platform)) {
    return "windows";
  }
  if (/mac/i.test(platform)) {
    return "macos";
  }
  return "other";
}

document.documentElement.dataset.platform = platformName();

export default function App() {
  const [workspacePath, setWorkspacePath] = useState("");
  // The open workspace tabs. Only the active one (workspacePath) is loaded into
  // the state below; the rest are folders the user can switch to. Persisted so
  // they reopen on next launch. See openWorkspace / switchWorkspace / closeWorkspace.
  const [openWorkspaces, setOpenWorkspaces] = useState<OpenWorkspaceRef[]>([]);
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const settingsRef = useRef<WorkspaceSettings | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [activeMemberId, setActiveMemberId] = useState("");
  const [inboxSeenAt, setInboxSeenAt] = useState("");
  const [boards, setBoards] = useState<Board[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [activeBoardId, setActiveBoardId] = useState("");
  const [view, setView] = useState<View>("board");
  const [filterRequest, setFilterRequest] = useState<FilterRequest | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedCardMode, setSelectedCardMode] = useState<CardOpenMode>("view");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"info" | "warning">("info");
  const [isLoading, setIsLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  // Progress of the card-loading phase of a progressive open (null when idle).
  // Feeds the "Loading cards… N of M" indicator and its Cancel button.
  const [cardsLoading, setCardsLoading] = useState<{ loaded: number; total: number } | null>(null);
  // A dismissible hint shown when the workspace lives in a cloud-sync folder
  // (or card files timed out downloading), advising the user to keep it offline.
  const [storageHint, setStorageHint] = useState<string | null>(null);
  const [textDialog, setTextDialog] = useState<TextDialogState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [updateInfo, setUpdateInfo] = useState<AppUpdate | null>(null);
  const [updateMessage, setUpdateMessage] = useState("");
  const [updateProgress, setUpdateProgress] = useState<DownloadProgress | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readStoredThemeMode());
  // Board list width is a per-computer preference (persisted to localStorage, not
  // the synced workspace) so each machine keeps its own layout.
  const [listWidth, setListWidth] = useState<number>(() => readStoredListWidth());
  const [listWidthMode, setListWidthMode] = useState<ListWidthMode>(() => readStoredListWidthMode());
  const sidebar = useResizableSidebar();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  // Preserved conflict artifacts awaiting in-app review, and whether the review
  // surface is open. Refreshed on every workspace load/reload.
  const [conflicts, setConflicts] = useState<ReviewConflict[]>([]);
  const [conflictReviewOpen, setConflictReviewOpen] = useState(false);
  // True while OS files are being dragged over the window, used to invite a drop
  // onto the open card editor.
  const [fileDragActive, setFileDragActive] = useState(false);
  // The board card currently under a file drag (highlighted as the drop target),
  // or null when the drag isn't over a card.
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null);
  const hasCheckedForUpdatesRef = useRef(false);

  const activeBoard = boards.find((board) => board.id === activeBoardId) ?? boards[0] ?? null;
  const selectedCard = cards.find((card) => card.id === selectedCardId) ?? null;
  const activeMember = resolveActiveMember(members, activeMemberId);
  const updaterAvailable = canUseUpdater();
  // Overdue + due-today count across every board — the reminder nudge shown on
  // the Filter nav item.
  const dueReminders = dueReminderCount(cards);
  const inboxItems = useMemo(() => buildInboxItems(cards, activeMemberId, members), [cards, activeMemberId, members]);
  const inboxUnread = inboxUnreadCount(inboxItems, inboxSeenAt);

  useEffect(() => {
    if (!workspacePath || !activeMemberId) {
      setInboxSeenAt("");
      return;
    }
    try {
      setInboxSeenAt(localStorage.getItem(inboxSeenAtKey(workspacePath, activeMemberId)) ?? "");
    } catch {
      setInboxSeenAt("");
    }
  }, [workspacePath, activeMemberId]);

  useLayoutEffect(() => {
    document.documentElement.dataset.platform = platformName();
  }, []);
  // The workspace watcher captures `refreshWorkspace` from the effect's render,
  // so read the open card / cards through refs to get current values when a
  // disk change fires.
  const selectedCardIdRef = useRef(selectedCardId);
  selectedCardIdRef.current = selectedCardId;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const boardsRef = useRef(boards);
  boardsRef.current = boards;
  // Lets the once-subscribed deep-link listener read the active workspace path
  // without re-subscribing or closing over a stale value.
  const workspacePathRef = useRef(workspacePath);
  workspacePathRef.current = workspacePath;
  // Mirrors `openWorkspaces` so the open/switch/close handlers can compute the
  // next tab list from the current one without racing React's async state.
  const openWorkspacesRef = useRef<OpenWorkspaceRef[]>(openWorkspaces);
  openWorkspacesRef.current = openWorkspaces;
  const membersRef = useRef(members);
  membersRef.current = members;
  // The members.json version last seen on disk. Members are held in state as a
  // bare array, so this ref carries the file-level `updatedAt` we compare-and-swap
  // against on the next members write.
  const membersVersionRef = useRef<string>("");
  // The card version the open editor started from — the true common ancestor for
  // a three-way merge. It is captured at open time and only advanced by our own
  // saves, never by a background disk refresh, so an external edit landing while
  // the editor is open still merges from the right base instead of clobbering it.
  const editorBaseRef = useRef<Card | null>(null);
  // The id of an open card we just auto-merged, so the reload that follows applies
  // the reconciled copy without a misleading "changed on disk" warning.
  const reconciledOpenCardRef = useRef<string | null>(null);
  // Points at the latest "attach these dropped files to a card" closure so the
  // window drag-drop listener (subscribed once) never reads stale state.
  const attachToCardRef = useRef<(cardId: string, paths: string[]) => void>(() => undefined);
  const pendingCardWriteRef = useRef<Record<string, string>>({});
  const pendingMembersWriteRef = useRef<Member[] | null>(null);
  const pendingSettingsWriteRef = useRef<WorkspaceSettings | null>(null);
  const watchRefreshTimerRef = useRef<number | null>(null);
  const watchRefreshInFlightRef = useRef(false);
  const watchRefreshPendingRef = useRef(false);
  // Monotonic token identifying the in-flight progressive load. Bumped on every
  // new load and on Cancel, so a slow card-load phase whose workspace/tab has
  // since changed (or was cancelled) discards its results instead of clobbering.
  const loadTokenRef = useRef(0);
  // Workspace-relative paths reported changed by the watcher since the last
  // refresh ran. Drives the incremental reload; a non-card path (or a payload
  // without paths, e.g. the e2e harness) sets fullReloadNeededRef instead.
  const changedCardPathsRef = useRef<Set<string>>(new Set());
  const fullReloadNeededRef = useRef(false);
  // True while a progressive open's card phase is still streaming in, so a
  // watch-driven refresh defers rather than racing the card apply.
  const progressiveLoadInFlightRef = useRef(false);
  const visibleCards = useMemo(
    () => cards.filter((card) => !card.archived && card.boardId === activeBoard?.id),
    [activeBoard?.id, cards]
  );
  const boardGroups = settings?.boardGroups ?? [];
  const boardNavSections = useMemo(() => {
    const validGroupIds = new Set(boardGroups.map((group) => group.id));
    const sorted = [...boards].sort(compareBoardsByOrder);
    const grouped = boardGroups.map((group) => ({
      group,
      boards: sorted.filter((board) => board.groupId === group.id)
    }));
    const ungrouped = sorted.filter((board) => !board.groupId || !validGroupIds.has(board.groupId));
    return { grouped, ungrouped };
  }, [boardGroups, boards]);

  useEffect(() => {
    void getOpenWorkspaces()
      .then(async (state) => {
        if (state.paths.length === 0) {
          return;
        }
        const list = state.paths.map((path) => ({ path, name: workspaceBaseName(path) }));
        openWorkspacesRef.current = list;
        setOpenWorkspaces(list);
        const active = state.active && state.paths.includes(state.active) ? state.active : state.paths[0];
        await openWorkspace(active);
      })
      .catch(() => undefined)
      .finally(() => setIsLoading(false));
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--list-width", `${listWidth}px`);
    document.documentElement.dataset.listWidthMode = listWidthMode;
    localStorage.setItem(LIST_WIDTH_STORAGE_KEY, String(listWidth));
    localStorage.setItem(LIST_WIDTH_MODE_STORAGE_KEY, listWidthMode);
  }, [listWidth, listWidthMode]);

  // Keep the active workspace's tab label in sync with its configured name, so a
  // rename in Settings (or one that arrives via a disk refresh) updates the tab
  // immediately instead of only after a restart.
  useEffect(() => {
    if (!workspacePath || !settings) {
      return;
    }
    const name = settings.workspaceName || workspaceBaseName(workspacePath);
    const current = openWorkspacesRef.current;
    const existing = current.find((workspace) => workspace.path === workspacePath);
    if (!existing || existing.name === name) {
      return;
    }
    commitOpenWorkspaces(
      current.map((workspace) => (workspace.path === workspacePath ? { ...workspace, name } : workspace)),
      workspacePath
    );
  }, [settings, workspacePath]);

  // Attach files dropped from the OS onto a card — either the open card editor or,
  // on the board, the card under the pointer. Subscribed once; current state is
  // read through refs so it never goes stale.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    // The board card under the given viewport point, if any.
    function cardIdAtPoint(x: number, y: number): string | null {
      return document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-card-id]")?.dataset.cardId ?? null;
    }

    // Only push state when the hovered card changes so a stream of "over" events
    // doesn't re-render the board on every frame.
    let hoveredCardId: string | null = null;
    function setHoveredCard(id: string | null) {
      if (hoveredCardId !== id) {
        hoveredCardId = id;
        setDragOverCardId(id);
      }
    }

    void listenFileDrop((event) => {
      if (event.type === "leave") {
        setFileDragActive(false);
        setHoveredCard(null);
        return;
      }

      // While the editor is open it owns the drop (via its own overlay);
      // otherwise the drop targets whichever board card sits under the pointer.
      const editorOpen = selectedCardIdRef.current !== null;
      const boardCardId = editorOpen ? null : cardIdAtPoint(event.x, event.y);

      if (event.type === "over") {
        setFileDragActive(editorOpen);
        setHoveredCard(boardCardId);
        return;
      }

      setFileDragActive(false);
      setHoveredCard(null);
      const targetCardId = editorOpen ? selectedCardIdRef.current : boardCardId;
      if (targetCardId && event.paths.length > 0) {
        attachToCardRef.current(targetCardId, event.paths);
      }
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (hasCheckedForUpdatesRef.current || !updaterAvailable) {
      return;
    }
    hasCheckedForUpdatesRef.current = true;
    void checkForUpdates(false);
  }, [updaterAvailable]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    function closeContextMenu() {
      setContextMenu(null);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    }

    window.addEventListener("pointerdown", closeContextMenu);
    window.addEventListener("resize", closeContextMenu);
    window.addEventListener("scroll", closeContextMenu, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeContextMenu);
      window.removeEventListener("resize", closeContextMenu);
      window.removeEventListener("scroll", closeContextMenu, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!workspacePath) {
      return;
    }

    let unlisten: (() => void) | undefined;
    let unlistenProgress: (() => void) | undefined;
    void watchWorkspace(workspacePath).catch((reason) => setError(errorText(reason)));
    void listen<WorkspaceChanged | undefined>("workspace-changed", (event) => {
      recordWatchChange(event.payload);
      scheduleWatchRefresh();
    }).then((dispose) => {
      unlisten = dispose;
    });
    // Advance the "Loading cards… N of M" indicator as the backend streams cards.
    void listen<WorkspaceLoadProgress>("workspace-load-progress", (event) => {
      const payload = event.payload;
      if (!payload || typeof payload.total !== "number") {
        return;
      }
      setCardsLoading((current) => (current ? { loaded: payload.loaded, total: payload.total } : current));
    }).then((dispose) => {
      unlistenProgress = dispose;
    });

    return () => {
      unlisten?.();
      unlistenProgress?.();
      clearScheduledWatchRefresh();
    };
  }, [workspacePath]);

  // Snapshot the merge base whenever a different card opens (or the editor
  // closes). Keyed on the id alone so later disk changes to the same card never
  // move the ancestor out from under an in-progress edit.
  useEffect(() => {
    editorBaseRef.current = selectedCardId
      ? cardsRef.current.find((card) => card.id === selectedCardId) ?? null
      : null;
  }, [selectedCardId]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<string>("menu-command", (event) => {
      void handleMenuCommand(event.payload);
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  });

  // A `limn://card/<id>` link clicked in another app arrives here as a
  // "deep-link" event from the backend; open the referenced card.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<string>("deep-link", (event) => {
      void handleDeepLink(event.payload);
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  });

  // Load a workspace's content into the active view (settings, members, boards,
  // cards, conflicts) and reset the transient per-workspace UI so switching tabs
  // starts clean. Returns the workspace's display name. Throws if it can't load;
  // callers keep the tab list unchanged in that case. Does not touch the tab list
  // or persistence — the open/switch/close handlers own that.
  // Open a workspace progressively: phase one loads the small meta payload
  // (settings, members, board columns) and paints the board shell immediately;
  // phase two streams the card files in the background with live progress, so a
  // large or cloud-synced vault never leaves the user staring at a blank
  // spinner. Returns the workspace name once the shell is ready (phase one);
  // callers commit the tab from that without waiting on the cards.
  async function loadWorkspaceData(path: string, focusCardId?: string): Promise<string> {
    const token = ++loadTokenRef.current;
    progressiveLoadInFlightRef.current = true;
    // A fresh load supersedes any pending incremental watch changes.
    changedCardPathsRef.current.clear();
    fullReloadNeededRef.current = false;

    const meta = await loadWorkspaceMeta(path);
    const name = meta.settings.workspaceName || workspaceBaseName(path);
    if (loadTokenRef.current !== token) {
      // Superseded by a newer open while meta was loading; abandon quietly.
      return name;
    }

    setWorkspacePath(path);
    settingsRef.current = meta.settings;
    setSettings(meta.settings);
    setMembers(meta.membersFile.members);
    membersVersionRef.current = meta.membersFile.updatedAt;
    setActiveMemberId(readActiveMemberId(path));
    setBoards(meta.boards);
    setCards([]);
    setActiveBoardId((current) => selectActiveBoardId(current, meta.boards));
    setSelectedCardId(null);
    setSelectedCardMode("view");
    setView("board");
    setFilterRequest(null);
    setConflictReviewOpen(false);
    setIsLoading(false);
    setCardsLoading(meta.cardCount > 0 ? { loaded: 0, total: meta.cardCount } : null);
    applyStorageHint(path, meta.cloudHint, meta.diagnostics);

    // Phase two runs detached so a slow/stuck card read never blocks the caller
    // (or the Cancel button). Its results are gated on the load token.
    void loadCardsPhase(path, token, focusCardId, meta);
    return name;
  }

  // Phase two of a progressive open: read the card files (with live progress) and
  // apply them, unless a newer load or a Cancel has since bumped the token.
  async function loadCardsPhase(
    path: string,
    token: number,
    focusCardId: string | undefined,
    meta: { boards: Board[]; settings: WorkspaceSettings; membersFile: MembersFile; diagnostics: string[]; cloudHint: string | null }
  ) {
    try {
      const cardData = await loadWorkspaceCards(path);
      if (loadTokenRef.current !== token) {
        return;
      }
      setCardsLoading(null);
      setCards(cardData.cards);
      // A deep link asks to open one specific card: land on its board with the
      // editor open once the card has arrived.
      const focusCard = focusCardId ? cardData.cards.find((card) => card.id === focusCardId) : undefined;
      if (focusCard) {
        setActiveBoardId(focusCard.boardId);
        setSelectedCardId(focusCard.id);
      }
      const diagnostics = [...meta.diagnostics, ...cardData.diagnostics];
      const reminders = dueReminderCount(cardData.cards);
      if (diagnostics.length > 0) {
        setNotice(diagnostics.join(" "));
        setNoticeKind("warning");
      } else if (reminders > 0) {
        setNotice(`${countLabel(reminders, "card")} overdue or due today. Open Filter to review.`);
        setNoticeKind("warning");
      } else {
        setNotice("");
        setNoticeKind("info");
      }
      applyStorageHint(path, meta.cloudHint, cardData.diagnostics);
      await reloadConflicts(path, {
        cards: cardData.cards,
        boards: meta.boards,
        settings: meta.settings,
        membersFile: meta.membersFile,
      });
    } catch (reason) {
      if (loadTokenRef.current === token) {
        setCardsLoading(null);
        setError(errorText(reason));
      }
    } finally {
      if (loadTokenRef.current === token) {
        progressiveLoadInFlightRef.current = false;
      }
    }
  }

  // Cancel the in-flight card-loading phase: bump the token so its result is
  // discarded, drop the progress indicator, and let the user reload to retry.
  // The board shell stays open and usable (cards simply aren't populated yet).
  function cancelCardLoad() {
    loadTokenRef.current += 1;
    progressiveLoadInFlightRef.current = false;
    setCardsLoading(null);
    setNotice("Card loading was cancelled. Use Reload to load the cards.");
    setNoticeKind("warning");
  }

  // Show the cloud-storage advisory when the workspace lives in a sync folder, or
  // when card reads actually timed out downloading. A passive path-based hint can
  // be dismissed per workspace; an active timeout always re-warns.
  function applyStorageHint(path: string, cloudHint: string | null, diagnostics: string[]) {
    const timedOut = diagnostics.some((message) => message.includes("cloud storage"));
    const label = timedOut ? cloudHint ?? "a cloud storage folder" : cloudHint;
    if (!label) {
      return;
    }
    if (!timedOut && storageHintDismissed(path)) {
      return;
    }
    setStorageHint(label);
  }

  // Update state, the ref, and the persisted file together so the open tabs and
  // active workspace always stay in sync.
  function commitOpenWorkspaces(list: OpenWorkspaceRef[], active: string) {
    openWorkspacesRef.current = list;
    setOpenWorkspaces(list);
    void saveOpenWorkspaces(list.map((workspace) => workspace.path), active).catch(() => undefined);
  }

  // Reorder the open-workspace tabs when one is dragged. `toIndex` is measured
  // in the list with the dragged tab removed, matching the drop math in
  // WorkspaceTabs. The active workspace is unchanged.
  function reorderWorkspace(path: string, toIndex: number) {
    const current = openWorkspacesRef.current;
    const from = current.findIndex((workspace) => workspace.path === path);
    if (from === -1) {
      return;
    }
    const moved = current[from];
    const without = current.filter((workspace) => workspace.path !== path);
    const clamped = Math.max(0, Math.min(toIndex, without.length));
    const next = [...without.slice(0, clamped), moved, ...without.slice(clamped)];
    if (next.every((workspace, index) => workspace.path === current[index].path)) {
      return;
    }
    commitOpenWorkspaces(next, workspacePath);
  }

  // Clear every workspace-scoped piece of state, returning to the welcome screen.
  // Used when the last open workspace tab is closed.
  function clearWorkspaceState() {
    setWorkspacePath("");
    settingsRef.current = null;
    setSettings(null);
    setMembers([]);
    setBoards([]);
    setCards([]);
    setActiveBoardId("");
    setSelectedCardId(null);
    setView("board");
    setFilterRequest(null);
    setConflicts([]);
    setConflictReviewOpen(false);
    setError("");
    setNotice("");
  }

  // Open a workspace folder into a tab (picking one when no path is given) and
  // make it active. Adds a new tab or refreshes an existing tab's name.
  async function openWorkspace(path?: string) {
    if (!hasDesktopShell()) {
      // A plain browser tab has no backend to pick or read a folder; surface the
      // desktop-app requirement instead of letting the IPC call throw.
      setError("Limn needs the desktop app to open a workspace folder.");
      return;
    }
    const selectedPath = path ?? (await pickWorkspaceFolder());
    if (!selectedPath) {
      return;
    }

    setError("");
    setOpening(true);
    try {
      const name = await loadWorkspaceData(selectedPath);
      const current = openWorkspacesRef.current;
      const list = current.some((workspace) => workspace.path === selectedPath)
        ? current.map((workspace) => (workspace.path === selectedPath ? { ...workspace, name } : workspace))
        : [...current, { path: selectedPath, name }];
      commitOpenWorkspaces(list, selectedPath);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setOpening(false);
    }
  }

  // Switch focus to an already-open workspace tab, loading its content.
  async function switchWorkspace(path: string, focusCardId?: string) {
    if (path === workspacePath || opening) {
      return;
    }
    setError("");
    setOpening(true);
    try {
      const name = await loadWorkspaceData(path, focusCardId);
      const list = openWorkspacesRef.current.map((workspace) =>
        workspace.path === path ? { ...workspace, name } : workspace
      );
      commitOpenWorkspaces(list, path);
    } catch (reason) {
      // The folder likely moved or was deleted; stay on the current workspace.
      setError(errorText(reason));
    } finally {
      setOpening(false);
    }
  }

  // Close a workspace tab. Closing an inactive tab just drops it; closing the
  // active tab falls back to a neighbor, or the welcome screen when it was the
  // last one.
  async function closeWorkspace(path: string) {
    const current = openWorkspacesRef.current;
    const index = current.findIndex((workspace) => workspace.path === path);
    if (index === -1) {
      return;
    }
    const next = current.filter((workspace) => workspace.path !== path);

    if (path !== workspacePath) {
      commitOpenWorkspaces(next, workspacePath);
      return;
    }

    if (next.length === 0) {
      clearWorkspaceState();
      commitOpenWorkspaces([], "");
      return;
    }

    const neighbor = next[Math.min(index, next.length - 1)];
    setOpening(true);
    try {
      const name = await loadWorkspaceData(neighbor.path);
      const list = next.map((workspace) => (workspace.path === neighbor.path ? { ...workspace, name } : workspace));
      commitOpenWorkspaces(list, neighbor.path);
    } catch (reason) {
      setError(errorText(reason));
      commitOpenWorkspaces(next, neighbor.path);
    } finally {
      setOpening(false);
    }
  }

  async function refreshWorkspace(showNotice = true) {
    if (!workspacePath) {
      return;
    }
    const data = await loadWorkspace(workspacePath);
    let settingsToApply = data.settings;
    let membersToApply = data.membersFile.members;
    let cardsToApply = data.cards;
    let openCardChangedOnDisk = false;
    if (!showNotice && data.diagnostics.length === 0) {
      // A silent (watch-driven) refresh: if the event only confirms our own
      // just-written open card, preserve that object so the editor draft is not
      // reset while the user continues typing.
      const openId = selectedCardIdRef.current;
      const before = openId ? cardsRef.current.find((card) => card.id === openId) : undefined;
      const after = openId ? data.cards.find((card) => card.id === openId) : undefined;
      const expectedSelfWrite = openId ? pendingCardWriteRef.current[openId] : undefined;
      if (openId && before && expectedSelfWrite && after?.updatedAt === expectedSelfWrite) {
        cardsToApply = data.cards.map((card) => (card.id === openId ? before : card));
        delete pendingCardWriteRef.current[openId];
      } else if (openId && reconciledOpenCardRef.current === openId) {
        // We just auto-merged this open card; apply the reconciled disk copy
        // silently rather than telling the user it "changed on disk".
        reconciledOpenCardRef.current = null;
      } else if (before && after && before.updatedAt !== after.updatedAt) {
        openCardChangedOnDisk = true;
      }

      const currentSettings = settingsRef.current;
      if (currentSettings && sameJson(data.settings, currentSettings)) {
        settingsToApply = currentSettings;
      }

      const pendingSettings = pendingSettingsWriteRef.current;
      if (pendingSettings && sameJson(data.settings, pendingSettings)) {
        settingsToApply = settingsRef.current ?? data.settings;
        pendingSettingsWriteRef.current = null;
      }

      if (sameJson(data.membersFile.members, membersRef.current)) {
        membersToApply = membersRef.current;
      }

      const pendingMembers = pendingMembersWriteRef.current;
      if (pendingMembers && sameJson(data.membersFile.members, pendingMembers)) {
        membersToApply = membersRef.current;
        pendingMembersWriteRef.current = null;
      }
    }
    settingsRef.current = settingsToApply;
    setSettings(settingsToApply);
    setMembers(membersToApply);
    membersVersionRef.current = data.membersFile.updatedAt;
    setBoards(data.boards);
    setCards(cardsToApply);
    setActiveBoardId((current) => selectActiveBoardId(current, data.boards));
    setSelectedCardId((current) => (current && cardsToApply.some((card) => card.id === current) ? current : null));
    if (showNotice) {
      setNotice(data.diagnostics.length > 0 ? `Workspace reloaded with warnings. ${data.diagnostics.join(" ")}` : "Workspace reloaded from disk.");
      setNoticeKind(data.diagnostics.length > 0 ? "warning" : "info");
    } else if (data.diagnostics.length > 0) {
      setNotice(data.diagnostics.join(" "));
      setNoticeKind("warning");
    } else if (openCardChangedOnDisk) {
      setNotice("This card changed on disk. Reopen it to see the latest version.");
      setNoticeKind("warning");
    }
    await reloadConflicts(workspacePath, {
      cards: data.cards,
      boards: data.boards,
      settings: data.settings,
      membersFile: data.membersFile,
    });
  }

  // Accumulate the changed paths from a `workspace-changed` event so the next
  // refresh can reload only what changed. A payload without paths (the e2e
  // harness, or any unexpected shape) conservatively forces a full reload.
  function recordWatchChange(payload: WorkspaceChanged | undefined) {
    const paths = payload?.paths;
    if (!Array.isArray(paths) || paths.length === 0) {
      fullReloadNeededRef.current = true;
      return;
    }
    for (const relativePath of paths) {
      const classified = classifyChangedPath(relativePath);
      if (classified.kind === "card") {
        changedCardPathsRef.current.add(classified.name);
      } else {
        fullReloadNeededRef.current = true;
      }
    }
  }

  function clearScheduledWatchRefresh() {
    watchRefreshPendingRef.current = false;
    if (watchRefreshTimerRef.current !== null) {
      window.clearTimeout(watchRefreshTimerRef.current);
      watchRefreshTimerRef.current = null;
    }
  }

  function scheduleWatchRefresh() {
    watchRefreshPendingRef.current = true;
    if (watchRefreshTimerRef.current !== null || watchRefreshInFlightRef.current) {
      return;
    }

    watchRefreshTimerRef.current = window.setTimeout(() => {
      watchRefreshTimerRef.current = null;
      void runScheduledWatchRefresh();
    }, WORKSPACE_WATCH_REFRESH_DELAY_MS);
  }

  async function runScheduledWatchRefresh() {
    if (watchRefreshInFlightRef.current) {
      return;
    }
    // Don't race the card-apply of an in-flight progressive open; retry shortly.
    if (progressiveLoadInFlightRef.current) {
      watchRefreshTimerRef.current = window.setTimeout(() => {
        watchRefreshTimerRef.current = null;
        void runScheduledWatchRefresh();
      }, WORKSPACE_WATCH_REFRESH_DELAY_MS);
      return;
    }

    watchRefreshPendingRef.current = false;
    watchRefreshInFlightRef.current = true;
    // Reload incrementally when every change was a plain card file and there
    // aren't too many; otherwise a single (parallel) full reload is simpler and
    // keeps board/settings/members/conflict changes correct.
    const changedCards = [...changedCardPathsRef.current];
    const useFull =
      fullReloadNeededRef.current ||
      changedCards.length === 0 ||
      changedCards.length > INCREMENTAL_REFRESH_MAX_FILES;
    changedCardPathsRef.current.clear();
    fullReloadNeededRef.current = false;
    try {
      if (useFull) {
        await refreshWorkspace(false);
      } else {
        await refreshChangedCards(changedCards);
      }
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      watchRefreshInFlightRef.current = false;
      if (watchRefreshPendingRef.current) {
        scheduleWatchRefresh();
      }
    }
  }

  // Incremental watch refresh: re-read only the changed card files and splice
  // them into state (add / update / remove), instead of re-reading the whole
  // vault. Preserves the open card's local draft on a self-write and warns when
  // the open card changed under us, mirroring the full refresh's reconciliation.
  // Falls back to a full reload if a changed card is present but unparseable, so
  // the corruption diagnostic surfaces exactly as it otherwise would.
  async function refreshChangedCards(names: string[]) {
    const path = workspacePathRef.current;
    if (!path) {
      return;
    }
    const updates = await readWorkspaceFiles(path, names.map((name) => ({ dir: "cards" as const, name })));
    if (updates.some((update) => !update.deleted && update.card === null)) {
      await refreshWorkspace(false);
      return;
    }

    const byFile = new Map(cardsRef.current.map((card) => [card.fileName, card]));
    const openId = selectedCardIdRef.current;
    let openCardChangedOnDisk = false;

    for (const update of updates) {
      if (update.deleted) {
        byFile.delete(update.fileName);
        continue;
      }
      const after = update.card as Card;
      const before = byFile.get(update.fileName);
      const isOpenCard = openId !== null && before?.id === openId;

      if (isOpenCard) {
        const expectedSelfWrite = pendingCardWriteRef.current[openId];
        if (expectedSelfWrite && after.updatedAt === expectedSelfWrite) {
          // Our own just-written change echoed back: keep the local object so the
          // editor draft isn't reset mid-edit.
          delete pendingCardWriteRef.current[openId];
          continue;
        }
        if (reconciledOpenCardRef.current === openId) {
          // We just auto-merged this open card; apply the disk copy silently.
          reconciledOpenCardRef.current = null;
        } else if (before && before.updatedAt !== after.updatedAt) {
          openCardChangedOnDisk = true;
        }
      }
      byFile.set(update.fileName, after);
    }

    const nextCards = [...byFile.values()];
    setCards(nextCards);
    setSelectedCardId((current) => (current && nextCards.some((card) => card.id === current) ? current : null));
    if (openCardChangedOnDisk) {
      setNotice("This card changed on disk. Reopen it to see the latest version.");
      setNoticeKind("warning");
    }
    await reloadConflicts(path, {
      cards: nextCards,
      boards: boardsRef.current,
      settings: settingsRef.current ?? createDefaultSettings(workspaceBaseName(path)),
      membersFile: { schemaVersion: 1, members: membersRef.current, updatedAt: membersVersionRef.current },
    });
  }

  async function checkForUpdates(showNoUpdate = true): Promise<AppUpdate | null> {
    if (!updaterAvailable) {
      if (showNoUpdate) {
        setUpdateStatus("not-available");
        setUpdateMessage("Update checks are available in the desktop app.");
      }
      return null;
    }

    setUpdateStatus("checking");
    setUpdateMessage("");
    setUpdateProgress(null);
    try {
      const update = await checkForUpdate();
      setUpdateInfo(update);
      if (update) {
        setUpdateStatus("available");
        setUpdateMessage(update.body?.trim() || `Limn ${update.version} is ready to install.`);
        return update;
      }
      setUpdateStatus(showNoUpdate ? "not-available" : "idle");
      setUpdateMessage(showNoUpdate ? "Limn is up to date." : "");
      return null;
    } catch (reason) {
      setUpdateStatus("error");
      setUpdateMessage(`Update check failed: ${errorText(reason)}`);
      return null;
    }
  }

  async function installAvailableUpdate() {
    if (!updateInfo) {
      return;
    }

    setUpdateStatus("downloading");
    setUpdateMessage(`Downloading Limn ${updateInfo.version}...`);
    setUpdateProgress({ downloaded: 0 });
    try {
      await installUpdate((progress) => setUpdateProgress(progress));
      setUpdateStatus("restart-ready");
      setUpdateMessage(`Limn ${updateInfo.version} is installed. Restart to finish updating.`);
    } catch (reason) {
      setUpdateStatus("error");
      setUpdateMessage(`Update install failed: ${errorText(reason)}`);
    }
  }

  async function restartAfterUpdate() {
    try {
      await restartApp();
    } catch (reason) {
      setUpdateStatus("error");
      setUpdateMessage(`Restart failed: ${errorText(reason)}`);
    }
  }

  // Turn a non-trivial save/delete outcome into user feedback. A plain "written"
  // needs nothing; a "merged"/"restored"/"conflict" means disk changed under us,
  // so we reload to show the reconciled state (and, for a hard conflict, point at
  // the preserved copy). The reload also refreshes the conflict-review list so a
  // freshly preserved copy shows up. See src/lib/merge.ts for what auto-merges.
  async function handleSaveOutcome(outcome: SaveOutcome, label: string, action: "save" | "delete" = "save") {
    if (outcome.status === "written") {
      return;
    }
    if (outcome.status === "merged") {
      setNotice(`Merged edits from another device into the ${label}.`);
      setNoticeKind("info");
    } else if (outcome.status === "restored") {
      setNotice(`The ${label} was deleted on another device; your version was restored.`);
      setNoticeKind("warning");
    } else if (action === "delete") {
      setNotice(`The ${label} changed on another device; not deleted. Your copy is at ${outcome.copyPath}. Review it under Conflicts.`);
      setNoticeKind("warning");
    } else {
      setNotice(`Couldn't fully merge the ${label}; your version was saved to ${outcome.copyPath}. Reloading disk state.`);
      setNoticeKind("warning");
    }
    await refreshWorkspace(false);
  }

  // Re-enumerate preserved conflict artifacts and pair each against the current
  // on-disk entity for the review UI. Called after every workspace load/reload;
  // failures never break the reload (the app just shows no conflicts).
  async function reloadConflicts(path: string, entities: WorkspaceEntities) {
    try {
      const files = await listConflicts(path);
      setConflicts(buildConflicts(files, entities));
    } catch {
      setConflicts([]);
    }
  }

  // Persist a chosen/merged resolution through the normal conflict-aware save
  // path, stamping a fresh version so it always lands as the newest write.
  async function saveResolvedEntity(entity: ResolveEntity): Promise<SaveOutcome> {
    const now = timestamp();
    if (entity.kind === "card") {
      return saveCard(workspacePath, { ...entity.card, updatedAt: now }, entity.base);
    }
    if (entity.kind === "board") {
      return saveBoard(workspacePath, { ...entity.board, updatedAt: now }, entity.base);
    }
    if (entity.kind === "settings") {
      return saveSettings(workspacePath, { ...entity.settings, updatedAt: now }, entity.base);
    }
    return saveMembers(workspacePath, { ...entity.members, updatedAt: now }, entity.base);
  }

  // Apply a conflict resolution: optionally write the kept/merged version, always
  // discard the artifact, then reload so the review list reflects the result.
  async function resolveConflict(conflict: ReviewConflict, choice: ConflictChoice) {
    if (!workspacePath) {
      return;
    }
    try {
      const entity = choice === "mine" ? conflict.mine : choice === "merged" ? conflict.merged : null;
      if (entity) {
        await saveResolvedEntity(entity);
      }
      await discardConflict(workspacePath, conflict.relativePath);
      setNotice(`Resolved conflict for ${conflict.title}.`);
      setNoticeKind("info");
      await refreshWorkspace(false);
    } catch (reason) {
      setError(`Couldn't resolve conflict: ${errorText(reason)}`);
    }
  }

  async function persistBoard(nextBoard: Board) {
    if (!workspacePath) {
      return;
    }
    const base = boardsRef.current.find((board) => board.id === nextBoard.id);
    setBoards((current) => upsertById(current, nextBoard));
    const outcome = await saveBoard(workspacePath, nextBoard, base);
    await handleSaveOutcome(outcome, "board");
  }

  async function persistWorkspaceSettings(nextSettings: WorkspaceSettings, savedNotice: string) {
    if (!workspacePath) {
      return;
    }
    const base = settingsRef.current ?? undefined;
    const updated = { ...nextSettings, updatedAt: timestamp() };
    settingsRef.current = updated;
    pendingSettingsWriteRef.current = updated;
    setSettings(updated);
    const outcome = await saveSettings(workspacePath, updated, base);
    if (outcome.status === "written" && savedNotice) {
      setNotice(savedNotice);
      setNoticeKind("info");
    } else {
      await handleSaveOutcome(outcome, "workspace settings");
    }
  }

  async function persistMembers(nextMembers: Member[], baseMembers: Member[]) {
    if (!workspacePath) {
      return;
    }
    const ours: MembersFile = { schemaVersion: 1, members: nextMembers, updatedAt: timestamp() };
    const base: MembersFile = { schemaVersion: 1, members: baseMembers, updatedAt: membersVersionRef.current };
    const outcome = await saveMembers(workspacePath, ours, base);
    if (outcome.status === "written") {
      membersVersionRef.current = ours.updatedAt;
    }
    await handleSaveOutcome(outcome, "members list");
  }

  async function persistCard(nextCard: Card, previous?: Card): Promise<SaveOutcome | null> {
    if (!workspacePath) {
      return null;
    }
    pendingCardWriteRef.current[nextCard.id] = nextCard.updatedAt;
    const outcome = await saveCard(workspacePath, nextCard, previous);
    setCards((current) => upsertById(current, nextCard));
    if (outcome.status === "written") {
      // A clean write to the open card becomes the new merge ancestor for the
      // editor. Immediately-persisted actions (posting a comment, adding an
      // attachment, toggling a step) bump the card's version on disk without
      // touching the editor draft; without advancing the base here, the next
      // editor Save would compare its stale open-time base against the newer
      // disk copy, "conflict", cleanly three-way-merge, and falsely report
      // "Merged edits from another device" for the device's own edits.
      if (nextCard.id === selectedCardIdRef.current) {
        editorBaseRef.current = nextCard;
      }
    } else {
      // A merge/restore/conflict changed disk; drop the self-write marker so the
      // reload actually applies the reconciled card instead of our local draft,
      // and mark it reconciled so that reload doesn't warn "changed on disk".
      delete pendingCardWriteRef.current[nextCard.id];
      reconciledOpenCardRef.current = nextCard.id;
      await handleSaveOutcome(outcome, "card");
    }
    return outcome;
  }

  async function addBoard(groupId?: string) {
    openTextDialog({
      title: "Create board",
      label: "Board name",
      value: "",
      confirmLabel: "Create board",
      validate: (name) =>
        boards.some((board) => board.name.trim().toLowerCase() === name.toLowerCase())
          ? "A board with this name already exists."
          : null,
      onSubmit: async (name) => {
        // Append below the boards already in the target category so a new board
        // lands at the bottom of a manually-curated list instead of the top.
        const scope = boardsRef.current.filter((item) => effectiveGroupId(item) === groupId);
        const board = { ...createBoard(name), groupId, order: nextOrderForList(scope) };
        await persistBoard(board);
        setActiveBoardId(board.id);
        setView("board");
      }
    });
  }

  async function renameBoard(board: Board) {
    openTextDialog({
      title: "Rename board",
      label: "Board name",
      value: board.name,
      confirmLabel: "Save board",
      validate: (name) =>
        boards.some((item) => item.id !== board.id && item.name.trim().toLowerCase() === name.toLowerCase())
          ? "A board with this name already exists."
          : null,
      onSubmit: async (name) => {
        await persistBoard({ ...board, name, updatedAt: timestamp() });
      }
    });
  }

  async function removeBoard(board: Board) {
    if (!workspacePath) {
      return;
    }
    openConfirmDialog({
      title: "Delete board",
      message: `Delete board "${board.name}" and all its cards?`,
      confirmLabel: "Delete board",
      destructive: true,
      onConfirm: async () => {
        const boardCards = cards.filter((card) => card.boardId === board.id);
        const cardOutcomes = await Promise.all(boardCards.map((card) => deleteCard(workspacePath, card)));
        const boardOutcome = await deleteBoard(workspacePath, board);
        const conflict = [...cardOutcomes, boardOutcome].find((outcome) => outcome.status === "conflict");
        if (conflict) {
          // A card or the board itself was edited on another device: its copy was
          // preserved and the delete refused. Reload to show exactly what
          // survived on disk instead of optimistically clearing everything.
          await handleSaveOutcome(conflict, "board", "delete");
          return;
        }
        setCards((current) => current.filter((card) => card.boardId !== board.id));
        setBoards((current) => current.filter((item) => item.id !== board.id));
        setActiveBoardId((current) => (current === board.id ? "" : current));
      }
    });
  }

  async function createBoardGroup() {
    if (!settings) {
      return;
    }

    openTextDialog({
      title: "Create category",
      label: "Category name",
      value: "",
      confirmLabel: "Create category",
      validate: (name) =>
        boardGroups.some((group) => group.name.trim().toLowerCase() === name.toLowerCase())
          ? "A category with this name already exists."
          : null,
      onSubmit: async (name) => {
        const now = timestamp();
        const group: BoardGroup = {
          id: makeId("group"),
          name,
          createdAt: now,
          updatedAt: now
        };
        await persistWorkspaceSettings({ ...settings, boardGroups: [...boardGroups, group] }, "Category created.");
      }
    });
  }

  async function renameBoardGroup(group: BoardGroup) {
    if (!settings) {
      return;
    }

    openTextDialog({
      title: "Rename category",
      label: "Category name",
      value: group.name,
      confirmLabel: "Save category",
      validate: (name) =>
        boardGroups.some((item) => item.id !== group.id && item.name.trim().toLowerCase() === name.toLowerCase())
          ? "A category with this name already exists."
          : null,
      onSubmit: async (name) => {
        await persistWorkspaceSettings({
          ...settings,
          boardGroups: boardGroups.map((item) => item.id === group.id ? { ...item, name, updatedAt: timestamp() } : item)
        }, "Category renamed.");
      }
    });
  }

  async function deleteBoardGroup(group: BoardGroup) {
    if (!workspacePath || !settings) {
      return;
    }

    const groupedBoards = boards.filter((board) => board.groupId === group.id);
    openConfirmDialog({
      title: "Delete category",
      message: `Delete category "${group.name}"? Its boards will move to Ungrouped.`,
      confirmLabel: "Delete category",
      destructive: true,
      onConfirm: async () => {
        const nextSettings = {
          ...settings,
          boardGroups: boardGroups.filter((item) => item.id !== group.id)
        };
        const now = timestamp();
        const nextBoards = groupedBoards.map((board) => ({ ...board, groupId: undefined, updatedAt: now }));
        await Promise.all([
          persistWorkspaceSettings(nextSettings, "Category deleted."),
          ...nextBoards.map((board) => persistBoard(board))
        ]);
      }
    });
  }

  async function moveBoardToGroup(board: Board, groupId?: string) {
    if (board.groupId === groupId) {
      return;
    }
    await persistBoard({ ...board, groupId, updatedAt: timestamp() });
  }

  // The category a board actually renders under: its `groupId`, or undefined when
  // that group no longer exists (such boards fall into the "Ungrouped" section).
  // Mirrors the split in `boardNavSections`.
  function effectiveGroupId(board: Board): string | undefined {
    return board.groupId && boardGroups.some((group) => group.id === board.groupId) ? board.groupId : undefined;
  }

  // Reorder a board within the sidebar when it's dragged, optionally moving it
  // into a different category. `index` is the drop position among the target
  // category's other boards (sorted by order). Reuses the card ordering scheme:
  // the moved board gets a fractional/appended order and any siblings that must
  // shift to stay distinct are rewritten first.
  async function moveBoard(boardId: string, groupId: string | undefined, index: number) {
    const board = boardsRef.current.find((item) => item.id === boardId);
    if (!board) {
      return;
    }
    const targetGroupId = groupId && boardGroups.some((group) => group.id === groupId) ? groupId : undefined;
    const sameGroup = effectiveGroupId(board) === targetGroupId;

    const siblings = boardsRef.current
      .filter((item) => item.id !== boardId && effectiveGroupId(item) === targetGroupId)
      .sort(compareBoardsByOrder);
    const placement = placeInList(siblings, index);

    if (sameGroup && placement.rebalance.length === 0 && board.order === placement.order) {
      return;
    }

    try {
      for (const change of placement.rebalance) {
        const sibling = boardsRef.current.find((item) => item.id === change.id);
        if (sibling) {
          await persistBoard({ ...sibling, order: change.order, updatedAt: timestamp() });
        }
      }
      await persistBoard({ ...board, groupId: targetGroupId, order: placement.order, updatedAt: timestamp() });
    } catch (reason) {
      setError(`Move failed: ${errorText(reason)}`);
    }
  }

  async function addList() {
    if (!activeBoard) {
      return;
    }
    openTextDialog({
      title: "Add list",
      label: "List name",
      value: "",
      confirmLabel: "Add list",
      validate: (name) =>
        activeBoard.lists.some((item) => item.name.trim().toLowerCase() === name.toLowerCase())
          ? "A list with this name already exists."
          : null,
      onSubmit: async (name) => {
        const list: BoardList = { id: makeId("list"), name };
        await persistBoard({ ...activeBoard, lists: [...activeBoard.lists, list], updatedAt: timestamp() });
      }
    });
  }

  async function renameList(list: BoardList) {
    if (!activeBoard) {
      return;
    }
    openTextDialog({
      title: "Rename list",
      label: "List name",
      value: list.name,
      confirmLabel: "Save list",
      validate: (name) =>
        activeBoard.lists.some((item) => item.id !== list.id && item.name.trim().toLowerCase() === name.toLowerCase())
          ? "A list with this name already exists."
          : null,
      onSubmit: async (name) => {
        await persistBoard({
          ...activeBoard,
          lists: activeBoard.lists.map((item) => (item.id === list.id ? { ...item, name } : item)),
          updatedAt: timestamp()
        });
      }
    });
  }

  async function toggleListCollapsed(list: BoardList) {
    if (!activeBoard) {
      return;
    }
    await persistBoard({
      ...activeBoard,
      lists: activeBoard.lists.map((item) =>
        item.id === list.id ? { ...item, collapsed: !item.collapsed } : item
      ),
      updatedAt: timestamp()
    });
  }

  async function deleteList(list: BoardList) {
    if (!activeBoard) {
      return;
    }
    const board = activeBoard;
    openConfirmDialog({
      title: "Delete list",
      message: `Delete list "${list.name}"? Cards in this list will be archived.`,
      confirmLabel: "Delete list",
      destructive: true,
      onConfirm: async () => {
        const now = timestamp();
        const nextCards = cards.map((card) =>
          card.boardId === board.id && card.listId === list.id
            ? addActivity({ ...card, archived: true, updatedAt: now }, "archived", `Archived when ${list.name} was deleted`)
            : card
        );
        const changedCards = nextCards.filter((card, index) => card !== cards[index]);
        await Promise.all(changedCards.map((card) => persistCard(card, cards.find((item) => item.id === card.id))));
        await persistBoard({
          ...board,
          lists: board.lists.filter((item) => item.id !== list.id),
          updatedAt: now
        });
      }
    });
  }

  async function moveList(listId: string, index: number) {
    if (!activeBoard) {
      return;
    }
    const list = activeBoard.lists.find((item) => item.id === listId);
    if (!list) {
      return;
    }

    const otherLists = activeBoard.lists.filter((item) => item.id !== listId);
    const clampedIndex = Math.max(0, Math.min(index, otherLists.length));
    const nextLists = [...otherLists];
    nextLists.splice(clampedIndex, 0, list);

    if (nextLists.every((item, position) => item.id === activeBoard.lists[position]?.id)) {
      return;
    }

    try {
      await persistBoard({ ...activeBoard, lists: nextLists, updatedAt: timestamp() });
    } catch (reason) {
      setError(`Move list failed: ${errorText(reason)}`);
    }
  }

  async function addCard(listId: string) {
    if (!activeBoard) {
      return;
    }
    openTextDialog({
      title: "Add card",
      label: "Card title",
      value: "",
      confirmLabel: "Add card",
      onSubmit: async (title) => {
        const listCards = cards.filter((item) => item.boardId === activeBoard.id && item.listId === listId && !item.archived);
        const card = { ...createCard(activeBoard.id, listId, title), order: nextOrderForList(listCards) };
        await persistCard(card);
        setSelectedCardMode("edit");
        setSelectedCardId(card.id);
      }
    });
  }

  async function archiveCard(card: Card) {
    try {
      const archived = addActivity({ ...card, archived: true }, "archived", "Archived card");
      await persistCard(archived, card);
      setSelectedCardId(null);
    } catch (reason) {
      setError(`Archive failed: ${errorText(reason)}`);
    }
  }

  async function removeCard(card: Card) {
    if (!workspacePath) {
      return;
    }
    openConfirmDialog({
      title: "Delete card",
      message: `Delete card "${card.title}"? This removes the card file from disk.`,
      confirmLabel: "Delete card",
      destructive: true,
      onConfirm: async () => {
        try {
          const outcome = await deleteCard(workspacePath, card);
          if (outcome.status !== "written") {
            // Edited elsewhere since we loaded it: the copy was preserved and the
            // delete refused. Suppress the generic "changed on disk" notice for
            // this open card so the specific "not deleted" conflict message shows,
            // then surface it and reload rather than dropping the card.
            reconciledOpenCardRef.current = card.id;
            await handleSaveOutcome(outcome, "card", "delete");
            return;
          }
          setCards((current) => current.filter((item) => item.id !== card.id));
          setSelectedCardId(null);
        } catch (reason) {
          setError(`Delete failed: ${errorText(reason)}`);
        }
      }
    });
  }

  // Move a card to `listId`, landing at `index` among that list's other cards
  // (append when omitted). Handles both cross-list moves and precise in-list
  // reordering: the moved card gets a new `order`, and any siblings that must
  // shift to keep the sequence distinct are rewritten silently first.
  async function moveCard(cardId: string, listId: string, index?: number) {
    const card = cards.find((item) => item.id === cardId);
    if (!card || !activeBoard) {
      return;
    }

    const sameList = card.listId === listId;
    const siblings = cards
      .filter((item) => item.boardId === activeBoard.id && item.listId === listId && !item.archived && item.id !== cardId)
      .sort(compareCardsByOrder);
    const placement = placeInList(siblings, index ?? siblings.length);

    if (sameList && placement.rebalance.length === 0 && card.order === placement.order) {
      return;
    }

    const list = activeBoard.lists.find((item) => item.id === listId);
    const previousList = activeBoard.lists.find((item) => item.id === card.listId);
    try {
      for (const change of placement.rebalance) {
        const sibling = cards.find((item) => item.id === change.id);
        if (sibling) {
          await persistCard({ ...sibling, order: change.order, updatedAt: timestamp() }, sibling);
        }
      }

      const moved = sameList
        ? { ...card, order: placement.order, updatedAt: timestamp() }
        : addActivity({ ...card, listId, order: placement.order }, "moved", `Moved from ${previousList?.name ?? "Unknown"} to ${list?.name ?? "Unknown"}`);
      const result = await persistCard(moved, card);

      const movedListName = list?.name ?? "";
      const configuredListNames = settingsRef.current?.slackMovedToListNames ?? "";
      if (result && result.status !== "conflict" && !sameList && listNameTriggersMoveNotification(movedListName, configuredListNames)) {
        await sendSlack(null, `➡️ Card moved to ${movedListName}: ${moved.title}\nAssigned to: ${assigneeSlackTags(moved)}\nBoard: ${activeBoard.name}${actorSlackLine()}`);
      }
    } catch (reason) {
      setError(`Move failed: ${errorText(reason)}`);
    }
  }

  // Open a card from a cross-board view: focus its board so the
  // editor has the right board/list context, then open the editor over the view.
  function openCardFromWorkspaceView(card: Card) {
    setActiveBoardId(card.boardId);
    setSelectedCardMode("view");
    setSelectedCardId(card.id);
  }

  function openCardFromBoard(cardId: string) {
    setSelectedCardMode("view");
    setSelectedCardId(cardId);
  }

  // Resolve a shared card link (`limn://card/<id>`) and open the card. The link
  // carries only the id, so we look through the workspaces the user has open:
  // the active one first (already in memory), then the rest via the backend's
  // file check. Switching a tab reloads it and opens the card in one step.
  async function handleDeepLink(url: string) {
    const cardId = parseCardDeepLink(url);
    if (!cardId) {
      return;
    }
    const activePath = workspacePathRef.current;
    const inActive = cardsRef.current.find((card) => card.id === cardId);
    if (inActive) {
      openCardFromWorkspaceView(inActive);
      return;
    }
    const otherPaths = openWorkspacesRef.current
      .map((workspace) => workspace.path)
      .filter((path) => path && path !== activePath);
    const foundPath = otherPaths.length > 0 ? await findCardWorkspace(cardId, otherPaths) : null;
    if (!foundPath) {
      setNotice(
        "That card link points to a card that isn't in any of your open workspaces. Open the workspace that has it, then click the link again."
      );
      setNoticeKind("warning");
      return;
    }
    await switchWorkspace(foundPath, cardId);
  }

  function openDueReminderFilter() {
    setView("filter");
    setFilterRequest((current) => ({
      id: (current?.id ?? 0) + 1,
      filter: { ...EMPTY_FILTER, due: "soon", sort: "due" }
    }));
  }

  // Saved views live in workspace settings so they are folder-synced and shared
  // by everyone on the workspace. The Filter view owns filter state and hands the
  // current filter here to be named and persisted.
  const savedViews = settings?.savedViews ?? [];

  function saveFilterView(filter: CardFilter) {
    if (!settings) {
      return;
    }
    openTextDialog({
      title: "Save view",
      label: "View name",
      value: "",
      confirmLabel: "Save view",
      validate: (name) =>
        savedViews.some((view) => view.name.trim().toLowerCase() === name.toLowerCase())
          ? "A saved view with this name already exists."
          : null,
      onSubmit: async (name) => {
        const now = timestamp();
        const view: SavedView = { id: makeId("view"), name, filter, createdAt: now, updatedAt: now };
        await persistWorkspaceSettings({ ...settings, savedViews: [...savedViews, view] }, "View saved.");
      }
    });
  }

  function renameFilterView(view: SavedView) {
    if (!settings) {
      return;
    }
    openTextDialog({
      title: "Rename view",
      label: "View name",
      value: view.name,
      confirmLabel: "Save view",
      validate: (name) =>
        savedViews.some((item) => item.id !== view.id && item.name.trim().toLowerCase() === name.toLowerCase())
          ? "A saved view with this name already exists."
          : null,
      onSubmit: async (name) => {
        await persistWorkspaceSettings({
          ...settings,
          savedViews: savedViews.map((item) => (item.id === view.id ? { ...item, name, updatedAt: timestamp() } : item))
        }, "View renamed.");
      }
    });
  }

  function deleteFilterView(view: SavedView) {
    if (!settings) {
      return;
    }
    openConfirmDialog({
      title: "Delete view",
      message: `Delete saved view "${view.name}"?`,
      confirmLabel: "Delete view",
      destructive: true,
      onConfirm: async () => {
        await persistWorkspaceSettings({
          ...settings,
          savedViews: savedViews.filter((item) => item.id !== view.id)
        }, "View deleted.");
      }
    });
  }

  // Export every non-archived card that has a due date to an .ics file inside the
  // workspace. Written into `exports/` so it stays part of the synced folder.
  async function exportDueCalendar() {
    if (!workspacePath) {
      return;
    }
    const entries: CalendarEntry[] = cards
      .filter((card) => !card.archived && card.due)
      .map((card) => ({
        uid: card.id,
        title: card.title,
        due: card.due,
        completed: card.completed,
        description: `${boardName(card.boardId)} · ${listName(card.boardId, card.listId)}`
      }));
    if (entries.length === 0) {
      setNotice("No cards have a due date to export yet.");
      setNoticeKind("warning");
      return;
    }
    try {
      const content = buildCalendar(entries, `${settings?.workspaceName ?? "Limn"} — Due dates`);
      const relativePath = await exportCalendar(workspacePath, content);
      setNotice(`Exported ${countLabel(entries.length, "due date")} to ${relativePath}.`);
      setNoticeKind("info");
    } catch (reason) {
      setError(`Calendar export failed: ${errorText(reason)}`);
    }
  }

  async function toggleSubtask(cardId: string, subtaskId: string, completed: boolean) {
    const card = cards.find((item) => item.id === cardId);
    if (!card) {
      return;
    }
    const subtask = card.subtasks.find((item) => item.id === subtaskId);
    const next = {
      ...card,
      subtasks: card.subtasks.map((subtask) => (subtask.id === subtaskId ? { ...subtask, completed } : subtask)),
      updatedAt: timestamp()
    };
    try {
      await persistCard(next, card);
      if (completed && subtask && !subtask.completed) {
        await sendSlack("subtaskCompleted", `☑️ Step completed: ${subtask.title || "Untitled step"}\nCard: ${card.title}\nAssigned to: ${assigneeSlackTags(card)}\nBoard: ${boardName(card.boardId)}${actorSlackLine()}`);
      }
    } catch (reason) {
      setError(`Sub-task update failed: ${errorText(reason)}`);
    }
  }

  // Attachments are file-backed, so add/remove persist immediately rather than
  // riding along with the editor's Save. Copy each source into the workspace,
  // then record the change (and an activity entry) on the card. Sources come
  // either from the native picker or from an OS file-drop.
  async function attachSourcesToCard(cardId: string, sources: string[]) {
    const card = cards.find((item) => item.id === cardId);
    if (!card || !workspacePath || sources.length === 0) {
      return;
    }
    try {
      const added: Attachment[] = [];
      for (const source of sources) {
        const id = makeId("att");
        const name = attachmentDisplayName(source);
        const storedName = attachmentStoredName(id, name);
        const size = await addAttachmentFile(workspacePath, cardId, storedName, source);
        added.push({ id, name, storedName, size, addedAt: timestamp() });
      }
      const message = added.length === 1 ? `Attached ${added[0].name}` : `Attached ${added.length} files`;
      const next = addActivity({ ...card, attachments: [...card.attachments, ...added] }, "updated", message);
      await persistCard(next, card);
    } catch (reason) {
      setError(`Attachment failed: ${errorText(reason)}`);
    }
  }

  async function attachFilesToCard(cardId: string) {
    await attachSourcesToCard(cardId, await pickAttachmentFiles());
  }

  // Refreshed every render so the once-subscribed drop listener always attaches
  // against current state, whichever card the drop resolves to.
  attachToCardRef.current = (cardId: string, paths: string[]) => void attachSourcesToCard(cardId, paths);

  async function removeAttachmentFromCard(cardId: string, attachment: Attachment) {
    const card = cards.find((item) => item.id === cardId);
    if (!card || !workspacePath) {
      return;
    }
    try {
      await deleteAttachmentFile(workspacePath, cardId, attachment.storedName);
      const next = addActivity(
        { ...card, attachments: card.attachments.filter((item) => item.id !== attachment.id) },
        "updated",
        `Removed attachment ${attachment.name}`
      );
      await persistCard(next, card);
    } catch (reason) {
      setError(`Remove attachment failed: ${errorText(reason)}`);
    }
  }

  async function openCardAttachment(cardId: string, attachment: Attachment) {
    if (!workspacePath) {
      return;
    }
    try {
      await openAttachmentFile(workspacePath, cardId, attachment.storedName);
    } catch (reason) {
      setError(`Open attachment failed: ${errorText(reason)}`);
    }
  }

  async function revealCardAttachment(cardId: string, attachment: Attachment) {
    if (!workspacePath) {
      return;
    }
    try {
      await revealAttachmentFile(workspacePath, cardId, attachment.storedName);
    } catch (reason) {
      setError(`Reveal attachment failed: ${errorText(reason)}`);
    }
  }

  // Comments, like attachments, persist immediately as they are posted and are
  // not part of the editor draft. Adding one bumps updatedAt so the card file
  // reflects the new discussion state and watch-refresh reconciliation matches
  // our own write.
  async function addComment(cardId: string, body: string) {
    const card = cards.find((item) => item.id === cardId);
    const author = resolveActiveMember(membersRef.current, activeMemberId);
    const trimmed = body.trim();
    if (!card || !workspacePath || !author || !trimmed) {
      return;
    }
    try {
      const comment = createComment(author.id, author.name, trimmed);
      const next = { ...card, comments: [...card.comments, comment], updatedAt: timestamp() };
      await persistCard(next, card);
    } catch (reason) {
      setError(`Comment failed: ${errorText(reason)}`);
    }
  }

  async function editComment(cardId: string, commentId: string, body: string) {
    const card = cards.find((item) => item.id === cardId);
    const trimmed = body.trim();
    if (!card || !workspacePath || !trimmed) {
      return;
    }
    try {
      const now = timestamp();
      const next = {
        ...card,
        comments: card.comments.map((comment) => (comment.id === commentId ? { ...comment, body: trimmed, editedAt: now } : comment)),
        updatedAt: now
      };
      await persistCard(next, card);
    } catch (reason) {
      setError(`Comment edit failed: ${errorText(reason)}`);
    }
  }

  async function deleteComment(cardId: string, commentId: string) {
    const card = cards.find((item) => item.id === cardId);
    if (!card || !workspacePath) {
      return;
    }
    try {
      const next = { ...card, comments: card.comments.filter((comment) => comment.id !== commentId), updatedAt: timestamp() };
      await persistCard(next, card);
    } catch (reason) {
      setError(`Comment delete failed: ${errorText(reason)}`);
    }
  }

  // The active member is who *you* are on this device; the choice is stored
  // locally (never in the synced workspace) so each person on a shared folder
  // keeps their own identity. See lib/identity.ts.
  function selectActiveMember(memberId: string) {
    writeActiveMemberId(workspacePath, memberId);
    setActiveMemberId(memberId);
  }

  async function saveCardFromEditor(nextCard: Card) {
    const live = cards.find((card) => card.id === nextCard.id);
    // The merge ancestor is the version the editor opened from, not the live
    // (possibly disk-refreshed) copy — that is what makes an external edit landing
    // mid-session merge cleanly rather than get overwritten.
    const previous = editorBaseRef.current ?? live;
    // Attachments and comments are persisted immediately and aren't tracked in
    // the editor draft, so keep the live copy's lists instead of the draft's
    // stale ones.
    const normalized = {
      ...nextCard,
      attachments: live?.attachments ?? nextCard.attachments,
      comments: live?.comments ?? nextCard.comments,
      // Discard blank checklist steps (e.g. from clicking "Add step" without
      // typing) so they don't clutter the card or skew its "N of M complete"
      // count. A step is kept if it carries a title, a link, or list content.
      subtasks: nextCard.subtasks.filter(
        (subtask) =>
          subtask.title.trim().length > 0 ||
          subtask.url.trim().length > 0 ||
          subtask.items.some((item) => item.text.trim().length > 0 || item.url.trim().length > 0)
      ),
      updatedAt: timestamp()
    };
    let withActivity = previous ? normalized : addActivity(normalized, "created", "Created card");
    const slackMessages: Array<{ key: SlackNotificationKey; message: string }> = [];

    if (previous && previous.completed !== normalized.completed && normalized.completed) {
      withActivity = addActivity(withActivity, "completed", "Marked complete");
      slackMessages.push({
        key: "cardCompleted",
        message: `✅ Task completed: ${normalized.title}\nAssigned to: ${assigneeSlackTags(normalized)}\nBoard: ${boardName(normalized.boardId)}${actorSlackLine()}`
      });
    }

    if (previous && previous.assignees.join(",") !== normalized.assignees.join(",")) {
      withActivity = addActivity(withActivity, "assigned", `Assigned to ${assigneeNames(normalized)}`);
      slackMessages.push({
        key: "cardAssigned",
        message: `👤 Card assigned: ${normalized.title}\nAssigned to: ${assigneeSlackTags(normalized)}\nBoard: ${boardName(normalized.boardId)}${actorSlackLine()}`
      });
    }

    if (previous) {
      const previousSubtasks = new Map(previous.subtasks.map((subtask) => [subtask.id, subtask]));
      for (const subtask of normalized.subtasks) {
        if (subtask.completed && previousSubtasks.get(subtask.id)?.completed === false) {
          slackMessages.push({
            key: "subtaskCompleted",
            message: `☑️ Step completed: ${subtask.title || "Untitled step"}\nCard: ${normalized.title}\nAssigned to: ${assigneeSlackTags(normalized)}\nBoard: ${boardName(normalized.boardId)}${actorSlackLine()}`
          });
        }
      }
    }

    const result = await persistCard(withActivity, previous);
    if (result && result.status === "written") {
      // Clean save: our version is now the ancestor for any follow-up edit in the
      // same session. (After a merge/conflict the reload supplies a fresh base.)
      editorBaseRef.current = withActivity;
    }
    if (result && result.status !== "conflict") {
      for (const slackMessage of slackMessages) {
        await sendSlack(slackMessage.key, slackMessage.message);
      }
    }
  }

  async function saveMember(member: Member) {
    if (!workspacePath) {
      return;
    }
    const baseMembers = members;
    const nextMembers = upsertById(members, member);
    pendingMembersWriteRef.current = nextMembers;
    setMembers(nextMembers);
    await persistMembers(nextMembers, baseMembers);
  }

  async function removeMember(memberId: string) {
    if (!workspacePath) {
      return;
    }
    const member = members.find((item) => item.id === memberId);
    if (!member) {
      return;
    }
    const assignedCards = cards.filter((card) => card.assignees.includes(memberId));
    const assignedNote = assignedCards.length
      ? ` They'll be unassigned from ${countLabel(assignedCards.length, "card")}.`
      : "";
    openConfirmDialog({
      title: "Remove member",
      message: `Remove "${member.name}" from this workspace?${assignedNote}`,
      confirmLabel: "Remove member",
      destructive: true,
      onConfirm: async () => {
        const baseMembers = members;
        const nextMembers = members.filter((item) => item.id !== memberId);
        pendingMembersWriteRef.current = nextMembers;
        setMembers(nextMembers);
        // Drop this device's identity if the removed member was who "you" are.
        if (activeMemberId === memberId) {
          selectActiveMember("");
        }
        await persistMembers(nextMembers, baseMembers);
        // Clear stale assignee references so the id can't silently resurrect the
        // assignment if a same-named member is later re-added.
        for (const card of assignedCards) {
          const unassigned = addActivity(
            { ...card, assignees: card.assignees.filter((id) => id !== memberId), updatedAt: timestamp() },
            "assigned",
            `Unassigned ${member.name} (removed from workspace)`
          );
          await persistCard(unassigned, card);
        }
      }
    });
  }

  async function saveWorkspaceSettings(nextSettings: WorkspaceSettings) {
    await persistWorkspaceSettings(nextSettings, "Settings saved.");
  }

  // `notification` gates the send on a per-event toggle; pass null when the
  // caller has already decided the event should fire (e.g. the move-to-list
  // notification, which is gated by its configured list names instead).
  async function sendSlack(notification: SlackNotificationKey | null, message: string) {
    const currentSettings = settingsRef.current;
    const webhookUrl = currentSettings?.slackWebhookUrl.trim();
    if (notification && currentSettings?.slackNotifications?.[notification] === false) {
      return;
    }
    if (!webhookUrl) {
      return;
    }
    try {
      await postSlack(webhookUrl, message);
    } catch (reason) {
      setError(`Slack notification failed: ${errorText(reason)}`);
    }
  }

  function assigneeNames(card: Card) {
    if (card.assignees.length === 0) {
      return "Unassigned";
    }
    return card.assignees.map((id) => members.find((member) => member.id === id)?.name ?? id).join(", ");
  }

  function assigneeSlackTags(card: Card) {
    if (card.assignees.length === 0) {
      return "Unassigned";
    }
    return card.assignees.map((id) => {
      const member = members.find((item) => item.id === id);
      return slackTag(member?.slackHandle) || member?.name || id;
    }).join(", ");
  }

  // Trailing "By: …" line naming who performed the action, drawn from the active
  // member (who you are). Empty when no identity is set, so the line is omitted
  // rather than reported as an unknown actor.
  function actorSlackLine() {
    if (!activeMember) {
      return "";
    }
    return `\nBy: ${slackTag(activeMember.slackHandle) || activeMember.name}`;
  }

  function boardName(boardId: string) {
    return boards.find((board) => board.id === boardId)?.name ?? "Unknown board";
  }

  function listName(boardId: string, listId: string) {
    return boards.find((board) => board.id === boardId)?.lists.find((list) => list.id === listId)?.name ?? "Unknown list";
  }

  function openTextDialog(nextDialog: TextDialogState) {
    setTextDialog(nextDialog);
  }

  function openConfirmDialog(nextDialog: ConfirmDialogState) {
    setConfirmDialog(nextDialog);
  }

  const openContextMenu: OpenContextMenu = (event, items, label) => {
    const hasEnabledAction = items.some((item) => item.type !== "separator" && !item.disabled);
    if (!hasEnabledAction) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 240;
    const estimatedHeight = Math.min(380, 10 + items.length * 36);
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - estimatedHeight - 8)),
      label,
      items
    });
  };

  function handleDefaultContextMenu(event: ReactMouseEvent<HTMLElement>) {
    const target = event.target;
    if (isEditableTextControl(target)) {
      openContextMenu(event, textControlContextItems(target));
      return;
    }

    openContextMenu(event, workspaceContextItems());
  }

  function workspaceContextItems(): ContextMenuItem[] {
    const items: ContextMenuItem[] = [
      { label: "Open workspace", icon: "folder", onSelect: () => void openWorkspace() }
    ];

    if (workspacePath) {
      items.push(
        { label: "Show workspace folder", icon: "folder", onSelect: () => void openWorkspaceFolder(workspacePath) },
        { label: "Reload workspace", icon: "refresh", onSelect: () => void refreshWorkspace() }
      );
    }

    if (settings) {
      items.push(
        { type: "separator" },
        { label: "Filter cards", icon: "search", onSelect: () => setView("filter") },
        { label: "Create board", icon: "plus", onSelect: () => void addBoard() },
        { label: "Create category", icon: "tag", onSelect: () => void createBoardGroup() },
        { label: "Members", icon: "users", onSelect: () => setView("members") },
        { label: "Settings", icon: "settings", onSelect: () => setView("settings") },
        {
          label: themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode",
          icon: themeMode === "dark" ? "sun" : "moon",
          onSelect: () => setThemeMode((current) => (current === "dark" ? "light" : "dark"))
        }
      );
    }

    return items;
  }

  function boardNavContextItems(board: Board): ContextMenuItem[] {
    const groupItems = boardGroups.map<ContextMenuItem>((group) => ({
      label: `Move to ${group.name}`,
      icon: "tag",
      disabled: board.groupId === group.id,
      onSelect: () => void moveBoardToGroup(board, group.id)
    }));

    return [
      {
        label: "Open board",
        icon: "folder",
        onSelect: () => {
          setActiveBoardId(board.id);
          setView("board");
        }
      },
      { label: "Rename board", icon: "edit", onSelect: () => void renameBoard(board) },
      { label: "Copy board name", icon: "copy", onSelect: () => void copyText(board.name) },
      { type: "separator" },
      ...(board.groupId ? [{ label: "Move to Ungrouped", icon: "tag", onSelect: () => void moveBoardToGroup(board) } satisfies ContextMenuItem] : []),
      ...groupItems,
      ...(boardGroups.length === 0 ? [{ label: "Create category", icon: "tag", onSelect: () => void createBoardGroup() } satisfies ContextMenuItem] : []),
      { type: "separator" },
      { label: "Delete board", icon: "trash", danger: true, onSelect: () => void removeBoard(board) }
    ];
  }

  function boardGroupContextItems(group: BoardGroup): ContextMenuItem[] {
    return [
      { label: "Create board in category", icon: "plus", onSelect: () => void addBoard(group.id) },
      { label: "Rename category", icon: "edit", onSelect: () => void renameBoardGroup(group) },
      { label: "Copy category name", icon: "copy", onSelect: () => void copyText(group.name) },
      { type: "separator" },
      { label: "Delete category", icon: "trash", danger: true, onSelect: () => void deleteBoardGroup(group) }
    ];
  }

  function identityContextItems(): ContextMenuItem[] {
    if (members.length === 0) {
      return [{ label: "Add members…", icon: "users", onSelect: () => setView("members") }];
    }
    const memberItems = members.map<ContextMenuItem>((member) => ({
      label: activeMemberId === member.id ? `${member.name} (you)` : member.name,
      icon: activeMemberId === member.id ? "check" : "users",
      onSelect: () => selectActiveMember(member.id)
    }));
    return [
      ...memberItems,
      { type: "separator" },
      { label: "Not set", icon: "x", disabled: !activeMemberId, onSelect: () => selectActiveMember("") }
    ];
  }

  async function copyText(text: string) {
    const value = text.trim();
    if (!value || !navigator.clipboard?.writeText) {
      return;
    }
    await navigator.clipboard.writeText(value);
  }

  async function runContextMenuItem(item: ContextMenuItem) {
    if (item.type === "separator" || item.disabled) {
      return;
    }

    setContextMenu(null);
    try {
      await item.onSelect();
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  async function handleMenuCommand(command: string) {
    try {
      switch (command) {
        case "open-workspace":
          await openWorkspace();
          return;
        case "open-workspace-folder":
          if (!workspacePath) {
            showCommandNotice("Open a workspace before showing its folder.", "warning");
            return;
          }
          await openWorkspaceFolder(workspacePath);
          return;
        case "reload-workspace":
          if (!workspacePath) {
            showCommandNotice("Open a workspace before reloading.", "warning");
            return;
          }
          await refreshWorkspace();
          return;
        case "new-board":
          if (!settings) {
            showCommandNotice("Open a workspace before creating a board.", "warning");
            return;
          }
          await addBoard();
          return;
        case "rename-board":
          if (!activeBoard) {
            showCommandNotice("Select a board before renaming.", "warning");
            return;
          }
          await renameBoard(activeBoard);
          return;
        case "delete-board":
          if (!activeBoard) {
            showCommandNotice("Select a board before deleting.", "warning");
            return;
          }
          await removeBoard(activeBoard);
          return;
        case "add-list":
          if (!activeBoard) {
            showCommandNotice("Select a board before adding a list.", "warning");
            return;
          }
          await addList();
          return;
        case "new-card":
          await addCardFromMenu();
          return;
        case "save-card":
          if (!selectedCard) {
            showCommandNotice("Open a card before saving.", "warning");
            return;
          }
          window.dispatchEvent(new Event("limn-save-card-editor"));
          return;
        case "close-card":
          if (!selectedCard) {
            showCommandNotice("No card is open.", "warning");
            return;
          }
          setSelectedCardId(null);
          return;
        case "toggle-card-completed":
          await toggleSelectedCardCompleted();
          return;
        case "archive-card":
          if (!selectedCard) {
            showCommandNotice("Open a card before archiving.", "warning");
            return;
          }
          await archiveCard(selectedCard);
          return;
        case "delete-card":
          if (!selectedCard) {
            showCommandNotice("Open a card before deleting.", "warning");
            return;
          }
          await removeCard(selectedCard);
          return;
        case "show-board":
          if (!activeBoard) {
            showCommandNotice("Create or select a board first.", "warning");
            return;
          }
          setView("board");
          return;
        case "show-filter":
          if (!settings) {
            showCommandNotice("Open a workspace before filtering.", "warning");
            return;
          }
          setView("filter");
          return;
        case "show-members":
          if (!settings) {
            showCommandNotice("Open a workspace before viewing members.", "warning");
            return;
          }
          setView("members");
          return;
        case "show-settings":
          if (!settings) {
            showCommandNotice("Open a workspace before viewing settings.", "warning");
            return;
          }
          setView("settings");
          return;
        case "toggle-theme":
          setThemeMode((current) => (current === "dark" ? "light" : "dark"));
          return;
        case "check-updates":
          await checkForUpdates(true);
          return;
        case "show-help":
          if (settings) {
            setView("settings");
          }
          showCommandNotice("Limn stores boards as JSON and cards as Markdown in the selected workspace folder.", "info");
          return;
      }
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  async function addCardFromMenu() {
    if (!activeBoard) {
      showCommandNotice("Select a board before creating a card.", "warning");
      return;
    }
    const firstList = activeBoard.lists[0];
    if (!firstList) {
      showCommandNotice("Add a list before creating a card.", "warning");
      return;
    }
    await addCard(firstList.id);
  }

  async function toggleSelectedCardCompleted() {
    if (!selectedCard) {
      showCommandNotice("Open a card before changing completion.", "warning");
      return;
    }
    await toggleCardCompleted(selectedCard);
  }

  async function toggleCardCompleted(card: Card) {
    const completed = !card.completed;
    const next = addActivity(
      { ...card, completed, updatedAt: timestamp() },
      completed ? "completed" : "updated",
      completed ? "Marked complete" : "Marked incomplete"
    );
    const result = await persistCard(next, card);
    // Completing a card from the board (checkbox, context menu, or keyboard
    // shortcut) must notify Slack just like completing it from the editor does.
    if (completed && result && result.status !== "conflict") {
      await sendSlack("cardCompleted", `✅ Task completed: ${next.title}\nAssigned to: ${assigneeSlackTags(next)}\nBoard: ${boardName(next.boardId)}${actorSlackLine()}`);
    }
  }

  function showCommandNotice(message: string, kind: "info" | "warning") {
    if (!workspacePath) {
      setError(message);
      return;
    }
    setNotice(message);
    setNoticeKind(kind);
  }

  const updateBannerVisible = ["available", "downloading", "restart-ready", "error"].includes(updateStatus);
  const updateBannerText = updateBannerMessage(updateStatus, updateInfo, updateMessage, updateProgress);

  if (isLoading) {
    return (
      <div className="center-screen">
        <Spinner />
        Opening Limn…
      </div>
    );
  }

  if (!workspacePath || !settings) {
    return (
      <WelcomeScreen
        desktopRequired={!hasDesktopShell()}
        error={error}
        opening={opening}
        onContextMenu={handleDefaultContextMenu}
        onOpenWorkspace={() => void openWorkspace()}
        contextMenu={contextMenu && (
          <ContextMenu
            menu={contextMenu}
            onClose={() => setContextMenu(null)}
            onPick={(item) => void runContextMenuItem(item)}
          />
        )}
      />
    );
  }

  return (
    <div className="app-frame" onContextMenu={handleDefaultContextMenu}>
      <WindowsTitlebar />
      <WorkspaceTabs
        workspaces={openWorkspaces}
        activePath={workspacePath}
        opening={opening}
        onSelect={(path) => void switchWorkspace(path)}
        onClose={(path) => void closeWorkspace(path)}
        onOpen={() => void openWorkspace()}
        onReorder={reorderWorkspace}
      />
      <div
        className={`app-shell${sidebar.resizing ? " resizing" : ""}`}
        style={{ "--sidebar-width": `${sidebar.width}px` } as CSSProperties}
      >
        <WorkspaceSidebar
          activeBoardId={activeBoard?.id ?? ""}
          activeMember={activeMember}
          boardGroups={boardGroups}
          boardNavSections={boardNavSections}
          boards={boards}
          dueReminders={dueReminders}
          inboxUnread={inboxUnread}
          opening={opening}
          themeMode={themeMode}
          view={view}
          onOpenWorkspace={() => void openWorkspace()}
          onSelectBoard={(boardId) => {
            setActiveBoardId(boardId);
            setView("board");
          }}
          onMoveBoard={(boardId, groupId, index) => void moveBoard(boardId, groupId, index)}
          onBoardContextMenu={(event, board) => openContextMenu(event, boardNavContextItems(board), board.name)}
          onGroupContextMenu={(event, group) => openContextMenu(event, boardGroupContextItems(group), group.name)}
          onCreateBoard={() => void addBoard()}
          onCreateGroup={() => void createBoardGroup()}
          onIdentityContextMenu={(event) => openContextMenu(event, identityContextItems(), "You are")}
          onToggleTheme={() => setThemeMode((current) => (current === "dark" ? "light" : "dark"))}
          onOpenDueReminderFilter={openDueReminderFilter}
          onSetView={setView}
        />

        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuenow={sidebar.width}
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          tabIndex={0}
          title="Drag to resize · double-click to reset"
          data-testid="sidebar-resizer"
          onPointerDown={sidebar.onPointerDown}
          onPointerMove={sidebar.onPointerMove}
          onPointerUp={sidebar.onPointerUp}
          onKeyDown={sidebar.onKeyDown}
          onDoubleClick={sidebar.onDoubleClick}
        />

        <main className="workspace">
        <WorkspaceBanners
          cardsLoading={cardsLoading}
          conflictsCount={conflicts.length}
          error={error}
          notice={notice}
          noticeKind={noticeKind}
          storageHint={storageHint}
          updateBannerText={updateBannerText}
          updateBannerVisible={updateBannerVisible}
          updateStatus={updateStatus}
          onCancelCardLoad={cancelCardLoad}
          onDismissMessage={() => {
            setError("");
            setNotice("");
          }}
          onDismissStorageHint={() => {
            rememberStorageHintDismissed(workspacePath);
            setStorageHint(null);
          }}
          onDismissUpdate={() => {
            setUpdateStatus("idle");
            setUpdateMessage("");
          }}
          onInstallUpdate={() => void installAvailableUpdate()}
          onRestartAfterUpdate={() => void restartAfterUpdate()}
          onReviewConflicts={() => setConflictReviewOpen(true)}
        />

        {view === "board" && activeBoard && (
          <BoardView
            board={activeBoard}
            cards={visibleCards}
            members={members}
            workspacePath={workspacePath}
            dropTargetCardId={dragOverCardId}
            onAddList={addList}
            onRenameBoard={renameBoard}
            onDeleteBoard={removeBoard}
            onRenameList={renameList}
            onDeleteList={deleteList}
            onToggleListCollapsed={toggleListCollapsed}
            onMoveList={moveList}
            onAddCard={addCard}
            onMoveCard={moveCard}
            onOpenCard={openCardFromBoard}
            onToggleSubtask={toggleSubtask}
            onToggleCardCompleted={toggleCardCompleted}
            onArchiveCard={archiveCard}
            onDeleteCard={removeCard}
            onOpenContextMenu={openContextMenu}
            onCopyText={copyText}
          />
        )}
        {view === "board" && !activeBoard && (
          <EmptyState title="No board selected" body="Create a board to start adding lists and cards." action="Create board" onAction={addBoard} />
        )}
        {view === "filter" && (
          <FilterView
            cards={cards}
            boards={boards}
            members={members}
            activeMemberId={activeMemberId}
            savedViews={savedViews}
            requestedFilter={filterRequest}
            onOpenCard={openCardFromWorkspaceView}
            onExportCalendar={exportDueCalendar}
            onSaveView={saveFilterView}
            onRenameView={renameFilterView}
            onDeleteView={deleteFilterView}
            onOpenContextMenu={openContextMenu}
            onCopyText={copyText}
          />
        )}
        {view === "inbox" && (
          <InboxView
            activeMemberId={activeMemberId}
            boards={boards}
            items={inboxItems}
            seenAt={inboxSeenAt}
            onChooseIdentity={() => document.querySelector<HTMLElement>("[data-testid='identity-select']")?.click()}
            onMarkAllRead={() => {
              const seenAt = new Date().toISOString();
              setInboxSeenAt(seenAt);
              try {
                localStorage.setItem(inboxSeenAtKey(workspacePath, activeMemberId), seenAt);
              } catch {
                // Read state is best-effort device-local UI state.
              }
            }}
            onOpenCard={openCardFromWorkspaceView}
          />
        )}
        {view === "members" && (
          <MembersView members={members} onSave={saveMember} onRemove={removeMember} onOpenContextMenu={openContextMenu} onCopyText={copyText} />
        )}
        {view === "settings" && (
          <SettingsView
            settings={settings}
            workspacePath={workspacePath}
            listWidth={listWidth}
            listWidthMode={listWidthMode}
            onChangeListWidth={(value) => setListWidth(clampListWidth(value))}
            onChangeListWidthMode={setListWidthMode}
            onSave={saveWorkspaceSettings}
            onReload={refreshWorkspace}
            updaterAvailable={updaterAvailable}
            updateInfo={updateInfo}
            updateMessage={updateMessage}
            updateProgress={updateProgress}
            updateStatus={updateStatus}
            onCheckForUpdates={checkForUpdates}
            onInstallUpdate={installAvailableUpdate}
            onRestartAfterUpdate={restartAfterUpdate}
            onOpenContextMenu={openContextMenu}
            onCopyText={copyText}
          />
        )}
        </main>

        {selectedCard && (
          <CardEditor
            card={selectedCard}
            workspacePath={workspacePath}
            boards={boards}
            members={members}
            activeMember={activeMember}
            fileDragActive={fileDragActive}
            initialMode={selectedCardMode}
            onSave={saveCardFromEditor}
            onClose={() => setSelectedCardId(null)}
            onArchive={archiveCard}
            onDelete={removeCard}
            onAddAttachments={attachFilesToCard}
            onRemoveAttachment={removeAttachmentFromCard}
            onOpenAttachment={openCardAttachment}
            onRevealAttachment={revealCardAttachment}
            onSelectActiveMember={selectActiveMember}
            onAddComment={addComment}
            onEditComment={editComment}
            onDeleteComment={deleteComment}
            onOpenContextMenu={openContextMenu}
            onCopyText={copyText}
          />
        )}
        {textDialog && (
          <TextDialog
            dialog={textDialog}
            onCancel={() => setTextDialog(null)}
            onChange={(value) => setTextDialog((current) => current ? { ...current, value } : current)}
            onSubmit={async (value) => {
              setTextDialog(null);
              try {
                await textDialog.onSubmit(value);
              } catch (reason) {
                setError(errorText(reason));
              }
            }}
          />
        )}
        {confirmDialog && (
          <ConfirmDialog
            dialog={confirmDialog}
            onCancel={() => setConfirmDialog(null)}
            onConfirm={async () => {
              setConfirmDialog(null);
              try {
                await confirmDialog.onConfirm();
              } catch (reason) {
                setError(errorText(reason));
              }
            }}
          />
        )}
        {contextMenu && (
          <ContextMenu
            menu={contextMenu}
            onClose={() => setContextMenu(null)}
            onPick={(item) => void runContextMenuItem(item)}
          />
        )}
        {conflictReviewOpen && (
          <ConflictReview
            conflicts={conflicts}
            onResolve={(conflict, choice) => void resolveConflict(conflict, choice)}
            onClose={() => setConflictReviewOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
