import type {
  ClipboardEvent as ReactClipboardEvent,
  Dispatch,
  FormEvent as ReactFormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
  SetStateAction
} from "react";
import type { Attachment, Board, Card, Member, Subtask, SubtaskListItem } from "../types";
import { dueInputFromToday, describeDue } from "../lib/dueDate.js";
import { initials } from "../lib/format.js";
import { openExternal } from "../storage.js";
import { AttachmentLightbox } from "./AttachmentLightbox.js";
import type { ContextMenuItem, OpenContextMenu } from "./contextMenu";
import { isEditableTextControl, textControlContextItems } from "./contextMenu.js";
import { Icon, LinkIcon, Spinner } from "./icons.js";

export type NoteLinkDraft = { mode: "selection" | "link"; label: string; url: string };

interface CardEditorHeaderProps {
  board: Board | undefined;
  draft: Card;
  saving: boolean;
  onClose: () => void;
}

export function CardEditorHeader({ board, draft, saving, onClose }: CardEditorHeaderProps) {
  return (
    <header className="card-editor-header">
      <div className="card-editor-heading">
        <p className="eyebrow">Edit card</p>
        <h2>{board ? `${board.name} / ${board.lists.find((list) => list.id === draft.listId)?.name ?? "Unlisted"}` : "Card details"}</h2>
      </div>
      <button aria-label="Close" className="icon-button" disabled={saving} title="Close" onClick={onClose}>
        <Icon name="x" />
      </button>
    </header>
  );
}

interface CardEditorTitleFieldProps {
  draft: Card;
  setDraft: Dispatch<SetStateAction<Card>>;
}

export function CardEditorTitleField({ draft, setDraft }: CardEditorTitleFieldProps) {
  return (
    <label className="title-field">
      <span className="field-label">Title</span>
      <input
        data-testid="card-title-input"
        value={draft.title}
        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        placeholder="Card title"
      />
    </label>
  );
}

