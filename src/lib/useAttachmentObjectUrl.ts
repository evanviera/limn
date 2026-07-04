import { useEffect, useState } from "react";
import { loadAttachmentLargePreview, loadAttachmentThumbnail } from "../storage";
import { sniffImageMimeType } from "./attachments";

// Loads an image attachment's bytes and exposes them as an object URL, cleaning
// the URL up on unmount / when the target changes. Shared by the inline
// thumbnail and the full-size lightbox so the fetch/blob logic lives in one place.
// Both variants pull a cached, downscaled rendering rather than the raw original:
// "thumbnail" (~640px) for covers/rows, "large" (~2560px) for the lightbox.
export function useAttachmentObjectUrl(
  workspacePath: string | null,
  cardId: string,
  storedName: string,
  variant: "thumbnail" | "large" = "thumbnail"
): { src: string | null; failed: boolean } {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!workspacePath || !storedName) {
      setSrc(null);
      setFailed(true);
      return;
    }

    let active = true;
    let objectUrl: string | null = null;
    setSrc(null);
    setFailed(false);

    const load = variant === "large" ? loadAttachmentLargePreview : loadAttachmentThumbnail;
    load(workspacePath, cardId, storedName)
      .then((buffer) => {
        if (!active) {
          return;
        }
        const bytes = new Uint8Array(buffer);
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: sniffImageMimeType(bytes) }));
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
  }, [workspacePath, cardId, storedName, variant]);

  return { src, failed };
}
