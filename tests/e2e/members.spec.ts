import { test, expect } from "@playwright/test";
import { openApp, openWorkspace, snapshot } from "./harness";

test.describe("members", () => {
  test("removing a member confirms, clears stale assignments, and blocks resurrection", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Team Board");
    await page.getByTestId("text-dialog-submit").click();

    // Add a member.
    await page.getByTestId("nav-members").click();
    await page.getByTestId("member-name-input").fill("Priya Nadkarni");
    await page.getByTestId("add-member").click();
    await expect.poll(async () => (await snapshot(page)).members.members.length).toBe(1);

    // Assign her to a card.
    await page.locator('[data-testid^="board-nav-"]').first().click();
    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Design homepage");
    await page.getByTestId("text-dialog-submit").click();
    await expect(page.getByTestId("card-title-input")).toBeVisible();
    await page.getByTestId("assignee-priya-nadkarni").check();
    await page.getByTestId("save-card").click();
    await expect(page.getByTestId("card-title-input")).toBeHidden();
    await expect.poll(async () => (await snapshot(page)).cards[0]?.content.includes("priya-nadkarni")).toBe(true);

    // Removing a member requires confirmation, consistent with other destructive actions.
    await page.getByTestId("nav-members").click();
    await page.getByTestId("member-priya-nadkarni-remove").click();
    await expect(page.getByTestId("confirm-dialog-submit")).toBeVisible();
    await page.getByTestId("confirm-dialog-submit").click();

    // The member is gone and the card no longer holds the stale assignee id.
    await expect.poll(async () => (await snapshot(page)).members.members.length).toBe(0);
    await expect.poll(async () => (await snapshot(page)).cards[0].content).toContain("assignees: []");
    expect((await snapshot(page)).cards[0].content).not.toContain("priya-nadkarni");

    // Re-adding a same-named member (same derived id) must not resurrect the assignment.
    await page.getByTestId("member-name-input").fill("Priya Nadkarni");
    await page.getByTestId("add-member").click();
    await expect.poll(async () => (await snapshot(page)).members.members.length).toBe(1);
    expect((await snapshot(page)).cards[0].content).toContain("assignees: []");
  });

  test("removing a member can be cancelled from the confirmation dialog", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Team Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("nav-members").click();
    await page.getByTestId("member-name-input").fill("Priya Nadkarni");
    await page.getByTestId("add-member").click();
    await expect.poll(async () => (await snapshot(page)).members.members.length).toBe(1);

    await page.getByTestId("member-priya-nadkarni-remove").click();
    await expect(page.getByTestId("confirm-dialog-submit")).toBeVisible();
    await page.keyboard.press("Escape");

    // Cancelling keeps the member.
    await expect(page.getByTestId("confirm-dialog-submit")).toBeHidden();
    await expect(page.getByTestId("member-priya-nadkarni-remove")).toBeVisible();
    expect((await snapshot(page)).members.members.length).toBe(1);
  });
});
