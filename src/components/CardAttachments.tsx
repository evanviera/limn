import type { Attachment } from "../types";
import { formatFileSize } from "../lib/format";
import { Icon } from "./icons";
import type { ContextMenuItem, OpenContextMenu } from "./contextMenu";

// Presentational attachments section for the card editor. All file I/O lives in
// App/storage; this component only renders the list and reports intent through
// props, so it extracts and tests mechanically.
export function CardAttachments({
  attachments,
  busy,
  onAdd,
  onOpen,
  onRemove,
  onOpenContextMenu,
  onCopyText
}: {
  attachments: Attachment[];
  busy: boolean;
  onAdd: () => void;
  onOpen: (attachment: Attachment) => void;
  onRemove: (attachment: Attachment) => void;
  onOpenContextMenu: OpenContextMenu;
  onCopyText: (text: string) => Promise<void>;
}) {
  function attachmentContextItems(attachment: Attachment): ContextMenuItem[] {
    return [
      { label: "Open attachment", icon: "chevron-up-right", onSelect: () => onOpen(attachment) },
      { label: "Copy file name", icon: "copy", disabled: !attachment.name.trim(), onSelect: () => void onCopyText(attachment.name) },
      { type: "separator" },
      { label: "Remove attachment", icon: "trash", danger: true, onSelect: () => onRemove(attachment) }
    ];
  }

  return (
    <section className="main-section attachments-section" aria-labelledby="attachments-heading">
      <div className="main-section-head">
        <div>
          <h3 id="attachments-heading">Attachments</h3>
          <p className="main-section-sub">
            {attachments.length === 0 ? "No files yet" : `${attachments.length} file${attachments.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <button data-testid="add-attachment" disabled={busy} onClick={onAdd}>
          <Icon name="paperclip" /> Add files
        </button>
      </div>
      {attachments.length === 0 && (
        <p className="section-empty">Attach screenshots, PDFs, or design files. Copies are stored alongside this card.</p>
      )}
      {attachments.length > 0 && (
        <ul className="attachment-list">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="attachment-row"
              data-testid={`attachment-${attachment.id}`}
              onContextMenu={(event) => onOpenContextMenu(event, attachmentContextItems(attachment), attachment.name)}
            >
              <button
                className="attachment-open"
                data-testid={`attachment-${attachment.id}-open`}
                title={`Open ${attachment.name}`}
                onClick={() => onOpen(attachment)}
              >
                <Icon name="paperclip" />
                <span className="attachment-name">{attachment.name}</span>
                <span className="attachment-size">{formatFileSize(attachment.size)}</span>
              </button>
              <button
                aria-label={`Remove ${attachment.name}`}
                className="attachment-remove subtask-remove"
                data-testid={`attachment-${attachment.id}-remove`}
                disabled={busy}
                title="Remove attachment"
                onClick={() => onRemove(attachment)}
              >
                <Icon name="x" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
