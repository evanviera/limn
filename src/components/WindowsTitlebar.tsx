import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "./icons";

export function WindowsTitlebar() {
  function withWindow(action: "minimize" | "toggleMaximize" | "close") {
    if (!window.__TAURI_INTERNALS__) {
      return;
    }
    void getCurrentWindow()[action]();
  }

  return (
    <header className="windows-titlebar" data-tauri-drag-region>
      <span className="windows-titlebar-spacer" data-tauri-drag-region />
      <strong className="windows-titlebar-title" data-tauri-drag-region>Limn</strong>
      <div className="windows-titlebar-controls">
        <button aria-label="Minimize window" className="window-control" title="Minimize" type="button" onClick={() => withWindow("minimize")}>
          <Icon name="minus" />
        </button>
        <button aria-label="Maximize window" className="window-control" title="Maximize" type="button" onClick={() => withWindow("toggleMaximize")}>
          <Icon name="maximize" />
        </button>
        <button aria-label="Close window" className="window-control close" title="Close" type="button" onClick={() => withWindow("close")}>
          <Icon name="x" />
        </button>
      </div>
    </header>
  );
}
