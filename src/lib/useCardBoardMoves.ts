import { useEffect, useRef, useState } from "react";
import type { Board, Card } from "../types";
import type { SaveOutcome } from "../storage";
import { addActivity, timestamp } from "../storage.js";
import { defaultCardMoveList } from "./cardMove.js";
import { compareCardsByOrder, placeInList } from "./ordering.js";

interface Options {
  workspacePath: string;
  cards: { readonly current: Card[] };
  boards: { readonly current: Board[] };
  persistCard: (card: Card, previous: Card) => Promise<SaveOutcome | null>;
  onMoved: (card: Card, board: Board) => void;
  onError: (message: string) => void;
}

export function useCardBoardMoves(options: Options) {
  const [requestCardId, setRequestCardId] = useState<string | null>(null);
  const [dropBoardId, setDropBoardId] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    setRequestCardId(null);
    setDropBoardId(null);
  }, [options.workspacePath]);

  async function moveCardToBoard(cardId: string, boardId: string, listId?: string, index?: number): Promise<boolean> {
    const card = options.cards.current.find((item) => item.id === cardId);
    const boards = options.boards.current;
    const destination = boards.find((board) => board.id === boardId);
    if (!card || card.archived || !destination || card.boardId === boardId || inFlight.current.has(cardId)) return false;
    const list = listId === undefined
      ? defaultCardMoveList(card, boards, destination)
      : destination.lists.find((item) => item.id === listId);
    if (!list) {
      options.onError("Move failed: choose a board with an available list.");
      return false;
    }
    options.onError("");
    inFlight.current.add(cardId);
    try {
      const source = boards.find((board) => board.id === card.boardId);
      const sourceList = source?.lists.find((item) => item.id === card.listId);
      const siblings = options.cards.current.filter((item) =>
        item.boardId === boardId && item.listId === list.id && !item.archived && item.id !== cardId
      ).sort(compareCardsByOrder);
      const placement = placeInList(siblings, index ?? siblings.length);
      for (const change of placement.rebalance) {
        const sibling = siblings.find(card => card.id === change.id)!;
        const outcome = await options.persistCard({ ...sibling, order: change.order, updatedAt: timestamp() }, sibling);
        if (!outcome || outcome.status === "conflict") return false;
      }
      const moved = addActivity({ ...card, boardId, listId: list.id, order: placement.order },
        "moved", `Moved from ${source?.name ?? "Unknown board"} / ${sourceList?.name ?? "Unknown list"} to ${destination.name} / ${list.name}`);
      const outcome = await options.persistCard(moved, card);
      // Reconciled writes reload from disk; leave their notice to the save path.
      if (outcome?.status === "written") options.onMoved(moved, destination);
      return Boolean(outcome && outcome.status !== "conflict");
    } catch (reason) {
      options.onError(`Move failed: ${reason instanceof Error ? reason.message : String(reason)}`);
      return false;
    } finally {
      inFlight.current.delete(cardId);
    }
  }

  return { requestCardId, requestMove: setRequestCardId, dropBoardId, setDropBoardId, moveCardToBoard };
}
