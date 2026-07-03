import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  CSSProperties,
  FormEvent as ReactFormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import type { Attachment, Board, Card, Member, Subtask, SubtaskListItem } from "../types";
import { makeId, normalizeUrl, openExternal } from "../storage";
import { MAX_NAME_LENGTH } from "../lib/constants";
import { initials } from "../lib/format";
import { CardAttachments } from "./CardAttachments";
import {
  NOTE_INLINE_PATTERN,
  clampNumber,
  endOfNoteEditorRange,
  noteEditorHtmlMatches,
  noteEditorRange,
  renderNoteEditorHtml,
  selectNoteNodeContents,
  serializeNoteEditor
} from "../lib/noteFormat";
import { useModalKeys } from "../lib/useModalKeys";
import { Icon, LinkIcon, Spinner } from "./icons";
import { isEditableTextControl, textControlContextItems, writeClipboard } from "./contextMenu";
import type { ContextMenuItem, OpenContextMenu } from "./contextMenu";

type NoteLinkDraft = { mode: "selection" | "link"; label: string; url: string };

const CARD_EDITOR_SIDE_WIDTH_DEFAULT = 280;
const CARD_EDITOR_SIDE_WIDTH_MIN = 240;
const CARD_EDITOR_SIDE_WIDTH_MAX = 460;
const CARD_EDITOR_MAIN_WIDTH_MIN = 380;
const CARD_EDITOR_SPLITTER_WIDTH = 13;
const CARD_EDITOR_SPLITTER_KEY_STEP = 24;

