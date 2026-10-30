import type { Board } from "../types";
import { boardFileName } from "./workspaceFactory.js";

interface ParsedBoardFile {
  fileName: string;
  board: Board;
}

function prefer(candidate: ParsedBoardFile, current: ParsedBoardFile): boolean {
  const canonical = boardFileName(candidate.board.id);
  // All board writes target <id>.json. A sync-created copy must never take
  // precedence over that file, even when it carries a newer timestamp.
  if (candidate.fileName === canonical) return true;
  if (current.fileName === canonical) return false;
  const candidateTime = Date.parse(candidate.board.updatedAt) || 0;
  const currentTime = Date.parse(current.board.updatedAt) || 0;
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  return candidate.fileName < current.fileName;
}

export function uniqueBoards(files: ParsedBoardFile[], diagnostics: string[]): Board[] {
  const selected = new Map<string, ParsedBoardFile>();
  for (const file of files) {
    const current = selected.get(file.board.id);
    if (!current || prefer(file, current)) selected.set(file.board.id, file);
  }
  for (const file of files) {
    const chosen = selected.get(file.board.id)!;
    if (file !== chosen) {
      diagnostics.push(`boards/${file.fileName} duplicates board ID "${file.board.id}". Using boards/${chosen.fileName}; the duplicate file was left unchanged.`);
    }
  }
  return [...selected.values()].map(file => file.board);
}
