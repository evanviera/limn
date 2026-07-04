import { Fragment, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { Board, BoardList, Card, Member } from "../types";
import { openExternal } from "../storage";
import { latestImageAttachment } from "../lib/attachments";
import { countLabel, initials } from "../lib/format";
import { describeDue } from "../lib/dueDate";
import { compareCardsByOrder } from "../lib/ordering";
import { AttachmentImagePreview } from "./AttachmentImagePreview";
import { Icon } from "./icons";
import { EmptyState } from "./dialogs";
import { RichNoteText } from "./RichNoteText";
import type { ContextMenuItem, OpenContextMenu } from "./contextMenu";

export interface BoardViewProps {
  board: Board;
  cards: Card[];
  members: Member[];
  workspacePath: string | null;
  // The card highlighted as the target of an in-progress OS file drag, or null.
  dropTargetCardId: string | null;
  onAddList: () => Promise<void>;
  onRenameBoard: (board: Board) => Promise<void>;
  onDeleteBoard: (board: Board) => Promise<void>;
  onRenameList: (list: BoardList) => Promise<void>;
  onDeleteList: (list: BoardList) => Promise<void>;
  onAddCard: (listId: string) => Promise<void>;
  // `index` is where the card should land among the *other* cards already in the
  // target list (0 = top, omitted = append to the bottom).
  onMoveCard: (cardId: string, listId: string, index?: number) => Promise<void>;
  onOpenCard: (cardId: string) => void;
  onToggleSubtask: (cardId: string, subtaskId: string, completed: boolean) => Promise<void>;
  onToggleCardCompleted: (card: Card) => Promise<void>;
  onArchiveCard: (card: Card) => Promise<void>;
  onDeleteCard: (card: Card) => Promise<void>;
  onOpenContextMenu: OpenContextMenu;
  onCopyText: (text: string) => Promise<void>;
}
export function BoardView(props: BoardViewProps) {
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
  // Where the dragged card would land: which list, and the insertion index among
  // that list's other cards. Drives the insertion line shown during a drag.
  const [dropTarget, setDropTarget] = useState<{ listId: string; index: number } | null>(null);
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
    setDropTarget(computeDropTarget(clientX, clientY, drag.cardId));
  }

  function clearDragPreview() {
    document.body.classList.remove("is-card-dragging");
    setDragPreview(null);
    setDropTarget(null);
  }

  // Resolve the pointer location to a target list and an insertion index among
  // that list's cards (excluding the one being dragged). The index is decided by
  // the vertical midpoints of the rendered cards. The floating drag preview has
  // `pointer-events: none`, so it never occludes the hit test.
  function computeDropTarget(clientX: number, clientY: number, draggedCardId: string): { listId: string; index: number } | null {
    const listElement = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-list-id]");
    const listId = listElement?.dataset.listId;
    if (!listElement || !listId) {
      return null;
    }

    const cardElements = Array.from(listElement.querySelectorAll<HTMLElement>(".card-stack [data-card-id]"))
      .filter((element) => element.dataset.cardId !== draggedCardId);
    let index = cardElements.length;
    for (let position = 0; position < cardElements.length; position += 1) {
      const rect = cardElements[position].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        index = position;
        break;
      }
    }
    return { listId, index };
  }

  function dropCardAtPoint(cardId: string, clientX: number, clientY: number) {
    suppressCardClickRef.current = cardId;
    window.setTimeout(() => {
      if (suppressCardClickRef.current === cardId) {
        suppressCardClickRef.current = null;
      }
    }, 0);

    const target = computeDropTarget(clientX, clientY, cardId);
    clearDragPreview();
    if (target) {
      void props.onMoveCard(cardId, target.listId, target.index);
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

  function boardContextItems(): ContextMenuItem[] {
    return [
      { label: "Add list", icon: "plus", onSelect: () => void props.onAddList() },
      { label: "Rename board", icon: "edit", onSelect: () => void props.onRenameBoard(props.board) },
      { label: "Copy board name", icon: "copy", onSelect: () => void props.onCopyText(props.board.name) },
      { type: "separator" },
      { label: "Delete board", icon: "trash", danger: true, onSelect: () => void props.onDeleteBoard(props.board) }
    ];
  }

  function listContextItems(list: BoardList): ContextMenuItem[] {
    return [
      { label: "Add card", icon: "plus", onSelect: () => void props.onAddCard(list.id) },
      { label: "Rename list", icon: "edit", onSelect: () => void props.onRenameList(list) },
      { label: "Copy list name", icon: "copy", onSelect: () => void props.onCopyText(list.name) },
      { type: "separator" },
      { label: "Delete list", icon: "trash", danger: true, onSelect: () => void props.onDeleteList(list) }
    ];
  }

  function cardContextItems(card: Card): ContextMenuItem[] {
    const moveItems = props.board.lists
      .filter((list) => list.id !== card.listId)
      .map<ContextMenuItem>((list) => ({
        label: `Move to ${list.name}`,
        icon: "chevron-up-right",
        onSelect: () => void props.onMoveCard(card.id, list.id)
      }));

    return [
      { label: "Open card", icon: "edit", onSelect: () => props.onOpenCard(card.id) },
      {
        label: card.completed ? "Mark incomplete" : "Mark complete",
        icon: "check",
        onSelect: () => void props.onToggleCardCompleted(card)
      },
      { label: "Copy title", icon: "copy", onSelect: () => void props.onCopyText(card.title) },
      ...(moveItems.length > 0 ? [{ type: "separator" } satisfies ContextMenuItem, ...moveItems] : []),
      { type: "separator" },
      { label: "Archive card", icon: "archive", onSelect: () => void props.onArchiveCard(card) },
      { label: "Delete card", icon: "trash", danger: true, onSelect: () => void props.onDeleteCard(card) }
    ];
  }

  const dragPreviewCard = dragPreview ? props.cards.find((card) => card.id === dragPreview.cardId) : null;

  return (
    <section className="board-view" onContextMenu={(event) => props.onOpenContextMenu(event, boardContextItems(), props.board.name)}>
      <header className="content-header">
        <div>
          <p className="eyebrow">Board</p>
          <h1>{props.board.name}</h1>
          <p className="meta-line">{countLabel(props.board.lists.length, "list")} / {countLabel(props.cards.length, "card")}</p>
        </div>
        <div className="header-actions">
          <button aria-label="Rename board" className="icon-button" data-testid="rename-board" title="Rename board" onClick={() => void props.onRenameBoard(props.board)}>
            <Icon name="edit" />
          </button>
          <button aria-label="Delete board" className="icon-button" data-testid="delete-board" title="Delete board" onClick={() => void props.onDeleteBoard(props.board)}>
            <Icon name="trash" />
          </button>
          <button className="primary" data-testid="add-list" onClick={() => void props.onAddList()}>
            <Icon name="plus" /> Add list
          </button>
        </div>
      </header>

      <div className="columns">
        {props.board.lists.length === 0 && (
          <EmptyState title="No lists yet" body="Add a list to organize cards on this board." action="Add list" onAction={props.onAddList} />
        )}
        {props.board.lists.map((list) => {
          const listCards = props.cards.filter((card) => card.listId === list.id).sort(compareCardsByOrder);
          // Map the drop index (measured over the *other* cards) onto a position
          // in the rendered list, which still includes the dimmed dragged card.
          const draggedIndex = dragPreview ? listCards.findIndex((card) => card.id === dragPreview.cardId) : -1;
          const indicatorAt =
            dropTarget?.listId === list.id
              ? draggedIndex !== -1 && dropTarget.index >= draggedIndex
                ? dropTarget.index + 1
                : dropTarget.index
              : -1;
          return (
            <section
              className="column"
              data-list-id={list.id}
              data-testid={`list-${list.id}`}
              key={list.id}
              onContextMenu={(event) => props.onOpenContextMenu(event, listContextItems(list), list.name)}
            >
              <header className="column-header">
                <h2>{list.name}</h2>
                <span>{listCards.length}</span>
                <button aria-label={`Rename ${list.name}`} title="Rename list" data-testid={`rename-list-${list.id}`} onClick={() => void props.onRenameList(list)}>
                  <Icon name="edit" />
                </button>
                <button aria-label={`Delete ${list.name}`} title="Delete list" data-testid={`delete-list-${list.id}`} onClick={() => void props.onDeleteList(list)}>
                  <Icon name="trash" />
                </button>
              </header>
              <div className="card-stack">
                {listCards.length === 0 && indicatorAt !== 0 && <p className="empty-list">Drop cards here.</p>}
                {indicatorAt === 0 && <div className="drop-indicator" data-testid={`drop-indicator-${list.id}`} />}
                {listCards.map((card, position) => (
                  <Fragment key={card.id}>
                    <article
                      aria-label={`${card.title}${card.completed ? " (completed)" : ""}`}
                      className={`task-card ${card.completed ? "completed" : ""} ${dragPreview?.cardId === card.id ? "drag-source" : ""} ${props.dropTargetCardId === card.id ? "drop-target" : ""}`}
                      data-card-id={card.id}
                      data-testid={`card-${card.id}`}
                      onClick={() => openCard(card.id)}
                      onContextMenu={(event) => props.onOpenContextMenu(event, cardContextItems(card), card.title)}
                      onPointerCancel={cancelPointerDrag}
                      onPointerDown={(event) => beginPointerDrag(event, card.id)}
                      onPointerMove={updatePointerDrag}
                      onPointerUp={finishPointerDrag}
                      onMouseDown={(event) => beginMouseDrag(event, card.id)}
                    >
                      <TaskCardBody
                        card={card}
                        members={props.members}
                        workspacePath={props.workspacePath}
                        onOpen={openCard}
                        onToggleSubtask={props.onToggleSubtask}
                        onOpenContextMenu={props.onOpenContextMenu}
                        onCopyText={props.onCopyText}
                      />
                    </article>
                    {indicatorAt === position + 1 && <div className="drop-indicator" data-testid={`drop-indicator-${list.id}`} />}
                  </Fragment>
                ))}
              </div>
              <button className="add-card" data-testid={`add-card-${list.id}`} onClick={() => void props.onAddCard(list.id)}>
                <Icon name="plus" /> Add card
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
          <TaskCardBody card={dragPreviewCard} members={props.members} workspacePath={props.workspacePath} />
        </article>
      )}
    </section>
  );
}
export function TaskCardBody({
  card,
  members,
  workspacePath,
  onOpen,
  onToggleSubtask,
  onOpenContextMenu,
  onCopyText
}: {
  card: Card;
  members: Member[];
  workspacePath?: string | null;
  onOpen?: (cardId: string) => void;
  onToggleSubtask?: (cardId: string, subtaskId: string, completed: boolean) => void;
  onOpenContextMenu?: OpenContextMenu;
  onCopyText?: (text: string) => Promise<void>;
}) {
  const doneCount = card.subtasks.filter((subtask) => subtask.completed).length;
  const noteText = card.body.trim();
  const coverAttachment = workspacePath ? latestImageAttachment(card.attachments) : null;
  const due = describeDue(card.due);
  // Completed cards never nag: their due date reads as a neutral chip.
  const dueClass = card.completed ? "due-badge due-complete" : `due-badge due-${due.status}`;
  return (
    <>
      {coverAttachment && (
        <AttachmentImagePreview
          attachment={coverAttachment}
          cardId={card.id}
          className="task-card-cover"
          testId={`card-${card.id}-image-cover`}
          workspacePath={workspacePath ?? null}
        />
      )}
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
                onContextMenu={(event) => {
                  if (!onOpenContextMenu) {
                    return;
                  }
                  onOpenContextMenu(event, [
                    {
                      label: subtask.completed ? "Mark step incomplete" : "Mark step complete",
                      icon: "check",
                      disabled: !onToggleSubtask,
                      onSelect: () => onToggleSubtask?.(card.id, subtask.id, !subtask.completed)
                    },
                    { label: "Open card", icon: "edit", disabled: !onOpen, onSelect: () => onOpen?.(card.id) },
                    { label: "Copy step title", icon: "copy", onSelect: () => void onCopyText?.(title) },
                    ...(subtaskUrl
                      ? ([
                          { type: "separator" },
                          { label: "Open step link", icon: "chevron-up-right", onSelect: () => void openExternal(subtaskUrl) },
                          { label: "Copy step link", icon: "copy", onSelect: () => void onCopyText?.(subtaskUrl) }
                        ] satisfies ContextMenuItem[])
                      : [])
                  ], title);
                }}
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
                      onContextMenu={(event) => {
                        if (!onOpenContextMenu) {
                          return;
                        }
                        onOpenContextMenu(event, [
                          { label: "Open step link", icon: "chevron-up-right", onSelect: () => void openExternal(subtaskUrl) },
                          { label: "Copy step link", icon: "copy", onSelect: () => void onCopyText?.(subtaskUrl) },
                          { label: "Copy step title", icon: "copy", onSelect: () => void onCopyText?.(title) }
                        ], title);
                      }}
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
                              onContextMenu={(event) => {
                                if (!onOpenContextMenu) {
                                  return;
                                }
                                onOpenContextMenu(event, [
                                  { label: "Open detail link", icon: "chevron-up-right", onSelect: () => void openExternal(itemUrl) },
                                  { label: "Copy detail link", icon: "copy", onSelect: () => void onCopyText?.(itemUrl) },
                                  { label: "Copy detail text", icon: "copy", onSelect: () => void onCopyText?.(itemText) }
                                ], itemText);
                              }}
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
      {noteText && (
        <p className="card-notes-preview" data-testid={`card-notes-${card.id}`}>
          <RichNoteText text={noteText} testIdPrefix={`card-note-link-${card.id}`} onOpenContextMenu={onOpenContextMenu} onCopyText={onCopyText} />
        </p>
      )}
      <footer>
        <span className={dueClass} data-testid={`card-due-${card.id}`} title={due.status === "none" ? "No due date" : due.label}>
          {due.label}
        </span>
        {card.subtasks.length > 0 && (
          <span className="subtask-badge" title="Sub-tasks completed">
            <Icon name="check" /> {doneCount}/{card.subtasks.length}
          </span>
        )}
        <MemberDots members={members.filter((member) => card.assignees.includes(member.id))} />
      </footer>
    </>
  );
}
export function MemberDots({ members }: { members: Member[] }) {
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
