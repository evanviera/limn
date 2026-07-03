import type { WorkspaceSettings } from "../types";

export const memberColors = ["#2563eb", "#0f766e", "#b45309", "#be123c", "#7c3aed", "#4d7c0f"];

export const MAX_NAME_LENGTH = 80;
export const THEME_STORAGE_KEY = "limn-theme";

export type ThemeMode = "dark" | "light";
export type SlackNotificationKey = keyof WorkspaceSettings["slackNotifications"];
