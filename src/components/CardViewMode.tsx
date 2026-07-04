import type { Attachment, Board, Card, Member, Subtask } from "../types";
import { describeDue } from "../lib/dueDate";
import { initials } from "../lib/format";
import { openExternal } from "../storage";
import { CardAttachments } from "./CardAttachments";
import { CardComments } from "./CardComments";
import { Icon } from "./icons";
import { RichNoteText } from "./RichNoteText";
import type { OpenContextMenu } from "./contextMenu";

export function CardViewMode({
  card,
  board,
  listName,
  workspacePath,
  members,
  activeMember,
  attachmentBusy,
  onEdit,
  onClose,
  onToggleCompleted,
  onToggleSubtask,
  onAddAttachments,
  onRemoveAttachment,
  onOpenAttachment,
  onArchive,
  onDelete,
  onSelectActiveMember,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onOpenContextMenu,
  onCopyText
}: {
  card: Card;
  board: Board | undefined;
  listName: string;
  workspacePath: string | null;
  members: Member[];
  activeMember: Member | null;
  attachmentBusy: boolean;
  onEdit: () => void;
  onClose: () => void;
  onToggleCompleted: () => void;
  onToggleSubtask: (subtask: Subtask, completed: boolean) => void;
  onAddAttachments: () => void;
  onRemoveAttachment: (attachment: Attachment) => void;
  onOpenAttachment: (attachment: Attachment) => void;
  onArchive: () => void;
  onDelete: () => void;
  onSelectActiveMember: (memberId: string) => void;
  onAddComment: (body: string) => Promise<void>;
  onEditComment: (commentId: string, body: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onOpenContextMenu: OpenContextMenu;
  onCopyText: (text: string) => Promise<void>;
}) {
  const due = card.due ? describeDue(card.due) : null;
  const completedSubtasks = card.subtasks.filter((subtask) => subtask.completed).length;
  const assignedMembers = members.filter((member) => card.assignees.includes(member.id));
  const location = [board?.name, listName].filter(Boolean).join(" / ");

  return (
    <>
      <header className="card-view-header">
        <div className="card-view-title-block">
          <p className="eyebrow">{location || "Card details"}</p>
          <h2 data-testid="card-view-title">{card.title || "Untitled card"}</h2>
        </div>
        <div className="card-view-actions">
          <button data-testid="edit-card" onClick={onEdit}>
            <Icon name="edit" /> Edit
          </button>
          <button aria-label="Close" className="icon-button" title="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
      </header>

      <div className="card-view-body" data-testid="card-view">
        <section className="card-view-overview" aria-label="Card overview">
          <button
            className="card-view-status"
            data-checked={card.completed}
            data-testid="card-view-complete"
            type="button"
            onClick={onToggleCompleted}
          >
            <Icon name="check" />
            <span>{card.completed ? "Completed" : "Mark complete"}</span>
          </button>
          <div className={`card-view-fact ${due ? `due-${card.completed ? "complete" : due.status}` : ""}`}>
            <Icon name="calendar" />
            <span>{due ? due.label : "No due date"}</span>
          </div>
          <div className="card-view-fact">
            <Icon name="check" />
            <span>
              {card.subtasks.length === 0 ? "No checklist" : `${completedSubtasks} of ${card.subtasks.length} steps complete`}
            </span>
          </div>
          <div className="card-view-fact">
            <Icon name="paperclip" />
            <span>{card.attachments.length === 0 ? "No files" : `${card.attachments.length} file${card.attachments.length === 1 ? "" : "s"}`}</span>
          </div>
        </section>

        <section className="card-view-section" aria-labelledby="card-view-notes-heading">
          <div className="card-view-section-head">
            <h3 id="card-view-notes-heading">Notes</h3>
          </div>
          {card.body.trim() ? (
            <div className="card-view-notes" data-testid="card-view-notes">
              <RichNoteText text={card.body} testIdPrefix={`card-view-note-link-${card.id}`} onOpenContextMenu={onOpenContextMenu} onCopyText={onCopyText} />
            </div>
          ) : (
            <p className="card-view-empty">No notes yet.</p>
          )}
        </section>

        <section className="card-view-section" aria-labelledby="card-view-checklist-heading">
          <div className="card-view-section-head">
            <h3 id="card-view-checklist-heading">Checklist</h3>
            {card.subtasks.length > 0 && <span>{completedSubtasks}/{card.subtasks.length}</span>}
          </div>
          {card.subtasks.length === 0 ? (
            <p className="card-view-empty">No steps yet.</p>
          ) : (
            <ul className="card-view-checklist">
              {card.subtasks.map((subtask) => (
                <li className={`card-view-step ${subtask.completed ? "completed" : ""}`} key={subtask.id}>
                  <label className="card-view-step-main">
                    <input
                      checked={subtask.completed}
                      data-testid={`card-view-subtask-${subtask.id}-toggle`}
                      type="checkbox"
                      onChange={(event) => onToggleSubtask(subtask, event.target.checked)}
                    />
                    <span>{subtask.title || "Untitled step"}</span>
                  </label>
                  {subtask.url.trim() && (
                    <button className="card-view-link" type="button" onClick={() => void openExternal(subtask.url.trim())}>
                      <Icon name="chevron-up-right" /> Open
                    </button>
                  )}
                  {subtask.items.length > 0 && (
                    <ul className="card-view-step-items">
                      {subtask.items.map((item) => (
                        <li key={item.id}>
                          {item.url.trim() ? (
                            <button className="card-view-item-link" type="button" onClick={() => void openExternal(item.url.trim())}>
                              {item.text || item.url}
                            </button>
                          ) : (
                            <span>{item.text || "Untitled detail"}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <CardAttachments
          attachments={card.attachments}
          workspacePath={workspacePath}
          cardId={card.id}
          busy={attachmentBusy}
          onAdd={onAddAttachments}
          onOpen={onOpenAttachment}
          onRemove={onRemoveAttachment}
          onOpenContextMenu={onOpenContextMenu}
          onCopyText={onCopyText}
        />

        <CardComments
          key={card.id}
          comments={card.comments}
          members={members}
          activeMember={activeMember}
          onSelectActiveMember={onSelectActiveMember}
          onAddComment={onAddComment}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
          onOpenContextMenu={onOpenContextMenu}
          onCopyText={onCopyText}
        />
      </div>

      <aside className="card-view-rail" aria-label="Card properties">
        <section className="card-view-rail-section">
          <span className="side-heading">Location</span>
          <p>{board?.name ?? "Unknown board"}</p>
          <p>{listName || "Unlisted"}</p>
        </section>
        <section className="card-view-rail-section">
          <span className="side-heading">Assignees</span>
          {assignedMembers.length === 0 ? (
            <p className="empty-inline">Unassigned</p>
          ) : (
            <div className="card-view-people">
              {assignedMembers.map((member) => (
                <span className="card-view-person" key={member.id}>
                  <span className="avatar small" style={{ background: member.color }}>
                    {initials(member.name)}
                  </span>
                  <span>{member.name}</span>
                </span>
              ))}
            </div>
          )}
        </section>
        <section className="card-view-rail-section">
          <span className="side-heading">Labels</span>
          {card.labels.length === 0 ? (
            <p className="empty-inline">No labels</p>
          ) : (
            <div className="label-chips">
              {card.labels.map((label) => (
                <span className="label-chip view-label-chip" key={label}>
                  <span className="label-chip-text">{label}</span>
                </span>
              ))}
            </div>
          )}
        </section>
        <section className="card-view-rail-section side-activity">
          <span className="side-heading">Recent activity</span>
          {card.activity.length === 0 && <p className="empty-inline">No activity yet.</p>}
          {card.activity.slice(0, 5).map((event) => (
            <div className="activity-row" key={event.id}>
              <time>{new Date(event.createdAt).toLocaleString()}</time>
              <span>{event.message}</span>
            </div>
          ))}
        </section>
      </aside>

      <footer className="card-view-footer">
        <div className="destructive-actions">
          <button data-testid="archive-card" onClick={onArchive}>
            <Icon name="archive" /> Archive
          </button>
          <button data-testid="delete-card" onClick={onDelete}>
            <Icon name="trash" /> Delete
          </button>
        </div>
        <button className="primary" data-testid="edit-card-footer" onClick={onEdit}>
          <Icon name="edit" /> Edit card
        </button>
      </footer>
    </>
  );
}
