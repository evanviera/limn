import { Fragment, useState } from "react";
import type {
  FormEvent as ReactFormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode
} from "react";
import type { Comment, Member } from "../types";
import { countLabel, initials } from "../lib/format";
import { MENTION_SPLIT_PATTERN, matchMention } from "../lib/mentions";
import { MentionTextarea } from "./MentionTextarea";
import { Icon } from "./icons";
import { isEditableTextControl, textControlContextItems } from "./contextMenu";
import type { ContextMenuItem, OpenContextMenu } from "./contextMenu";

const FALLBACK_AVATAR_COLOR = "#77828a";

// Render a comment body as text with known @mentions highlighted. Newlines are
// preserved by the `.comment-body` white-space rule, so the whole body can be
// tokenized at once.
function renderCommentBody(body: string, members: Member[]): ReactNode[] {
  return body.split(MENTION_SPLIT_PATTERN).map((part, index) => {
    if (part.startsWith("@")) {
      const member = matchMention(part.slice(1), members);
      if (member) {
        return (
          <span className="mention" data-member-id={member.id} key={index}>
            {part}
          </span>
        );
      }
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function formatCommentTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function CardComments({
  comments,
  members,
  activeMember,
  onSelectActiveMember,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onOpenContextMenu,
  onCopyText
}: {
  comments: Comment[];
  members: Member[];
  activeMember: Member | null;
  onSelectActiveMember: (memberId: string) => void;
  onAddComment: (body: string) => Promise<void>;
  onEditComment: (commentId: string, body: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onOpenContextMenu: OpenContextMenu;
  onCopyText: (text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  // Serialize comment writes so a slow save can't be double-submitted.
  async function runComment(action: () => Promise<void>) {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  function submitComment(event: ReactFormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !activeMember) {
      return;
    }
    void runComment(async () => {
      await onAddComment(body);
      setDraft("");
    });
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function beginEdit(comment: Comment) {
    setEditingId(comment.id);
    setEditDraft(comment.body);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft("");
  }

  function submitEdit(event: ReactFormEvent<HTMLFormElement>, comment: Comment) {
    event.preventDefault();
    const body = editDraft.trim();
    if (!body) {
      return;
    }
    if (body === comment.body) {
      cancelEdit();
      return;
    }
    void runComment(async () => {
      await onEditComment(comment.id, body);
      cancelEdit();
    });
  }

  function handleEditKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
    }
  }

  function commentContextItems(comment: Comment, isOwn: boolean): ContextMenuItem[] {
    const items: ContextMenuItem[] = [
      { label: "Copy comment", icon: "copy", disabled: !comment.body.trim(), onSelect: () => void onCopyText(comment.body) }
    ];
    if (isOwn) {
      items.push(
        { type: "separator" },
        { label: "Edit comment", icon: "edit", onSelect: () => beginEdit(comment) },
        { label: "Delete comment", icon: "trash", danger: true, onSelect: () => void runComment(() => onDeleteComment(comment.id)) }
      );
    }
    return items;
  }

  return (
    <section className="main-section card-comments" aria-labelledby="discussion-heading">
      <div className="main-section-head">
        <div>
          <h3 id="discussion-heading">Discussion</h3>
          <p className="main-section-sub">
            {comments.length === 0 ? "No comments yet" : countLabel(comments.length, "comment")}
          </p>
        </div>
      </div>

      {comments.length > 0 && (
        <div className="comment-list" data-testid="comment-list">
          {comments.map((comment) => {
            const authorMember = members.find((member) => member.id === comment.authorId);
            const isOwn = Boolean(activeMember && comment.authorId === activeMember.id);
            const authorName = authorMember?.name ?? comment.authorName;
            const isEditing = editingId === comment.id;
            return (
              <article
                key={comment.id}
                className="comment"
                data-testid={`comment-${comment.id}`}
                onContextMenu={(event) => {
                  if (isEditableTextControl(event.target)) {
                    onOpenContextMenu(event, textControlContextItems(event.target));
                    return;
                  }
                  onOpenContextMenu(event, commentContextItems(comment, isOwn), authorName);
                }}
              >
                <span className="avatar small" style={{ background: authorMember?.color ?? FALLBACK_AVATAR_COLOR }}>
                  {initials(authorName)}
                </span>
                <div className="comment-content">
                  <div className="comment-meta">
                    <span className="comment-author">{authorName}</span>
                    <time className="comment-time" dateTime={comment.createdAt}>{formatCommentTime(comment.createdAt)}</time>
                    {comment.editedAt && <span className="comment-edited" title={`Edited ${formatCommentTime(comment.editedAt)}`}>(edited)</span>}
                    {isOwn && !isEditing && (
                      <div className="comment-actions">
                        <button
                          className="comment-action"
                          data-testid={`comment-${comment.id}-edit`}
                          aria-label="Edit comment"
                          title="Edit"
                          type="button"
                          disabled={busy}
                          onClick={() => beginEdit(comment)}
                        >
                          <Icon name="edit" />
                        </button>
                        <button
                          className="comment-action comment-action-danger"
                          data-testid={`comment-${comment.id}-delete`}
                          aria-label="Delete comment"
                          title="Delete"
                          type="button"
                          disabled={busy}
                          onClick={() => void runComment(() => onDeleteComment(comment.id))}
                        >
                          <Icon name="trash" />
                        </button>
                      </div>
                    )}
                  </div>
                  {isEditing ? (
                    <form className="comment-edit-form" onSubmit={(event) => submitEdit(event, comment)}>
                      <MentionTextarea
                        className="comment-textarea"
                        testId={`comment-${comment.id}-edit-input`}
                        value={editDraft}
                        members={members}
                        autoFocus
                        onChange={setEditDraft}
                        onKeyDown={handleEditKeyDown}
                      />
                      <div className="comment-edit-actions">
                        <button className="primary" data-testid={`comment-${comment.id}-edit-save`} type="submit" disabled={busy || !editDraft.trim()}>
                          Save
                        </button>
                        <button data-testid={`comment-${comment.id}-edit-cancel`} type="button" onClick={cancelEdit}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <p className="comment-body">{renderCommentBody(comment.body, members)}</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {activeMember && (
        <form className="comment-composer" data-testid="comment-composer" onSubmit={submitComment}>
          <span className="avatar small" style={{ background: activeMember.color }}>
            {initials(activeMember.name)}
          </span>
          <div className="comment-composer-main">
            <MentionTextarea
              className="comment-textarea"
              testId="comment-input"
              value={draft}
              members={members}
              placeholder={`Comment as ${activeMember.name}…`}
              ariaLabel="Write a comment"
              onChange={setDraft}
              onKeyDown={handleComposerKeyDown}
            />
            <div className="comment-composer-foot">
              <span className="comment-hint">Type @name to mention a member · ⌘/Ctrl + Enter to send</span>
              <button className="primary" data-testid="add-comment" type="submit" disabled={busy || !draft.trim()}>
                <Icon name="chat" /> Comment
              </button>
            </div>
          </div>
        </form>
      )}

      {!activeMember && members.length > 0 && (
        <div className="comment-identity-prompt" data-testid="comment-identity-prompt">
          <p className="comment-identity-lead">Choose who you are to join the discussion.</p>
          <div className="comment-identity-options">
            {members.map((member) => (
              <button
                key={member.id}
                className="comment-identity-option"
                data-testid={`comment-identify-${member.id}`}
                type="button"
                onClick={() => onSelectActiveMember(member.id)}
              >
                <span className="avatar small" style={{ background: member.color }}>{initials(member.name)}</span>
                <span className="comment-identity-name">{member.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!activeMember && members.length === 0 && (
        <p className="section-empty" data-testid="comment-no-members">
          Add members in the Members view before starting a discussion.
        </p>
      )}
    </section>
  );
}
