import { useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "./icons";
import { countLabel } from "../lib/format";
import type { Board, BoardGroup } from "../types";

interface BoardNavSections {
  grouped: Array<{ group: BoardGroup; boards: Board[] }>;
  ungrouped: Board[];
}

interface BoardNavProps {
  sections: BoardNavSections;
  hasGroups: boolean;
  totalBoards: number;
  activeBoardId: string;
  isBoardView: boolean;
  onSelectBoard: (boardId: string) => void;
  // Drop `boardId` into category `groupId` (undefined = Ungrouped/flat) at the
  // given index among that category's other boards.
  onMoveBoard: (boardId: string, groupId: string | undefined, index: number) => void;
  onBoardContextMenu: (event: ReactMouseEvent<HTMLElement>, board: Board) => void;
  onGroupContextMenu: (event: ReactMouseEvent<HTMLElement>, group: BoardGroup) => void;
  onCreateBoard: () => void;
  onCreateGroup: () => void;
}

// Pointer must travel this far before a press becomes a drag, so a plain click
// still opens the board.
const DRAG_THRESHOLD = 5;

interface BoardDragState {
  pointerId: number;
  boardId: string;
  startX: number;
  startY: number;
  didMove: boolean;
}

interface DropTarget {
  groupId: string | undefined;
  index: number;
}

// The Boards sidebar: the heading with its create actions, then the boards
// themselves — either a flat list or grouped into categories with an "Ungrouped"
// section. Boards can be dragged vertically to reorder within a category or
// across into another one. All persistence lives in App.
export function BoardNav({
  sections,
  hasGroups,
  totalBoards,
  activeBoardId,
  isBoardView,
  onSelectBoard,
  onMoveBoard,
  onBoardContextMenu,
  onGroupContextMenu,
  onCreateBoard,
  onCreateGroup
}: BoardNavProps) {
  const navRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<BoardDragState | null>(null);
  // Set true once a drag actually moved, so the click that follows pointerup
  // doesn't also switch boards.
  const suppressClickRef = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  // Resolve the pointer to a target category (the section under it) and an
  // insertion index among that section's boards, excluding the dragged one. The
  // section wrappers carry `data-board-section`; boards carry `data-board-id`.
  function computeDropTarget(clientX: number, clientY: number, draggedId: string): DropTarget | null {
    const section = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-board-section]");
    if (!section) {
      return null;
    }
    const rawGroup = section.dataset.groupId ?? "";
    const groupId = rawGroup === "" ? undefined : rawGroup;

    const boardEls = Array.from(section.querySelectorAll<HTMLElement>("[data-board-id]"))
      .filter((element) => element.dataset.boardId !== draggedId);
    let index = boardEls.length;
    for (let position = 0; position < boardEls.length; position += 1) {
      const rect = boardEls[position].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        index = position;
        break;
      }
    }
    return { groupId, index };
  }

  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>, boardId: string) {
    if (event.button !== 0) {
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      boardId,
      startX: event.clientX,
      startY: event.clientY,
      didMove: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (!drag.didMove && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= DRAG_THRESHOLD) {
      drag.didMove = true;
      setDraggingId(drag.boardId);
    }

    if (drag.didMove) {
      event.preventDefault();
      setDropTarget(computeDropTarget(event.clientX, event.clientY, drag.boardId));
    }
  }

  function finishDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (drag.didMove) {
      // A drag suppresses the click that pointerup may still synthesize; clear
      // the flag next tick so it never swallows a later, genuine click.
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      const target = computeDropTarget(event.clientX, event.clientY, drag.boardId);
      if (target) {
        onMoveBoard(drag.boardId, target.groupId, target.index);
      }
    }
    setDraggingId(null);
    setDropTarget(null);
  }

  function cancelDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
  }

  function handleSelect(boardId: string) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onSelectBoard(boardId);
  }

  // Render one board button, tagging the drop indicator based on where the
  // dragged board would land within its section.
  function renderBoard(board: Board, marker: { before: string | null; after: string | null }) {
    const active = board.id === activeBoardId && isBoardView;
    const dragging = board.id === draggingId;
    const classes = [
      active ? "active" : "",
      dragging ? "dragging" : "",
      board.id === marker.before ? "drop-before" : "",
      board.id === marker.after ? "drop-after" : ""
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <button
        className={`board-nav-item${classes ? ` ${classes}` : ""}`}
        data-testid={`board-nav-${board.id}`}
        data-board-id={board.id}
        key={board.id}
        onContextMenu={(event) => onBoardContextMenu(event, board)}
        onPointerDown={(event) => beginDrag(event, board.id)}
        onPointerMove={updateDrag}
        onPointerUp={finishDrag}
        onPointerCancel={cancelDrag}
        onClick={() => handleSelect(board.id)}
      >
        {board.name}
      </button>
    );
  }

  // Where the drop indicator sits within a section: before a specific board, or
  // trailing the last board when appending. `groupId` identifies the section so
  // only the one under the pointer shows a marker.
  function sectionMarker(groupId: string | undefined, boards: Board[]) {
    if (!dropTarget || dropTarget.groupId !== groupId) {
      return { before: null, after: null, intoEmpty: false };
    }
    const visible = boards.filter((board) => board.id !== draggingId);
    if (visible.length === 0) {
      return { before: null, after: null, intoEmpty: true };
    }
    if (dropTarget.index >= visible.length) {
      return { before: null, after: visible[visible.length - 1].id, intoEmpty: false };
    }
    return { before: visible[dropTarget.index].id, after: null, intoEmpty: false };
  }

  const flatMarker = hasGroups ? { before: null, after: null, intoEmpty: false } : sectionMarker(undefined, sections.ungrouped);

  return (
    <nav className="board-nav" ref={navRef}>
      <div className="nav-heading">
        <span>Boards</span>
        <div className="nav-heading-actions">
          <button aria-label="Create category" title="Create category" data-testid="create-board-category" onClick={onCreateGroup}>
            <Icon name="tag" />
          </button>
          <button aria-label="Create board" title="Create board" data-testid="create-board" onClick={onCreateBoard}>
            <Icon name="plus" />
          </button>
        </div>
      </div>

      {totalBoards === 0 && <p className="empty-small">No boards yet.</p>}

      {!hasGroups && totalBoards > 0 && (
        <div className="board-group" data-board-section data-group-id="">
          {sections.ungrouped.map((board) => renderBoard(board, flatMarker))}
        </div>
      )}

      {hasGroups &&
        sections.grouped.map(({ group, boards: groupBoards }) => {
          const marker = sectionMarker(group.id, groupBoards);
          return (
            <div className="board-group" key={group.id} data-board-section data-group-id={group.id}>
              <div
                className="board-group-heading"
                data-testid={`board-group-${group.id}`}
                title="Category options"
                onContextMenu={(event) => onGroupContextMenu(event, group)}
              >
                <span>{group.name}</span>
                <span>{countLabel(groupBoards.length, "board")}</span>
              </div>
              {groupBoards.length === 0 ? (
                <p className={`empty-small board-group-empty${marker.intoEmpty ? " drop-into" : ""}`}>No boards in this category.</p>
              ) : (
                groupBoards.map((board) => renderBoard(board, marker))
              )}
            </div>
          );
        })}

      {hasGroups && sections.ungrouped.length > 0 && (
        <div className="board-group" data-board-section data-group-id="">
          <div className="board-group-heading">
            <span>Ungrouped</span>
            <span>{countLabel(sections.ungrouped.length, "board")}</span>
          </div>
          {sections.ungrouped.map((board) => renderBoard(board, sectionMarker(undefined, sections.ungrouped)))}
        </div>
      )}
    </nav>
  );
}
