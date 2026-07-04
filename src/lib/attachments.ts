import type { Attachment } from "../types";

const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);

export function attachmentFileExtension(attachment: Attachment): string {
  const name = attachment.name || attachment.storedName;
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isImageAttachment(attachment: Attachment): boolean {
  return IMAGE_EXTENSIONS.has(attachmentFileExtension(attachment));
}

export function latestImageAttachment(attachments: Attachment[]): Attachment | null {
  for (let index = attachments.length - 1; index >= 0; index -= 1) {
    if (isImageAttachment(attachments[index])) {
      return attachments[index];
    }
  }
  return null;
}

// Identify an image's type from its leading bytes. Preview bytes arrive from the
// backend as a raw binary buffer (not a JSON payload carrying a mime string), so we
// recover the type here to tag the Blob. Raster types are mostly cosmetic — the
// browser sniffs them anyway — but SVG must be declared as image/svg+xml or an
// <img> will refuse to render it.
export function sniffImageMimeType(bytes: Uint8Array): string {
  const startsWith = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);

  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (startsWith(0x47, 0x49, 0x46)) return "image/gif";
  if (startsWith(0x42, 0x4d)) return "image/bmp";
  // RIFF....WEBP
  if (startsWith(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  // ISO-BMFF box "ftyp" with an "avif"/"avis" brand.
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 && bytes[8] === 0x61 && bytes[9] === 0x76 && bytes[10] === 0x69) {
    return "image/avif";
  }
  // SVG is text; look for an <svg or <?xml opening past any leading whitespace/BOM.
  const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";

  return "application/octet-stream";
}

