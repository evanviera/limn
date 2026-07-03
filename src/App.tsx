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
import { listen } from "./ipc";
import {
  addActivity,
  addAttachmentFile,
  attachmentDisplayName,
  attachmentStoredName,
  createBoard,
  createCard,
  deleteAttachmentFile,
  deleteBoard,
  deleteCard,
  getLastWorkspace,
  loadWorkspace,
  makeId,
  normalizeUrl,
  openAttachmentFile,
  openExternal,
  openWorkspaceFolder,
  pickAttachmentFiles,
  pickWorkspaceFolder,
  postSlack,
  saveBoard,
  saveCard,
  saveLastWorkspace,
  saveMembers,
  saveSettings,
  timestamp,
  watchWorkspace
} from "./storage";
import { Attachment, Board, BoardGroup, BoardList, Card, Member, Subtask, SubtaskListItem, View, WorkspaceSettings, WriteResult } from "./types";
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
import { ConfirmDialog, EmptyState, TextDialog } from "./components/dialogs";
import type { ConfirmDialogState, TextDialogState } from "./components/dialogs";
import { ContextMenu, isEditableTextControl, textControlContextItems } from "./components/contextMenu";
import type { ContextMenuItem, ContextMenuState, OpenContextMenu } from "./components/contextMenu";
import { Icon, Spinner } from "./components/icons";
import { MembersView } from "./components/MembersView";
import { SettingsView } from "./components/SettingsView";
import { WindowsTitlebar } from "./components/WindowsTitlebar";
import { THEME_STORAGE_KEY } from "./lib/constants";
import type { SlackNotificationKey, ThemeMode } from "./lib/constants";
import { countLabel, errorText, readStoredThemeMode, sameJson, selectActiveBoardId, slackTag, upsertById } from "./lib/format";
import { updateBannerMessage } from "./lib/updateMessages";
import type { UpdateStatus } from "./lib/updateMessages";

