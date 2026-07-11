import type { WorkspaceSettings } from "../types";

export const memberColors = ["#2563eb", "#0f766e", "#b45309", "#be123c", "#7c3aed", "#4d7c0f"];

export const MAX_NAME_LENGTH = 80;
export const THEME_STORAGE_KEY = "limn-theme";

// Board list-width preferences are per-computer (stored in localStorage, never in
// the synced workspace files) so each machine keeps its own layout.
export const LIST_WIDTH_STORAGE_KEY = "limn-list-width";
export const LIST_WIDTH_MODE_STORAGE_KEY = "limn-list-width-mode";
export const DEFAULT_LIST_WIDTH = 320;
export const MIN_LIST_WIDTH = 200;
export const MAX_LIST_WIDTH = 640;

// The boards sidebar width is likewise per-computer, kept in localStorage so the
// panel holds its size across sessions and workspaces.
export const SIDEBAR_WIDTH_STORAGE_KEY = "limn-sidebar-width";
export const DEFAULT_SIDEBAR_WIDTH = 264;
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 480;

export type ThemeMode = "dark" | "light";
export type ListWidthMode = "fixed" | "flexible";
export type SlackNotificationKey = keyof WorkspaceSettings["slackNotifications"];
