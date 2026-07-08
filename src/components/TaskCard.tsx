import type { Card, Member } from "../types";
import { openExternal } from "../storage";
import { latestImageAttachment } from "../lib/attachments";
import { initials } from "../lib/format";
import { describeDue } from "../lib/dueDate";
import { AttachmentImagePreview } from "./AttachmentImagePreview";
import { Icon } from "./icons";
import { RichNoteText } from "./RichNoteText";
import type { ContextMenuItem, OpenContextMenu } from "./contextMenu";

export function TaskCardBody({
  card,
  members,
  workspacePath,
  compact = false,
  onOpen,
  onToggleSubtask,
  onOpenContextMenu,
  onCopyText
}: {
  card: Card;
  members: Member[];
  workspacePath?: string | null;
  compact?: boolean;
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
  // Card footers only carry meaning when there's something to show — an empty
  // "No due date · Unassigned" row is pure noise, so each meta slot is gated and
  // the footer collapses entirely when a card has no due date, sub-tasks, or
  // assignees.
  const showDue = due.status !== "none";
  const hasSubtasks = card.subtasks.length > 0;
  const assignedMembers = members.filter((member) => card.assignees.includes(member.id));
  return (
    <>
      {!compact && coverAttachment && (
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
      {!compact && card.labels.length > 0 && (
        <div className="label-row">
          {card.labels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      )}
      {!compact && card.subtasks.length > 0 && (
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
      {!compact && noteText && (
        <p className="card-notes-preview" data-testid={`card-notes-${card.id}`}>
          <RichNoteText text={noteText} testIdPrefix={`card-note-link-${card.id}`} onOpenContextMenu={onOpenContextMenu} onCopyText={onCopyText} />
        </p>
      )}
      {(showDue || hasSubtasks || assignedMembers.length > 0) && (
        <footer>
          {showDue && (
            <span className={dueClass} data-testid={`card-due-${card.id}`} title={due.label}>
              {due.label}
            </span>
          )}
          {hasSubtasks && (
            <span className="subtask-badge" title="Sub-tasks completed">
              <Icon name="check" /> {doneCount}/{card.subtasks.length}
            </span>
          )}
          {assignedMembers.length > 0 && <MemberDots members={assignedMembers} />}
        </footer>
      )}
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
