import { test, expect, type Page } from "@playwright/test";
import type { Board, WorkspaceFiles } from "../../src/types";
import { openApp, openWorkspace, queueWorkspacePick, snapshot } from "./harness";

const WORKSPACE_A = "/mock/limn-e2e-workspace";
const WORKSPACE_B = "/mock/limn-e2e-workspace-b";

declare global {
  interface Window {
    __LIMN_HELD_READ__?: { started: boolean; completed: boolean; release: () => void };
  }
}

// Delay a captured response, rather than the read itself, to reproduce stale
// cloud IO deterministically while the user switches workspaces.
async function holdWorkspaceRead(page: Page, command: string) {
  await page.evaluate(({ command, path }) => {
    const ipc = window.__LIMN_TEST_IPC__!;
    const invoke = ipc.invoke.bind(ipc);
    let release = () => {};
    const pending = new Promise<void>(resolve => { release = resolve; });
    const state = { started: false, completed: false, release };
    window.__LIMN_HELD_READ__ = state;
    ipc.invoke = async <T,>(name: string, args?: Record<string, unknown>): Promise<T> => {
      const result = await invoke<T>(name, args);
      if (name === command && args?.path === path && !state.started) {
        state.started = true;
        await pending;
        state.completed = true;
      }
      return result;
    };
  }, { command, path: WORKSPACE_A });
}

test.describe("workspace tabs", () => {
  test("opens, switches between, and closes multiple workspaces as tabs", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    // Create a board in the first workspace so the two are distinguishable.
    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Alpha Board");
    await page.getByTestId("text-dialog-submit").click();
    await expect(page.locator('[data-testid^="board-nav-"]')).toHaveCount(1);

    // A single tab so far.
    await expect(page.getByTestId("workspace-tabs").getByRole("tab")).toHaveCount(1);

    // Open a second workspace folder into a new tab.
    await queueWorkspacePick(page, WORKSPACE_B);
    await page.getByTestId("workspace-tab-add").click();

    // Two tabs; the new one is active and starts empty (its own boards).
    await expect(page.getByTestId("workspace-tabs").getByRole("tab")).toHaveCount(2);
    await expect(page.locator('[data-testid^="board-nav-"]')).toHaveCount(0);
    await expect(page.getByText("No boards yet.")).toBeVisible();
    await expect.poll(async () => (await snapshot(page)).openWorkspaces).toEqual({
      active: WORKSPACE_B,
      paths: [WORKSPACE_A, WORKSPACE_B]
    });

    // Switch back to the first workspace; its board returns.
    await page.getByTestId(`workspace-tab-${WORKSPACE_A}`).click();
    await expect(page.locator('[data-testid^="board-nav-"]')).toHaveCount(1);
    await expect.poll(async () => (await snapshot(page)).openWorkspaces.active).toBe(WORKSPACE_A);

    // Close the (inactive) second tab; it disappears and the first stays active.
    await page.getByTestId(`workspace-tab-close-${WORKSPACE_B}`).click();
    await expect(page.getByTestId("workspace-tabs").getByRole("tab")).toHaveCount(1);
    await expect(page.locator('[data-testid^="board-nav-"]')).toHaveCount(1);
    await expect.poll(async () => (await snapshot(page)).openWorkspaces.paths).toEqual([WORKSPACE_A]);

    // Closing the last tab returns to the welcome screen.
    await page.getByTestId(`workspace-tab-close-${WORKSPACE_A}`).click();
    await expect(page.getByTestId("welcome-open-workspace")).toBeVisible();
    await expect.poll(async () => (await snapshot(page)).openWorkspaces.paths).toEqual([]);
  });

  test("closing the active workspace falls back to a neighbouring tab", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await queueWorkspacePick(page, WORKSPACE_B);
    await page.getByTestId("workspace-tab-add").click();
    await expect.poll(async () => (await snapshot(page)).openWorkspaces.active).toBe(WORKSPACE_B);

    // Closing the active (second) tab activates its neighbour rather than the
    // welcome screen while another workspace is still open.
    await page.getByTestId(`workspace-tab-close-${WORKSPACE_B}`).click();
    await expect(page.getByTestId("workspace-tabs").getByRole("tab")).toHaveCount(1);
    await expect(page.getByTestId("create-board")).toBeVisible();
    await expect.poll(async () => (await snapshot(page)).openWorkspaces.active).toBe(WORKSPACE_A);
  });

  test("renaming the workspace updates its tab label immediately", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    // The tab starts labelled with the workspace's folder-derived name.
    await expect(page.getByTestId(`workspace-tab-${WORKSPACE_A}`)).toContainText("limn-e2e-workspace");

    await page.getByTestId("nav-settings").click();
    await page.getByTestId("workspace-name-input").fill("Two Embers");
    await page.getByTestId("save-settings").click();

    // The tab relabels without needing a restart.
    await expect(page.getByTestId(`workspace-tab-${WORKSPACE_A}`)).toContainText("Two Embers");
  });

  test("tabs can be dragged to reorder and the order persists", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    await queueWorkspacePick(page, WORKSPACE_B);
    await page.getByTestId("workspace-tab-add").click();
    await expect.poll(async () => (await snapshot(page)).openWorkspaces.paths).toEqual([WORKSPACE_A, WORKSPACE_B]);

    const tabA = page.getByTestId(`workspace-tab-${WORKSPACE_A}`);
    const tabB = page.getByTestId(`workspace-tab-${WORKSPACE_B}`);
    const aBox = await tabA.boundingBox();
    const bBox = await tabB.boundingBox();
    if (!aBox || !bBox) {
      throw new Error("tab bounding boxes unavailable");
    }

    // Drag the second tab past the midpoint of the first so it lands ahead of it.
    await page.mouse.move(bBox.x + bBox.width / 2, bBox.y + bBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(bBox.x + bBox.width / 2 - 10, bBox.y + bBox.height / 2);
    await page.mouse.move(aBox.x + 4, aBox.y + aBox.height / 2);
    await page.mouse.up();

    // Order flips and persists; the active workspace is unchanged.
    await expect.poll(async () => (await snapshot(page)).openWorkspaces).toEqual({
      active: WORKSPACE_B,
      paths: [WORKSPACE_B, WORKSPACE_A]
    });
  });

  test("re-opening an already-open workspace focuses its tab instead of duplicating it", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    await expect(page.getByTestId("workspace-tabs").getByRole("tab")).toHaveCount(1);

    // Picking the same folder again must not add a duplicate tab.
    await queueWorkspacePick(page, WORKSPACE_A);
    await page.getByTestId("workspace-tab-add").click();
    await expect(page.getByTestId("workspace-tabs").getByRole("tab")).toHaveCount(1);
    await expect.poll(async () => (await snapshot(page)).openWorkspaces.paths).toEqual([WORKSPACE_A]);
  });
});

