import type { ThemeMode } from "./constants";

/**
 * Color themes, darkest to lightest. Themes change colors only (see
 * src/styles/themes.css); type, spacing and layout are shared, and every theme
 * supports Quiet mode. Dark and Light are the originals; the four between them
 * are mid-grade themes with their own sidebar color.
 */
export const THEMES: ReadonlyArray<{ id: ThemeMode; label: string; tone: "dark" | "light" }> = [
  { id: "dark", label: "Dark", tone: "dark" },
  { id: "graphite", label: "Graphite", tone: "dark" },
  { id: "storm", label: "Storm", tone: "dark" },
  { id: "ash", label: "Ash", tone: "light" },
  { id: "fog", label: "Fog", tone: "light" },
  { id: "light", label: "Light", tone: "light" }
];

export function isThemeMode(value: unknown): value is ThemeMode {
  return THEMES.some(theme => theme.id === value);
}

export function themeLabel(mode: ThemeMode): string {
  return THEMES.find(theme => theme.id === mode)?.label ?? "Dark";
}

export function themeTone(mode: ThemeMode): "dark" | "light" {
  return THEMES.find(theme => theme.id === mode)?.tone ?? "dark";
}

/** The menu shortcut steps through the themes in order and wraps around. */
export function nextTheme(mode: ThemeMode): ThemeMode {
  const index = THEMES.findIndex(theme => theme.id === mode);
  return THEMES[(index + 1) % THEMES.length].id;
}
