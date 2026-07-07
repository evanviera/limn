import type { Board } from "../types";
import { THEME_STORAGE_KEY, type ThemeMode } from "./constants";

export function readStoredThemeMode(): ThemeMode {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("resetLimnE2e")) {
    localStorage.removeItem(THEME_STORAGE_KEY);
  }
  return localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
}

// Extract a clean message for user-facing error banners so we don't surface the
// stringified Error object (e.g. "Error: …") prefix to the user.
export function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

// Slack only renders a real @mention (a ping) when the message text contains
// the `<@MEMBER_ID>` syntax, where MEMBER_ID is the internal Slack member ID
// (e.g. "U024BE7LH"). Plain "@handle" text is never resolved into a mention, so
// we wrap member IDs in the mention syntax. Values that aren't member IDs fall
// back to plain "@text" so the assignee is still shown (just not pinged).
export function slackTag(handle?: string) {
  const trimmed = handle?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  // Already in `<@…>` mention form — pass through untouched.
  if (trimmed.startsWith("<@") && trimmed.endsWith(">")) {
    return trimmed;
  }
  // Accept a member ID with or without a leading "@". Slack member IDs start
  // with U (users) or W (Enterprise Grid users) followed by uppercase alnum.
  const id = trimmed.replace(/^@/, "");
  if (/^[UW][A-Z0-9]{6,}$/.test(id)) {
    return `<@${id}>`;
  }
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const exists = items.some((current) => current.id === item.id);
  return exists ? items.map((current) => (current.id === item.id ? item : current)) : [...items, item];
}

export function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function selectActiveBoardId(current: string, boards: Board[]): string {
  if (current && boards.some((board) => board.id === current)) {
    return current;
  }
  return boards[0]?.id ?? "";
}

export function countLabel(count: number, label: string) {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

// The trailing folder name of a workspace path, used to label a workspace tab
// before its settings (with the configured workspace name) have been loaded.
// Handles both POSIX and Windows separators and any trailing slash.
export function workspaceBaseName(path: string): string {
  const segment = path.split(/[\\/]/).filter(Boolean).pop();
  return segment || path;
}

// Human-readable file size for attachment rows. Keeps one decimal only when it
// adds information (e.g. "1.4 MB" but "12 MB" and "512 B").
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 10 || Number.isInteger(value) ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${units[unitIndex]}`;
}
