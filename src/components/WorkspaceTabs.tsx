import { useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "./icons";
import type { OpenWorkspaceRef } from "../types";

interface WorkspaceTabsProps {
  workspaces: OpenWorkspaceRef[];
  activePath: string;
  opening: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onOpen: () => void;
  // Move the tab at `path` so it sits at insertion index `toIndex`, measured in
  // the tab list with the dragged tab removed (0…count-1).
  onReorder: (path: string, toIndex: number) => void;
}

// Pointer must travel this far before a press turns into a drag, so a plain
// click still selects the tab.
const DRAG_THRESHOLD = 5;

interface TabDragState {
  pointerId: number;
  path: string;
  startX: number;
  didMove: boolean;
}

// The strip of open-workspace tabs across the top of the window. Each tab
// switches the active workspace; its × (or a middle-click) closes it, and it can
// be dragged horizontally to reorder. The trailing + button opens another
// workspace folder into a new tab. All persistence lives in App.
export function WorkspaceTabs({ workspaces, activePath, opening, onSelect, onClose, onOpen, onReorder }: WorkspaceTabsProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<TabDragState | null>(null);
  // Set true once a drag actually moved, so the click that follows pointerup
  // doesn't also switch workspaces.
  const suppressClickRef = useRef(false);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  function handleClose(event: ReactMouseEvent, path: string) {
    event.stopPropagation();
    onClose(path);
  }

  function handleAuxClick(event: ReactMouseEvent, path: string) {
    // Middle-click closes the tab, matching browser tab conventions.
    if (event.button === 1) {
      event.preventDefault();
      onClose(path);
    }
  }

  // Resolve the pointer's x position to an insertion index among the tabs that
  // aren't being dragged, using each tab's horizontal midpoint.
  function computeDropIndex(clientX: number, draggedPath: string): number {
    const strip = stripRef.current;
    if (!strip) {
      return 0;
    }
    const tabs = Array.from(strip.querySelectorAll<HTMLElement>(":scope > [data-tab-path]"))
      .filter((element) => element.dataset.tabPath !== draggedPath);
    let index = tabs.length;
    for (let position = 0; position < tabs.length; position += 1) {
      const rect = tabs[position].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) {
        index = position;
        break;
      }
    }
    return index;
  }

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>, path: string) {
    // Ignore non-primary buttons and presses that start on the close button, so
    // closing a tab never begins a drag.
    if (event.button !== 0 || (event.target as HTMLElement).closest(".workspace-tab-close")) {
      return;
    }
    dragRef.current = { pointerId: event.pointerId, path, startX: event.clientX, didMove: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (!drag.didMove && Math.abs(event.clientX - drag.startX) >= DRAG_THRESHOLD) {
      drag.didMove = true;
      setDraggingPath(drag.path);
    }

    if (drag.didMove) {
      event.preventDefault();
      setDropIndex(computeDropIndex(event.clientX, drag.path));
    }
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
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
      const target = computeDropIndex(event.clientX, drag.path);
      onReorder(drag.path, target);
    }
    setDraggingPath(null);
    setDropIndex(null);
  }

  function cancelDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    setDraggingPath(null);
    setDropIndex(null);
  }

  function handleSelect(path: string) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onSelect(path);
  }

  // The drop indicator renders before the tab currently sitting at `dropIndex`
  // within the non-dragged tabs, so map that back to a position in the full list.
  const visibleOrder = workspaces.filter((workspace) => workspace.path !== draggingPath);
  const indicatorBeforePath =
    dropIndex !== null && dropIndex < visibleOrder.length ? visibleOrder[dropIndex].path : null;
  const indicatorAtEnd = dropIndex !== null && dropIndex >= visibleOrder.length;

  return (
    <div className="workspace-tabs" data-testid="workspace-tabs" role="tablist" ref={stripRef}>
      {workspaces.map((workspace) => {
        const active = workspace.path === activePath;
        const dragging = workspace.path === draggingPath;
        return (
          <div
            key={workspace.path}
            className={`workspace-tab${active ? " active" : ""}${dragging ? " dragging" : ""}${
              indicatorBeforePath === workspace.path ? " drop-before" : ""
            }`}
            data-testid={`workspace-tab-${workspace.path}`}
            data-tab-path={workspace.path}
            role="tab"
            aria-selected={active}
            title={workspace.path}
            onMouseDown={(event) => handleAuxClick(event, workspace.path)}
            onPointerDown={(event) => beginDrag(event, workspace.path)}
            onPointerMove={updateDrag}
            onPointerUp={finishDrag}
            onPointerCancel={cancelDrag}
            onClick={() => handleSelect(workspace.path)}
          >
            <Icon name="folder" />
            <span className="workspace-tab-name">{workspace.name}</span>
            <button
              type="button"
              className="workspace-tab-close"
              aria-label={`Close ${workspace.name}`}
              title={`Close ${workspace.name}`}
              data-testid={`workspace-tab-close-${workspace.path}`}
              onClick={(event) => handleClose(event, workspace.path)}
            >
              <Icon name="x" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className={`workspace-tab-add${indicatorAtEnd ? " drop-before" : ""}`}
        aria-label="Open another workspace"
        title="Open another workspace"
        data-testid="workspace-tab-add"
        disabled={opening}
        onClick={() => onOpen()}
      >
        <Icon name="plus" />
      </button>
    </div>
  );
}
