import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent as ReactFormEvent } from "react";
import type { Board, Card, Member } from "../types";
import {
  archiveLocation,
  archiveReason,
  compareArchivedCards,
  formatArchivedWhen,
  type ArchiveSort
} from "../lib/archive.js";
import { countLabel } from "../lib/format.js";
import { useModalKeys } from "../lib/useModalKeys.js";
import type { ContextMenuItem, OpenContextMenu } from "./contextMenu";
import { Icon } from "./icons.js";
import { MemberDots } from "./TaskCard.js";

interface ArchiveViewProps {
  cards: Card[];
  boards: Board[];
  members: Member[];
  onOpenCard: (card: Card) => void;
  onRestoreCard: (card: Card) => Promise<void>;
  onDeleteCard: (card: Card) => Promise<void>;
  onOpenContextMenu: OpenContextMenu;
  onCopyText: (text: string) => Promise<void>;
}

export interface ArchiveToastState {
  message: string;
  actionLabel?: string;
  onAction?: () => Promise<void> | void;
}

export function ArchiveToast({ toast, onDismiss }: { toast: ArchiveToastState; onDismiss: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 8_000);
    return () => window.clearTimeout(timer);
  }, [onDismiss, toast]);

  return (
    <div aria-live="polite" className="archive-toast" data-testid="archive-toast" role="status">
      <Icon name="check" />
      <span>{toast.message}</span>
      {toast.actionLabel && toast.onAction && (
        <button data-testid="archive-toast-action" type="button" onClick={() => void toast.onAction?.()}>{toast.actionLabel}</button>
      )}
      <button aria-label="Dismiss archive message" className="icon-button" type="button" onClick={onDismiss}><Icon name="x" /></button>
    </div>
  );
}

function archiveMenuItems(props: ArchiveViewProps, card: Card): ContextMenuItem[] {
  const location = archiveLocation(card, props.boards);
  return [
    { label: "Open card", icon: "edit", onSelect: () => props.onOpenCard(card) },
    {
      label: location.available ? "Restore card" : "Restore card to…",
      icon: "refresh",
      onSelect: () => props.onRestoreCard(card)
    },
    { label: "Copy title", icon: "copy", onSelect: () => props.onCopyText(card.title) },
    { type: "separator" },
    { label: "Delete forever", icon: "trash", danger: true, onSelect: () => props.onDeleteCard(card) }
  ];
}

