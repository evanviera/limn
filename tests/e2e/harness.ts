import { type Page, expect } from "@playwright/test";

/**
 * Helpers for driving Limn's in-browser E2E harness (src/testHarness.ts).
 *
 * The harness activates via the `?limnE2e` query param and mocks all Tauri IPC,
 * so the real React UI runs in a plain browser. `resetLimnE2e` clears any state
 * persisted in sessionStorage so each test starts clean.
 */

export interface HarnessFile {
  file_name: string;
  content: string;
}

export interface HarnessSnapshot {
  settings: Record<string, unknown>;
  members: { schemaVersion: number; members: unknown[] };
  boards: HarnessFile[];
  cards: HarnessFile[];
  lastWorkspace: string | null;
  slack: Array<{ webhookUrl: string; message: string }>;
  updater: {
    mode: "none" | "available" | "install-fail";
    installed: boolean;
    restarted: boolean;
  };
}

/** Navigate to the app with the E2E harness enabled and reset to a clean state. */
export async function openApp(page: Page, { reset = true }: { reset?: boolean } = {}): Promise<void> {
  const params = new URLSearchParams({ limnE2e: "1" });
  if (reset) {
    params.set("resetLimnE2e", "1");
  }
  await page.goto(`/?${params.toString()}`);
  await page.waitForFunction(() => Boolean((window as { __LIMN_E2E__?: unknown }).__LIMN_E2E__));
}

/** Open the mock workspace from the welcome screen and wait for the board shell. */
export async function openWorkspace(page: Page): Promise<void> {
  await page.getByTestId("welcome-open-workspace").click();
  await expect(page.getByTestId("create-board")).toBeVisible();
}

/** Read the current harness state (boards, cards, members, slack posts, …). */
export function snapshot(page: Page): Promise<HarnessSnapshot> {
  return page.evaluate(() => {
    const api = (window as { __LIMN_E2E__?: { snapshot(): HarnessSnapshot } }).__LIMN_E2E__;
    if (!api) {
      throw new Error("Limn E2E harness not loaded");
    }
    return api.snapshot();
  });
}

export async function setUpdaterMode(page: Page, mode: HarnessSnapshot["updater"]["mode"]): Promise<void> {
  await page.evaluate((nextMode) => {
    const api = (window as { __LIMN_E2E__?: { setUpdaterMode(mode: typeof nextMode): void } }).__LIMN_E2E__;
    if (!api) {
      throw new Error("Limn E2E harness not loaded");
    }
    api.setUpdaterMode(nextMode);
  }, mode);
}
