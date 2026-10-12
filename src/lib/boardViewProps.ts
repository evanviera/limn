import type { Board, Card } from "../types";
import type { BoardViewProps } from "../components/BoardView";
import type { BoardListActions } from "./useBoardListActions";

type SharedProps = Omit<BoardViewProps, "board" | "cards" | "allCards" | "onOpenCard" |
  "onAddList" | "onRenameList" | "onDeleteList" | "onSortListCardsByDueDate" |
  "onArchiveListCards" | "onDeleteListCards" | "onToggleListCollapsed" | "onMoveList" | "onAddCard">;

export function createBoardViewProps(board: Board, cards: Card[], actions: BoardListActions,
  shared: SharedProps, onOpenCard: (card: Card) => void): BoardViewProps {
  const allCards = cards.filter(card => card.boardId === board.id);
  return {
    ...shared, board, allCards, cards: allCards.filter(card => !card.archived),
    onAddList: () => actions.addList(board.id),
    onRenameList: list => actions.renameList(board.id, list),
    onDeleteList: list => actions.deleteList(board.id, list),
    onSortListCardsByDueDate: list => actions.sortListCardsByDueDate(board.id, list),
    onArchiveListCards: list => actions.archiveListCards(board.id, list),
    onDeleteListCards: list => actions.deleteListCards(board.id, list),
    onToggleListCollapsed: list => actions.toggleListCollapsed(board.id, list),
    onMoveList: (listId, index) => actions.moveList(board.id, listId, index),
    onAddCard: listId => actions.addCard(board.id, listId),
    onOpenCard: cardId => {
      const card = allCards.find(card => card.id === cardId);
      if (card) onOpenCard(card);
    }
  };
}
