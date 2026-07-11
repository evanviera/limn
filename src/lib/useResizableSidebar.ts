import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { DEFAULT_SIDEBAR_WIDTH, SIDEBAR_WIDTH_STORAGE_KEY } from "./constants";
import { clampSidebarWidth, readStoredSidebarWidth } from "./format";

// How far the arrow keys nudge the divider when it has keyboard focus.
const KEYBOARD_STEP = 16;

interface ResizeState {
  pointerId: number;
  startX: number;
  startWidth: number;
}

export interface ResizableSidebar {
  width: number;
  // True while the divider is actively being dragged, so the shell can suppress
  // transitions and show a resize cursor for the whole window.
  resizing: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
}

// Drives the draggable divider between the boards sidebar and the workspace. The
// chosen width is clamped to the supported range and persisted to localStorage
// so the panel keeps its size across sessions.
export function useResizableSidebar(): ResizableSidebar {
  const [width, setWidth] = useState<number>(readStoredSidebarWidth);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<ResizeState | null>(null);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
  }, [width]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
      event.currentTarget.setPointerCapture(event.pointerId);
      setResizing(true);
    },
    [width]
  );

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    setWidth(clampSidebarWidth(drag.startWidth + (event.clientX - drag.startX)));
  }, []);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResizing(false);
  }, []);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setWidth((current) => clampSidebarWidth(current - KEYBOARD_STEP));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setWidth((current) => clampSidebarWidth(current + KEYBOARD_STEP));
    }
  }, []);

  // Double-clicking the divider snaps the sidebar back to its default width.
  const onDoubleClick = useCallback(() => {
    setWidth(DEFAULT_SIDEBAR_WIDTH);
  }, []);

  return { width, resizing, onPointerDown, onPointerMove, onPointerUp, onKeyDown, onDoubleClick };
}