interface CardEditorSplitterProps {
  maxSideWidth: number;
  minSideWidth: number;
  sideWidth: number;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export function CardEditorSplitter({
  maxSideWidth,
  minSideWidth,
  sideWidth,
  onKeyDown,
  onPointerDown
}: CardEditorSplitterProps) {
  return (
    <div
      aria-label="Resize card detail columns"
      aria-orientation="vertical"
      aria-valuemax={maxSideWidth}
      aria-valuemin={minSideWidth}
      aria-valuenow={Math.round(sideWidth)}
      className="card-editor-splitter"
      data-testid="card-editor-splitter"
      role="separator"
      tabIndex={0}
      title="Resize columns"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    />
  );
}

interface CardEditorFooterProps {
  draft: Card;
  saving: boolean;
  onArchive: (card: Card) => Promise<void>;
  onDelete: (card: Card) => Promise<void>;
  onSaveAndClose: () => void;
}

export function CardEditorFooter({
  draft,
  saving,
  onArchive,
  onDelete,
  onSaveAndClose
}: CardEditorFooterProps) {
  return (
    <footer>
      <div className="destructive-actions">
        <button data-testid="archive-card" disabled={saving} onClick={() => void onArchive(draft)}>
          <Icon name="archive" /> Archive
        </button>
        <button data-testid="delete-card" disabled={saving} onClick={() => void onDelete(draft)}>
          <Icon name="trash" /> Delete
        </button>
      </div>
      <button
        className="primary"
        data-testid="save-card"
        disabled={saving}
        onClick={onSaveAndClose}
      >
        {saving ? (
          <>
            <Spinner /> Saving…
          </>
        ) : (
          <>
            <Icon name="save" /> Save
          </>
        )}
      </button>
    </footer>
  );
}

export function CardEditorDropzone({ active }: { active: boolean }) {
  if (!active) {
    return null;
  }

  return (
    <div className="card-editor-dropzone" data-testid="card-editor-dropzone" aria-hidden="true">
      <div className="card-editor-dropzone-inner">
        <Icon name="paperclip" />
        <p>Drop files to attach</p>
      </div>
    </div>
  );
}

interface CardEditorLightboxProps {
  cardId: string;
  imageAttachments: Attachment[];
  lightboxAttachment: Attachment | null;
  lightboxIndex: number | null;
  workspacePath: string | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onOpenExternally: (attachment: Attachment) => void;
  onRevealInFolder: (attachment: Attachment) => void;
}

export function CardEditorLightbox({
  cardId,
  imageAttachments,
  lightboxAttachment,
  lightboxIndex,
  workspacePath,
  onClose,
  onNavigate,
  onOpenExternally,
  onRevealInFolder
}: CardEditorLightboxProps) {
  if (!lightboxAttachment || lightboxIndex === null) {
    return null;
  }

  return (
    <AttachmentLightbox
      attachments={imageAttachments}
      index={lightboxIndex}
      workspacePath={workspacePath}
      cardId={cardId}
      onClose={onClose}
      onNavigate={onNavigate}
      onOpenExternally={onOpenExternally}
      onRevealInFolder={onRevealInFolder}
    />
  );
}

interface ChecklistEditorProps {
  completedSubtasks: number;
  draft: Card;
  expandedSubtasks: Set<string>;
  onAddSubtask: () => void;
  onAddSubtaskItem: (subtaskId: string) => void;
  onRemoveSubtask: (id: string) => void;
  onRemoveSubtaskItem: (subtaskId: string, itemId: string) => void;
  onToggleSubtaskExpanded: (id: string) => void;
  onUpdateSubtask: (id: string, patch: Partial<Subtask>) => void;
  onUpdateSubtaskItem: (subtaskId: string, itemId: string, patch: Partial<SubtaskListItem>) => void;
  onOpenContextMenu: OpenContextMenu;
  subtaskContextItems: (subtask: Subtask, isExpanded: boolean) => ContextMenuItem[];
  subtaskItemContextItems: (subtask: Subtask, item: SubtaskListItem) => ContextMenuItem[];
}

export function ChecklistEditor({
  completedSubtasks,
  draft,
  expandedSubtasks,
  onAddSubtask,
  onAddSubtaskItem,
  onRemoveSubtask,
  onRemoveSubtaskItem,
  onToggleSubtaskExpanded,
  onUpdateSubtask,
  onUpdateSubtaskItem,
  onOpenContextMenu,
  subtaskContextItems,
  subtaskItemContextItems
}: ChecklistEditorProps) {
  return (
    <section className="main-section" aria-labelledby="subtasks-heading">
      <div className="main-section-head">
        <div>
          <h3 id="subtasks-heading">Checklist</h3>
          <p className="main-section-sub">
            {draft.subtasks.length === 0 ? "No steps yet" : `${completedSubtasks} of ${draft.subtasks.length} complete`}
          </p>
        </div>
        <button data-testid="add-subtask" onClick={onAddSubtask}>
          <Icon name="plus" /> Add step
        </button>
      </div>
      {draft.subtasks.length === 0 && <p className="section-empty">Add a step when this card needs a checklist.</p>}
      {draft.subtasks.length > 0 && (
        <div className="subtask-list">
          {draft.subtasks.map((subtask) => {
            const isExpanded = expandedSubtasks.has(subtask.id);
            const itemCount = subtask.items.length;
            const hasUrl = subtask.url.trim().length > 0;
            return (
              <div
                key={subtask.id}
                className={`subtask-block ${subtask.completed ? "completed" : ""}`}
                onContextMenu={(event) => {
                  if (isEditableTextControl(event.target)) {
                    onOpenContextMenu(event, textControlContextItems(event.target));
                    return;
                  }
                  onOpenContextMenu(event, subtaskContextItems(subtask, isExpanded), subtask.title || "Step");
                }}
              >
                <div className="subtask-head">
                  <input
                    className="subtask-check"
                    checked={subtask.completed}
                    data-testid={`subtask-${subtask.id}-toggle`}
                    type="checkbox"
                    aria-label="Mark sub-task complete"
                    onChange={(event) => onUpdateSubtask(subtask.id, { completed: event.target.checked })}
                  />
                  <input
                    className="subtask-title"
                    data-testid={`subtask-${subtask.id}-title`}
                    value={subtask.title}
                    onChange={(event) => onUpdateSubtask(subtask.id, { title: event.target.value })}
                    placeholder="Step"
                  />
                  {(isExpanded || hasUrl) && (
                    <div className={`link-line ${hasUrl ? "has-url" : ""}`}>
                      <LinkIcon />
                      <input
                        className="link-input"
                        data-testid={`subtask-${subtask.id}-url`}
                        value={subtask.url}
                        onChange={(event) => onUpdateSubtask(subtask.id, { url: event.target.value })}
                        placeholder="Add link"
                      />
                      {hasUrl && (
                        <button
                          aria-label="Open link"
                          className="link-open"
                          data-testid={`subtask-${subtask.id}-open`}
                          title="Open link"
                          onClick={() => void openExternal(subtask.url.trim())}
                        >
                          <Icon name="chevron-up-right" />
                        </button>
                      )}
                    </div>
                  )}
                  <button
                    className="subtask-expand"
                    data-expanded={isExpanded}
                    aria-expanded={isExpanded}
                    aria-label={isExpanded ? "Hide list items" : "Show list items"}
                    title={isExpanded ? "Hide list items" : "Show list items"}
                    onClick={() => onToggleSubtaskExpanded(subtask.id)}
                  >
                    {itemCount > 0 && <span className="subtask-count">{itemCount}</span>}
                    <Icon name="chevron-down" />
                  </button>
                  <button
                    aria-label="Remove sub-task"
                    className="subtask-remove"
                    data-testid={`subtask-${subtask.id}-remove`}
                    title="Remove sub-task"
                    onClick={() => onRemoveSubtask(subtask.id)}
                  >
                    <Icon name="x" />
                  </button>
                </div>
                {isExpanded && (
                  <div className="subtask-items-editor">
                    {itemCount > 0 && (
                      <ul className="subtask-item-list">
                        {subtask.items.map((item) => {
                          const itemHasUrl = item.url.trim().length > 0;
                          return (
                            <li
                              key={item.id}
                              className="subtask-item-row"
                              onContextMenu={(event) => {
                                if (isEditableTextControl(event.target)) {
                                  onOpenContextMenu(event, textControlContextItems(event.target));
                                  return;
                                }
                                onOpenContextMenu(event, subtaskItemContextItems(subtask, item), item.text || "Detail");
                              }}
                            >
                              <span className="subtask-item-bullet" aria-hidden="true" />
                              <input
                                className="subtask-item-text"
                                data-testid={`subtask-item-${item.id}-text`}
                                value={item.text}
                                onChange={(event) => onUpdateSubtaskItem(subtask.id, item.id, { text: event.target.value })}
                                placeholder="List item"
                              />
                              <div className={`link-line ${itemHasUrl ? "has-url" : ""}`}>
                                <LinkIcon />
                                <input
                                  className="link-input"
                                  data-testid={`subtask-item-${item.id}-url`}
                                  value={item.url}
                                  onChange={(event) => onUpdateSubtaskItem(subtask.id, item.id, { url: event.target.value })}
                                  placeholder="Add link"
                                />
                                {itemHasUrl && (
                                  <button
                                    aria-label="Open list item link"
                                    className="link-open"
                                    data-testid={`subtask-item-${item.id}-open`}
                                    title="Open link"
                                    onClick={() => void openExternal(item.url.trim())}
                                  >
                                    <Icon name="chevron-up-right" />
                                  </button>
                                )}
                              </div>
                              <button
                                aria-label="Remove list item"
                                className="subtask-remove"
                                data-testid={`subtask-item-${item.id}-remove`}
                                title="Remove list item"
                                onClick={() => onRemoveSubtaskItem(subtask.id, item.id)}
                              >
                                <Icon name="x" />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <button
                      className="subtask-add-item"
                      data-testid={`subtask-${subtask.id}-add-item`}
                      onClick={() => onAddSubtaskItem(subtask.id)}
                    >
                      <Icon name="plus" /> Add detail
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

interface CardEditorSidePanelProps {
  board: Board | undefined;
  boards: Board[];
  draft: Card;
  labelInput: string;
  members: Member[];
  setDraft: Dispatch<SetStateAction<Card>>;
  setLabelInput: Dispatch<SetStateAction<string>>;
  onCommitLabels: (raw: string) => void;
  onCopyText: (text: string) => Promise<void>;
  onOpenContextMenu: OpenContextMenu;
  onRemoveLabel: (label: string) => void;
  onUpdateAssignee: (memberId: string, checked: boolean) => void;
}

export function CardEditorSidePanel({
  board,
  boards,
  draft,
  labelInput,
  members,
  setDraft,
  setLabelInput,
  onCommitLabels,
  onCopyText,
  onOpenContextMenu,
  onRemoveLabel,
  onUpdateAssignee
}: CardEditorSidePanelProps) {
  return (
    <aside className="card-editor-side" aria-label="Card properties" data-testid="card-editor-side">
      <div className="side-section">
        <span className="side-heading">Status</span>
        <label
          className="status-toggle"
          data-checked={draft.completed}
          onContextMenu={(event) => onOpenContextMenu(event, [
            {
              label: draft.completed ? "Mark incomplete" : "Mark complete",
              icon: "check",
              onSelect: () => setDraft({ ...draft, completed: !draft.completed })
            }
          ], "Status")}
        >
          <input
            data-testid="card-completed-input"
            type="checkbox"
            checked={draft.completed}
            onChange={(event) => setDraft({ ...draft, completed: event.target.checked })}
          />
          <span>{draft.completed ? "Completed" : "Mark complete"}</span>
        </label>
      </div>

      <div className="side-section">
        <span className="side-heading">Details</span>
        <label className="side-field side-field-select">
          <span>Board</span>
          <select
            data-testid="card-board-select"
            value={draft.boardId}
            onChange={(event) => {
              const nextBoard = boards.find((item) => item.id === event.target.value);
              setDraft({ ...draft, boardId: event.target.value, listId: nextBoard?.lists[0]?.id ?? "" });
            }}
          >
            {boards.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="side-field side-field-select">
          <span>List</span>
          <select data-testid="card-list-select" value={draft.listId} onChange={(event) => setDraft({ ...draft, listId: event.target.value })}>
            {board?.lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        </label>
        <label
          className="side-field side-field-date"
          onContextMenu={(event) => onOpenContextMenu(event, [
            { label: "Clear due date", icon: "x", disabled: !draft.due, onSelect: () => setDraft({ ...draft, due: "" }) },
            { label: "Copy due date", icon: "copy", disabled: !draft.due, onSelect: () => void onCopyText(draft.due) }
          ], "Due date")}
        >
          <Icon name="calendar" />
          <span>Due date</span>
          <input data-testid="card-due-input" type="date" value={draft.due} onChange={(event) => setDraft({ ...draft, due: event.target.value })} />
        </label>
        <div className="due-shortcuts">
          <button type="button" data-testid="due-set-today" onClick={() => setDraft({ ...draft, due: dueInputFromToday(0) })}>Today</button>
          <button type="button" data-testid="due-set-tomorrow" onClick={() => setDraft({ ...draft, due: dueInputFromToday(1) })}>Tomorrow</button>
          <button type="button" data-testid="due-set-next-week" onClick={() => setDraft({ ...draft, due: dueInputFromToday(7) })}>Next week</button>
          <button type="button" data-testid="due-clear" disabled={!draft.due} onClick={() => setDraft({ ...draft, due: "" })}>Clear</button>
        </div>
        {draft.due && (() => {
          const due = describeDue(draft.due);
          return (
            <p className={`due-hint due-${draft.completed ? "complete" : due.status}`} data-testid="card-due-hint">
              {due.label}
            </p>
          );
        })()}
      </div>

      <div className="side-section">
        <span className="side-heading">Assignees</span>
        <div className="assignee-list">
          {members.length === 0 && <p className="empty-inline">Add members before assigning cards.</p>}
          {members.map((member) => (
            <label
              key={member.id}
              className={`assignee-option ${draft.assignees.includes(member.id) ? "checked" : ""}`}
              onContextMenu={(event) => onOpenContextMenu(event, [
                {
                  label: draft.assignees.includes(member.id) ? "Unassign member" : "Assign member",
                  icon: "users",
                  onSelect: () => onUpdateAssignee(member.id, !draft.assignees.includes(member.id))
                },
                { label: "Copy member name", icon: "copy", onSelect: () => void onCopyText(member.name) }
              ], member.name)}
            >
              <input
                checked={draft.assignees.includes(member.id)}
                data-testid={`assignee-${member.id}`}
                type="checkbox"
                onChange={(event) => onUpdateAssignee(member.id, event.target.checked)}
              />
              <span className="avatar small" style={{ background: member.color }}>
                {initials(member.name)}
              </span>
              <span className="assignee-name">{member.name}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="side-section">
        <span className="side-heading"><Icon name="tag" /> Labels</span>
        <div className="label-field">
          {draft.labels.length > 0 && (
            <div className="label-chips">
              {draft.labels.map((label) => (
                <span
                  className="label-chip"
                  key={label}
                  onContextMenu={(event) => onOpenContextMenu(event, [
                    { label: "Copy label", icon: "copy", onSelect: () => void onCopyText(label) },
                    { type: "separator" },
                    { label: "Remove label", icon: "x", danger: true, onSelect: () => onRemoveLabel(label) }
                  ], label)}
                >
                  <span className="label-chip-text">{label}</span>
                  <button
                    className="label-chip-remove"
                    type="button"
                    aria-label={`Remove label ${label}`}
                    title={`Remove ${label}`}
                    onClick={() => onRemoveLabel(label)}
                  >
                    <Icon name="x" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            className="label-input"
            data-testid="card-labels-input"
            value={labelInput}
            onChange={(event) => setLabelInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                onCommitLabels(labelInput);
              } else if (event.key === "Backspace" && labelInput === "" && draft.labels.length > 0) {
                onRemoveLabel(draft.labels[draft.labels.length - 1]);
              }
            }}
            onBlur={() => onCommitLabels(labelInput)}
            placeholder="Add label…"
          />
        </div>
      </div>

      <div className="side-section side-activity">
        <span className="side-heading">Activity</span>
        {draft.activity.length === 0 && <p className="empty-inline">No activity yet.</p>}
        {draft.activity.slice(0, 8).map((event) => (
          <div className="activity-row" key={event.id}>
            <time>{new Date(event.createdAt).toLocaleString()}</time>
            <span>{event.message}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

interface NotesEditorProps {
  linkDraft: NoteLinkDraft | null;
  notesInputRef: RefObject<HTMLDivElement | null>;
  notesLinkInputRef: RefObject<HTMLInputElement | null>;
  notesLinkLabelInputRef: RefObject<HTMLInputElement | null>;
  onCancelLinkDraft: () => void;
  onFormatBold: () => void;
  onFormatItalic: () => void;
  onFormatLink: () => void;
  onNotesClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onNotesContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onNotesInput: () => void;
  onNotesKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onNotesPaste: (event: ReactClipboardEvent<HTMLDivElement>) => void;
  onOpenLinkDraft: () => void;
  onRemoveLink: () => void;
  onReplaceLinkDraft: (event: ReactFormEvent<HTMLFormElement>) => void;
  onUpdateLinkDraft: (patch: Partial<NoteLinkDraft>) => void;
}

export function NotesEditor({
  linkDraft,
  notesInputRef,
  notesLinkInputRef,
  notesLinkLabelInputRef,
  onCancelLinkDraft,
  onFormatBold,
  onFormatItalic,
  onFormatLink,
  onNotesClick,
  onNotesContextMenu,
  onNotesInput,
  onNotesKeyDown,
  onNotesPaste,
  onOpenLinkDraft,
  onRemoveLink,
  onReplaceLinkDraft,
  onUpdateLinkDraft
}: NotesEditorProps) {
  return (
    <section className="main-section notes-editor" aria-labelledby="notes-heading">
      <div className="main-section-head notes-editor-header">
        <h3 id="notes-heading">Notes</h3>
        <div className="notes-toolbar" aria-label="Notes formatting">
          <button
            aria-label="Bold"
            className="notes-tool"
            data-testid="notes-bold"
            title="Bold"
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onFormatBold}
          >
            <strong>B</strong>
          </button>
          <button
            aria-label="Italic"
            className="notes-tool"
            data-testid="notes-italic"
            title="Italic"
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onFormatItalic}
          >
            <em>I</em>
          </button>
          <button
            aria-label="Create link"
            className="notes-tool"
            data-testid="notes-link"
            title="Create link"
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onFormatLink}
          >
            <LinkIcon />
          </button>
        </div>
      </div>
      {linkDraft && (
        <form className="notes-link-form" data-testid="notes-link-form" onSubmit={onReplaceLinkDraft}>
          <input
            aria-label="Link text"
            data-testid="notes-link-label"
            placeholder="Link text"
            ref={notesLinkLabelInputRef}
            value={linkDraft.label}
            onChange={(event) => onUpdateLinkDraft({ label: event.target.value })}
          />
          <input
            aria-label="Link URL"
            data-testid="notes-link-url"
            placeholder="https://example.com"
            ref={notesLinkInputRef}
            value={linkDraft.url}
            onChange={(event) => onUpdateLinkDraft({ url: event.target.value })}
          />
          <button className="primary" data-testid="notes-link-apply" type="submit">
            {linkDraft.mode === "link" ? "Update" : "Apply"}
          </button>
          {linkDraft.mode === "link" && (
            <>
              <button data-testid="notes-link-open" type="button" onClick={onOpenLinkDraft}>
                Open
              </button>
              <button data-testid="notes-link-remove" type="button" onClick={onRemoveLink}>
                Remove link
              </button>
            </>
          )}
          <button data-testid="notes-link-cancel" type="button" onClick={onCancelLinkDraft}>
            Cancel
          </button>
        </form>
      )}
      <div
        aria-labelledby="notes-heading"
        aria-multiline="true"
        className="notes-rich-input"
        contentEditable
        data-testid="card-notes-input"
        data-placeholder="Add notes"
        ref={notesInputRef}
        role="textbox"
        suppressContentEditableWarning
        onClick={onNotesClick}
        onInput={onNotesInput}
        onKeyDown={onNotesKeyDown}
        onPaste={onNotesPaste}
        onContextMenu={onNotesContextMenu}
      />
    </section>
  );
}
