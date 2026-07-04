import type { MouseEvent as ReactMouseEvent } from "react";
import type { Attachment, Board, Card, Member, Subtask } from "../types";
import { AttachmentLightbox } from "./AttachmentLightbox";
import { CardViewMode } from "./CardViewMode";
import { Icon } from "./icons";
import type { OpenContextMenu } from "./contextMenu";

export function CardViewPanel({
  card,
  board,
  listName,
  workspacePath,
  members,
  activeMember,
  fileDragActive,
  attachmentBusy,
  imageAttachments,
  lightboxAttachment,
  lightboxIndex,
  editorRef,
  onPanelContextMenu,
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
  onCopyText,
  onCloseLightbox,
  onNavigateLightbox,
  onOpenAttachmentExternally,
  onRevealAttachment
}: {
  card: Card;
  board: Board | undefined;
  listName: string;
  workspacePath: string | null;
  members: Member[];
  activeMember: Member | null;
  fileDragActive: boolean;
  attachmentBusy: boolean;
  imageAttachments: Attachment[];
  lightboxAttachment: Attachment | null;
  lightboxIndex: number | null;
  editorRef: React.RefObject<HTMLElement | null>;
  onPanelContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
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
  onCloseLightbox: () => void;
  onNavigateLightbox: (index: number) => void;
  onOpenAttachmentExternally: (attachment: Attachment) => void;
  onRevealAttachment: (attachment: Attachment) => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <aside
        aria-label="Card details"
        aria-modal="true"
        className="card-editor card-view-shell"
        ref={editorRef}
        role="dialog"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={onPanelContextMenu}
      >
        <CardViewMode
          card={card}
          board={board}
          listName={listName}
          workspacePath={workspacePath}
          members={members}
          activeMember={activeMember}
          attachmentBusy={attachmentBusy}
          onEdit={onEdit}
          onClose={onClose}
          onToggleCompleted={onToggleCompleted}
          onToggleSubtask={onToggleSubtask}
          onAddAttachments={onAddAttachments}
          onRemoveAttachment={onRemoveAttachment}
          onOpenAttachment={onOpenAttachment}
          onArchive={onArchive}
          onDelete={onDelete}
          onSelectActiveMember={onSelectActiveMember}
          onAddComment={onAddComment}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
          onOpenContextMenu={onOpenContextMenu}
          onCopyText={onCopyText}
        />

        {fileDragActive && (
          <div className="card-editor-dropzone" data-testid="card-editor-dropzone" aria-hidden="true">
            <div className="card-editor-dropzone-inner">
              <Icon name="paperclip" />
              <p>Drop files to attach</p>
            </div>
          </div>
        )}
      </aside>

      {lightboxAttachment && lightboxIndex !== null && (
        <AttachmentLightbox
          attachments={imageAttachments}
          index={lightboxIndex}
          workspacePath={workspacePath}
          cardId={card.id}
          onClose={onCloseLightbox}
          onNavigate={onNavigateLightbox}
          onOpenExternally={onOpenAttachmentExternally}
          onRevealInFolder={onRevealAttachment}
        />
      )}
    </div>
  );
}
