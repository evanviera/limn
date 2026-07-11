import type { Board } from "../types";
import {
  DEFAULT_LIST_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  LIST_WIDTH_MODE_STORAGE_KEY,
  LIST_WIDTH_STORAGE_KEY,
  MAX_LIST_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_LIST_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
  THEME_STORAGE_KEY,
  type ListWidthMode,
  type ThemeMode
} from "./constants";

function isE2eReset(): boolean {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has("resetLimnE2e");
}

export function readStoredThemeMode(): ThemeMode {
  if (isE2eReset()) {
    localStorage.removeItem(THEME_STORAGE_KEY);
  }
  return localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
}

// Clamp a list-width value to the supported range, falling back to the default
// for anything non-numeric so a corrupt localStorage entry can't break layout.
export function clampListWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_LIST_WIDTH;
  }
  return Math.min(MAX_LIST_WIDTH, Math.max(MIN_LIST_WIDTH, Math.round(value)));
}

export function readStoredListWidth(): number {
  if (isE2eReset()) {
    localStorage.removeItem(LIST_WIDTH_STORAGE_KEY);
  }
  const raw = localStorage.getItem(LIST_WIDTH_STORAGE_KEY);
  return raw === null ? DEFAULT_LIST_WIDTH : clampListWidth(Number(raw));
}

export function readStoredListWidthMode(): ListWidthMode {
  if (isE2eReset()) {
    localStorage.removeItem(LIST_WIDTH_MODE_STORAGE_KEY);
  }
  return localStorage.getItem(LIST_WIDTH_MODE_STORAGE_KEY) === "flexible" ? "flexible" : "fixed";
}

// Clamp a sidebar-width value to the supported range, falling back to the
// default for anything non-numeric so a corrupt localStorage entry can't break
// the layout.
export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SIDEBAR_WIDTH;
  }
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(value)));
}

export function readStoredSidebarWidth(): number {
  if (isE2eReset()) {
    localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY);
  }
  const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  return raw === null ? DEFAULT_SIDEBAR_WIDTH : clampSidebarWidth(Number(raw));
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
