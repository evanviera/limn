import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import type { Event as TauriEvent } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";

type Listener<T = unknown> = (event: TauriEvent<T>) => void;

// A file drag-drop over the app window, normalized to just what the UI needs:
// whether files are hovering ("over"), were dropped ("drop", with absolute
// source paths), or the drag left the window ("leave"). `x`/`y` are viewport CSS
// pixels so the UI can hit-test which card is under the pointer.
export type FileDropEvent =
  | { type: "over"; x: number; y: number }
  | { type: "drop"; paths: string[]; x: number; y: number }
  | { type: "leave" };

export interface LimnTestIpc {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T = unknown>(event: string, handler: Listener<T>): Promise<() => void>;
}

declare global {
  interface Window {
    __LIMN_TEST_IPC__?: LimnTestIpc;
    __TAURI_INTERNALS__?: unknown;
  }
}

// Whether a backend that can service IPC is present: the real Tauri desktop
// shell (`__TAURI_INTERNALS__`) or the E2E test harness that stands in for it
// (`__LIMN_TEST_IPC__`). A plain browser — the Vite dev URL opened without the
// test harness — has neither, so every workspace command would throw. The UI
// checks this to show a "desktop app required" state instead of an Open button
// that silently fails.
export function hasDesktopShell(): boolean {
  return Boolean(window.__LIMN_TEST_IPC__ || window.__TAURI_INTERNALS__);
}

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (window.__LIMN_TEST_IPC__) {
    return window.__LIMN_TEST_IPC__.invoke<T>(command, args);
  }
  return tauriInvoke<T>(command, args);
}

export async function listen<T = unknown>(event: string, handler: Listener<T>): Promise<() => void> {
  if (window.__LIMN_TEST_IPC__) {
    return window.__LIMN_TEST_IPC__.listen<T>(event, handler);
  }
  return tauriListen<T>(event, handler);
}

// Subscribe to OS file drops onto the app window. Tauri intercepts native
// drag-drop (HTML5 drop events never fire in the webview), so we map its webview
// event to `FileDropEvent`; the E2E harness emits a stand-in event instead.
export async function listenFileDrop(handler: (event: FileDropEvent) => void): Promise<() => void> {
  if (window.__LIMN_TEST_IPC__) {
    return window.__LIMN_TEST_IPC__.listen<FileDropEvent>("limn://file-drop", (event) => handler(event.payload));
  }
  return getCurrentWebview().onDragDropEvent((event) => {
    const payload = event.payload;
    if (payload.type === "enter" || payload.type === "over") {
      const point = dragPositionToViewport(payload.position);
      handler({ type: "over", x: point.x, y: point.y });
    } else if (payload.type === "drop") {
      const point = dragPositionToViewport(payload.position);
      handler({ type: "drop", paths: payload.paths, x: point.x, y: point.y });
    } else {
      handler({ type: "leave" });
    }
  });
}

// `document.elementFromPoint` needs viewport CSS pixels. Tauri wraps the drag
// position as `PhysicalPosition`, but the underlying value is in logical points on
// macOS (AppKit) and in physical pixels on Windows/Linux. Dividing the macOS value
// by the device pixel ratio would halve it and pull every drop toward the
// top-left, so only scale on the platforms that actually report physical pixels.
function dragPositionToViewport(position: { x: number; y: number }): { x: number; y: number } {
  const isMac = /mac/i.test(navigator.platform || navigator.userAgent);
  const ratio = isMac ? 1 : window.devicePixelRatio || 1;
  return { x: position.x / ratio, y: position.y / ratio };
}
