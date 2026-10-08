import { useEffect, useRef, useState } from "react";
import type { Board, Card } from "../types";
import { defaultCardMoveList } from "../lib/cardMove.js";
import { useModalKeys } from "../lib/useModalKeys.js";

export function MoveCardDialog({ card, boards, onCancel, onMove }: {
  card: Card;
  boards: Board[];
  onCancel: () => void;
  onMove: (cardId: string, boardId: string, listId: string) => Promise<boolean>;
}) {
  const destinations = boards.filter((board) => board.id !== card.boardId);
  const [selectedBoardId, setSelectedBoardId] = useState(() => destinations.find((board) => board.lists.length > 0)?.id ?? "");
  const board = destinations.find((item) => item.id === selectedBoardId) ?? destinations[0];
  const [selectedListId, setSelectedListId] = useState(() => board ? defaultCardMoveList(card, boards, board)?.id ?? "" : "");
  const listId = board?.lists.some((list) => list.id === selectedListId)
    ? selectedListId : board ? defaultCardMoveList(card, boards, board)?.id ?? "" : "";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const boardRef = useRef<HTMLSelectElement>(null);
  const savingRef = useRef(false);
  const close = () => { if (!savingRef.current) onCancel(); };
  useModalKeys(formRef, close);
  useEffect(() => {
    (boardRef.current ?? formRef.current?.querySelector<HTMLButtonElement>("button"))?.focus();
  }, []);

  async function submit() {
    if (!board || !listId || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      if (await onMove(card.id, board.id, listId)) {
        onCancel();
      } else {
        setError("The move could not be completed. Check the workspace message and choose an available location.");
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={close}>
      <form aria-labelledby="move-card-title" aria-modal="true" className="text-dialog" data-testid="move-card-dialog"
        ref={formRef} role="dialog" onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <header><h2 id="move-card-title">Move to board</h2><button disabled={saving} type="button" onClick={close}>Cancel</button></header>
        <p>Choose where to move “{card.title}”.</p>
        {destinations.length === 0 ? <p>Create another board before moving this card.</p> : <>
          <label>Board
            <select ref={boardRef} disabled={saving} data-testid="move-card-board" value={board?.id ?? ""} onChange={(event) => {
              const next = destinations.find((item) => item.id === event.target.value);
              setSelectedBoardId(event.target.value);
              setSelectedListId(next ? defaultCardMoveList(card, boards, next)?.id ?? "" : "");
              setError("");
            }}>
              {destinations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>List
            <select disabled={saving || !board?.lists.length} data-testid="move-card-list" value={listId} onChange={(event) => setSelectedListId(event.target.value)}>
              {!board?.lists.length && <option value="">No lists available</option>}
              {board?.lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
            </select>
          </label>
          {!board?.lists.length && <p>Add a list to this board before moving the card.</p>}
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer><button disabled={saving} type="button" onClick={close}>Cancel</button>
          <button className="primary" data-testid="move-card-submit" disabled={saving || !board || !listId} type="submit">{saving ? "Moving…" : "Move card"}</button>
        </footer>
      </form>
    </div>
  );
}
