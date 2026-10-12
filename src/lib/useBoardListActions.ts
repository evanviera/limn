import type { Dispatch, SetStateAction } from "react";
import type { Board, BoardList, Card, View } from "../types";
import type { SaveOutcome } from "../storage";
import type { TextDialogState, ConfirmDialogState } from "../components/dialogs";
import type { ArchiveToastState } from "../components/ArchiveView";
import { addActivity, createCard, deleteCard, makeId, timestamp } from "../storage.js";
import { countLabel, errorText } from "./format.js";
import { nextOrderForList } from "./ordering.js";

interface Options {
  boards: { readonly current: Board[] };
  cards: { readonly current: Card[] };
  workspacePath: string;
  selectedCardIdRef: { readonly current: string | null };
  persistBoard: (board: Board) => Promise<unknown>;
  persistCard: (card: Card, previous?: Card) => Promise<SaveOutcome | null>;
  openTextDialog: (dialog: TextDialogState) => void;
  openConfirmDialog: (dialog: ConfirmDialogState) => void;
  setArchiveToast: Dispatch<SetStateAction<ArchiveToastState | null>>;
  setView: Dispatch<SetStateAction<View>>;
  setSelectedCardId: Dispatch<SetStateAction<string | null>>;
  setCards: Dispatch<SetStateAction<Card[]>>;
  setError: (message: string) => void;
  handleSaveOutcome: (outcome: SaveOutcome, label: string, operation: "delete") => Promise<unknown>;
  onCreatedCard: (card: Card) => void;
}

