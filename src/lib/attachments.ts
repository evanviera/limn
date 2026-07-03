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

