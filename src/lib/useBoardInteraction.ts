import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { BoardViewProps, CardDropTarget } from "../components/BoardView";
import { readBoardDisplayPreference, writeBoardDisplayPreference, BOARD_DISPLAY_CHANGE_EVENT } from "./viewPreferences.js";

export function useBoardInteraction(props: BoardViewProps) {
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
  const [localDropTarget, setLocalDropTarget] = useState<CardDropTarget | null>(null);
  const dropTarget = props.cardDropTarget === undefined ? localDropTarget : props.cardDropTarget;
  function setDropTarget(target: CardDropTarget | null) {
    setLocalDropTarget(target);
    props.onCardDropListChange?.(target);
  }
  const [draggingListId, setDraggingListId] = useState<string | null>(null);
  const [listDropTarget, setListDropTarget] = useState<{ index: number } | null>(null);
  const [compactCards, setCompactCards] = useState(() => readBoardDisplayPreference("compactCards"));
  const [autoCompactCompletedCards, setAutoCompactCompletedCards] = useState(() => readBoardDisplayPreference("compactCompleted"));
  const [showMoreSteps, setShowMoreSteps] = useState(() => readBoardDisplayPreference("showMoreSteps"));
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement | null>(null);
  const viewMenuToggleRef = useRef<HTMLButtonElement | null>(null);
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

  useEffect(() => {
    writeBoardDisplayPreference("compactCards", compactCards);
  }, [compactCards]);

  useEffect(() => {
    writeBoardDisplayPreference("compactCompleted", autoCompactCompletedCards);
  }, [autoCompactCompletedCards]);

  useEffect(() => {
    writeBoardDisplayPreference("showMoreSteps", showMoreSteps);
  }, [showMoreSteps]);

  useEffect(() => {
    if (!viewMenuOpen) {
      return undefined;
    }

    function closeOnPointerDown(event: PointerEvent) {
      if (!viewMenuRef.current?.contains(event.target as Node)) {
        setViewMenuOpen(false);
      }
    }

    function closeOnKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setViewMenuOpen(false);
        viewMenuToggleRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnKeyDown);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnKeyDown);
    };
  }, [viewMenuOpen]);

  useEffect(() => {
    function syncDisplay(event: Event) {
      const { preference, enabled } = (event as CustomEvent<{ preference: string; enabled: boolean }>).detail;
      if (preference === "compactCards") setCompactCards(enabled);
      if (preference === "compactCompleted") setAutoCompactCompletedCards(enabled);
      if (preference === "showMoreSteps") setShowMoreSteps(enabled);
    }
    window.addEventListener(BOARD_DISPLAY_CHANGE_EVENT, syncDisplay);
    return () => window.removeEventListener(BOARD_DISPLAY_CHANGE_EVENT, syncDisplay);
  }, []);

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

  useEffect(() => () => {
    props.onCardDropBoardChange(null);
    props.onCardDropListChange?.(null);
  }, [props.onCardDropBoardChange, props.onCardDropListChange]);

  function computeBoardDropTarget(clientX: number, clientY: number): { boardId: string; right: number } | null {
    const element = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-card-drop-board-id]");
    const boardId = element?.dataset.cardDropBoardId;
    return element && boardId && boardId !== props.board.id
      ? { boardId, right: element.getBoundingClientRect().right } : null;
  }

  function updateDragPreview(drag: DragState, clientX: number, clientY: number) {
    document.body.classList.add("is-card-dragging");
    const boardTarget = computeBoardDropTarget(clientX, clientY);
    setDragPreview({
      cardId: drag.cardId,
      // Keep the destination board name and its highlight visible.
      left: boardTarget ? boardTarget.right + 24 : clientX - drag.offsetX,
      top: clientY - drag.offsetY,
      width: drag.width,
      height: drag.height
    });
    props.onCardDropBoardChange(boardTarget?.boardId ?? null);
    setDropTarget(boardTarget ? null : computeDropTarget(clientX, clientY, drag.cardId));
  }

  function clearDragPreview() {
    document.body.classList.remove("is-card-dragging");
    setDragPreview(null);
    setDropTarget(null);
    props.onCardDropBoardChange(null);
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
  function computeDropTarget(clientX: number, clientY: number, draggedCardId: string): CardDropTarget | null {
    const listElement = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-list-id]");
    const listId = listElement?.dataset.listId;
    const boardId = listElement?.dataset.listBoardId;
    if (!listElement || !listId || !boardId) {
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
    return { boardId, listId, index };
  }

  function dropCardAtPoint(cardId: string, clientX: number, clientY: number) {
    suppressCardClickRef.current = cardId;
    window.setTimeout(() => {
      if (suppressCardClickRef.current === cardId) {
        suppressCardClickRef.current = null;
      }
    }, 0);

    const boardId = computeBoardDropTarget(clientX, clientY)?.boardId;
    const target = computeDropTarget(clientX, clientY, cardId);
    clearDragPreview();
    if (boardId) {
      void props.onMoveCardToBoard(cardId, boardId);
    } else if (target) {
      if (target.boardId === props.board.id) void props.onMoveCard(cardId, target.listId, target.index);
      else void props.onMoveCardToBoard(cardId, target.boardId, target.listId, target.index);
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

  return {
    columnsRef, dragPreview, dropTarget, draggingListId, listDropTarget,
    compactCards, setCompactCards, autoCompactCompletedCards, setAutoCompactCompletedCards,
    showMoreSteps, setShowMoreSteps,
    viewMenuOpen, setViewMenuOpen, viewMenuRef, viewMenuToggleRef, openCard,
    beginPointerDrag, updatePointerDrag, finishPointerDrag, cancelPointerDrag, beginMouseDrag,
    beginListPointerDrag, updateListPointerDrag, finishListPointerDrag, cancelListPointerDrag, beginListMouseDrag
  };
}
