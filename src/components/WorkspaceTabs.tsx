import type { MouseEvent as ReactMouseEvent } from "react";
import { Icon } from "./icons";
import type { OpenWorkspaceRef } from "../types";

interface WorkspaceTabsProps {
  workspaces: OpenWorkspaceRef[];
  activePath: string;
  opening: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onOpen: () => void;
}

// The strip of open-workspace tabs across the top of the window. Each tab
// switches the active workspace; its × (or a middle-click) closes it. The
// trailing + button opens another workspace folder into a new tab. Purely
// presentational — all state and persistence live in App.
export function WorkspaceTabs({ workspaces, activePath, opening, onSelect, onClose, onOpen }: WorkspaceTabsProps) {
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

  return (
    <div className="workspace-tabs" data-testid="workspace-tabs" role="tablist">
      {workspaces.map((workspace) => {
        const active = workspace.path === activePath;
        return (
          <div
            key={workspace.path}
            className={`workspace-tab${active ? " active" : ""}`}
            data-testid={`workspace-tab-${workspace.path}`}
            role="tab"
            aria-selected={active}
            title={workspace.path}
            onMouseDown={(event) => handleAuxClick(event, workspace.path)}
            onClick={() => onSelect(workspace.path)}
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
        className="workspace-tab-add"
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
