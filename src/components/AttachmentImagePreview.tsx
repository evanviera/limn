import { useEffect, useState } from "react";
import type { Attachment } from "../types";
import { loadAttachmentPreview } from "../storage";

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
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!workspacePath) {
      setSrc(null);
      setFailed(true);
      return;
    }

    let active = true;
    let objectUrl: string | null = null;
    setSrc(null);
    setFailed(false);

    loadAttachmentPreview(workspacePath, cardId, attachment.storedName)
      .then((preview) => {
        if (!active) {
          return;
        }
        const bytes = Uint8Array.from(preview.bytes);
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: preview.mimeType }));
        setSrc(objectUrl);
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [workspacePath, cardId, attachment.storedName]);

  if (!src) {
    return <span aria-hidden="true" className={`${className} ${failed ? "attachment-image-failed" : "attachment-image-loading"}`} data-testid={testId} />;
  }

  return <img alt={attachment.name} className={className} data-testid={testId} draggable={false} loading="lazy" src={src} />;
}

