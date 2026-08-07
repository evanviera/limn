// Device-local display preferences. These affect how Limn is laid out, not the
// shared workspace data, so localStorage keeps each person's setup independent.

type BoardDisplayPreference = "compactCards" | "compactCompleted";

const BOARD_DISPLAY_KEYS: Record<BoardDisplayPreference, string> = {
  compactCards: "limn-board-compact-cards",
  compactCompleted: "limn-board-compact-completed"
};
const COLLAPSED_BOARD_GROUPS_KEY_PREFIX = "limn-collapsed-board-groups:";
const CARD_EDITOR_SIDE_WIDTH_KEY = "limn-card-editor-side-width";

function isE2eReset(): boolean {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has("resetLimnE2e");
}

function readItem(key: string): string | null {
  try {
    if (isE2eReset()) {
      localStorage.removeItem(key);
    }
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A blocked localStorage should only make the preference non-persistent.
  }
}

export function readBoardDisplayPreference(preference: BoardDisplayPreference): boolean {
  return readItem(BOARD_DISPLAY_KEYS[preference]) === "true";
}

export function writeBoardDisplayPreference(preference: BoardDisplayPreference, enabled: boolean): void {
  writeItem(BOARD_DISPLAY_KEYS[preference], String(enabled));
}

function collapsedBoardGroupsKey(workspacePath: string): string {
  return `${COLLAPSED_BOARD_GROUPS_KEY_PREFIX}${workspacePath}`;
}

export function readCollapsedBoardGroupIds(workspacePath: string): Set<string> {
  if (!workspacePath) {
    return new Set();
  }
  const raw = readItem(collapsedBoardGroupsKey(workspacePath));
  if (!raw) {
    return new Set();
  }
  try {
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? new Set(ids.filter((id): id is string => typeof id === "string")) : new Set();
  } catch {
    return new Set();
  }
}

export function writeCollapsedBoardGroupIds(workspacePath: string, groupIds: Set<string>): void {
  if (!workspacePath) {
    return;
  }
  writeItem(collapsedBoardGroupsKey(workspacePath), JSON.stringify([...groupIds]));
}

export function readCardEditorSideWidth(fallback: number, minimum: number, maximum: number): number {
  const raw = readItem(CARD_EDITOR_SIDE_WIDTH_KEY);
  const parsed = raw === null ? fallback : Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

export function writeCardEditorSideWidth(width: number): void {
  writeItem(CARD_EDITOR_SIDE_WIDTH_KEY, String(Math.round(width)));
}
