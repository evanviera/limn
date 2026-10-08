import type { Board, BoardList, Card } from "../types";

// List ids are local to a board; match names when choosing a cross-board drop.
export function defaultCardMoveList(card: Card, boards: Board[], destination: Board): BoardList | undefined {
  const source = boards.find((board) => board.id === card.boardId);
  const name = source?.lists.find((list) => list.id === card.listId)?.name.trim().toLowerCase();
  return destination.lists.find((list) => list.name.trim().toLowerCase() === name) ?? destination.lists[0];
}
