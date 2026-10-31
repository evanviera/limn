import { useId, useState } from "react";
import type { Attachment, Card, Member } from "../types";
import { latestImageAttachment } from "../lib/attachments.js";
import { formatFileSize } from "../lib/format.js";
import { describeDue } from "../lib/dueDate.js";
import { AttachmentImagePreview } from "./AttachmentImagePreview.js";
import { Icon } from "./icons.js";
import { TaskCardChecklist } from "./TaskCardChecklist.js";
import { RichNoteText } from "./RichNoteText.js";
import type { OpenContextMenu } from "./contextMenu";
import { Avatar } from "./Avatar.js";

export function TaskCardBody({
  card,
  members,
  workspacePath,
  compact = false,
  compactSteps = false,
  onOpen,
  onToggleSubtask,
  onOpenAttachment,
  onRevealAttachment,
  onOpenContextMenu,
  onCopyText
}: {
  card: Card;
  members: Member[];
  workspacePath?: string | null;
  compact?: boolean;
  compactSteps?: boolean;
  onOpen?: (cardId: string) => void;
  onToggleSubtask?: (cardId: string, subtaskId: string, completed: boolean) => void;
  onOpenAttachment?: (cardId: string, attachment: Attachment) => void;
  onRevealAttachment?: (cardId: string, attachment: Attachment) => void;
  onOpenContextMenu?: OpenContextMenu;
  onCopyText?: (text: string) => Promise<void>;
}) {
  const detailsId = useId();
  // The board keys this component by compactSteps so changing the display
  // preference resets per-card overrides and applies the new default at once.
  const [previewExpanded, setPreviewExpanded] = useState(!compactSteps);
  const expanded = !compact && previewExpanded;
  const pendingSubtasks = card.subtasks.filter(subtask => !subtask.completed);
  const completedSubtasks = card.subtasks.filter(subtask => subtask.completed);
  const doneCount = completedSubtasks.length;
  const checklistProps = { card, onOpen, onToggleSubtask, onOpenContextMenu, onCopyText };
  const noteText = card.body.trim();
  const coverAttachment = workspacePath ? latestImageAttachment(card.attachments) : null;
  const due = describeDue(card.due);
  const dueLabel = due.status === "overdue" ? `${Math.abs(due.days!)}d overdue`
    : due.status === "today" ? "Today"
    : due.status === "soon" ? (due.days === 1 ? "Tomorrow" : `In ${due.days} days`)
    : due.label;
  // Completed cards never nag: their due date reads as a neutral chip.
  const dueLate = due.status === "overdue" && Math.abs(due.days ?? 0) > 7;
  const dueClass = card.completed ? "due-badge due-complete" : `due-badge due-${due.status}${dueLate ? " due-late" : ""}`;
  // Card footers only carry meaning when there's something to show — an empty
  // "No due date · Unassigned" row is pure noise, so each meta slot is gated and
  // the footer collapses entirely when a card has no due date, sub-tasks, or
  // assignees.
  const showDue = due.status !== "none";
  const hasSubtasks = card.subtasks.length > 0;
  const assignedMembers = members.filter((member) => card.assignees.includes(member.id));
  const hasDetails = card.subtasks.length > 0 || Boolean(noteText) || card.attachments.length > 0 || card.labels.length > 2;
  function togglePreview() { setPreviewExpanded(current => !current); }
  return (
    <>
      <div className="task-card-heading">
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
        {!compact && hasDetails && (
          <button className="card-preview-toggle" type="button" data-testid={`card-preview-${card.id}`}
            aria-label={`${expanded ? "Collapse" : "Expand"} preview for ${card.title}`}
            aria-expanded={expanded} aria-controls={detailsId}
            onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
            onClick={event => { event.stopPropagation(); togglePreview(); }}>
            <Icon name="chevron-down" />
          </button>
        )}
      </div>
      <div id={detailsId} className="card-preview-content"
        hidden={compact || (!expanded && card.labels.length === 0 && pendingSubtasks.length === 0)}>
        {!compact && card.labels.length > 0 && (
          <div className="label-row">
            {(expanded ? card.labels : card.labels.slice(0, 2)).map((label) => (
              <span key={label}>{label}</span>
            ))}
            {!expanded && card.labels.length > 2 && <span title={card.labels.slice(2).join(", ")}>+{card.labels.length - 2}</span>}
          </div>
        )}
        {!compact && (
          <TaskCardChecklist {...checklistProps} subtasks={expanded ? pendingSubtasks : pendingSubtasks.slice(0, 1)} preview={!expanded} />
        )}
        {!compact && !expanded && pendingSubtasks.length > 1 && (
          <button type="button" className="card-more-steps" aria-expanded={false} aria-controls={detailsId}
            onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation();
              event.currentTarget.closest(".task-card")?.querySelector<HTMLButtonElement>(".card-preview-toggle")?.focus();
              togglePreview();
            }}>
            +{pendingSubtasks.length - 1} more {pendingSubtasks.length === 2 ? "step" : "steps"}
          </button>
        )}
        <div className="card-preview-details" hidden={!expanded}
          onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}
          onMouseDown={event => event.stopPropagation()}>
          {expanded && coverAttachment && (
            <AttachmentImagePreview attachment={coverAttachment} cardId={card.id}
              className="task-card-cover" testId={`card-${card.id}-image-cover`}
              workspacePath={workspacePath ?? null} />
          )}
          {expanded && doneCount > 0 && (
            <details className="card-completed-steps">
              <summary>{doneCount} completed</summary>
              <TaskCardChecklist {...checklistProps} subtasks={completedSubtasks} />
            </details>
          )}
          {expanded && card.attachments.length > 0 && (
            <ul
              aria-label="Attachments"
              className="task-card-attachments"
              data-testid={`card-${card.id}-attachments`}
            >
              {card.attachments.map((attachment) => (
                <li
                  key={attachment.id}
                  data-testid={`card-${card.id}-attachment-${attachment.id}`}
                  title={attachment.name}
                  onContextMenu={(event) => {
                    if (!onOpenContextMenu) {
                      return;
                    }
                    onOpenContextMenu(event, [
                      {
                        label: "Open attachment",
                        icon: "chevron-up-right",
                        disabled: !onOpenAttachment,
                        onSelect: () => onOpenAttachment?.(card.id, attachment)
                      },
                      {
                        label: "Show in file manager",
                        icon: "folder",
                        disabled: !onRevealAttachment,
                        onSelect: () => onRevealAttachment?.(card.id, attachment)
                      },
                      { label: "Copy file name", icon: "copy", onSelect: () => void onCopyText?.(attachment.name) },
                      { label: "Open card", icon: "edit", disabled: !onOpen, onSelect: () => onOpen?.(card.id) }
                    ], attachment.name);
                  }}
                >
                  <Icon name="paperclip" />
                  <span className="task-card-attachment-name">{attachment.name}</span>
                  <span className="task-card-attachment-size">{formatFileSize(attachment.size)}</span>
                </li>
              ))}
            </ul>
          )}
          {expanded && noteText && (
            <p className="card-notes-preview" data-testid={`card-notes-${card.id}`}>
              <RichNoteText text={noteText} testIdPrefix={`card-note-link-${card.id}`} onOpenContextMenu={onOpenContextMenu} onCopyText={onCopyText} />
            </p>
          )}
        </div>
      </div>
      {(showDue || hasSubtasks || card.attachments.length > 0 || assignedMembers.length > 0) && (
        <footer>
          {showDue && (
            <span className={dueClass} data-testid={`card-due-${card.id}`} title={due.label} aria-label={due.label}>
              {dueLabel}
            </span>
          )}
          <span className="card-footer-details">
            {card.attachments.length > 0 && <span className="card-attachment-count" title={`${card.attachments.length} attachments`} aria-label={`${card.attachments.length} attachments`}><Icon name="paperclip" />{card.attachments.length}</span>}
            {hasSubtasks && (
              <span className="subtask-badge" title="Sub-tasks completed" aria-label={`${doneCount} of ${card.subtasks.length} steps complete`}>
                {doneCount}/{card.subtasks.length}
              </span>
            )}
            {assignedMembers.length > 0 && <MemberDots members={assignedMembers} quiet={!expanded} />}
          </span>
        </footer>
      )}
    </>
  );
}

export function MemberDots({ members, quiet = false }: { members: Member[]; quiet?: boolean }) {
  if (members.length === 0) {
    return <span className="muted">Unassigned</span>;
  }
  return (
    <span className={`member-dots${quiet ? " quiet" : ""}`} role="img" aria-label={`Assigned to ${members.map(member => member.name).join(", ")}`} title={members.map(member => member.name).join(", ")}>
      {members.slice(0, quiet ? 1 : 4).map((member) => (
        <Avatar key={member.id} name={member.name} small title={member.name} />
      ))}
      {members.length > (quiet ? 1 : 4) && <span className="member-overflow">+{members.length - (quiet ? 1 : 4)}</span>}
    </span>
  );
}