test("workspace tabs support arrow navigation and keyboard activation", async ({ page }) => {
  await openApp(page);
  await openWorkspace(page);
  await queueWorkspacePick(page, WORKSPACE_B);
  await page.getByTestId("workspace-tab-add").click();
  const tabA = page.getByTestId(`workspace-tab-${WORKSPACE_A}`);
  const tabB = page.getByTestId(`workspace-tab-${WORKSPACE_B}`);
  await expect(tabB).toHaveAttribute("aria-selected", "true");
  await tabB.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(tabA).toBeFocused();
  // Moving focus does not switch a workspace until it is activated.
  await expect(tabB).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(tabA).toHaveAttribute("aria-selected", "true");
  await expect.poll(async () => (await snapshot(page)).openWorkspaces.active).toBe(WORKSPACE_A);
  await page.keyboard.press("End");
  await expect(tabB).toBeFocused();
  await page.keyboard.press("Space");
  await expect(tabB).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(tabA).toBeFocused();
});

for (const command of ["load_workspace", "read_workspace_files"] as const) {
  test(`a delayed ${command} cannot contaminate another workspace`, async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Alpha board");
    await page.getByTestId("text-dialog-submit").click();
    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Alpha card");
    await page.getByTestId("text-dialog-submit").click();
    await page.getByTestId("save-card").click();
    const alpha = await snapshot(page);
    const board = JSON.parse(alpha.boards[0].content) as Board;
    // Observe a completed watch refresh before installing the delayed response.
    await page.evaluate(({ file, board }) => window.__LIMN_E2E__!.externalEditBoard(file, {
      ...board, name: "Alpha ready", updatedAt: "2026-12-01T00:00:00.000Z"
    }), { file: alpha.boards[0].file_name, board });
    await expect(page.getByTestId(`board-nav-${board.id}`)).toHaveText("Alpha ready");
    await holdWorkspaceRead(page, command);
    await page.evaluate(({ command, board, card }) => {
      if (command === "load_workspace") {
        window.__LIMN_E2E__!.externalEditBoard(`${board.id}.json`, {
          ...board, name: "Alpha remote", updatedAt: "2026-12-02T00:00:00.000Z"
        });
      } else {
        window.__LIMN_E2E__!.externalEditCard(card.file_name, card.content
          .replace(/^title: .*$/m, 'title: "Alpha remote card"')
          .replace(/^updatedAt: .*$/m, 'updatedAt: "2026-12-02T00:00:00.000Z"'));
      }
    }, { command, board, card: alpha.cards[0] });
    await page.waitForFunction(() => window.__LIMN_HELD_READ__?.started);

    await queueWorkspacePick(page, WORKSPACE_B);
    await page.getByTestId("workspace-tab-add").click();
    await expect(page.getByTestId(`workspace-tab-${WORKSPACE_B}`)).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Beta board");
    await page.getByTestId("text-dialog-submit").click();
    const beta = JSON.parse((await snapshot(page)).boards[0].content) as Board;
    await page.evaluate(() => window.__LIMN_HELD_READ__!.release());
    await page.waitForFunction(() => window.__LIMN_HELD_READ__?.completed);
    // Allow the released promise's React updates to commit before asserting absence.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.getByTestId(`board-nav-${beta.id}`)).toHaveText("Beta board");
    await expect(page.getByTestId(`board-nav-${board.id}`)).toHaveCount(0);
    await page.getByTestId("nav-filter").click();
    await expect(page.getByTestId("filter-result-count")).toHaveText("0 cards");

    // Editing after the late response must still write only Beta's data into B.
    await page.getByTestId(`board-nav-${beta.id}`).click();
    await page.getByTestId("list-more-todo").click();
    await page.getByRole("menuitem", { name: "Rename list", exact: true }).click();
    await page.getByTestId("text-dialog-input").fill("Beta backlog");
    await page.getByTestId("text-dialog-submit").click();
    const saved = await page.evaluate(path => window.__LIMN_TEST_IPC__!.invoke<WorkspaceFiles>("load_workspace", { path }), WORKSPACE_B);
    expect(saved.boards.map(file => JSON.parse(file.content).id)).toEqual([beta.id]);
    expect(JSON.parse(saved.boards[0].content).lists[0].name).toBe("Beta backlog");
    expect(saved.cards).toHaveLength(0);
  });
}
