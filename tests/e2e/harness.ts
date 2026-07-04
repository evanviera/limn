import { type Locator, type Page, expect } from "@playwright/test";

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
  attachments: Array<{ path: string; size: number }>;
  exports: Array<{ path: string; content: string }>;
  lastWorkspace: string | null;
  externalLinks: string[];
  loadWorkspaceCount: number;
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

export async function queuePrompt(page: Page, value: string | null): Promise<void> {
  await page.evaluate((nextValue) => {
    document.dispatchEvent(new CustomEvent("limn-e2e-command", {
      detail: { type: "queuePrompt", value: nextValue }
    }));
  }, value);
}

/** Queue the paths the next `pick_attachment_files` (native file dialog) returns. */
export async function queueAttachmentPick(page: Page, paths: string[]): Promise<void> {
  await page.evaluate((nextPaths) => {
    document.dispatchEvent(new CustomEvent("limn-e2e-command", {
      detail: { type: "queueAttachmentPick", paths: nextPaths }
    }));
  }, paths);
}

/**
 * Simulate an OS file drop of the given absolute paths onto the app window.
 * Pass a `target` locator to drop onto a specific element (e.g. a board card);
 * omit it to drop with no card under the pointer (attaches to the open editor).
 */
export async function dropFiles(page: Page, paths: string[], target?: Locator): Promise<void> {
  let point: { x: number; y: number } = { x: 0, y: 0 };
  if (target) {
    const box = await target.boundingBox();
    if (!box) {
      throw new Error("Drop target is not visible");
    }
    point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  await page.evaluate(({ nextPaths, x, y }) => {
    document.dispatchEvent(new CustomEvent("limn-e2e-command", {
      detail: { type: "dropFiles", paths: nextPaths, x, y }
    }));
  }, { nextPaths: paths, x: point.x, y: point.y });
}
