import { Fragment, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { Board, BoardList, Card, Member } from "../types";
import { countLabel } from "../lib/format";
import { compareCardsByOrder } from "../lib/ordering";
import { Icon } from "./icons";
import { EmptyState } from "./dialogs";
import { TaskCardBody } from "./TaskCard";
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
  onToggleListCollapsed: (list: BoardList) => Promise<void>;
  onMoveList: (listId: string, index: number) => Promise<void>;
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

  type ListDragState = {
    listId: string;
    startX: number;
    startY: number;
    didMove: boolean;
  };

  const columnsRef = useRef<HTMLDivElement | null>(null);
  const pointerDragRef = useRef<{
    pointerId: number;
    state: DragState;
  } | null>(null);
  const pointerListDragRef = useRef<{
    pointerId: number;
    state: ListDragState;
  } | null>(null);
  const mouseDragRef = useRef<DragState | null>(null);
  const mouseListDragRef = useRef<ListDragState | null>(null);
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
  const [draggingListId, setDraggingListId] = useState<string | null>(null);
  const [listDropTarget, setListDropTarget] = useState<{ index: number } | null>(null);
  const [compactCards, setCompactCards] = useState(false);
  const mouseDragCleanupRef = useRef<(() => void) | null>(null);
  const mouseListDragCleanupRef = useRef<(() => void) | null>(null);
  const suppressCardClickRef = useRef<string | null>(null);
  const dragThreshold = 6;

  useEffect(
    () => () => {
      mouseDragCleanupRef.current?.();
      mouseListDragCleanupRef.current?.();
      document.body.classList.remove("is-card-dragging");
      document.body.classList.remove("is-list-dragging");
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

  function createListDragState(listId: string, clientX: number, clientY: number): ListDragState {
    return {
      listId,
      startX: clientX,
      startY: clientY,
      didMove: false
    };
  }

  function computeListDropTarget(clientX: number, clientY: number, draggedListId: string): { index: number } | null {
    const columns = columnsRef.current;
    if (!columns) {
      return null;
    }
    const columnsRect = columns.getBoundingClientRect();
    if (clientY < columnsRect.top || clientY > columnsRect.bottom) {
      return null;
    }

    const listElements = Array.from(columns.querySelectorAll<HTMLElement>(":scope > [data-list-id]"))
      .filter((element) => element.dataset.listId !== draggedListId);
    let index = listElements.length;
    for (let position = 0; position < listElements.length; position += 1) {
      const rect = listElements[position].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) {
        index = position;
        break;
      }
    }
    return { index };
  }

  function updateListDrag(drag: ListDragState, clientX: number, clientY: number) {
    document.body.classList.add("is-list-dragging");
    setDraggingListId(drag.listId);
    setListDropTarget(computeListDropTarget(clientX, clientY, drag.listId));
  }

  function clearListDrag() {
    document.body.classList.remove("is-list-dragging");
    setDraggingListId(null);
    setListDropTarget(null);
  }

  function dropListAtPoint(listId: string, clientX: number, clientY: number) {
    const target = computeListDropTarget(clientX, clientY, listId);
    clearListDrag();
    if (target) {
      void props.onMoveList(listId, target.index);
    }
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

  function beginListPointerDrag(event: ReactPointerEvent<HTMLElement>, listId: string) {
    if (event.pointerType === "mouse") {
      return;
    }

    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    pointerListDragRef.current = {
      pointerId: event.pointerId,
      state: createListDragState(listId, event.clientX, event.clientY)
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateListPointerDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = pointerListDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const moved = Math.hypot(event.clientX - drag.state.startX, event.clientY - drag.state.startY) >= dragThreshold;
    if (!drag.state.didMove && moved) {
      drag.state.didMove = true;
    }

    if (drag.state.didMove) {
      event.preventDefault();
      updateListDrag(drag.state, event.clientX, event.clientY);
    }
  }

  function finishListPointerDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = pointerListDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    pointerListDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!drag.state.didMove) {
      clearListDrag();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dropListAtPoint(drag.state.listId, event.clientX, event.clientY);
  }

  function cancelListPointerDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = pointerListDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    pointerListDragRef.current = null;
    clearListDrag();
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

  function beginListMouseDrag(event: ReactMouseEvent<HTMLElement>, listId: string) {
    if (event.button !== 0 || pointerListDragRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    mouseListDragCleanupRef.current?.();
    mouseListDragRef.current = createListDragState(listId, event.clientX, event.clientY);

    const handleMouseMove = (nativeEvent: MouseEvent) => {
      const drag = mouseListDragRef.current;
      if (!drag) {
        return;
      }

      const moved = Math.hypot(nativeEvent.clientX - drag.startX, nativeEvent.clientY - drag.startY) >= dragThreshold;
      if (!drag.didMove && moved) {
        drag.didMove = true;
      }

      if (drag.didMove) {
        nativeEvent.preventDefault();
        updateListDrag(drag, nativeEvent.clientX, nativeEvent.clientY);
      }
    };

    const handleMouseUp = (nativeEvent: MouseEvent) => {
      mouseListDragCleanupRef.current?.();
      const drag = mouseListDragRef.current;
      mouseListDragRef.current = null;
      if (!drag?.didMove) {
        clearListDrag();
        return;
      }

      nativeEvent.preventDefault();
      dropListAtPoint(drag.listId, nativeEvent.clientX, nativeEvent.clientY);
    };

    const cleanup = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      mouseListDragCleanupRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    mouseListDragCleanupRef.current = cleanup;
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
      {
        label: list.collapsed ? "Expand list" : "Collapse list",
        icon: list.collapsed ? "chevron-right" : "chevron-down",
        onSelect: () => void props.onToggleListCollapsed(list)
      },
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
  const draggedListIndex = draggingListId ? props.board.lists.findIndex((list) => list.id === draggingListId) : -1;
  const listIndicatorAt =
    listDropTarget && draggedListIndex !== -1
      ? listDropTarget.index >= draggedListIndex
        ? listDropTarget.index + 1
        : listDropTarget.index
      : -1;

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
          <button
            aria-pressed={compactCards}
            className={`compact-toggle ${compactCards ? "active" : ""}`}
            data-testid="compact-board-toggle"
            title={compactCards ? "Show full cards" : "Show compact cards"}
            onClick={() => setCompactCards((current) => !current)}
          >
            <Icon name={compactCards ? "maximize" : "minus"} /> Compact
          </button>
          <button className="primary" data-testid="add-list" onClick={() => void props.onAddList()}>
            <Icon name="plus" /> Add list
          </button>
        </div>
      </header>

      <div className="columns" ref={columnsRef}>
        {props.board.lists.length === 0 && (
          <EmptyState title="No lists yet" body="Add a list to organize cards on this board." action="Add list" onAction={props.onAddList} />
        )}
        {props.board.lists.map((list, listPosition) => {
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
          // A single insertion line marks where the dragged list will land.
          // Interior/leading gaps draw it before the column at that index; the
          // trailing append case (index past the last column) draws it after the
          // final column. Never draw both for one gap, or two lines appear.
          const isLastList = listPosition === props.board.lists.length - 1;
          const showDropBefore = listIndicatorAt === listPosition;
          const showDropAfter = isLastList && listIndicatorAt === listPosition + 1;
          const columnClass = `column ${list.collapsed ? "collapsed" : ""} ${draggingListId === list.id ? "list-drag-source" : ""} ${showDropBefore ? "list-drop-before" : ""} ${showDropAfter ? "list-drop-after" : ""}`;
          if (list.collapsed) {
            return (
              <section
                className={columnClass}
                data-list-id={list.id}
                data-testid={`list-${list.id}`}
                key={list.id}
                onContextMenu={(event) => props.onOpenContextMenu(event, listContextItems(list), list.name)}
              >
                <button
                  aria-label={`Drag list ${list.name}`}
                  className="list-drag-handle"
                  data-testid={`list-drag-${list.id}`}
                  title="Drag list"
                  onContextMenu={(event) => event.stopPropagation()}
                  onPointerCancel={cancelListPointerDrag}
                  onPointerDown={(event) => beginListPointerDrag(event, list.id)}
                  onPointerMove={updateListPointerDrag}
                  onPointerUp={finishListPointerDrag}
                  onMouseDown={(event) => beginListMouseDrag(event, list.id)}
                >
                  <Icon name="drag-handle" />
                </button>
                <button
                  aria-label={`Expand list ${list.name}`}
                  aria-expanded={false}
                  className="collapsed-list-body"
                  data-testid={`collapse-list-${list.id}`}
                  title="Expand list"
                  onClick={() => void props.onToggleListCollapsed(list)}
                >
                  <Icon name="chevron-right" />
                  <span className="collapsed-list-title">{list.name}</span>
                  <span className="collapsed-list-count">{listCards.length}</span>
                </button>
              </section>
            );
          }
          return (
            <section
              className={columnClass}
              data-list-id={list.id}
              data-testid={`list-${list.id}`}
              key={list.id}
              onContextMenu={(event) => props.onOpenContextMenu(event, listContextItems(list), list.name)}
            >
              <header className="column-header">
                <button
                  aria-label={`Drag list ${list.name}`}
                  className="list-drag-handle"
                  data-testid={`list-drag-${list.id}`}
                  title="Drag list"
                  onContextMenu={(event) => event.stopPropagation()}
                  onPointerCancel={cancelListPointerDrag}
                  onPointerDown={(event) => beginListPointerDrag(event, list.id)}
                  onPointerMove={updateListPointerDrag}
                  onPointerUp={finishListPointerDrag}
                  onMouseDown={(event) => beginListMouseDrag(event, list.id)}
                >
                  <Icon name="drag-handle" />
                </button>
                <button
                  aria-label={`Collapse list ${list.name}`}
                  aria-expanded={true}
                  className="list-collapse-toggle"
                  data-testid={`collapse-list-${list.id}`}
                  title="Collapse list"
                  onClick={() => void props.onToggleListCollapsed(list)}
                >
                  <Icon name="chevron-down" />
                </button>
                <h2
                  className="list-title"
                  data-testid={`list-title-${list.id}`}
                  title="Drag to reorder"
                  onPointerCancel={cancelListPointerDrag}
                  onPointerDown={(event) => beginListPointerDrag(event, list.id)}
                  onPointerMove={updateListPointerDrag}
                  onPointerUp={finishListPointerDrag}
                  onMouseDown={(event) => beginListMouseDrag(event, list.id)}
                >
                  {list.name}
                </h2>
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
                      className={`task-card ${compactCards ? "compact" : ""} ${card.completed ? "completed" : ""} ${dragPreview?.cardId === card.id ? "drag-source" : ""} ${props.dropTargetCardId === card.id ? "drop-target" : ""}`}
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
                        compact={compactCards}
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
          className={`task-card drag-preview ${compactCards ? "compact" : ""} ${dragPreviewCard.completed ? "completed" : ""}`}
          data-testid="card-drag-preview"
          style={{
            height: dragPreview.height,
            transform: `translate3d(${dragPreview.left}px, ${dragPreview.top}px, 0)`,
            width: dragPreview.width
          }}
        >
          <TaskCardBody card={dragPreviewCard} compact={compactCards} members={props.members} workspacePath={props.workspacePath} />
        </article>
      )}
    </section>
  );
}
