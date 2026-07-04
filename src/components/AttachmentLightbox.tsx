import { useEffect, useRef } from "react";
import type { Attachment } from "../types";
import { formatFileSize } from "../lib/format";
import { useAttachmentObjectUrl } from "../lib/useAttachmentObjectUrl";
import { useModalKeys } from "../lib/useModalKeys";
import { Icon } from "./icons";

// Full-screen image viewer for the card editor's image attachments. Arrow keys
// (and the on-screen chevrons) flip through the list, wrapping at the ends;
// Escape closes it. All file I/O is delegated through props/hooks, so this stays
// presentational.
export function AttachmentLightbox({
  attachments,
  index,
  workspacePath,
  cardId,
  onClose,
  onNavigate,
  onOpenExternally,
  onRevealInFolder
}: {
  attachments: Attachment[];
  index: number;
  workspacePath: string | null;
  cardId: string;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onOpenExternally: (attachment: Attachment) => void;
  onRevealInFolder: (attachment: Attachment) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const attachment = attachments[index];
  const count = attachments.length;
  const showNav = count > 1;
  const { src, failed } = useAttachmentObjectUrl(workspacePath, cardId, attachment?.storedName ?? "");
  useModalKeys(dialogRef, onClose);

  // Focus the dialog on open so the arrow-key handler and focus trap engage.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onNavigate((index + 1) % count);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        onNavigate((index - 1 + count) % count);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [index, count, onNavigate]);

  if (!attachment) {
    return null;
  }

  return (
    <div
      className="lightbox-backdrop"
      data-testid="attachment-lightbox"
      onMouseDown={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <div
        aria-label={`Image viewer: ${attachment.name}`}
        aria-modal="true"
        className="lightbox"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="lightbox-toolbar">
          <span className="lightbox-caption" data-testid="attachment-lightbox-caption">
            <span className="lightbox-name">{attachment.name}</span>
            <span className="lightbox-meta">
              {showNav ? `${index + 1} of ${count} · ` : ""}
              {formatFileSize(attachment.size)}
            </span>
          </span>
          <div className="lightbox-actions">
            <button
              aria-label="Show in file manager"
              className="icon-button lightbox-button"
              data-testid="attachment-lightbox-reveal"
              title="Show in file manager"
              type="button"
              onClick={() => onRevealInFolder(attachment)}
            >
              <Icon name="folder" />
            </button>
            <button
              aria-label="Open in default app"
              className="icon-button lightbox-button"
              data-testid="attachment-lightbox-open-external"
              title="Open in default app"
              type="button"
              onClick={() => onOpenExternally(attachment)}
            >
              <Icon name="chevron-up-right" />
            </button>
            <button
              aria-label="Close viewer"
              className="icon-button lightbox-button"
              data-testid="attachment-lightbox-close"
              title="Close"
              type="button"
              onClick={onClose}
            >
              <Icon name="x" />
            </button>
          </div>
        </div>
        <div className="lightbox-stage">
          {showNav && (
            <button
              aria-label="Previous image"
              className="lightbox-nav prev"
              data-testid="attachment-lightbox-prev"
              title="Previous"
              type="button"
              onClick={() => onNavigate((index - 1 + count) % count)}
            >
              <Icon name="chevron-left" />
            </button>
          )}
          {src ? (
            <img
              alt={attachment.name}
              className="lightbox-image"
              data-testid="attachment-lightbox-image"
              draggable={false}
              src={src}
            />
          ) : (
            <div
              className={`lightbox-status ${failed ? "is-failed" : "is-loading"}`}
              data-testid="attachment-lightbox-status"
            >
              {failed ? "Preview unavailable" : "Loading…"}
            </div>
          )}
          {showNav && (
            <button
              aria-label="Next image"
              className="lightbox-nav next"
              data-testid="attachment-lightbox-next"
              title="Next"
              type="button"
              onClick={() => onNavigate((index + 1) % count)}
            >
              <Icon name="chevron-right" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
