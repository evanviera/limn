import { test, expect, type Page } from "@playwright/test";
import { openApp, openWorkspace, snapshot } from "./harness";

async function createBoard(page: Page, name: string): Promise<string> {
  await page.getByTestId("create-board").click();
  await page.getByTestId("text-dialog-input").fill(name);
  await page.getByTestId("text-dialog-submit").click();
  const board = JSON.parse((await snapshot(page)).boards[0].content) as { id: string };
  return board.id;
}

async function createCard(page: Page, title: string, completed = false): Promise<string> {
  await page.getByTestId("add-card-todo").click();
  await page.getByTestId("text-dialog-input").fill(title);
  await page.getByTestId("text-dialog-submit").click();
  await expect(page.getByTestId("card-title-input")).toBeVisible();
  if (completed) {
    await page.getByTestId("card-completed-input").check();
  }
  await page.getByTestId("save-card").click();
  const file = (await snapshot(page)).cards.find((item) => item.content.includes(`title: "${title}"`));
  const id = file?.content.match(/^id:\s*"?([^"\n]+)"?$/m)?.[1];
  if (!id) throw new Error(`Could not find card id for ${title}`);
  return id;
}

async function archiveCard(page: Page, cardId: string): Promise<void> {
  await page.getByTestId(`card-open-${cardId}`).click();
  await expect(page.getByTestId("card-view")).toBeVisible();
  await page.getByTestId("archive-card").click();
  await expect(page.getByTestId("card-view")).toBeHidden();
}

test.describe("archive recovery", () => {
  test("shows every archived card and restores one to its previous list", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    await createBoard(page, "Recovery Board");
    const cardId = await createCard(page, "Completed archive", true);
    await archiveCard(page, cardId);

    await expect(page.getByTestId("archive-count")).toHaveText("1");
    await page.getByTestId("nav-filter").click();
    await page.getByTestId("filter-completion").selectOption("any");
    await page.getByTestId("filter-archived").selectOption("archived");
    await page.getByTestId(`filter-row-${cardId}`).click();
    await expect(page.getByTestId("restore-card")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByTestId("nav-archive").click();
    const row = page.getByTestId(`archive-row-${cardId}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("Completed");
    await expect(row).toContainText("Recovery Board · To Do");

    await page.getByTestId(`restore-card-${cardId}`).click();
    await expect(row).toHaveCount(0);
    await expect(page.getByTestId("archive-empty")).toContainText("No archived cards");
    await expect(page.getByTestId("archive-count")).toHaveCount(0);
    await expect(page.getByTestId("archive-toast")).toContainText("restored to Recovery Board / To Do");
    await page.getByTestId("archive-toast-action").click();
    await expect(row).toBeVisible();
    await expect(page.getByTestId("archive-count")).toHaveText("1");
    await page.getByTestId(`restore-card-${cardId}`).click();
    await expect(row).toHaveCount(0);
    await expect.poll(async () => (await snapshot(page)).cards[0].content).toMatch(/^archived:\s*false$/m);
    await expect.poll(async () => (await snapshot(page)).cards[0].content).not.toMatch(/^archivedAt:/m);
  });

  test("chooses a new destination when the archived card's list was deleted", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    const boardId = await createBoard(page, "List Recovery");
    const cardId = await createCard(page, "Orphaned archive");

    await page.getByTestId("list-title-todo").click({ button: "right" });
    await page.getByTestId("context-menu").getByRole("menuitem", { name: "Delete list" }).click();
    await page.getByTestId("confirm-dialog-submit").click();
    await page.getByTestId("nav-archive").click();

    const row = page.getByTestId(`archive-row-${cardId}`);
    await expect(row).toContainText("Needs a new list");
    await expect(row).toContainText("Deleted list (deleted)");
    await page.getByTestId(`restore-card-${cardId}`).click();
    await expect(page.getByTestId("restore-card-dialog")).toBeVisible();
    await page.getByTestId("restore-card-list").selectOption("in-progress");
    await page.getByTestId("restore-card-submit").click();
    await expect(page.getByTestId("restore-card-dialog")).toBeHidden();
    await expect(row).toHaveCount(0);

    await page.getByTestId(`board-nav-${boardId}`).click();
    await expect(page.getByTestId("list-in-progress").getByText("Orphaned archive", { exact: true })).toBeVisible();
    await expect.poll(async () => (await snapshot(page)).cards[0].content).toMatch(/^listId:\s*"?in-progress"?$/m);
  });

  test("can permanently delete an archived card from its overflow menu", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    await createBoard(page, "Purge Board");
    const cardId = await createCard(page, "Discard old draft");
    await archiveCard(page, cardId);
    await page.getByTestId("nav-archive").click();

    await page.getByTestId(`archive-more-${cardId}`).click();
    await page.getByTestId("context-menu").getByRole("menuitem", { name: "Delete forever" }).click();
    await expect(page.getByRole("dialog", { name: "Delete card" })).toContainText("removes the card file");
    await page.getByTestId("confirm-dialog-submit").click();
    await expect.poll(async () => (await snapshot(page)).cards).toHaveLength(0);
    await expect(page.getByTestId("archive-empty")).toBeVisible();
  });
});
