import { test, expect } from "@playwright/test";
import { openApp, openWorkspace, snapshot } from "./harness";

test.describe("smoke", () => {
  test("welcome screen renders", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("welcome-open-workspace")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("opening a workspace reveals the board shell", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    await expect(page.getByTestId("create-board")).toBeVisible();
    await expect(page.getByTestId("nav-members")).toBeVisible();
    await expect(page.getByTestId("nav-settings")).toBeVisible();
  });

  test("creating a board persists to the harness snapshot", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    // Create board opens a TextDialog for the name, then persists on submit.
    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("QA Board");
    await page.getByTestId("text-dialog-submit").click();

    await expect.poll(async () => (await snapshot(page)).boards.length).toBeGreaterThan(0);
  });
});
