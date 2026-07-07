import { test, expect } from "@playwright/test";
import { openApp, openWorkspace, queueWorkspacePick, snapshot } from "./harness";

const WORKSPACE_A = "/mock/limn-e2e-workspace";
const WORKSPACE_B = "/mock/limn-e2e-workspace-b";

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
