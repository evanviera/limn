import type { Board, BoardGroup } from "../types";

const normalizedName = (name: string) => name.trim().toLowerCase();

export function effectiveBoardGroupId(board: Pick<Board, "groupId">, groups: BoardGroup[]): string | undefined {
  return groups.some((group) => group.id === board.groupId) ? board.groupId : undefined;
}

export function boardNameError(boards: Board[], groups: BoardGroup[], name: string, groupId?: string, exceptId?: string): string | null {
  const target = effectiveBoardGroupId({ groupId }, groups);
  const duplicate = boards.some((board) => board.id !== exceptId &&
    effectiveBoardGroupId(board, groups) === target && normalizedName(board.name) === normalizedName(name));
  return duplicate ? "A board with this name already exists in this category." : null;
}

// Check a whole category relocation before any writes, including collisions
// between its own boards and the boards already in the destination.
export function boardCategoryMoveError(boards: Board[], groups: BoardGroup[], ids: string[], groupId?: string): string | null {
  const moving = new Set(ids);
  const projected = boards.map((board) => moving.has(board.id) ? { ...board, groupId } : board);
  const duplicate = projected.find((board) => moving.has(board.id) &&
    boardNameError(projected, groups, board.name, groupId, board.id));
  const category = groups.find((group) => group.id === groupId)?.name ?? "Ungrouped";
  return duplicate ? `A board named “${duplicate.name}” already exists in ${category}. Rename a board or choose another category first.` : null;
}

// Presentation-only copies for cross-board views. Stored board names and ids
// stay unchanged; repeated names get their category as context.
export function boardChoices(boards: Board[], groups: BoardGroup[]): Board[] {
  const counts = new Map<string, number>();
  for (const board of boards) counts.set(normalizedName(board.name), (counts.get(normalizedName(board.name)) ?? 0) + 1);
  return boards.map((board) => counts.get(normalizedName(board.name))! > 1
    ? { ...board, name: `${groups.find((group) => group.id === board.groupId)?.name ?? "Ungrouped"} / ${board.name}` }
    : board);
}
