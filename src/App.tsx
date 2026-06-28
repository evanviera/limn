import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { listen } from "./ipc";
import {
  addActivity,
  createBoard,
  createCard,
  deleteBoard,
  deleteCard,
  getLastWorkspace,
  loadWorkspace,
  makeId,
  openExternal,
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
import { Board, BoardList, Card, Member, Subtask, SubtaskListItem, View, WorkspaceSettings, WriteResult } from "./types";

const memberColors = ["#2563eb", "#0f766e", "#b45309", "#be123c", "#7c3aed", "#4d7c0f"];

const MAX_NAME_LENGTH = 80;

interface TextDialogState {
  title: string;
  label: string;
  value: string;
  confirmLabel: string;
  onSubmit: (value: string) => Promise<void>;
  // Optional extra validation run on submit (e.g. duplicate-name checks).
  // Return an error message to block submission, or null to allow it.
  validate?: (value: string) => string | null;
}

interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
}

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

  const activeBoard = boards.find((board) => board.id === activeBoardId) ?? boards[0] ?? null;
  const selectedCard = cards.find((card) => card.id === selectedCardId) ?? null;
  // The workspace watcher captures `refreshWorkspace` from the effect's render,
  // so read the open card / cards through refs to get current values when a
  // disk change fires.
  const selectedCardIdRef = useRef(selectedCardId);
  selectedCardIdRef.current = selectedCardId;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const visibleCards = useMemo(
    () => cards.filter((card) => !card.archived && card.boardId === activeBoard?.id),
    [activeBoard?.id, cards]
  );

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

  useEffect(() => {
    if (!workspacePath) {
      return;
    }

    let unlisten: (() => void) | undefined;
    void watchWorkspace(workspacePath).catch((reason) => setError(errorText(reason)));
    void listen("workspace-changed", () => {
      void refreshWorkspace(false);
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      unlisten?.();
    };
  }, [workspacePath]);

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
    settingsRef.current = data.settings;
    setSettings(data.settings);
    setMembers(data.membersFile.members);
    setBoards(data.boards);
    setCards(data.cards);
    setActiveBoardId((current) => selectActiveBoardId(current, data.boards));
    setSelectedCardId((current) => (current && data.cards.some((card) => card.id === current) ? current : null));
    if (showNotice) {
      setNotice(data.diagnostics.length > 0 ? `Workspace reloaded with warnings. ${data.diagnostics.join(" ")}` : "Workspace reloaded from disk.");
      setNoticeKind(data.diagnostics.length > 0 ? "warning" : "info");
    } else if (data.diagnostics.length > 0) {
      setNotice(data.diagnostics.join(" "));
      setNoticeKind("warning");
    } else {
      // A silent (watch-driven) refresh: if the card currently open in the
      // editor changed on disk, warn before the user overwrites it.
      const openId = selectedCardIdRef.current;
      const before = openId ? cardsRef.current.find((card) => card.id === openId) : undefined;
      const after = openId ? data.cards.find((card) => card.id === openId) : undefined;
      if (before && after && before.updatedAt !== after.updatedAt) {
        setNotice("This card changed on disk. Reopen it to see the latest version.");
        setNoticeKind("warning");
      }
    }
  }

  async function persistBoard(nextBoard: Board) {
    if (!workspacePath) {
      return;
    }
    setBoards((current) => upsertById(current, nextBoard));
    await saveBoard(workspacePath, nextBoard);
  }

  async function persistCard(nextCard: Card, previous?: Card): Promise<WriteResult | null> {
    if (!workspacePath) {
      return null;
    }
    const expectedUpdatedAt = previous?.updatedAt;
    const result = await saveCard(workspacePath, nextCard, expectedUpdatedAt);
    setCards((current) => upsertById(current, nextCard));
    if (result.conflict) {
      setNotice(`Conflict copy written to ${result.relative_path}. Reloading disk state.`);
      setNoticeKind("warning");
      await refreshWorkspace(false);
    }
    return result;
  }

  async function addBoard() {
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
        const board = createBoard(name);
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
        await sendSlack(`➡️ Card moved to Done: ${moved.title}\nBoard: ${activeBoard.name}`);
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
    const next = {
      ...card,
      subtasks: card.subtasks.map((subtask) => (subtask.id === subtaskId ? { ...subtask, completed } : subtask)),
      updatedAt: timestamp()
    };
    try {
      await persistCard(next, card);
    } catch (reason) {
      setError(`Sub-task update failed: ${errorText(reason)}`);
    }
  }

  async function saveCardFromEditor(nextCard: Card) {
    const previous = cards.find((card) => card.id === nextCard.id);
    const normalized = { ...nextCard, updatedAt: timestamp() };
    let withActivity = previous ? normalized : addActivity(normalized, "created", "Created card");
    const slackMessages: string[] = [];

    if (previous && previous.completed !== normalized.completed && normalized.completed) {
      withActivity = addActivity(withActivity, "completed", "Marked complete");
      slackMessages.push(
        `✅ Task completed: ${normalized.title}\nAssigned to: ${assigneeNames(normalized)}\nBoard: ${boardName(normalized.boardId)}`
      );
    }

    if (previous && previous.assignees.join(",") !== normalized.assignees.join(",")) {
      withActivity = addActivity(withActivity, "assigned", `Assigned to ${assigneeNames(normalized)}`);
      slackMessages.push(`👤 Card assigned: ${normalized.title}\nAssigned to: ${assigneeNames(normalized)}\nBoard: ${boardName(normalized.boardId)}`);
    }

    const result = await persistCard(withActivity, previous);
    if (result && !result.conflict) {
      for (const message of slackMessages) {
        await sendSlack(message);
      }
    }
  }

  async function saveMember(member: Member) {
    if (!workspacePath) {
      return;
    }
    const nextMembers = upsertById(members, member);
    setMembers(nextMembers);
    await saveMembers(workspacePath, { schemaVersion: 1, members: nextMembers });
  }

  async function removeMember(memberId: string) {
    if (!workspacePath) {
      return;
    }
    const nextMembers = members.filter((member) => member.id !== memberId);
    setMembers(nextMembers);
    await saveMembers(workspacePath, { schemaVersion: 1, members: nextMembers });
  }

  async function saveWorkspaceSettings(nextSettings: WorkspaceSettings) {
    if (!workspacePath) {
      return;
    }
    const updated = { ...nextSettings, updatedAt: timestamp() };
    settingsRef.current = updated;
    setSettings(updated);
    await saveSettings(workspacePath, updated);
    setNotice("Settings saved.");
    setNoticeKind("info");
  }

  async function sendSlack(message: string) {
    const webhookUrl = settingsRef.current?.slackWebhookUrl.trim();
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

  function boardName(boardId: string) {
    return boards.find((board) => board.id === boardId)?.name ?? "Unknown board";
  }

  function openTextDialog(nextDialog: TextDialogState) {
    setTextDialog(nextDialog);
  }

  function openConfirmDialog(nextDialog: ConfirmDialogState) {
    setConfirmDialog(nextDialog);
  }

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
      <main className="welcome">
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
      </main>
    );
  }

  return (
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
            "Open workspace"
          )}
        </button>
        <nav className="board-nav">
          <div className="nav-heading">
            <span>Boards</span>
            <button aria-label="Create board" title="Create board" data-testid="create-board" onClick={() => void addBoard()}>
              +
            </button>
          </div>
          {boards.length === 0 && <p className="empty-small">No boards yet.</p>}
          {boards.map((board) => (
            <button
              className={board.id === activeBoard?.id && view === "board" ? "active" : ""}
              data-testid={`board-nav-${board.id}`}
              key={board.id}
              onClick={() => {
                setActiveBoardId(board.id);
                setView("board");
              }}
            >
              {board.name}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className={view === "members" ? "active" : ""} data-testid="nav-members" onClick={() => setView("members")}>
            Members
          </button>
          <button className={view === "settings" ? "active" : ""} data-testid="nav-settings" onClick={() => setView("settings")}>
            Settings
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
              data-testid="dismiss-banner"
              onClick={() => {
                setError("");
                setNotice("");
              }}
            >
              Dismiss
            </button>
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
          />
        )}
        {view === "board" && !activeBoard && (
          <EmptyState title="No board selected" body="Create a board to start adding lists and cards." action="Create board" onAction={addBoard} />
        )}
        {view === "members" && (
          <MembersView members={members} onSave={saveMember} onRemove={removeMember} />
        )}
        {view === "settings" && (
          <SettingsView settings={settings} workspacePath={workspacePath} onSave={saveWorkspaceSettings} onReload={refreshWorkspace} />
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
    </div>
  );
}

interface BoardViewProps {
  board: Board;
  cards: Card[];
  members: Member[];
  onAddList: () => Promise<void>;
  onRenameBoard: (board: Board) => Promise<void>;
  onDeleteBoard: (board: Board) => Promise<void>;
  onRenameList: (list: BoardList) => Promise<void>;
  onDeleteList: (list: BoardList) => Promise<void>;
  onAddCard: (listId: string) => Promise<void>;
  onMoveCard: (cardId: string, listId: string) => Promise<void>;
  onOpenCard: (cardId: string) => void;
  onToggleSubtask: (cardId: string, subtaskId: string, completed: boolean) => Promise<void>;
}

function BoardView(props: BoardViewProps) {
  type DragState = {
    cardId: string;
    startX: number;
    startY: number;
    didMove: boolean;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  };

  const pointerDragRef = useRef<{
    pointerId: number;
    state: DragState;
  } | null>(null);
  const mouseDragRef = useRef<DragState | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    cardId: string;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const mouseDragCleanupRef = useRef<(() => void) | null>(null);
  const suppressCardClickRef = useRef<string | null>(null);
  const dragThreshold = 6;

  useEffect(
    () => () => {
      mouseDragCleanupRef.current?.();
      document.body.classList.remove("is-card-dragging");
    },
    []
  );

  function createDragState(element: HTMLElement, cardId: string, clientX: number, clientY: number): DragState {
    const rect = element.getBoundingClientRect();
    return {
      cardId,
      startX: clientX,
      startY: clientY,
      didMove: false,
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top,
      width: rect.width,
      height: rect.height
    };
  }

  function updateDragPreview(drag: DragState, clientX: number, clientY: number) {
    document.body.classList.add("is-card-dragging");
    setDragPreview({
      cardId: drag.cardId,
      left: clientX - drag.offsetX,
      top: clientY - drag.offsetY,
      width: drag.width,
      height: drag.height
    });
  }

  function clearDragPreview() {
    document.body.classList.remove("is-card-dragging");
    setDragPreview(null);
  }

  function dropCardAtPoint(cardId: string, clientX: number, clientY: number) {
    suppressCardClickRef.current = cardId;
    window.setTimeout(() => {
      if (suppressCardClickRef.current === cardId) {
        suppressCardClickRef.current = null;
      }
    }, 0);
    clearDragPreview();

    const dropTarget = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-list-id]");
    const listId = dropTarget?.dataset.listId;
    if (listId) {
      void props.onMoveCard(cardId, listId);
    }
  }

  function beginPointerDrag(event: ReactPointerEvent<HTMLElement>, cardId: string) {
    if (event.pointerType === "mouse") {
      return;
    }

    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    pointerDragRef.current = {
      pointerId: event.pointerId,
      state: createDragState(event.currentTarget, cardId, event.clientX, event.clientY)
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updatePointerDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const moved = Math.hypot(event.clientX - drag.state.startX, event.clientY - drag.state.startY) >= dragThreshold;
    if (!drag.state.didMove && moved) {
      drag.state.didMove = true;
    }

    if (drag.state.didMove) {
      event.preventDefault();
      updateDragPreview(drag.state, event.clientX, event.clientY);
    }
  }

  function finishPointerDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    pointerDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!drag.state.didMove) {
      clearDragPreview();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dropCardAtPoint(drag.state.cardId, event.clientX, event.clientY);
  }

  function cancelPointerDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    pointerDragRef.current = null;
    clearDragPreview();
  }

  function beginMouseDrag(event: ReactMouseEvent<HTMLElement>, cardId: string) {
    if (event.button !== 0 || pointerDragRef.current) {
      return;
    }

    event.preventDefault();
    mouseDragCleanupRef.current?.();
    mouseDragRef.current = createDragState(event.currentTarget, cardId, event.clientX, event.clientY);

    const handleMouseMove = (nativeEvent: MouseEvent) => {
      const drag = mouseDragRef.current;
      if (!drag) {
        return;
      }

      const moved = Math.hypot(nativeEvent.clientX - drag.startX, nativeEvent.clientY - drag.startY) >= dragThreshold;
      if (!drag.didMove && moved) {
        drag.didMove = true;
      }

      if (drag.didMove) {
        nativeEvent.preventDefault();
        updateDragPreview(drag, nativeEvent.clientX, nativeEvent.clientY);
      }
    };

    const handleMouseUp = (nativeEvent: MouseEvent) => {
      mouseDragCleanupRef.current?.();
      const drag = mouseDragRef.current;
      mouseDragRef.current = null;
      if (!drag?.didMove) {
        clearDragPreview();
        return;
      }

      nativeEvent.preventDefault();
      dropCardAtPoint(drag.cardId, nativeEvent.clientX, nativeEvent.clientY);
    };

    const cleanup = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      mouseDragCleanupRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    mouseDragCleanupRef.current = cleanup;
  }

  function openCard(cardId: string) {
    if (suppressCardClickRef.current === cardId) {
      suppressCardClickRef.current = null;
      return;
    }

    props.onOpenCard(cardId);
  }

  const dragPreviewCard = dragPreview ? props.cards.find((card) => card.id === dragPreview.cardId) : null;

  return (
    <section className="board-view">
      <header className="content-header">
        <div>
          <p className="eyebrow">Board</p>
          <h1>{props.board.name}</h1>
        </div>
        <div className="header-actions">
          <button data-testid="rename-board" onClick={() => void props.onRenameBoard(props.board)}>Rename</button>
          <button data-testid="delete-board" onClick={() => void props.onDeleteBoard(props.board)}>Delete</button>
          <button className="primary" data-testid="add-list" onClick={() => void props.onAddList()}>
            Add list
          </button>
        </div>
      </header>

      <div className="columns">
        {props.board.lists.length === 0 && (
          <EmptyState title="No lists yet" body="Add a list to organize cards on this board." action="Add list" onAction={props.onAddList} />
        )}
        {props.board.lists.map((list) => {
          const listCards = props.cards.filter((card) => card.listId === list.id).sort(compareCardsByDueDate);
          return (
            <section
              className="column"
              data-list-id={list.id}
              data-testid={`list-${list.id}`}
              key={list.id}
            >
              <header className="column-header">
                <h2>{list.name}</h2>
                <span>{listCards.length}</span>
                <button title="Rename list" data-testid={`rename-list-${list.id}`} onClick={() => void props.onRenameList(list)}>
                  Rename
                </button>
                <button title="Delete list" data-testid={`delete-list-${list.id}`} onClick={() => void props.onDeleteList(list)}>
                  Delete
                </button>
              </header>
              <div className="card-stack">
                {listCards.length === 0 && <p className="empty-list">Drop cards here.</p>}
                {listCards.map((card) => (
                  <article
                    aria-label={`${card.title}${card.completed ? " (completed)" : ""}`}
                    className={`task-card ${card.completed ? "completed" : ""} ${dragPreview?.cardId === card.id ? "drag-source" : ""}`}
                    data-card-id={card.id}
                    data-testid={`card-${card.id}`}
                    key={card.id}
                    onClick={() => openCard(card.id)}
                    onPointerCancel={cancelPointerDrag}
                    onPointerDown={(event) => beginPointerDrag(event, card.id)}
                    onPointerMove={updatePointerDrag}
                    onPointerUp={finishPointerDrag}
                    onMouseDown={(event) => beginMouseDrag(event, card.id)}
                  >
                    <TaskCardBody card={card} members={props.members} onOpen={openCard} onToggleSubtask={props.onToggleSubtask} />
                  </article>
                ))}
              </div>
              <button className="add-card" data-testid={`add-card-${list.id}`} onClick={() => void props.onAddCard(list.id)}>
                Add card
              </button>
            </section>
          );
        })}
      </div>
      {dragPreview && dragPreviewCard && (
        <article
          className={`task-card drag-preview ${dragPreviewCard.completed ? "completed" : ""}`}
          data-testid="card-drag-preview"
          style={{
            height: dragPreview.height,
            transform: `translate3d(${dragPreview.left}px, ${dragPreview.top}px, 0)`,
            width: dragPreview.width
          }}
        >
          <TaskCardBody card={dragPreviewCard} members={props.members} />
        </article>
      )}
    </section>
  );
}

