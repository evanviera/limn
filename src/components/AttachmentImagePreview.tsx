import type { Attachment } from "../types";
import { useAttachmentObjectUrl } from "../lib/useAttachmentObjectUrl";

export function AttachmentImagePreview({
  workspacePath,
  cardId,
  attachment,
  className,
  testId
}: {
  workspacePath: string | null;
  cardId: string;
  attachment: Attachment;
  className: string;
  testId?: string;
}) {
  const { src, failed } = useAttachmentObjectUrl(workspacePath, cardId, attachment.storedName);

  if (!src) {
    return <span aria-hidden="true" className={`${className} ${failed ? "attachment-image-failed" : "attachment-image-loading"}`} data-testid={testId} />;
  }

  return <img alt={attachment.name} className={className} data-testid={testId} decoding="async" draggable={false} loading="lazy" src={src} />;
}