// Shared by standalone boards and Overview. Every action names its board;
// default list IDs are only unique *within* that board.
export function useBoardListActions(options: Options) {
  const { workspacePath, selectedCardIdRef, persistBoard, persistCard, openTextDialog,
    openConfirmDialog, setArchiveToast, setView, setSelectedCardId, setCards,
    setError, handleSaveOutcome } = options;
  const cards = options.cards.current;

  async function addList(boardId: string) {
    const board = options.boards.current.find(board => board.id === boardId);
    if (!board) {
      return;
    }
    openTextDialog({
      title: "Add list",
      label: "List name",
      value: "",
      confirmLabel: "Add list",
      validate: (name) =>
        board.lists.some((item) => item.name.trim().toLowerCase() === name.toLowerCase())
          ? "A list with this name already exists."
          : null,
      onSubmit: async (name) => {
        const list: BoardList = { id: makeId("list"), name };
        await persistBoard({ ...board, lists: [...board.lists, list], updatedAt: timestamp() });
      }
    });
  }

  async function renameList(boardId: string, list: BoardList) {
    const board = options.boards.current.find(board => board.id === boardId);
    if (!board) {
      return;
    }
    openTextDialog({
      title: "Rename list",
      label: "List name",
      value: list.name,
      confirmLabel: "Save list",
      validate: (name) =>
        board.lists.some((item) => item.id !== list.id && item.name.trim().toLowerCase() === name.toLowerCase())
          ? "A list with this name already exists."
          : null,
      onSubmit: async (name) => {
        await persistBoard({
          ...board,
          lists: board.lists.map((item) => (item.id === list.id ? { ...item, name } : item)),
          updatedAt: timestamp()
        });
      }
    });
  }

  async function toggleListCollapsed(boardId: string, list: BoardList) {
    const board = options.boards.current.find(board => board.id === boardId);
    if (!board) {
      return;
    }
    await persistBoard({
      ...board,
      lists: board.lists.map((item) =>
        item.id === list.id ? { ...item, collapsed: !item.collapsed } : item
      ),
      updatedAt: timestamp()
    });
  }

  async function deleteList(boardId: string, list: BoardList) {
    const board = options.boards.current.find(board => board.id === boardId);
    if (!board) {
      return;
    }
    openConfirmDialog({
      title: "Delete list",
      message: `Delete list "${list.name}"? Cards in this list will be archived.`,
      confirmLabel: "Delete list",
      destructive: true,
      onConfirm: async () => {
        const now = timestamp();
        const nextCards = cards.map((card) =>
          card.boardId === board.id && card.listId === list.id && !card.archived
            ? addActivity({ ...card, archived: true, archivedAt: now, updatedAt: now }, "archived", `Archived when ${list.name} was deleted`)
            : card
        );
        const changedCards = nextCards.filter((card, index) => card !== cards[index]);
        await Promise.all(changedCards.map((card) => persistCard(card, cards.find((item) => item.id === card.id))));
        await persistBoard({
          ...board,
          lists: board.lists.filter((item) => item.id !== list.id),
          updatedAt: now
        });
        if (changedCards.length > 0) {
          setArchiveToast({
            message: `${countLabel(changedCards.length, "card")} archived when “${list.name}” was deleted.`,
            actionLabel: "View archive",
            onAction: () => {
              setArchiveToast(null);
              setView("archive");
            }
          });
        }
      }
    });
  }

  async function archiveListCards(boardId: string, list: BoardList) {
    const board = options.boards.current.find(board => board.id === boardId);
    if (!board) {
      return;
    }
    const listCards = cards.filter(
      (card) => card.boardId === board.id && card.listId === list.id && !card.archived
    );
    if (listCards.length === 0) {
      return;
    }

    openConfirmDialog({
      title: "Archive all cards",
      message: `Archive ${countLabel(listCards.length, "card")} in "${list.name}"? Archived cards remain available from Archive.`,
      confirmLabel: "Archive all cards",
      onConfirm: async () => {
        const archivedCards = listCards.map((card) =>
          addActivity({ ...card, archived: true, archivedAt: timestamp() }, "archived", `Archived with all cards in ${list.name}`)
        );
        await Promise.all(archivedCards.map((card, index) => persistCard(card, listCards[index])));
        const archivedIds = new Set(listCards.map((card) => card.id));
        if (selectedCardIdRef.current && archivedIds.has(selectedCardIdRef.current)) {
          setSelectedCardId(null);
        }
        setArchiveToast({
          message: `${countLabel(listCards.length, "card")} archived from “${list.name}”.`,
          actionLabel: "View archive",
          onAction: () => {
            setArchiveToast(null);
            setView("archive");
          }
        });
      }
    });
  }

  async function sortListCardsByDueDate(boardId: string, list: BoardList) {
    const board = options.boards.current.find(board => board.id === boardId);
    if (!board) {
      return;
    }
    const listCards = cards.filter(
      (card) => card.boardId === board.id && card.listId === list.id && !card.archived
    );
    const manuallyOrderedCards = listCards.filter((card) => card.order !== 0);
    if (manuallyOrderedCards.length === 0) {
      return;
    }

    try {
      // A shared order of zero opts the list back into its built-in due-date
      // comparator. Future cards also stay in due-date mode until manually moved.
      await Promise.all(
        manuallyOrderedCards.map((card) =>
          persistCard({ ...card, order: 0, updatedAt: timestamp() }, card)
        )
      );
    } catch (reason) {
      setError(`Sort by due date failed: ${errorText(reason)}`);
    }
  }

  async function deleteListCards(boardId: string, list: BoardList) {
    const board = options.boards.current.find(board => board.id === boardId);
    if (!board || !workspacePath) {
      return;
    }
    // Archived cards retain their list id, so deleting every card in a list also
    // removes cards that were archived earlier and are currently hidden here.
    const listCards = cards.filter((card) => card.boardId === board.id && card.listId === list.id);
    if (listCards.length === 0) {
      return;
    }

    openConfirmDialog({
      title: "Delete all cards",
      message: `Permanently delete ${countLabel(listCards.length, "card")} in "${list.name}"? This removes their card files and attachments from disk.`,
      confirmLabel: "Delete all cards",
      destructive: true,
      onConfirm: async () => {
        const outcomes = await Promise.all(listCards.map((card) => deleteCard(workspacePath, card)));
        const conflict = outcomes.find((outcome) => outcome.status === "conflict");
        if (conflict) {
          // Some independent deletes may already have succeeded. Reload so the
          // board reflects exactly which cards remain after the refused delete.
          await handleSaveOutcome(conflict, "card batch", "delete");
          return;
        }
        const deletedIds = new Set(listCards.map((card) => card.id));
        setCards((current) => current.filter((card) => !deletedIds.has(card.id)));
        if (selectedCardIdRef.current && deletedIds.has(selectedCardIdRef.current)) {
          setSelectedCardId(null);
        }
      }
    });
  }

  async function moveList(boardId: string, listId: string, index: number) {
    const board = options.boards.current.find(board => board.id === boardId);
    if (!board) {
      return;
    }
    const list = board.lists.find((item) => item.id === listId);
    if (!list) {
      return;
    }

    const otherLists = board.lists.filter((item) => item.id !== listId);
    const clampedIndex = Math.max(0, Math.min(index, otherLists.length));
    const nextLists = [...otherLists];
    nextLists.splice(clampedIndex, 0, list);

    if (nextLists.every((item, position) => item.id === board.lists[position]?.id)) {
      return;
    }

    try {
      await persistBoard({ ...board, lists: nextLists, updatedAt: timestamp() });
    } catch (reason) {
      setError(`Move list failed: ${errorText(reason)}`);
    }
  }

  async function addCard(boardId: string, listId: string) {
    const board = options.boards.current.find(board => board.id === boardId);
    if (!board) {
      return;
    }
    openTextDialog({
      title: "Add card",
      label: "Card title",
      value: "",
      confirmLabel: "Add card",
      onSubmit: async (title) => {
        const listCards = cards.filter((item) => item.boardId === board.id && item.listId === listId && !item.archived);
        const card = { ...createCard(board.id, listId, title), order: nextOrderForList(listCards) };
        await persistCard(card);
        options.onCreatedCard(card);
      }
    });
  }

  return { addList, renameList, toggleListCollapsed, deleteList, archiveListCards, sortListCardsByDueDate, deleteListCards, moveList, addCard };
}

export type BoardListActions = ReturnType<typeof useBoardListActions>;