function TaskCardBody({
  card,
  members,
  onOpen,
  onToggleSubtask
}: {
  card: Card;
  members: Member[];
  onOpen?: (cardId: string) => void;
  onToggleSubtask?: (cardId: string, subtaskId: string, completed: boolean) => void;
}) {
  const doneCount = card.subtasks.filter((subtask) => subtask.completed).length;
  return (
    <>
      <h3>
        {card.completed && (
          <>
            <span className="sr-only">Completed: </span>
            <span className="done-check" aria-hidden="true">✓ </span>
          </>
        )}
        {onOpen ? (
          <button
            className="card-open"
            data-testid={`card-open-${card.id}`}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(card.id);
            }}
          >
            {card.title}
          </button>
        ) : (
          card.title
        )}
      </h3>
      {card.labels.length > 0 && (
        <div className="label-row">
          {card.labels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      )}
      {card.subtasks.length > 0 && (
        <ul className="card-subtasks">
          {card.subtasks.map((subtask) => {
            const subtaskUrl = subtask.url.trim();
            const title = subtask.title || subtaskUrl || "Untitled sub-task";
            const listItems = subtask.items.filter((item) => item.text.trim() || item.url.trim());
            return (
              <li
                key={subtask.id}
                className={`card-subtask ${subtask.completed ? "completed" : ""}`}
              >
                <div className="card-subtask-main">
                  <input
                    checked={subtask.completed}
                    data-testid={`card-subtask-${subtask.id}-toggle`}
                    disabled={!onToggleSubtask}
                    type="checkbox"
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onChange={(event) => onToggleSubtask?.(card.id, subtask.id, event.target.checked)}
                  />
                  {subtaskUrl ? (
                    <a
                      className="card-subtask-title card-subtask-link"
                      data-testid={`card-subtask-${subtask.id}-link`}
                      href={subtaskUrl}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void openExternal(subtaskUrl);
                      }}
                    >
                      {title}
                    </a>
                  ) : (
                    <span className="card-subtask-title">{title}</span>
                  )}
                </div>
                {listItems.length > 0 && (
                  <ul className="card-subtask-items">
                    {listItems.map((item) => {
                      const itemUrl = item.url.trim();
                      const itemText = item.text || itemUrl || "Untitled item";
                      return (
                        <li key={item.id} className="card-subtask-item">
                          {itemUrl ? (
                            <a
                              className="card-subtask-item-content card-subtask-link"
                              data-testid={`card-subtask-item-${item.id}-link`}
                              href={itemUrl}
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void openExternal(itemUrl);
                              }}
                            >
                              {itemText}
                            </a>
                          ) : (
                            <span className="card-subtask-item-content">{itemText}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <footer>
        <span>{card.due || "No due date"}</span>
        {card.subtasks.length > 0 && (
          <span className="subtask-badge" title="Sub-tasks completed">
            ☑ {doneCount}/{card.subtasks.length}
          </span>
        )}
        <MemberDots members={members.filter((member) => card.assignees.includes(member.id))} />
      </footer>
    </>
  );
}

function MembersView({ members, onSave, onRemove }: { members: Member[]; onSave: (member: Member) => Promise<void>; onRemove: (id: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [validation, setValidation] = useState("");

  return (
    <section>
      <header className="content-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Members</h1>
        </div>
      </header>
      <form
        className="inline-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) {
            setValidation("Enter a member name.");
            return;
          }
          setValidation("");
          const member: Member = {
            id: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || makeId("member"),
            name: name.trim(),
            color: memberColors[members.length % memberColors.length]
          };
          setName("");
          void onSave(member);
        }}
      >
        <input
          aria-describedby={validation ? "member-name-error" : undefined}
          aria-invalid={validation ? true : undefined}
          data-testid="member-name-input"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (validation) {
              setValidation("");
            }
          }}
          placeholder="Member name"
        />
        <button className="primary" data-testid="add-member">Add member</button>
        {validation && <p className="form-error" id="member-name-error">{validation}</p>}
      </form>
      <div className="member-list">
        {members.length === 0 && <p className="muted">No members yet.</p>}
        {members.map((member) => (
          <div className="member-row" key={member.id}>
            <span className="avatar" style={{ background: member.color }}>
              {initials(member.name)}
            </span>
            <input
              value={member.name}
              onChange={(event) => void onSave({ ...member, name: event.target.value })}
              aria-label={`${member.name} name`}
            />
            <input
              type="color"
              value={member.color}
              onChange={(event) => void onSave({ ...member, color: event.target.value })}
              aria-label={`${member.name} color`}
            />
            <button onClick={() => void onRemove(member.id)}>Remove</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsView({
  settings,
  workspacePath,
  onSave,
  onReload
}: {
  settings: WorkspaceSettings;
  workspacePath: string;
  onSave: (settings: WorkspaceSettings) => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
  const [reloading, setReloading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(settings), [settings]);

  return (
    <section>
      <header className="content-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Settings</h1>
        </div>
        <button
          data-testid="reload-workspace"
          disabled={reloading}
          onClick={() => {
            setReloading(true);
            void onReload().finally(() => setReloading(false));
          }}
        >
          {reloading ? (
            <>
              <Spinner /> Reloading…
            </>
          ) : (
            "Reload from disk"
          )}
        </button>
      </header>
      <div className="settings-grid">
        <label>
          Workspace name
          <input value={draft.workspaceName} onChange={(event) => setDraft({ ...draft, workspaceName: event.target.value })} />
        </label>
        <label>
          Slack incoming webhook URL
          <input
            data-testid="slack-webhook-input"
            value={draft.slackWebhookUrl}
            onChange={(event) => setDraft({ ...draft, slackWebhookUrl: event.target.value })}
            placeholder="https://hooks.slack.com/services/..."
          />
        </label>
        <label>
          Workspace folder
          <input value={workspacePath} readOnly />
        </label>
      </div>
      <button
        className="primary"
        data-testid="save-settings"
        disabled={saving}
        onClick={() => {
          setSaving(true);
          void onSave(draft).finally(() => setSaving(false));
        }}
      >
        {saving ? (
          <>
            <Spinner /> Saving…
          </>
        ) : (
          "Save settings"
        )}
      </button>
    </section>
  );
}

function CardEditor({
  card,
  boards,
  members,
  onSave,
  onClose,
  onArchive,
  onDelete
}: {
  card: Card;
  boards: Board[];
  members: Member[];
  onSave: (card: Card) => Promise<void>;
  onClose: () => void;
  onArchive: (card: Card) => Promise<void>;
  onDelete: (card: Card) => Promise<void>;
}) {
  const [draft, setDraft] = useState(card);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<HTMLElement>(null);
  const board = boards.find((item) => item.id === draft.boardId) ?? boards[0];

  useEffect(() => setDraft(card), [card]);
  useModalKeys(editorRef, onClose);
  // Move focus into the dialog on open so keyboard users land inside it.
  useEffect(() => {
    editorRef.current?.focus();
  }, []);

  function updateAssignee(memberId: string, checked: boolean) {
    setDraft((current) => ({
      ...current,
      assignees: checked ? [...current.assignees, memberId] : current.assignees.filter((id) => id !== memberId)
    }));
  }

  function addSubtask() {
    setDraft((current) => ({
      ...current,
      subtasks: [...current.subtasks, { id: makeId("subtask"), title: "", completed: false, url: "", items: [] }]
    }));
  }

  function updateSubtask(id: string, patch: Partial<Subtask>) {
    setDraft((current) => ({
      ...current,
      subtasks: current.subtasks.map((subtask) => (subtask.id === id ? { ...subtask, ...patch } : subtask))
    }));
  }

  function removeSubtask(id: string) {
    setDraft((current) => ({
      ...current,
      subtasks: current.subtasks.filter((subtask) => subtask.id !== id)
    }));
  }

  function addSubtaskItem(subtaskId: string) {
    const item: SubtaskListItem = { id: makeId("subtask-item"), text: "", url: "" };
    setDraft((current) => ({
      ...current,
      subtasks: current.subtasks.map((subtask) => (subtask.id === subtaskId ? { ...subtask, items: [...subtask.items, item] } : subtask))
    }));
  }

  function updateSubtaskItem(subtaskId: string, itemId: string, patch: Partial<SubtaskListItem>) {
    setDraft((current) => ({
      ...current,
      subtasks: current.subtasks.map((subtask) =>
        subtask.id === subtaskId
          ? {
              ...subtask,
              items: subtask.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item))
            }
          : subtask
      )
    }));
  }

  function removeSubtaskItem(subtaskId: string, itemId: string) {
    setDraft((current) => ({
      ...current,
      subtasks: current.subtasks.map((subtask) =>
        subtask.id === subtaskId
          ? {
              ...subtask,
              items: subtask.items.filter((item) => item.id !== itemId)
            }
          : subtask
      )
    }));
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <aside
        aria-label="Edit card"
        aria-modal="true"
        className="card-editor"
        ref={editorRef}
        role="dialog"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2>Edit card</h2>
          <button disabled={saving} onClick={onClose}>Close</button>
        </header>
        <label>
          Title
          <input data-testid="card-title-input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
        </label>
        <div className="editor-grid">
          <label>
            Board
            <select
              data-testid="card-board-select"
              value={draft.boardId}
              onChange={(event) => {
                const nextBoard = boards.find((item) => item.id === event.target.value);
                setDraft({ ...draft, boardId: event.target.value, listId: nextBoard?.lists[0]?.id ?? "" });
              }}
            >
              {boards.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            List
            <select data-testid="card-list-select" value={draft.listId} onChange={(event) => setDraft({ ...draft, listId: event.target.value })}>
              {board?.lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Due
            <input data-testid="card-due-input" type="date" value={draft.due} onChange={(event) => setDraft({ ...draft, due: event.target.value })} />
          </label>
          <label className="checkbox-row">
            <input data-testid="card-completed-input" type="checkbox" checked={draft.completed} onChange={(event) => setDraft({ ...draft, completed: event.target.checked })} />
            Completed
          </label>
        </div>
        <label>
          Labels
          <input
            data-testid="card-labels-input"
            value={draft.labels.join(", ")}
            onChange={(event) =>
              setDraft({
                ...draft,
                labels: event.target.value
                  .split(",")
                  .map((label) => label.trim())
                  .filter(Boolean)
              })
            }
            placeholder="animation, review"
          />
        </label>
        <fieldset className="assignee-fieldset">
          <legend>Assignees</legend>
          {members.length === 0 && <p className="muted">Add members before assigning cards.</p>}
          {members.map((member) => (
            <label key={member.id} className="checkbox-row">
              <input
                checked={draft.assignees.includes(member.id)}
                data-testid={`assignee-${member.id}`}
                type="checkbox"
                onChange={(event) => updateAssignee(member.id, event.target.checked)}
              />
              <span className="avatar" style={{ background: member.color }}>
                {initials(member.name)}
              </span>
              {member.name}
            </label>
          ))}
        </fieldset>
        <section className="subtasks">
          <div className="subtasks-header">
            <h3>Sub-tasks</h3>
            <button data-testid="add-subtask" onClick={addSubtask}>
              Add sub-task
            </button>
          </div>
          {draft.subtasks.length === 0 && <p className="muted">No sub-tasks yet.</p>}
          {draft.subtasks.map((subtask) => (
            <div key={subtask.id} className="subtask-block">
              <div className="subtask-row">
                <input
                  checked={subtask.completed}
                  data-testid={`subtask-${subtask.id}-toggle`}
                  type="checkbox"
                  onChange={(event) => updateSubtask(subtask.id, { completed: event.target.checked })}
                />
                <input
                  className="subtask-title"
                  data-testid={`subtask-${subtask.id}-title`}
                  value={subtask.title}
                  onChange={(event) => updateSubtask(subtask.id, { title: event.target.value })}
                  placeholder="Sub-task"
                />
                <input
                  className="subtask-url"
                  data-testid={`subtask-${subtask.id}-url`}
                  value={subtask.url}
                  onChange={(event) => updateSubtask(subtask.id, { url: event.target.value })}
                  placeholder="https://..."
                />
                {subtask.url.trim() && (
                  <button
                    aria-label="Open link"
                    className="subtask-open"
                    data-testid={`subtask-${subtask.id}-open`}
                    title="Open link"
                    onClick={() => void openExternal(subtask.url.trim())}
                  >
                    ↗
                  </button>
                )}
                <button
                  aria-label="Remove sub-task"
                  className="subtask-remove"
                  data-testid={`subtask-${subtask.id}-remove`}
                  title="Remove sub-task"
                  onClick={() => removeSubtask(subtask.id)}
                >
                  ×
                </button>
              </div>
              <div className="subtask-items-editor">
                <div className="subtask-items-header">
                  <span>List items</span>
                  <button data-testid={`subtask-${subtask.id}-add-item`} onClick={() => addSubtaskItem(subtask.id)}>
                    Add item
                  </button>
                </div>
                {subtask.items.length === 0 && <p className="muted">No list items yet.</p>}
                {subtask.items.length > 0 && (
                  <ul className="subtask-item-list">
                    {subtask.items.map((item) => (
                      <li key={item.id} className="subtask-item-row">
                        <input
                          className="subtask-item-text"
                          data-testid={`subtask-item-${item.id}-text`}
                          value={item.text}
                          onChange={(event) => updateSubtaskItem(subtask.id, item.id, { text: event.target.value })}
                          placeholder="List item"
                        />
                        <input
                          className="subtask-item-url"
                          data-testid={`subtask-item-${item.id}-url`}
                          value={item.url}
                          onChange={(event) => updateSubtaskItem(subtask.id, item.id, { url: event.target.value })}
                          placeholder="https://..."
                        />
                        {item.url.trim() && (
                          <button
                            aria-label="Open list item link"
                            className="subtask-open"
                            data-testid={`subtask-item-${item.id}-open`}
                            title="Open link"
                            onClick={() => void openExternal(item.url.trim())}
                          >
                            ↗
                          </button>
                        )}
                        <button
                          aria-label="Remove list item"
                          className="subtask-remove"
                          data-testid={`subtask-item-${item.id}-remove`}
                          title="Remove list item"
                          onClick={() => removeSubtaskItem(subtask.id, item.id)}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </section>
        <label>
          Notes
          <textarea data-testid="card-notes-input" value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} rows={10} />
        </label>
        <section className="activity">
          <h3>Activity</h3>
          {draft.activity.length === 0 && <p className="muted">No activity yet.</p>}
          {draft.activity.slice(0, 8).map((event) => (
            <p key={event.id}>
              <span>{new Date(event.createdAt).toLocaleString()}</span>
              {event.message}
            </p>
          ))}
        </section>
        <footer>
          <div className="destructive-actions">
            <button data-testid="archive-card" disabled={saving} onClick={() => void onArchive(draft)}>
              Archive
            </button>
            <button data-testid="delete-card" disabled={saving} onClick={() => void onDelete(draft)}>
              Delete
            </button>
          </div>
          <button
            className="primary"
            data-testid="save-card"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void onSave(draft)
                .then(onClose)
                .catch(() => setSaving(false));
            }}
          >
            {saving ? (
              <>
                <Spinner /> Saving…
              </>
            ) : (
              "Save card"
            )}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function EmptyState({ title, body, action, onAction }: { title: string; body: string; action: string; onAction: () => void | Promise<void> }) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{body}</p>
      <button className="primary" onClick={() => void onAction()}>
        {action}
      </button>
    </div>
  );
}

function TextDialog({
  dialog,
  onCancel,
  onChange,
  onSubmit
}: {
  dialog: TextDialogState;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSubmit: (value: string) => Promise<void>;
}) {
  const [validation, setValidation] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [dialog.title]);
  useModalKeys(formRef, onCancel);

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <form
        aria-labelledby="text-dialog-title"
        aria-modal="true"
        className="text-dialog"
        noValidate
        ref={formRef}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          const value = dialog.value.trim();
          if (!value) {
            setValidation(`${dialog.label} is required.`);
            return;
          }
          const problem = dialog.validate?.(value);
          if (problem) {
            setValidation(problem);
            return;
          }
          setValidation("");
          void onSubmit(value);
        }}
        role="dialog"
      >
        <header>
          <h2 id="text-dialog-title">{dialog.title}</h2>
          <button type="button" onClick={onCancel}>Cancel</button>
        </header>
        <label>
          {dialog.label}
          <input
            aria-describedby={validation ? "text-dialog-error" : undefined}
            aria-invalid={validation ? true : undefined}
            data-testid="text-dialog-input"
            maxLength={MAX_NAME_LENGTH}
            ref={inputRef}
            value={dialog.value}
            onChange={(event) => {
              onChange(event.target.value);
              if (validation) {
                setValidation("");
              }
            }}
          />
        </label>
        {validation && <p className="form-error" id="text-dialog-error">{validation}</p>}
        <footer>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button className="primary" data-testid="text-dialog-submit" type="submit">
            {dialog.confirmLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}

function ConfirmDialog({
  dialog,
  onCancel,
  onConfirm
}: {
  dialog: ConfirmDialogState;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // For destructive actions, default focus to Cancel so a reflexive Enter
    // doesn't immediately confirm; otherwise focus the confirm button.
    if (dialog.destructive) {
      cancelRef.current?.focus();
    } else {
      confirmRef.current?.focus();
    }
  }, [dialog.title, dialog.destructive]);
  useModalKeys(dialogRef, onCancel);

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        aria-describedby="confirm-dialog-message"
        aria-labelledby="confirm-dialog-title"
        aria-modal="true"
        className="text-dialog"
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <h2 id="confirm-dialog-title">{dialog.title}</h2>
          <button type="button" onClick={onCancel}>Cancel</button>
        </header>
        <p id="confirm-dialog-message">{dialog.message}</p>
        <footer>
          <button ref={cancelRef} type="button" onClick={onCancel}>Cancel</button>
          <button
            className={dialog.destructive ? "danger" : "primary"}
            data-testid="confirm-dialog-submit"
            ref={confirmRef}
            type="button"
            onClick={() => void onConfirm()}
          >
            {dialog.confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

function MemberDots({ members }: { members: Member[] }) {
  if (members.length === 0) {
    return <span className="muted">Unassigned</span>;
  }
  return (
    <span className="member-dots">
      {members.slice(0, 4).map((member) => (
        <span className="avatar small" key={member.id} style={{ background: member.color }}>
          {initials(member.name)}
        </span>
      ))}
    </span>
  );
}

function compareCardsByDueDate(left: Card, right: Card): number {
  const dueComparison = dueSortValue(left).localeCompare(dueSortValue(right));
  if (dueComparison !== 0) {
    return dueComparison;
  }

  const createdComparison = left.createdAt.localeCompare(right.createdAt);
  if (createdComparison !== 0) {
    return createdComparison;
  }

  return left.title.localeCompare(right.title);
}

function dueSortValue(card: Card): string {
  return card.due || "9999-12-31";
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

// Tracks the order in which modals open so that only the topmost one responds
// to Escape/Tab. Without this, stacked dialogs (e.g. the card editor with a
// delete confirm on top) each register a document listener and Escape fires
// every handler at once, dismissing the wrong layer.
const modalStack: symbol[] = [];

function useModalKeys(containerRef: { readonly current: HTMLElement | null }, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const id = Symbol("modal");
    modalStack.push(id);
    // Remember what was focused before the modal opened so we can restore it.
    const previousActive = document.activeElement as HTMLElement | null;

    function isTopmost() {
      return modalStack[modalStack.length - 1] === id;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!isTopmost()) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const node = containerRef.current;
      if (!node) {
        return;
      }
      const focusable = Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hasAttribute("disabled") && element.tabIndex !== -1);
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const index = modalStack.lastIndexOf(id);
      if (index !== -1) {
        modalStack.splice(index, 1);
      }
      // Return focus to the opener so keyboard/screen-reader users keep their place.
      if (previousActive && document.contains(previousActive)) {
        previousActive.focus();
      }
    };
    // Mount/unmount only: onClose is read through a ref so re-renders don't
    // churn the modal stack or capture a fresh "previously focused" element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);
}

// Extract a clean message for user-facing error banners so we don't surface the
// stringified Error object (e.g. "Error: …") prefix to the user.
function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const exists = items.some((current) => current.id === item.id);
  return exists ? items.map((current) => (current.id === item.id ? item : current)) : [...items, item];
}

function selectActiveBoardId(current: string, boards: Board[]): string {
  if (current && boards.some((board) => board.id === current)) {
    return current;
  }
  return boards[0]?.id ?? "";
}
