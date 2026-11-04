import { useLayoutEffect } from "react";
import { BOARD_DISPLAY_CHANGE_EVENT, readBoardDisplayPreference } from "./viewPreferences.js";

/**
 * Mirrors the Quiet mode view option onto <html data-quiet>. Quiet mode is the
 * neutral look (grey avatars, status dots, links as text); without it,
 * src/styles/accents.css colors each kind of element so they're easy to tell
 * apart. Lives at the root so every view follows it, not only the board.
 */
export function useQuietMode(): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const apply = (enabled: boolean) => {
      if (enabled) root.dataset.quiet = "true";
      else delete root.dataset.quiet;
    };
    apply(readBoardDisplayPreference("quietMode"));
    function sync(event: Event) {
      const { preference, enabled } = (event as CustomEvent<{ preference: string; enabled: boolean }>).detail;
      if (preference === "quietMode") apply(enabled);
    }
    window.addEventListener(BOARD_DISPLAY_CHANGE_EVENT, sync);
    return () => window.removeEventListener(BOARD_DISPLAY_CHANGE_EVENT, sync);
  }, []);
}
