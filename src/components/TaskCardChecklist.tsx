import type { Card, Subtask } from "../types";
import { openExternal } from "../storage.js";
import type { ContextMenuItem, OpenContextMenu } from "./contextMenu";

export interface TaskCardChecklistProps {
  card: Card;
  subtasks: Subtask[];
  preview?: boolean;
  onOpen?: (cardId: string) => void;
  onToggleSubtask?: (cardId: string, subtaskId: string, completed: boolean) => void;
  onOpenContextMenu?: OpenContextMenu;
  onCopyText?: (text: string) => Promise<void>;
}

export function TaskCardChecklist({ card, subtasks, preview = false, onOpen, onToggleSubtask,
  onOpenContextMenu, onCopyText }: TaskCardChecklistProps) {
  if (subtasks.length === 0) return null;
  return (
    <ul className={`card-subtasks${preview ? " card-subtasks-preview" : ""}`} onMouseDown={(event) => event.stopPropagation()}>
      {subtasks.map((subtask) => {
        const subtaskUrl = subtask.url.trim();
        const title = subtask.title || subtaskUrl || "Untitled sub-task";
        const listItems = subtask.items.filter((item) => item.text.trim() || item.url.trim());
        // Keep the preview input mounted when it advances to the next step,
        // so a keyboard user can continue without losing focus.
        return (
          <li
            key={preview ? "next-step" : subtask.id}
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
                aria-label={`Mark ${title} ${subtask.completed ? "incomplete" : "complete"}`}
                checked={subtask.completed}
                data-testid={`card-subtask-${subtask.id}-toggle`}
                disabled={!onToggleSubtask}
                type="checkbox"
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => {
                  const completed = event.target.checked;
                  if (preview && completed && !card.subtasks.some(step => step.id !== subtask.id && !step.completed)) {
                    event.currentTarget.closest(".task-card")?.querySelector<HTMLButtonElement>(".card-preview-toggle")?.focus();
                  }
                  onToggleSubtask?.(card.id, subtask.id, completed);
                }}
              />
              {subtaskUrl ? (
                <a
                  className="card-subtask-title card-subtask-link"
                  title={title}
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
                <span className="card-subtask-title" title={title}>{title}</span>
              )}
            </div>
            {!preview && listItems.length > 0 && (
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
  );
}
