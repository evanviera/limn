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
import { isImageAttachment } from "../lib/attachments";
import { cardDeepLink } from "../lib/deepLink";
import { CardAttachments } from "./CardAttachments";
import { CardComments } from "./CardComments";
import {
  CardEditorDropzone,
  CardEditorFooter,
  CardEditorHeader,
  CardEditorLightbox,
  CardEditorSidePanel,
  CardEditorSplitter,
  CardEditorTitleField,
  ChecklistEditor,
  NotesEditor
} from "./CardEditorEditSections.js";
import type { NoteLinkDraft } from "./CardEditorEditSections";
import { CardViewPanel } from "./CardViewPanel";
import {
  NOTE_INLINE_PATTERN,
  clampNumber,
  endOfNoteEditorRange,
  exitNoteFormatRun,
  noteEditorHtmlMatches,
  noteEditorRange,
  noteFormatAncestor,
  renderNoteEditorHtml,
  selectNoteNodeContents,
  serializeNoteEditor,
  unwrapNoteFormat
} from "../lib/noteFormat";
import { useModalKeys } from "../lib/useModalKeys";
import { isEditableTextControl, textControlContextItems, writeClipboard } from "./contextMenu";
import type { ContextMenuItem, OpenContextMenu } from "./contextMenu";

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
  activeMember,
  fileDragActive,
  initialMode = "view",
  onSave,
  onClose,
  onArchive,
  onDelete,
  onAddAttachments,
  onRemoveAttachment,
  onOpenAttachment,
  onRevealAttachment,
  onSelectActiveMember,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onOpenContextMenu,
  onCopyText
}: {
  card: Card;
  workspacePath: string | null;
  boards: Board[];
  members: Member[];
  activeMember: Member | null;
  initialMode?: "view" | "edit";
  // True while files are being dragged over the window, so the editor can invite
  // a drop. The actual attach happens in App (it owns the dropped paths).
  fileDragActive: boolean;
  onSave: (card: Card) => Promise<void>;
  onClose: () => void;
  onArchive: (card: Card) => Promise<void>;
  onDelete: (card: Card) => Promise<void>;
  onAddAttachments: (cardId: string) => Promise<void>;
  onRemoveAttachment: (cardId: string, attachment: Attachment) => Promise<void>;
  onOpenAttachment: (cardId: string, attachment: Attachment) => Promise<void>;
  onRevealAttachment: (cardId: string, attachment: Attachment) => Promise<void>;
  onSelectActiveMember: (memberId: string) => void;
  onAddComment: (cardId: string, body: string) => Promise<void>;
  onEditComment: (cardId: string, commentId: string, body: string) => Promise<void>;
  onDeleteComment: (cardId: string, commentId: string) => Promise<void>;
  onOpenContextMenu: OpenContextMenu;
  onCopyText: (text: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"view" | "edit">(initialMode);
  const [draft, setDraft] = useState(card);
  const [saving, setSaving] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  // Index into `imageAttachments` of the image open in the lightbox, or null when
  // it's closed. Image attachments open in the viewer; other files open natively.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
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
  const cardBoard = boards.find((item) => item.id === card.boardId);
  const listName = cardBoard?.lists.find((list) => list.id === card.listId)?.name ?? "";
  const completedSubtasks = draft.subtasks.filter((subtask) => subtask.completed).length;
  // Attachments persist immediately, so the lightbox reads the saved `card`
  // (not `draft`) — same source the attachments list renders from.
  const imageAttachments = card.attachments.filter(isImageAttachment);
  const lightboxAttachment = lightboxIndex === null ? null : imageAttachments[lightboxIndex] ?? null;

  // Reset the draft only when a *different* card opens. Attachment actions
  // persist the open card immediately (adding/removing files can't be deferred),
  // which replaces the `card` prop object; keying this on the id keeps the user's
  // unsaved title/notes/subtask edits when only that card's attachments change.
  useEffect(() => {
    setMode(initialMode);
    setDraft(card);
    setLabelInput("");
    setExpandedSubtasks(new Set());
    setLinkDraft(null);
    setLightboxIndex(null);
    activeNotesLinkRef.current = null;
    pendingNotesLinkRangeRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, initialMode]);
  useLayoutEffect(() => {
    const input = notesInputRef.current;
    if (!input) {
      return;
    }

    input.innerHTML = renderNoteEditorHtml(card.body);
  }, [card.id, card.body, mode]);
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

  // Image attachments open in the in-app lightbox; everything else opens in the
  // OS default app. The lightbox flips through image attachments only, so we map
  // the clicked attachment to its position within that filtered list.
  function openAttachment(attachment: Attachment) {
    if (isImageAttachment(attachment)) {
      const position = imageAttachments.findIndex((item) => item.id === attachment.id);
      if (position >= 0) {
        setLightboxIndex(position);
        return;
      }
    }
    void onOpenAttachment(card.id, attachment);
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

  async function saveCardPatch(patch: Partial<Card>) {
    if (saving) {
      return;
    }
    setSaving(true);
    try {
      await onSave({ ...card, ...patch });
    } finally {
      setSaving(false);
    }
  }

  function toggleViewSubtask(subtask: Subtask, completed: boolean) {
    void saveCardPatch({
      subtasks: card.subtasks.map((item) => (item.id === subtask.id ? { ...item, completed } : item))
    });
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
    const startFormat = noteFormatAncestor(range.startContainer, tagName, input);

    if (!selectedText) {
      if (startFormat) {
        // Caret sits inside an emphasis run: turn the format off so the next
        // keystrokes are unformatted. This is the "toggle off, keep typing"
        // gesture and it writes no stray markers.
        exitNoteFormatRun(startFormat);
        return;
      }

      // Turn the format on: seed a single clean emphasis run with placeholder
      // text the user immediately overwrites.
      const wrapper = document.createElement(tagName);
      wrapper.textContent = fallbackText;
      range.insertNode(wrapper);
      selectNoteNodeContents(wrapper);
      syncNotesFromEditor();
      return;
    }

    const endFormat = noteFormatAncestor(range.endContainer, tagName, input);
    if (startFormat && startFormat === endFormat) {
      // The selection already lives inside one emphasis run of this type — including
      // the just-inserted placeholder — so toggle it off by unwrapping instead of
      // nesting another run (which is what produced the stray `****`).
      unwrapNoteFormat(startFormat);
      syncNotesFromEditor();
      return;
    }

    // Wrap the selection as plain text so the run never nests another marker.
    const wrapper = document.createElement(tagName);
    wrapper.textContent = selectedText;
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
      { label: "Copy card link", icon: "copy", onSelect: () => void onCopyText(cardDeepLink(draft.id)) },
      { label: "Close editor", icon: "x", onSelect: onClose },
      { type: "separator" },
      { label: "Archive card", icon: "archive", disabled: saving, onSelect: () => void onArchive(draft) },
      { label: "Delete card", icon: "trash", danger: true, disabled: saving, onSelect: () => void onDelete(draft) }
    ];
  }

  function cardViewContextItems(): ContextMenuItem[] {
    return [
      { label: "Edit card", icon: "edit", onSelect: () => setMode("edit") },
      {
        label: card.completed ? "Mark incomplete" : "Mark complete",
        icon: "check",
        disabled: saving,
        onSelect: () => void saveCardPatch({ completed: !card.completed })
      },
      { label: "Copy title", icon: "copy", disabled: !card.title.trim(), onSelect: () => void onCopyText(card.title) },
      { label: "Copy card link", icon: "copy", onSelect: () => void onCopyText(cardDeepLink(card.id)) },
      { label: "Close card", icon: "x", onSelect: onClose },
      { type: "separator" },
      { label: "Archive card", icon: "archive", disabled: saving, onSelect: () => void onArchive(card) },
      { label: "Delete card", icon: "trash", danger: true, disabled: saving, onSelect: () => void onDelete(card) }
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

  if (mode === "view") {
    return (
      <CardViewPanel
        card={card}
        board={cardBoard}
        listName={listName}
        workspacePath={workspacePath}
        members={members}
        activeMember={activeMember}
        fileDragActive={fileDragActive}
        attachmentBusy={attachmentBusy}
        imageAttachments={imageAttachments}
        lightboxAttachment={lightboxAttachment}
        lightboxIndex={lightboxIndex}
        editorRef={editorRef}
        onPanelContextMenu={(event) => {
            if (isEditableTextControl(event.target)) {
              onOpenContextMenu(event, textControlContextItems(event.target));
              return;
            }
            onOpenContextMenu(event, cardViewContextItems(), card.title || "Card");
        }}
        onEdit={() => setMode("edit")}
        onClose={onClose}
        onToggleCompleted={() => void saveCardPatch({ completed: !card.completed })}
        onToggleSubtask={toggleViewSubtask}
        onAddAttachments={() => void runAttachmentAction(() => onAddAttachments(card.id))}
        onRemoveAttachment={(attachment) => void runAttachmentAction(() => onRemoveAttachment(card.id, attachment))}
        onOpenAttachment={openAttachment}
        onArchive={() => void onArchive(card)}
        onDelete={() => void onDelete(card)}
        onSelectActiveMember={onSelectActiveMember}
        onAddComment={(body) => onAddComment(card.id, body)}
        onEditComment={(commentId, body) => onEditComment(card.id, commentId, body)}
        onDeleteComment={(commentId) => onDeleteComment(card.id, commentId)}
        onOpenContextMenu={onOpenContextMenu}
        onCopyText={onCopyText}
        onCloseLightbox={() => setLightboxIndex(null)}
        onNavigateLightbox={setLightboxIndex}
        onOpenAttachmentExternally={(attachment) => void onOpenAttachment(card.id, attachment)}
        onRevealAttachment={(attachment) => void onRevealAttachment(card.id, attachment)}
      />
    );
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
        <CardEditorHeader board={board} draft={draft} saving={saving} onClose={onClose} />

        <div className="card-editor-body" data-testid="card-editor-body" ref={cardEditorBodyRef} style={cardEditorBodyStyle}>
          <div className="card-editor-main">
            <CardEditorTitleField draft={draft} setDraft={setDraft} />

            <ChecklistEditor
              completedSubtasks={completedSubtasks}
              draft={draft}
              expandedSubtasks={expandedSubtasks}
              onAddSubtask={addSubtask}
              onAddSubtaskItem={addSubtaskItem}
              onRemoveSubtask={removeSubtask}
              onRemoveSubtaskItem={removeSubtaskItem}
              onToggleSubtaskExpanded={toggleSubtaskExpanded}
              onUpdateSubtask={updateSubtask}
              onUpdateSubtaskItem={updateSubtaskItem}
              onOpenContextMenu={onOpenContextMenu}
              subtaskContextItems={subtaskContextItems}
              subtaskItemContextItems={subtaskItemContextItems}
            />

            <CardAttachments
              attachments={card.attachments}
              workspacePath={workspacePath}
              cardId={card.id}
              busy={attachmentBusy}
              onAdd={() => void runAttachmentAction(() => onAddAttachments(card.id))}
              onOpen={openAttachment}
              onRemove={(attachment) => void runAttachmentAction(() => onRemoveAttachment(card.id, attachment))}
              onOpenContextMenu={onOpenContextMenu}
              onCopyText={onCopyText}
            />

            <NotesEditor
              linkDraft={linkDraft}
              notesInputRef={notesInputRef}
              notesLinkInputRef={notesLinkInputRef}
              notesLinkLabelInputRef={notesLinkLabelInputRef}
              onCancelLinkDraft={() => {
                setLinkDraft(null);
                clearActiveNotesLink();
                pendingNotesLinkRangeRef.current = null;
                notesInputRef.current?.focus();
              }}
              onFormatBold={formatNotesAsBold}
              onFormatItalic={formatNotesAsItalic}
              onFormatLink={formatNotesAsLink}
              onNotesClick={handleNotesLinkClick}
              onNotesContextMenu={handleNotesContextMenu}
              onNotesInput={handleNotesInput}
              onNotesKeyDown={handleNotesLinkKeyDown}
              onNotesPaste={handleNotesPaste}
              onOpenLinkDraft={openNotesLinkDraft}
              onRemoveLink={removeNotesLink}
              onReplaceLinkDraft={replaceNotesLinkDraft}
              onUpdateLinkDraft={updateNotesLinkDraft}
            />

            <CardComments
              key={card.id}
              comments={card.comments}
              members={members}
              activeMember={activeMember}
              onSelectActiveMember={onSelectActiveMember}
              onAddComment={(body) => onAddComment(card.id, body)}
              onEditComment={(commentId, body) => onEditComment(card.id, commentId, body)}
              onDeleteComment={(commentId) => onDeleteComment(card.id, commentId)}
              onOpenContextMenu={onOpenContextMenu}
              onCopyText={onCopyText}
            />
          </div>

          <CardEditorSplitter
            maxSideWidth={CARD_EDITOR_SIDE_WIDTH_MAX}
            minSideWidth={CARD_EDITOR_SIDE_WIDTH_MIN}
            sideWidth={sideWidth}
            onKeyDown={handleCardEditorSplitterKeyDown}
            onPointerDown={handleCardEditorSplitterPointerDown}
          />

          <CardEditorSidePanel
            board={board}
            boards={boards}
            draft={draft}
            labelInput={labelInput}
            members={members}
            setDraft={setDraft}
            setLabelInput={setLabelInput}
            onCommitLabels={commitLabels}
            onCopyText={onCopyText}
            onOpenContextMenu={onOpenContextMenu}
            onRemoveLabel={removeLabel}
            onUpdateAssignee={updateAssignee}
          />
        </div>

        <CardEditorFooter
          draft={draft}
          saving={saving}
          onArchive={onArchive}
          onDelete={onDelete}
          onSaveAndClose={() => {
            setSaving(true);
            void onSave(draft)
              .then(onClose)
              .catch(() => setSaving(false));
          }}
        />

        <CardEditorDropzone active={fileDragActive} />
      </aside>

      <CardEditorLightbox
        cardId={card.id}
        imageAttachments={imageAttachments}
        lightboxAttachment={lightboxAttachment}
        lightboxIndex={lightboxIndex}
        workspacePath={workspacePath}
        onClose={() => setLightboxIndex(null)}
        onNavigate={setLightboxIndex}
        onOpenExternally={(attachment) => void onOpenAttachment(card.id, attachment)}
        onRevealInFolder={(attachment) => void onRevealAttachment(card.id, attachment)}
      />
    </div>
  );
}