const WORKSPACE_WATCH_REFRESH_DELAY_MS = 75;


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
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const settingsRef = useRef<WorkspaceSettings | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [activeBoardId, setActiveBoardId] = useState("");
  const [view, setView] = useState<View>("board");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"info" | "warning">("info");
  const [isLoading, setIsLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [textDialog, setTextDialog] = useState<TextDialogState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [updateInfo, setUpdateInfo] = useState<AppUpdate | null>(null);
  const [updateMessage, setUpdateMessage] = useState("");
  const [updateProgress, setUpdateProgress] = useState<DownloadProgress | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readStoredThemeMode());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const hasCheckedForUpdatesRef = useRef(false);

  const activeBoard = boards.find((board) => board.id === activeBoardId) ?? boards[0] ?? null;
  const selectedCard = cards.find((card) => card.id === selectedCardId) ?? null;
  const updaterAvailable = canUseUpdater();

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
  const membersRef = useRef(members);
  membersRef.current = members;
  const pendingCardWriteRef = useRef<Record<string, string>>({});
  const pendingMembersWriteRef = useRef<Member[] | null>(null);
  const pendingSettingsWriteRef = useRef<WorkspaceSettings | null>(null);
  const watchRefreshTimerRef = useRef<number | null>(null);
  const watchRefreshInFlightRef = useRef(false);
  const watchRefreshPendingRef = useRef(false);
  const visibleCards = useMemo(
    () => cards.filter((card) => !card.archived && card.boardId === activeBoard?.id),
    [activeBoard?.id, cards]
  );
  const boardGroups = settings?.boardGroups ?? [];
  const boardNavSections = useMemo(() => {
    const validGroupIds = new Set(boardGroups.map((group) => group.id));
    const grouped = boardGroups.map((group) => ({
      group,
      boards: boards.filter((board) => board.groupId === group.id)
    }));
    const ungrouped = boards.filter((board) => !board.groupId || !validGroupIds.has(board.groupId));
    return { grouped, ungrouped };
  }, [boardGroups, boards]);

  useEffect(() => {
    void getLastWorkspace()
      .then(async (path) => {
        if (path) {
          await openWorkspace(path);
        }
      })
      .catch(() => undefined)
      .finally(() => setIsLoading(false));
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

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
    void watchWorkspace(workspacePath).catch((reason) => setError(errorText(reason)));
    void listen("workspace-changed", () => {
      scheduleWatchRefresh();
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      unlisten?.();
      clearScheduledWatchRefresh();
    };
  }, [workspacePath]);

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

  async function openWorkspace(path?: string) {
    const selectedPath = path ?? (await pickWorkspaceFolder());
    if (!selectedPath) {
      return;
    }

    setError("");
    setOpening(true);
    try {
      const data = await loadWorkspace(selectedPath);
      setWorkspacePath(selectedPath);
      settingsRef.current = data.settings;
      setSettings(data.settings);
      setMembers(data.membersFile.members);
      setBoards(data.boards);
      setCards(data.cards);
      setActiveBoardId((current) => selectActiveBoardId(current, data.boards));
      setSelectedCardId((current) => (current && data.cards.some((card) => card.id === current) ? current : null));
      setNotice(data.diagnostics.length > 0 ? data.diagnostics.join(" ") : "");
      setNoticeKind(data.diagnostics.length > 0 ? "warning" : "info");
      await saveLastWorkspace(selectedPath);
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

    watchRefreshPendingRef.current = false;
    watchRefreshInFlightRef.current = true;
    try {
      await refreshWorkspace(false);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      watchRefreshInFlightRef.current = false;
      if (watchRefreshPendingRef.current) {
        scheduleWatchRefresh();
      }
    }
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

  async function persistBoard(nextBoard: Board) {
    if (!workspacePath) {
      return;
    }
    setBoards((current) => upsertById(current, nextBoard));
    await saveBoard(workspacePath, nextBoard);
  }

  async function persistWorkspaceSettings(nextSettings: WorkspaceSettings, savedNotice: string) {
    if (!workspacePath) {
      return;
    }
    const updated = { ...nextSettings, updatedAt: timestamp() };
    settingsRef.current = updated;
    pendingSettingsWriteRef.current = updated;
    setSettings(updated);
    await saveSettings(workspacePath, updated);
    if (savedNotice) {
      setNotice(savedNotice);
      setNoticeKind("info");
    }
  }

  async function persistCard(nextCard: Card, previous?: Card): Promise<WriteResult | null> {
    if (!workspacePath) {
      return null;
    }
    const expectedUpdatedAt = previous?.updatedAt;
    pendingCardWriteRef.current[nextCard.id] = nextCard.updatedAt;
    const result = await saveCard(workspacePath, nextCard, expectedUpdatedAt);
    setCards((current) => upsertById(current, nextCard));
    if (result.conflict) {
      setNotice(`Conflict copy written to ${result.relative_path}. Reloading disk state.`);
      setNoticeKind("warning");
      await refreshWorkspace(false);
    }
    return result;
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
        const board = { ...createBoard(name), groupId };
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
        await Promise.all(boardCards.map((card) => deleteCard(workspacePath, card)));
        await deleteBoard(workspacePath, board.id);
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
        setBoards((current) => current.map((board) => nextBoards.find((item) => item.id === board.id) ?? board));
        await Promise.all([
          persistWorkspaceSettings(nextSettings, "Category deleted."),
          ...nextBoards.map((board) => saveBoard(workspacePath, board))
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
        const card = createCard(activeBoard.id, listId, title);
        await persistCard(card);
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
          await deleteCard(workspacePath, card);
          setCards((current) => current.filter((item) => item.id !== card.id));
          setSelectedCardId(null);
        } catch (reason) {
          setError(`Delete failed: ${errorText(reason)}`);
        }
      }
    });
  }

  async function moveCard(cardId: string, listId: string) {
    const card = cards.find((item) => item.id === cardId);
    if (!card || !activeBoard || card.listId === listId) {
      return;
    }
    const list = activeBoard.lists.find((item) => item.id === listId);
    const previousList = activeBoard.lists.find((item) => item.id === card.listId);
    try {
      const moved = addActivity({ ...card, listId }, "moved", `Moved from ${previousList?.name ?? "Unknown"} to ${list?.name ?? "Unknown"}`);
      const result = await persistCard(moved, card);

      if (result && !result.conflict && list?.name.trim().toLowerCase() === "done") {
        await sendSlack("cardMovedToDone", `➡️ Card moved to Done: ${moved.title}\nAssigned to: ${assigneeSlackTags(moved)}\nBoard: ${activeBoard.name}`);
      }
    } catch (reason) {
      setError(`Move failed: ${errorText(reason)}`);
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
        await sendSlack("subtaskCompleted", `☑️ Step completed: ${subtask.title || "Untitled step"}\nCard: ${card.title}\nAssigned to: ${assigneeSlackTags(card)}\nBoard: ${boardName(card.boardId)}`);
      }
    } catch (reason) {
      setError(`Sub-task update failed: ${errorText(reason)}`);
    }
  }

  // Attachments are file-backed, so add/remove persist immediately rather than
  // riding along with the editor's Save. Each copies/deletes the file first, then
  // records the change (and an activity entry) on the card.
  async function attachFilesToCard(cardId: string) {
    const card = cards.find((item) => item.id === cardId);
    if (!card || !workspacePath) {
      return;
    }
    try {
      const sources = await pickAttachmentFiles();
      if (sources.length === 0) {
        return;
      }
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

  async function saveCardFromEditor(nextCard: Card) {
    const previous = cards.find((card) => card.id === nextCard.id);
    // Attachments are persisted immediately and aren't tracked in the editor
    // draft, so keep the live copy's list instead of the draft's stale one.
    const normalized = { ...nextCard, attachments: previous?.attachments ?? nextCard.attachments, updatedAt: timestamp() };
    let withActivity = previous ? normalized : addActivity(normalized, "created", "Created card");
    const slackMessages: Array<{ key: SlackNotificationKey; message: string }> = [];

    if (previous && previous.completed !== normalized.completed && normalized.completed) {
      withActivity = addActivity(withActivity, "completed", "Marked complete");
      slackMessages.push({
        key: "cardCompleted",
        message: `✅ Task completed: ${normalized.title}\nAssigned to: ${assigneeSlackTags(normalized)}\nBoard: ${boardName(normalized.boardId)}`
      });
    }

    if (previous && previous.assignees.join(",") !== normalized.assignees.join(",")) {
      withActivity = addActivity(withActivity, "assigned", `Assigned to ${assigneeNames(normalized)}`);
      slackMessages.push({
        key: "cardAssigned",
        message: `👤 Card assigned: ${normalized.title}\nAssigned to: ${assigneeSlackTags(normalized)}\nBoard: ${boardName(normalized.boardId)}`
      });
    }

    if (previous) {
      const previousSubtasks = new Map(previous.subtasks.map((subtask) => [subtask.id, subtask]));
      for (const subtask of normalized.subtasks) {
        if (subtask.completed && previousSubtasks.get(subtask.id)?.completed === false) {
          slackMessages.push({
            key: "subtaskCompleted",
            message: `☑️ Step completed: ${subtask.title || "Untitled step"}\nCard: ${normalized.title}\nAssigned to: ${assigneeSlackTags(normalized)}\nBoard: ${boardName(normalized.boardId)}`
          });
        }
      }
    }

    const result = await persistCard(withActivity, previous);
    if (result && !result.conflict) {
      for (const slackMessage of slackMessages) {
        await sendSlack(slackMessage.key, slackMessage.message);
      }
    }
  }

  async function saveMember(member: Member) {
    if (!workspacePath) {
      return;
    }
    const nextMembers = upsertById(members, member);
    pendingMembersWriteRef.current = nextMembers;
    setMembers(nextMembers);
    await saveMembers(workspacePath, { schemaVersion: 1, members: nextMembers });
  }

  async function removeMember(memberId: string) {
    if (!workspacePath) {
      return;
    }
    const nextMembers = members.filter((member) => member.id !== memberId);
    pendingMembersWriteRef.current = nextMembers;
    setMembers(nextMembers);
    await saveMembers(workspacePath, { schemaVersion: 1, members: nextMembers });
  }

  async function saveWorkspaceSettings(nextSettings: WorkspaceSettings) {
    await persistWorkspaceSettings(nextSettings, "Settings saved.");
  }

  async function sendSlack(notification: SlackNotificationKey, message: string) {
    const currentSettings = settingsRef.current;
    const webhookUrl = currentSettings?.slackWebhookUrl.trim();
    if (currentSettings?.slackNotifications?.[notification] === false) {
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

  function boardName(boardId: string) {
    return boards.find((board) => board.id === boardId)?.name ?? "Unknown board";
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
    await persistCard(next, card);
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
      <main className="welcome" onContextMenu={handleDefaultContextMenu}>
        <section className="welcome-panel">
          <p className="eyebrow">Limn</p>
          <h1>Local-first boards for a small trusted team.</h1>
          <p className="muted">Choose a folder to create or open a workspace. Limn writes boards and cards as readable files.</p>
          <button className="primary" data-testid="welcome-open-workspace" disabled={opening} onClick={() => void openWorkspace()}>
            {opening ? (
              <>
                <Spinner /> Opening…
              </>
            ) : (
              "Open workspace folder"
            )}
          </button>
          {error && <p className="error">{error}</p>}
        </section>
        {contextMenu && (
          <ContextMenu
            menu={contextMenu}
            onClose={() => setContextMenu(null)}
            onPick={(item) => void runContextMenuItem(item)}
          />
        )}
      </main>
    );
  }

  function renderBoardNavButton(board: Board) {
    return (
      <button
        className={board.id === activeBoard?.id && view === "board" ? "active" : ""}
        data-testid={`board-nav-${board.id}`}
        key={board.id}
        onContextMenu={(event) => openContextMenu(event, boardNavContextItems(board), board.name)}
        onClick={() => {
          setActiveBoardId(board.id);
          setView("board");
        }}
      >
        {board.name}
      </button>
    );
  }

  return (
    <div className="app-frame" onContextMenu={handleDefaultContextMenu}>
      <WindowsTitlebar />
      <div className="app-shell">
        <aside className="sidebar">
        <div className="brand">
          <strong>Limn</strong>
          <span>{settings.workspaceName}</span>
        </div>
        <button className="sidebar-action" data-testid="open-workspace" disabled={opening} onClick={() => void openWorkspace()}>
          {opening ? (
            <>
              <Spinner /> Opening…
            </>
          ) : (
            <>
              <Icon name="folder" /> Open workspace
            </>
          )}
        </button>
        <nav className="board-nav">
          <div className="nav-heading">
            <span>Boards</span>
            <div className="nav-heading-actions">
              <button aria-label="Create category" title="Create category" data-testid="create-board-category" onClick={() => void createBoardGroup()}>
                <Icon name="tag" />
              </button>
              <button aria-label="Create board" title="Create board" data-testid="create-board" onClick={() => void addBoard()}>
                <Icon name="plus" />
              </button>
            </div>
          </div>
          {boards.length === 0 && <p className="empty-small">No boards yet.</p>}
          {boardGroups.length === 0 && boards.map((board) => renderBoardNavButton(board))}
          {boardGroups.length > 0 && boardNavSections.grouped.map(({ group, boards: groupBoards }) => (
            <div className="board-group" key={group.id}>
              <div
                className="board-group-heading"
                data-testid={`board-group-${group.id}`}
                title="Category options"
                onContextMenu={(event) => openContextMenu(event, boardGroupContextItems(group), group.name)}
              >
                <span>{group.name}</span>
                <span>{countLabel(groupBoards.length, "board")}</span>
              </div>
              {groupBoards.length === 0 ? (
                <p className="empty-small board-group-empty">No boards in this category.</p>
              ) : (
                groupBoards.map((board) => renderBoardNavButton(board))
              )}
            </div>
          ))}
          {boardGroups.length > 0 && boardNavSections.ungrouped.length > 0 && (
            <div className="board-group">
              <div className="board-group-heading">
                <span>Ungrouped</span>
                <span>{countLabel(boardNavSections.ungrouped.length, "board")}</span>
              </div>
              {boardNavSections.ungrouped.map((board) => renderBoardNavButton(board))}
            </div>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button
            data-testid="theme-toggle"
            title={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`}
            onClick={() => setThemeMode((current) => (current === "dark" ? "light" : "dark"))}
          >
            <Icon name={themeMode === "dark" ? "sun" : "moon"} /> {themeMode === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button className={view === "members" ? "active" : ""} data-testid="nav-members" onClick={() => setView("members")}>
            <Icon name="users" /> Members
          </button>
          <button className={view === "settings" ? "active" : ""} data-testid="nav-settings" onClick={() => setView("settings")}>
            <Icon name="settings" /> Settings
          </button>
        </div>
        </aside>

        <main className="workspace">
        {(error || notice) && (
          <div
            aria-live={error ? "assertive" : "polite"}
            className={`banner ${error ? "banner-error" : noticeKind === "warning" ? "banner-warning" : ""}`}
            role={error ? "alert" : "status"}
          >
            <span>{error || notice}</span>
            <button
              aria-label="Dismiss message"
              className="icon-button"
              data-testid="dismiss-banner"
              title="Dismiss"
              onClick={() => {
                setError("");
                setNotice("");
              }}
            >
              <Icon name="x" />
            </button>
          </div>
        )}
        {updateBannerVisible && (
          <div
            aria-live={updateStatus === "error" ? "assertive" : "polite"}
            className={`banner ${updateStatus === "error" ? "banner-error" : "banner-warning"}`}
            data-testid="update-banner"
            role={updateStatus === "error" ? "alert" : "status"}
          >
            <span>{updateBannerText}</span>
            <div className="banner-actions">
              {updateStatus === "available" && (
                <button data-testid="install-update" onClick={() => void installAvailableUpdate()}>
                  Install update
                </button>
              )}
              {updateStatus === "restart-ready" && (
                <button data-testid="restart-update" onClick={() => void restartAfterUpdate()}>
                  Restart Limn
                </button>
              )}
              <button
                aria-label="Dismiss update message"
                className="icon-button"
                data-testid="dismiss-update-banner"
                title="Dismiss"
                onClick={() => {
                  setUpdateStatus("idle");
                  setUpdateMessage("");
                }}
              >
                <Icon name="x" />
              </button>
            </div>
          </div>
        )}

        {view === "board" && activeBoard && (
          <BoardView
            board={activeBoard}
            cards={visibleCards}
            members={members}
            onAddList={addList}
            onRenameBoard={renameBoard}
            onDeleteBoard={removeBoard}
            onRenameList={renameList}
            onDeleteList={deleteList}
            onAddCard={addCard}
            onMoveCard={moveCard}
            onOpenCard={setSelectedCardId}
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
        {view === "members" && (
          <MembersView members={members} onSave={saveMember} onRemove={removeMember} onOpenContextMenu={openContextMenu} onCopyText={copyText} />
        )}
        {view === "settings" && (
          <SettingsView
            settings={settings}
            workspacePath={workspacePath}
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
            boards={boards}
            members={members}
            onSave={saveCardFromEditor}
            onClose={() => setSelectedCardId(null)}
            onArchive={archiveCard}
            onDelete={removeCard}
            onAddAttachments={attachFilesToCard}
            onRemoveAttachment={removeAttachmentFromCard}
            onOpenAttachment={openCardAttachment}
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
      </div>
    </div>
  );
}

