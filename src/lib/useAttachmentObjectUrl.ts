import { useEffect, useState } from "react";
import { loadAttachmentPreview } from "../storage";

// Loads an image attachment's bytes and exposes them as an object URL, cleaning
// the URL up on unmount / when the target changes. Shared by the inline
// thumbnail and the full-size lightbox so the fetch/blob logic lives in one place.
export function useAttachmentObjectUrl(
  workspacePath: string | null,
  cardId: string,
  storedName: string
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

    loadAttachmentPreview(workspacePath, cardId, storedName)
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
  }, [workspacePath, cardId, storedName]);

  return { src, failed };
}