export function CardEditor({
  card,
  workspacePath,
  boards,
  members,
  onSave,
  onClose,
  onArchive,
  onDelete,
  onAddAttachments,
  onRemoveAttachment,
  onOpenAttachment,
  onOpenContextMenu,
  onCopyText
}: {
  card: Card;
  workspacePath: string | null;
  boards: Board[];
  members: Member[];
  onSave: (card: Card) => Promise<void>;
  onClose: () => void;
  onArchive: (card: Card) => Promise<void>;
  onDelete: (card: Card) => Promise<void>;
  onAddAttachments: (cardId: string) => Promise<void>;
  onRemoveAttachment: (cardId: string, attachment: Attachment) => Promise<void>;
  onOpenAttachment: (cardId: string, attachment: Attachment) => Promise<void>;
  onOpenContextMenu: OpenContextMenu;
  onCopyText: (text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(card);
  const [saving, setSaving] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  const [sideWidth, setSideWidth] = useState(CARD_EDITOR_SIDE_WIDTH_DEFAULT);
  const [resizingColumns, setResizingColumns] = useState(false);
  // Which sub-tasks have their list-items section expanded. Kept out of the card
  // model since it's pure view state; reset whenever a different card opens.
  const [expandedSubtasks, setExpandedSubtasks] = useState<Set<string>>(() => new Set());
  const [linkDraft, setLinkDraft] = useState<NoteLinkDraft | null>(null);
  const editorRef = useRef<HTMLElement>(null);
  const cardEditorBodyRef = useRef<HTMLDivElement>(null);
  const notesInputRef = useRef<HTMLDivElement>(null);
  const notesLinkInputRef = useRef<HTMLInputElement>(null);
  const notesLinkLabelInputRef = useRef<HTMLInputElement>(null);
  const pendingNotesLinkRangeRef = useRef<Range | null>(null);
  const activeNotesLinkRef = useRef<HTMLAnchorElement | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const cardEditorBodyStyle = { "--card-editor-side-width": `${sideWidth}px` } as CSSProperties;
  const board = boards.find((item) => item.id === draft.boardId) ?? boards[0];
  const completedSubtasks = draft.subtasks.filter((subtask) => subtask.completed).length;

  // Reset the draft only when a *different* card opens. Attachment actions
  // persist the open card immediately (adding/removing files can't be deferred),
  // which replaces the `card` prop object; keying this on the id keeps the user's
  // unsaved title/notes/subtask edits when only that card's attachments change.
  useEffect(() => {
    setDraft(card);
    setLabelInput("");
    setExpandedSubtasks(new Set());
    setLinkDraft(null);
    activeNotesLinkRef.current = null;
    pendingNotesLinkRangeRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);
  useLayoutEffect(() => {
    const input = notesInputRef.current;
    if (!input) {
      return;
    }

    input.innerHTML = renderNoteEditorHtml(card.body);
  }, [card.id, card.body]);
  useModalKeys(editorRef, onClose);
  // Move focus into the dialog on open so keyboard users land inside it.
  useEffect(() => {
    editorRef.current?.focus();
  }, []);

  useEffect(() => {
    function saveFromMenu() {
      if (saving) {
        return;
      }
      setSaving(true);
      void onSave(draft)
        .catch(() => undefined)
        .finally(() => setSaving(false));
    }

    window.addEventListener("limn-save-card-editor", saveFromMenu);
    return () => window.removeEventListener("limn-save-card-editor", saveFromMenu);
  }, [draft, onSave, saving]);

  // Detach any live splitter-drag window listeners when the editor unmounts.
  useEffect(() => () => resizeCleanupRef.current?.(), []);

  function updateAssignee(memberId: string, checked: boolean) {
    setDraft((current) => ({
      ...current,
      assignees: checked ? [...current.assignees, memberId] : current.assignees.filter((id) => id !== memberId)
    }));
  }

  function addSubtask() {
    const id = makeId("subtask");
    setDraft((current) => ({
      ...current,
      subtasks: [...current.subtasks, { id, title: "", completed: false, url: "", items: [] }]
    }));
    // New sub-tasks open expanded so their list items are immediately reachable.
    setExpandedSubtasks((current) => new Set(current).add(id));
  }

  function toggleSubtaskExpanded(id: string) {
    setExpandedSubtasks((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function updateSubtask(id: string, patch: Partial<Subtask>) {
    setDraft((current) => ({
      ...current,
      subtasks: current.subtasks.map((subtask) => (subtask.id === id ? { ...subtask, ...patch } : subtask))
    }));
  }

  function removeSubtask(id: string) {
    setDraft((current) => ({
      ...current,
      subtasks: current.subtasks.filter((subtask) => subtask.id !== id)
    }));
  }

  function addSubtaskItem(subtaskId: string) {
    const item: SubtaskListItem = { id: makeId("subtask-item"), text: "", url: "" };
    setDraft((current) => ({
      ...current,
      subtasks: current.subtasks.map((subtask) => (subtask.id === subtaskId ? { ...subtask, items: [...subtask.items, item] } : subtask))
    }));
    // Reveal the items section if it was collapsed so the new row is visible.
    setExpandedSubtasks((current) => new Set(current).add(subtaskId));
  }

  function updateSubtaskItem(subtaskId: string, itemId: string, patch: Partial<SubtaskListItem>) {
    setDraft((current) => ({
      ...current,
      subtasks: current.subtasks.map((subtask) =>
        subtask.id === subtaskId
          ? {
              ...subtask,
              items: subtask.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item))
            }
          : subtask
      )
    }));
  }

  function removeSubtaskItem(subtaskId: string, itemId: string) {
    setDraft((current) => ({
      ...current,
      subtasks: current.subtasks.map((subtask) =>
        subtask.id === subtaskId
          ? {
              ...subtask,
              items: subtask.items.filter((item) => item.id !== itemId)
            }
          : subtask
      )
    }));
  }

  // Turn the pending input into one or more label chips. Accepts comma-separated
  // text so a paste like "launch, urgent" yields two chips; ignores duplicates
  // (case-insensitive) and blank entries.
  function commitLabels(raw: string) {
    const additions = raw
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
    setLabelInput("");
    if (additions.length === 0) {
      return;
    }
    setDraft((current) => {
      const next = [...current.labels];
      for (const label of additions) {
        if (!next.some((existing) => existing.toLowerCase() === label.toLowerCase())) {
          next.push(label);
        }
      }
      return { ...current, labels: next };
    });
  }

  function removeLabel(label: string) {
    setDraft((current) => ({ ...current, labels: current.labels.filter((item) => item !== label) }));
  }

  // Attachment add/remove persist to disk immediately (see the draft-reset note
  // above). Serialize them behind a busy flag so a slow copy can't be double-run.
  async function runAttachmentAction(action: () => Promise<void>) {
    if (attachmentBusy) {
      return;
    }
    setAttachmentBusy(true);
    try {
      await action();
    } finally {
      setAttachmentBusy(false);
    }
  }

  function cardEditorSideWidthFromPointer(clientX: number): number {
    const body = cardEditorBodyRef.current;
    if (!body) {
      return sideWidth;
    }

    const rect = body.getBoundingClientRect();
    const style = window.getComputedStyle(body);
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(style.paddingRight) || 0;
    const columnGap = Number.parseFloat(style.columnGap) || 0;
    const dividerCenterOffset = CARD_EDITOR_SPLITTER_WIDTH / 2 + columnGap;
    const requestedSideWidth = rect.right - paddingRight - clientX - dividerCenterOffset;
    return clampNumber(requestedSideWidth, CARD_EDITOR_SIDE_WIDTH_MIN, cardEditorSideWidthMax());
  }

  function cardEditorSideWidthMax(): number {
    const body = cardEditorBodyRef.current;
    if (!body) {
      return CARD_EDITOR_SIDE_WIDTH_MAX;
    }

    const rect = body.getBoundingClientRect();
    const style = window.getComputedStyle(body);
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(style.paddingRight) || 0;
    const columnGap = Number.parseFloat(style.columnGap) || 0;
    const usableWidth = rect.width - paddingLeft - paddingRight - CARD_EDITOR_SPLITTER_WIDTH - columnGap * 2;
    return clampNumber(usableWidth - CARD_EDITOR_MAIN_WIDTH_MIN, CARD_EDITOR_SIDE_WIDTH_MIN, CARD_EDITOR_SIDE_WIDTH_MAX);
  }

  function resizeCardEditorSideWidth(clientX: number) {
    setSideWidth(cardEditorSideWidthFromPointer(clientX));
  }

  function handleCardEditorSplitterPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setResizingColumns(true);
    resizeCardEditorSideWidth(event.clientX);

    // Track the drag on the window so it keeps resizing when the pointer leaves
    // the 13px splitter or the body scrolls. Listeners are attached synchronously
    // here (not via effect) so the first pointer-move after this event can't slip
    // through before they're live.
    resizeCleanupRef.current?.();
    const handleMove = (moveEvent: PointerEvent) => resizeCardEditorSideWidth(moveEvent.clientX);
    const stop = () => {
      setResizingColumns(false);
      resizeCleanupRef.current?.();
    };
    resizeCleanupRef.current = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      resizeCleanupRef.current = null;
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  function handleCardEditorSplitterKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? CARD_EDITOR_SPLITTER_KEY_STEP * 2 : CARD_EDITOR_SPLITTER_KEY_STEP;
    const maxSideWidth = cardEditorSideWidthMax();
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSideWidth((current) => clampNumber(current + step, CARD_EDITOR_SIDE_WIDTH_MIN, maxSideWidth));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setSideWidth((current) => clampNumber(current - step, CARD_EDITOR_SIDE_WIDTH_MIN, maxSideWidth));
    } else if (event.key === "Home") {
      event.preventDefault();
      setSideWidth(CARD_EDITOR_SIDE_WIDTH_MIN);
    } else if (event.key === "End") {
      event.preventDefault();
      setSideWidth(maxSideWidth);
    } else if (event.key === "Enter") {
      event.preventDefault();
      setSideWidth(clampNumber(CARD_EDITOR_SIDE_WIDTH_DEFAULT, CARD_EDITOR_SIDE_WIDTH_MIN, maxSideWidth));
    }
  }

  function syncNotesFromEditor(): string {
    const input = notesInputRef.current;
    if (!input) {
      return draft.body;
    }

    const body = serializeNoteEditor(input);
    setDraft((current) => (current.body === body ? current : { ...current, body }));
    return body;
  }

  function placeNotesCaretAtEnd() {
    const input = notesInputRef.current;
    if (!input) {
      return;
    }

    const range = endOfNoteEditorRange(input);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function refreshNotesRenderingIfNeeded(body: string) {
    const input = notesInputRef.current;
    if (!input) {
      return;
    }

    const rendered = renderNoteEditorHtml(body);
    if (noteEditorHtmlMatches(input, rendered)) {
      return;
    }

    input.innerHTML = rendered;
    placeNotesCaretAtEnd();
  }

  function handleNotesInput() {
    const body = syncNotesFromEditor();
    if (NOTE_INLINE_PATTERN.test(body)) {
      NOTE_INLINE_PATTERN.lastIndex = 0;
      refreshNotesRenderingIfNeeded(body);
    }
    NOTE_INLINE_PATTERN.lastIndex = 0;
  }

  function notesLinkFromTarget(target: EventTarget | null): HTMLAnchorElement | null {
    if (!(target instanceof Element)) {
      return null;
    }

    const link = target.closest<HTMLAnchorElement>('a[data-note-link="true"]');
    return link && notesInputRef.current?.contains(link) ? link : null;
  }

  function clearActiveNotesLink() {
    if (activeNotesLinkRef.current) {
      activeNotesLinkRef.current.dataset.active = "false";
    }
    activeNotesLinkRef.current = null;
  }

  function editNotesLink(link: HTMLAnchorElement) {
    clearActiveNotesLink();
    activeNotesLinkRef.current = link;
    link.dataset.active = "true";
    pendingNotesLinkRangeRef.current = null;
    setLinkDraft({
      mode: "link",
      label: link.textContent || link.dataset.noteOriginalText || "link text",
      url: link.dataset.noteUrl || link.getAttribute("href") || ""
    });
    window.requestAnimationFrame(() => {
      notesLinkLabelInputRef.current?.focus();
      notesLinkLabelInputRef.current?.select();
    });
  }

  function insertFormattedNotesText(tagName: "strong" | "em", fallbackText: string) {
    const input = notesInputRef.current;
    if (!input) {
      return;
    }

    input.focus();
    const range = noteEditorRange(input) ?? endOfNoteEditorRange(input);
    const selectedText = range.toString();
    const wrapper = document.createElement(tagName);
    wrapper.textContent = selectedText || fallbackText;
    range.deleteContents();
    range.insertNode(wrapper);
    selectNoteNodeContents(wrapper);
    syncNotesFromEditor();
  }

  function replaceNotesSelectionWithText(text: string) {
    const input = notesInputRef.current;
    if (!input) {
      return;
    }

    input.focus();
    const range = noteEditorRange(input) ?? endOfNoteEditorRange(input);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    syncNotesFromEditor();
  }

  function selectAllNotes() {
    const input = notesInputRef.current;
    if (!input) {
      return;
    }

    input.focus();
    selectNoteNodeContents(input);
  }

  function handleNotesPaste(event: ReactClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    replaceNotesSelectionWithText(event.clipboardData.getData("text/plain"));
  }

  function handleNotesLinkClick(event: ReactMouseEvent<HTMLDivElement>) {
    const link = notesLinkFromTarget(event.target);
    if (!link) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    editNotesLink(link);
  }

  function handleNotesLinkKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const link = notesLinkFromTarget(event.target);
    if (!link || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }

    event.preventDefault();
    editNotesLink(link);
  }

  function noteEditorContextItems(): ContextMenuItem[] {
    const selection = window.getSelection();
    const hasSelection = Boolean(selection && !selection.isCollapsed && notesInputRef.current?.contains(selection.anchorNode));
    return [
      { label: "Copy", icon: "copy", disabled: !hasSelection, onSelect: () => void writeClipboard(selection?.toString() ?? "") },
      { label: "Paste", icon: "clipboard", disabled: !navigator.clipboard?.readText, onSelect: async () => replaceNotesSelectionWithText(await navigator.clipboard.readText()) },
      { label: "Select all", icon: "check", disabled: !draft.body, onSelect: selectAllNotes },
      { type: "separator" },
      { label: "Bold", icon: "edit", onSelect: formatNotesAsBold },
      { label: "Italic", icon: "edit", onSelect: formatNotesAsItalic },
      { label: "Create link", icon: "chevron-up-right", onSelect: formatNotesAsLink }
    ];
  }

  function noteLinkContextItems(link: HTMLAnchorElement): ContextMenuItem[] {
    const url = link.dataset.noteUrl || link.getAttribute("href") || "";
    return [
      { label: "Edit link", icon: "edit", onSelect: () => editNotesLink(link) },
      { label: "Open link", icon: "chevron-up-right", onSelect: () => void openExternal(url) },
      { label: "Copy link", icon: "copy", onSelect: () => void onCopyText(url) },
      { label: "Remove link", icon: "x", onSelect: removeNotesLink }
    ];
  }

  function handleNotesContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    const link = notesLinkFromTarget(event.target);
    if (link) {
      editNotesLink(link);
      onOpenContextMenu(event, noteLinkContextItems(link), link.textContent || "Link");
      return;
    }

    onOpenContextMenu(event, noteEditorContextItems(), "Notes");
  }

  function updateNotesLinkDraft(patch: Partial<NoteLinkDraft>) {
    setLinkDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function makeNotesAnchor(label: string, url: string): HTMLAnchorElement {
    const normalizedUrl = normalizeUrl(url);
    const anchor = document.createElement("a");
    anchor.href = normalizedUrl;
    anchor.textContent = label;
    anchor.contentEditable = "false";
    anchor.tabIndex = 0;
    anchor.dataset.noteLink = "true";
    anchor.dataset.noteUrl = normalizedUrl;
    anchor.dataset.noteOriginalText = label;
    anchor.dataset.noteBare = "false";
    return anchor;
  }

  function replaceNotesLinkDraft(event: ReactFormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!linkDraft) {
      return;
    }

    const normalizedUrl = normalizeUrl(linkDraft.url);
    if (!linkDraft.url.trim() || normalizedUrl === "https://") {
      return;
    }

    const input = notesInputRef.current;
    const label = linkDraft.label.trim() || "link text";
    if (linkDraft.mode === "link" && activeNotesLinkRef.current) {
      const link = activeNotesLinkRef.current;
      link.href = normalizedUrl;
      link.textContent = label;
      link.dataset.noteUrl = normalizedUrl;
      link.dataset.noteOriginalText = label;
      link.dataset.noteBare = "false";
      selectNoteNodeContents(link);
    } else if (input) {
      input.focus();
      const range = pendingNotesLinkRangeRef.current ?? noteEditorRange(input) ?? endOfNoteEditorRange(input);
      const anchor = makeNotesAnchor(label, normalizedUrl);
      range.deleteContents();
      range.insertNode(anchor);
      selectNoteNodeContents(anchor);
    }

    setLinkDraft(null);
    clearActiveNotesLink();
    pendingNotesLinkRangeRef.current = null;
    syncNotesFromEditor();
    window.requestAnimationFrame(() => {
      notesInputRef.current?.focus();
    });
  }

  function formatNotesAsBold() {
    insertFormattedNotesText("strong", "bold text");
  }

  function formatNotesAsItalic() {
    insertFormattedNotesText("em", "italic text");
  }

  function formatNotesAsLink() {
    const input = notesInputRef.current;
    if (!input) {
      return;
    }

    const activeLink = activeNotesLinkRef.current;
    if (activeLink) {
      editNotesLink(activeLink);
      return;
    }

    input.focus();
    const range = noteEditorRange(input) ?? endOfNoteEditorRange(input);
    pendingNotesLinkRangeRef.current = range.cloneRange();
    const selectedText = range.toString();
    const isSelectedUrl = /^(https?:\/\/|www\.)/i.test(selectedText);
    setLinkDraft({
      mode: "selection",
      label: selectedText || "link text",
      url: isSelectedUrl ? normalizeUrl(selectedText) : ""
    });
    window.requestAnimationFrame(() => {
      notesLinkInputRef.current?.focus();
    });
  }

  function removeNotesLink() {
    const link = activeNotesLinkRef.current;
    if (!link) {
      return;
    }

    const textNode = document.createTextNode(link.textContent || link.dataset.noteOriginalText || "");
    link.replaceWith(textNode);
    setLinkDraft(null);
    clearActiveNotesLink();
    syncNotesFromEditor();
    notesInputRef.current?.focus();
  }

  function openNotesLinkDraft() {
    if (!linkDraft?.url.trim()) {
      return;
    }

    void openExternal(normalizeUrl(linkDraft.url));
  }

  function cardEditorContextItems(): ContextMenuItem[] {
    return [
      { label: "Save card", icon: "save", disabled: saving, onSelect: () => void onSave(draft) },
      {
        label: draft.completed ? "Mark incomplete" : "Mark complete",
        icon: "check",
        disabled: saving,
        onSelect: () => {
          setDraft((current) => ({ ...current, completed: !current.completed }));
        }
      },
      { label: "Copy title", icon: "copy", disabled: !draft.title.trim(), onSelect: () => void onCopyText(draft.title) },
      { label: "Close editor", icon: "x", onSelect: onClose },
      { type: "separator" },
      { label: "Archive card", icon: "archive", disabled: saving, onSelect: () => void onArchive(draft) },
      { label: "Delete card", icon: "trash", danger: true, disabled: saving, onSelect: () => void onDelete(draft) }
    ];
  }

  function subtaskContextItems(subtask: Subtask, isExpanded: boolean): ContextMenuItem[] {
    const title = subtask.title || subtask.url || "Untitled step";
    return [
      {
        label: subtask.completed ? "Mark step incomplete" : "Mark step complete",
        icon: "check",
        onSelect: () => updateSubtask(subtask.id, { completed: !subtask.completed })
      },
      {
        label: isExpanded ? "Hide details" : "Show details",
        icon: "chevron-down",
        onSelect: () => toggleSubtaskExpanded(subtask.id)
      },
      { label: "Add detail", icon: "plus", onSelect: () => addSubtaskItem(subtask.id) },
      { label: "Copy step title", icon: "copy", disabled: !title.trim(), onSelect: () => void onCopyText(title) },
      ...(subtask.url.trim()
        ? ([
            { type: "separator" },
            { label: "Open step link", icon: "chevron-up-right", onSelect: () => void openExternal(subtask.url) },
            { label: "Copy step link", icon: "copy", onSelect: () => void onCopyText(subtask.url) }
          ] satisfies ContextMenuItem[])
        : []),
      { type: "separator" },
      { label: "Remove step", icon: "trash", danger: true, onSelect: () => removeSubtask(subtask.id) }
    ];
  }

  function subtaskItemContextItems(subtask: Subtask, item: SubtaskListItem): ContextMenuItem[] {
    const text = item.text || item.url || "Untitled detail";
    return [
      { label: "Copy detail text", icon: "copy", disabled: !text.trim(), onSelect: () => void onCopyText(text) },
      ...(item.url.trim()
        ? ([
            { type: "separator" },
            { label: "Open detail link", icon: "chevron-up-right", onSelect: () => void openExternal(item.url) },
            { label: "Copy detail link", icon: "copy", onSelect: () => void onCopyText(item.url) }
          ] satisfies ContextMenuItem[])
        : []),
      { type: "separator" },
      { label: "Remove detail", icon: "trash", danger: true, onSelect: () => removeSubtaskItem(subtask.id, item.id) }
    ];
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <aside
        aria-label="Edit card"
        aria-modal="true"
        className={`card-editor ${resizingColumns ? "is-resizing-columns" : ""}`}
        ref={editorRef}
        role="dialog"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => {
          if (isEditableTextControl(event.target)) {
            onOpenContextMenu(event, textControlContextItems(event.target));
            return;
          }
          onOpenContextMenu(event, cardEditorContextItems(), draft.title || "Card");
        }}
      >
        <header className="card-editor-header">
          <div className="card-editor-heading">
            <p className="eyebrow">Edit card</p>
            <h2>{board ? `${board.name} / ${board.lists.find((list) => list.id === draft.listId)?.name ?? "Unlisted"}` : "Card details"}</h2>
          </div>
          <button aria-label="Close" className="icon-button" disabled={saving} title="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>

        <div className="card-editor-body" data-testid="card-editor-body" ref={cardEditorBodyRef} style={cardEditorBodyStyle}>
          <div className="card-editor-main">
            <label className="title-field">
              <span className="field-label">Title</span>
              <input
                data-testid="card-title-input"
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                placeholder="Card title"
              />
            </label>

            <section className="main-section" aria-labelledby="subtasks-heading">
              <div className="main-section-head">
                <div>
                  <h3 id="subtasks-heading">Checklist</h3>
                  <p className="main-section-sub">
                    {draft.subtasks.length === 0 ? "No steps yet" : `${completedSubtasks} of ${draft.subtasks.length} complete`}
                  </p>
                </div>
                <button data-testid="add-subtask" onClick={addSubtask}>
                  <Icon name="plus" /> Add step
                </button>
              </div>
              {draft.subtasks.length === 0 && <p className="section-empty">Add a step when this card needs a checklist.</p>}
              {draft.subtasks.length > 0 && (
                <div className="subtask-list">
                  {draft.subtasks.map((subtask) => {
                    const isExpanded = expandedSubtasks.has(subtask.id);
                    const itemCount = subtask.items.length;
                    const hasUrl = subtask.url.trim().length > 0;
                    return (
                      <div
                        key={subtask.id}
                        className={`subtask-block ${subtask.completed ? "completed" : ""}`}
                        onContextMenu={(event) => {
                          if (isEditableTextControl(event.target)) {
                            onOpenContextMenu(event, textControlContextItems(event.target));
                            return;
                          }
                          onOpenContextMenu(event, subtaskContextItems(subtask, isExpanded), subtask.title || "Step");
                        }}
                      >
                        <div className="subtask-head">
                          <input
                            className="subtask-check"
                            checked={subtask.completed}
                            data-testid={`subtask-${subtask.id}-toggle`}
                            type="checkbox"
                            aria-label="Mark sub-task complete"
                            onChange={(event) => updateSubtask(subtask.id, { completed: event.target.checked })}
                          />
                          <input
                            className="subtask-title"
                            data-testid={`subtask-${subtask.id}-title`}
                            value={subtask.title}
                            onChange={(event) => updateSubtask(subtask.id, { title: event.target.value })}
                            placeholder="Step"
                          />
                          <button
                            className="subtask-expand"
                            data-expanded={isExpanded}
                            aria-expanded={isExpanded}
                            aria-label={isExpanded ? "Hide list items" : "Show list items"}
                            title={isExpanded ? "Hide list items" : "Show list items"}
                            onClick={() => toggleSubtaskExpanded(subtask.id)}
                          >
                            {itemCount > 0 && <span className="subtask-count">{itemCount}</span>}
                            <Icon name="chevron-down" />
                          </button>
                          <button
                            aria-label="Remove sub-task"
                            className="subtask-remove"
                            data-testid={`subtask-${subtask.id}-remove`}
                            title="Remove sub-task"
                            onClick={() => removeSubtask(subtask.id)}
                          >
                            <Icon name="x" />
                          </button>
                        </div>
                        {(isExpanded || hasUrl) && (
                          <div className={`link-line ${hasUrl ? "has-url" : ""}`}>
                            <LinkIcon />
                            <input
                              className="link-input"
                              data-testid={`subtask-${subtask.id}-url`}
                              value={subtask.url}
                              onChange={(event) => updateSubtask(subtask.id, { url: event.target.value })}
                              placeholder="Add link"
                            />
                            {hasUrl && (
                              <button
                                aria-label="Open link"
                                className="link-open"
                                data-testid={`subtask-${subtask.id}-open`}
                                title="Open link"
                                onClick={() => void openExternal(subtask.url.trim())}
                              >
                                <Icon name="chevron-up-right" />
                              </button>
                            )}
                          </div>
                        )}
                        {isExpanded && (
                          <div className="subtask-items-editor">
                            {itemCount > 0 && (
                              <ul className="subtask-item-list">
                                {subtask.items.map((item) => {
                                  const itemHasUrl = item.url.trim().length > 0;
                                  return (
                                    <li
                                      key={item.id}
                                      className="subtask-item-row"
                                      onContextMenu={(event) => {
                                        if (isEditableTextControl(event.target)) {
                                          onOpenContextMenu(event, textControlContextItems(event.target));
                                          return;
                                        }
                                        onOpenContextMenu(event, subtaskItemContextItems(subtask, item), item.text || "Detail");
                                      }}
                                    >
                                      <span className="subtask-item-bullet" aria-hidden="true" />
                                      <input
                                        className="subtask-item-text"
                                        data-testid={`subtask-item-${item.id}-text`}
                                        value={item.text}
                                        onChange={(event) => updateSubtaskItem(subtask.id, item.id, { text: event.target.value })}
                                        placeholder="List item"
                                      />
                                      <div className={`link-line ${itemHasUrl ? "has-url" : ""}`}>
                                        <LinkIcon />
                                        <input
                                          className="link-input"
                                          data-testid={`subtask-item-${item.id}-url`}
                                          value={item.url}
                                          onChange={(event) => updateSubtaskItem(subtask.id, item.id, { url: event.target.value })}
                                          placeholder="Add link"
                                        />
                                        {itemHasUrl && (
                                          <button
                                            aria-label="Open list item link"
                                            className="link-open"
                                            data-testid={`subtask-item-${item.id}-open`}
                                            title="Open link"
                                            onClick={() => void openExternal(item.url.trim())}
                                          >
                                            <Icon name="chevron-up-right" />
                                          </button>
                                        )}
                                      </div>
                                      <button
                                        aria-label="Remove list item"
                                        className="subtask-remove"
                                        data-testid={`subtask-item-${item.id}-remove`}
                                        title="Remove list item"
                                        onClick={() => removeSubtaskItem(subtask.id, item.id)}
                                      >
                                        <Icon name="x" />
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                            <button
                              className="subtask-add-item"
                              data-testid={`subtask-${subtask.id}-add-item`}
                              onClick={() => addSubtaskItem(subtask.id)}
                            >
                              <Icon name="plus" /> Add detail
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <CardAttachments
              attachments={card.attachments}
              workspacePath={workspacePath}
              cardId={card.id}
              busy={attachmentBusy}
              onAdd={() => void runAttachmentAction(() => onAddAttachments(card.id))}
              onOpen={(attachment) => void onOpenAttachment(card.id, attachment)}
              onRemove={(attachment) => void runAttachmentAction(() => onRemoveAttachment(card.id, attachment))}
              onOpenContextMenu={onOpenContextMenu}
              onCopyText={onCopyText}
            />

            <section className="main-section notes-editor" aria-labelledby="notes-heading">
              <div className="main-section-head notes-editor-header">
                <h3 id="notes-heading">Notes</h3>
                <div className="notes-toolbar" aria-label="Notes formatting">
                  <button
                    aria-label="Bold"
                    className="notes-tool"
                    data-testid="notes-bold"
                    title="Bold"
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={formatNotesAsBold}
                  >
                    <strong>B</strong>
                  </button>
                  <button
                    aria-label="Italic"
                    className="notes-tool"
                    data-testid="notes-italic"
                    title="Italic"
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={formatNotesAsItalic}
                  >
                    <em>I</em>
                  </button>
                  <button
                    aria-label="Create link"
                    className="notes-tool"
                    data-testid="notes-link"
                    title="Create link"
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={formatNotesAsLink}
                  >
                    <LinkIcon />
                  </button>
                </div>
              </div>
              {linkDraft && (
                <form className="notes-link-form" data-testid="notes-link-form" onSubmit={replaceNotesLinkDraft}>
                  <input
                    aria-label="Link text"
                    data-testid="notes-link-label"
                    placeholder="Link text"
                    ref={notesLinkLabelInputRef}
                    value={linkDraft.label}
                    onChange={(event) => updateNotesLinkDraft({ label: event.target.value })}
                  />
                  <input
                    aria-label="Link URL"
                    data-testid="notes-link-url"
                    placeholder="https://example.com"
                    ref={notesLinkInputRef}
                    value={linkDraft.url}
                    onChange={(event) => updateNotesLinkDraft({ url: event.target.value })}
                  />
                  <button className="primary" data-testid="notes-link-apply" type="submit">
                    {linkDraft.mode === "link" ? "Update" : "Apply"}
                  </button>
                  {linkDraft.mode === "link" && (
                    <>
                      <button data-testid="notes-link-open" type="button" onClick={openNotesLinkDraft}>
                        Open
                      </button>
                      <button data-testid="notes-link-remove" type="button" onClick={removeNotesLink}>
                        Remove link
                      </button>
                    </>
                  )}
                  <button
                    data-testid="notes-link-cancel"
                    type="button"
                    onClick={() => {
                      setLinkDraft(null);
                      clearActiveNotesLink();
                      pendingNotesLinkRangeRef.current = null;
                      notesInputRef.current?.focus();
                    }}
                  >
                    Cancel
                  </button>
                </form>
              )}
              <div
                aria-labelledby="notes-heading"
                aria-multiline="true"
                className="notes-rich-input"
                contentEditable
                data-testid="card-notes-input"
                data-placeholder="Add notes"
                ref={notesInputRef}
                role="textbox"
                suppressContentEditableWarning
                onClick={handleNotesLinkClick}
                onInput={handleNotesInput}
                onKeyDown={handleNotesLinkKeyDown}
                onPaste={handleNotesPaste}
                onContextMenu={handleNotesContextMenu}
              />
            </section>
          </div>

          <div
            aria-label="Resize card detail columns"
            aria-orientation="vertical"
            aria-valuemax={CARD_EDITOR_SIDE_WIDTH_MAX}
            aria-valuemin={CARD_EDITOR_SIDE_WIDTH_MIN}
            aria-valuenow={Math.round(sideWidth)}
            className="card-editor-splitter"
            data-testid="card-editor-splitter"
            role="separator"
            tabIndex={0}
            title="Resize columns"
            onKeyDown={handleCardEditorSplitterKeyDown}
            onPointerDown={handleCardEditorSplitterPointerDown}
          />

          <aside className="card-editor-side" aria-label="Card properties" data-testid="card-editor-side">
            <div className="side-section">
              <span className="side-heading">Status</span>
              <label
                className="status-toggle"
                data-checked={draft.completed}
                onContextMenu={(event) => onOpenContextMenu(event, [
                  {
                    label: draft.completed ? "Mark incomplete" : "Mark complete",
                    icon: "check",
                    onSelect: () => setDraft({ ...draft, completed: !draft.completed })
                  }
                ], "Status")}
              >
                <input
                  data-testid="card-completed-input"
                  type="checkbox"
                  checked={draft.completed}
                  onChange={(event) => setDraft({ ...draft, completed: event.target.checked })}
                />
                <span>{draft.completed ? "Completed" : "Mark complete"}</span>
              </label>
            </div>

            <div className="side-section">
              <span className="side-heading">Details</span>
              <label className="side-field side-field-select">
                <span>Board</span>
                <select
                  data-testid="card-board-select"
                  value={draft.boardId}
                  onChange={(event) => {
                    const nextBoard = boards.find((item) => item.id === event.target.value);
                    setDraft({ ...draft, boardId: event.target.value, listId: nextBoard?.lists[0]?.id ?? "" });
                  }}
                >
                  {boards.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="side-field side-field-select">
                <span>List</span>
                <select data-testid="card-list-select" value={draft.listId} onChange={(event) => setDraft({ ...draft, listId: event.target.value })}>
                  {board?.lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
              </label>
              <label
                className="side-field side-field-date"
                onContextMenu={(event) => onOpenContextMenu(event, [
                  { label: "Clear due date", icon: "x", disabled: !draft.due, onSelect: () => setDraft({ ...draft, due: "" }) },
                  { label: "Copy due date", icon: "copy", disabled: !draft.due, onSelect: () => void onCopyText(draft.due) }
                ], "Due date")}
              >
                <Icon name="calendar" />
                <span>Due date</span>
                <input data-testid="card-due-input" type="date" value={draft.due} onChange={(event) => setDraft({ ...draft, due: event.target.value })} />
              </label>
            </div>

            <div className="side-section">
              <span className="side-heading">Assignees</span>
              <div className="assignee-list">
                {members.length === 0 && <p className="empty-inline">Add members before assigning cards.</p>}
                {members.map((member) => (
                  <label
                    key={member.id}
                    className={`assignee-option ${draft.assignees.includes(member.id) ? "checked" : ""}`}
                    onContextMenu={(event) => onOpenContextMenu(event, [
                      {
                        label: draft.assignees.includes(member.id) ? "Unassign member" : "Assign member",
                        icon: "users",
                        onSelect: () => updateAssignee(member.id, !draft.assignees.includes(member.id))
                      },
                      { label: "Copy member name", icon: "copy", onSelect: () => void onCopyText(member.name) }
                    ], member.name)}
                  >
                    <input
                      checked={draft.assignees.includes(member.id)}
                      data-testid={`assignee-${member.id}`}
                      type="checkbox"
                      onChange={(event) => updateAssignee(member.id, event.target.checked)}
                    />
                    <span className="avatar small" style={{ background: member.color }}>
                      {initials(member.name)}
                    </span>
                    <span className="assignee-name">{member.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="side-section">
              <span className="side-heading"><Icon name="tag" /> Labels</span>
              <div className="label-field">
                {draft.labels.length > 0 && (
                  <div className="label-chips">
                    {draft.labels.map((label) => (
                      <span
                        className="label-chip"
                        key={label}
                        onContextMenu={(event) => onOpenContextMenu(event, [
                          { label: "Copy label", icon: "copy", onSelect: () => void onCopyText(label) },
                          { type: "separator" },
                          { label: "Remove label", icon: "x", danger: true, onSelect: () => removeLabel(label) }
                        ], label)}
                      >
                        <span className="label-chip-text">{label}</span>
                        <button
                          className="label-chip-remove"
                          type="button"
                          aria-label={`Remove label ${label}`}
                          title={`Remove ${label}`}
                          onClick={() => removeLabel(label)}
                        >
                          <Icon name="x" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  className="label-input"
                  data-testid="card-labels-input"
                  value={labelInput}
                  onChange={(event) => setLabelInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      commitLabels(labelInput);
                    } else if (event.key === "Backspace" && labelInput === "" && draft.labels.length > 0) {
                      removeLabel(draft.labels[draft.labels.length - 1]);
                    }
                  }}
                  onBlur={() => commitLabels(labelInput)}
                  placeholder="Add label…"
                />
              </div>
            </div>

            <div className="side-section side-activity">
              <span className="side-heading">Activity</span>
              {draft.activity.length === 0 && <p className="empty-inline">No activity yet.</p>}
              {draft.activity.slice(0, 8).map((event) => (
                <div className="activity-row" key={event.id}>
                  <time>{new Date(event.createdAt).toLocaleString()}</time>
                  <span>{event.message}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>

        <footer>
          <div className="destructive-actions">
            <button data-testid="archive-card" disabled={saving} onClick={() => void onArchive(draft)}>
              <Icon name="archive" /> Archive
            </button>
            <button data-testid="delete-card" disabled={saving} onClick={() => void onDelete(draft)}>
              <Icon name="trash" /> Delete
            </button>
          </div>
          <button
            className="primary"
            data-testid="save-card"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void onSave(draft)
                .then(onClose)
                .catch(() => setSaving(false));
            }}
          >
            {saving ? (
              <>
                <Spinner /> Saving…
              </>
            ) : (
              <>
                <Icon name="save" /> Save
              </>
            )}
          </button>
        </footer>
      </aside>
    </div>
  );
}