export function ArchiveView(props: ArchiveViewProps) {
  const [text, setText] = useState("");
  const [boardId, setBoardId] = useState("");
  const [sort, setSort] = useState<ArchiveSort>("recent");
  const [helpOpen, setHelpOpen] = useState(false);
  const archivedCards = useMemo(() => props.cards.filter((card) => card.archived), [props.cards]);
  const results = useMemo(() => {
    const query = text.trim().toLowerCase();
    return archivedCards
      .filter((card) => !boardId || card.boardId === boardId)
      .filter((card) => !query || `${card.title}\n${card.body}\n${card.labels.join(" ")}`.toLowerCase().includes(query))
      .sort(compareArchivedCards(sort));
  }, [archivedCards, boardId, sort, text]);
  const archiveBoards = props.boards.filter((board) => archivedCards.some((card) => card.boardId === board.id));

  return (
    <section className="archive-view">
      <header className="content-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Archive</h1>
          <p className="meta-line" data-testid="archive-result-count">
            {countLabel(results.length, "archived card")} · Kept safely outside active boards
          </p>
        </div>
        <div className="header-actions">
          <button data-testid="archive-help" onClick={() => setHelpOpen(true)}>How archiving works</button>
        </div>
      </header>

      <div className="archive-toolbar">
        <label className="archive-search">
          <span className="sr-only">Search archived cards</span>
          <Icon name="search" />
          <input
            data-testid="archive-search"
            type="search"
            value={text}
            placeholder="Search archived cards…"
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Board</span>
          <select data-testid="archive-board" value={boardId} onChange={(event) => setBoardId(event.target.value)}>
            <option value="">All boards</option>
            {archiveBoards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Sort</span>
          <select data-testid="archive-sort" value={sort} onChange={(event) => setSort(event.target.value as ArchiveSort)}>
            <option value="recent">Recently archived</option>
            <option value="oldest">Oldest archived</option>
            <option value="title">Title (A–Z)</option>
          </select>
        </label>
      </div>

      <p className="archive-guidance">
        <Icon name="archive" /> Restoring returns a card to its previous list when that location still exists.
      </p>

      {results.length === 0 ? (
        <div className="empty-state" data-testid="archive-empty">
          <Icon name="archive" />
          <h2>{archivedCards.length === 0 ? "No archived cards" : "No archived cards match"}</h2>
          <p>{archivedCards.length === 0 ? "Cards you archive will stay safely available here." : "Try clearing your search or board filter."}</p>
        </div>
      ) : (
        <ul className="archive-list">
          {results.map((card) => {
            const location = archiveLocation(card, props.boards);
            const assignees = props.members.filter((member) => card.assignees.includes(member.id));
            const items = archiveMenuItems(props, card);
            return (
              <li className="archive-row" data-testid={`archive-row-${card.id}`} key={card.id} onContextMenu={(event) => props.onOpenContextMenu(event, items, card.title)}>
                <button className="archive-row-open" type="button" onClick={() => props.onOpenCard(card)}>
                  <span className="archive-row-title">
                    <strong>{card.title}</strong>
                    {card.completed && <span className="archive-state completed">Completed</span>}
                    {!location.available && <span className="archive-state warning">Needs a new list</span>}
                  </span>
                  <span className={`archive-row-location${location.available ? "" : " missing"}`}>
                    {location.boardName} · {location.listName}{location.available ? "" : " (deleted)"}
                  </span>
                  <span className="archive-row-meta">
                    <span>{formatArchivedWhen(card)}</span>
                    <span>{archiveReason(card)}</span>
                  </span>
                  {card.labels.length > 0 && (
                    <span className="archive-row-labels">
                      {card.labels.map((label) => <span key={label}>{label}</span>)}
                    </span>
                  )}
                </button>
                <div className="archive-row-actions">
                  {assignees.length > 0 && <MemberDots members={assignees} />}
                  <button
                    className="archive-restore"
                    data-testid={`restore-card-${card.id}`}
                    type="button"
                    onClick={() => void props.onRestoreCard(card)}
                  >
                    <Icon name="refresh" /> {location.available ? "Restore" : "Restore to…"}
                  </button>
                  <button
                    aria-label={`More actions for ${card.title}`}
                    className="icon-button archive-more"
                    data-testid={`archive-more-${card.id}`}
                    type="button"
                    onClick={(event) => props.onOpenContextMenu(event, items, card.title)}
                  >
                    <span aria-hidden="true">•••</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {helpOpen && <ArchiveHelpDialog onClose={() => setHelpOpen(false)} />}
    </section>
  );
}

function ArchiveHelpDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalKeys(dialogRef, onClose);
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div aria-labelledby="archive-help-title" aria-modal="true" className="text-dialog" ref={dialogRef} role="dialog" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <header><h2 id="archive-help-title">How archiving works</h2><button type="button" onClick={onClose}>Close</button></header>
        <p>Archived cards leave active boards but keep their notes, comments, attachments, and history. Restore returns a card to its previous list, or lets you choose a new location if that list was removed.</p>
        <footer><button className="primary" type="button" onClick={onClose}>Got it</button></footer>
      </div>
    </div>
  );
}

export function RestoreCardDialog({
  card,
  boards,
  onCancel,
  onRestore
}: {
  card: Card;
  boards: Board[];
  onCancel: () => void;
  onRestore: (card: Card, boardId: string, listId: string) => Promise<void>;
}) {
  const destinations = boards.filter((board) => board.lists.length > 0);
  const originalBoard = destinations.find((board) => board.id === card.boardId);
  const [boardId, setBoardId] = useState(originalBoard?.id ?? destinations[0]?.id ?? "");
  const board = destinations.find((item) => item.id === boardId);
  const originalList = board?.lists.find((list) => board.id === card.boardId && list.id === card.listId);
  const [listId, setListId] = useState(originalList?.id ?? board?.lists[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useModalKeys(formRef, onCancel);

  function changeBoard(nextBoardId: string) {
    const nextBoard = destinations.find((item) => item.id === nextBoardId);
    setBoardId(nextBoardId);
    setListId(nextBoard?.lists[0]?.id ?? "");
  }

  function submit(event: ReactFormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!boardId || !listId || saving) return;
    setSaving(true);
    void onRestore(card, boardId, listId).catch(() => setSaving(false));
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <form aria-labelledby="restore-card-title" aria-modal="true" className="text-dialog restore-card-dialog" data-testid="restore-card-dialog" ref={formRef} role="dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
        <header><h2 id="restore-card-title">Choose a new location</h2><button disabled={saving} type="button" onClick={onCancel}>Cancel</button></header>
        {destinations.length === 0 ? (
          <p>Create a board with at least one list before restoring “{card.title}”.</p>
        ) : (
          <>
            <p>The card’s previous list no longer exists. Choose where to restore “{card.title}”.</p>
            <div className="restore-card-fields">
              <label>Board<select data-testid="restore-card-board" disabled={saving} value={boardId} onChange={(event) => changeBoard(event.target.value)}>{destinations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>List<select data-testid="restore-card-list" disabled={saving} value={listId} onChange={(event) => setListId(event.target.value)}>{board?.lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>
            </div>
          </>
        )}
        <footer>
          <button disabled={saving} type="button" onClick={onCancel}>Cancel</button>
          <button className="primary" data-testid="restore-card-submit" disabled={!boardId || !listId || saving} type="submit">{saving ? "Restoring…" : "Restore card"}</button>
        </footer>
      </form>
    </div>
  );
}
