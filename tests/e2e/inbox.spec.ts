import { test, expect } from "@playwright/test";
import { openApp, openWorkspace } from "./harness";

async function addMember(page: import("@playwright/test").Page, name: string) {
  await page.getByTestId("member-name-input").fill(name);
  await page.getByTestId("add-member").click();
}

test.describe("inbox", () => {
  test("comments and mentions on your card are unread without duplicates", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("nav-members").click();
    await addMember(page, "Ada Lovelace");
    await addMember(page, "Grace Hopper");

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Launch Board");
    await page.getByTestId("text-dialog-submit").click();
    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Plan the launch");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("assignee-grace-hopper").check();
    await page.getByTestId("save-card").click();
    await page.getByTestId(/card-open-.*/).click();
    await page.getByTestId("comment-identify-ada-lovelace").click();
    await page.getByTestId("comment-input").fill("@Grace can you review the launch plan?");
    await page.getByTestId("add-comment").click();
    await page.getByTestId("comment-input").fill("I also added the latest launch notes.");
    await page.getByTestId("add-comment").click();
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByTestId("identity-select").click();
    await page.getByRole("menuitem", { name: "Grace Hopper" }).click();
    await page.getByTestId(/card-open-.*/).click();
    await page.getByTestId("comment-input").fill("@Grace leaving myself a status note.");
    await page.getByTestId("add-comment").click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByTestId("inbox-unread-count")).toHaveText("3");

    await page.getByTestId("nav-inbox").click();
    await expect(page.getByTestId(/inbox-item-mention:/)).toContainText("Ada Lovelace mentioned you");
    await expect(page.getByTestId(/inbox-item-mention:/)).toContainText("Plan the launch · Launch Board");
    const ordinaryComment = page.getByTestId(/inbox-item-comment:/).filter({ hasText: "Ada Lovelace commented" });
    await expect(ordinaryComment).toContainText("I also added the latest launch notes.");
    await expect(page.getByText("You commented")).toHaveCount(0);
    await expect(page.getByText("leaving myself a status note.")).toHaveCount(0);
    await expect(page.getByTestId(/inbox-item-mention:/)).toHaveCount(1);
    await page.getByTestId(/inbox-item-mention:/).click();
    await expect(page.getByRole("heading", { name: "Plan the launch" })).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByTestId("inbox-mark-all-read").click();
    await expect(page.getByTestId("inbox-unread-count")).toBeHidden();
  });

  test("without an identity the inbox offers the identity picker", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    await page.getByTestId("nav-inbox").click();
    await expect(page.getByTestId("inbox-no-identity")).toContainText("Choose who you are to see your mentions and assignments");
    await page.getByRole("button", { name: "Choose who you are" }).click();
    await expect(page.getByRole("menuitem", { name: "Add members…" })).toBeVisible();
  });
});
