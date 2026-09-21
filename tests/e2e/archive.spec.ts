import { test, expect, type Page } from "@playwright/test";
import { openApp, openWorkspace, queueAttachmentPick, snapshot } from "./harness";

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

  test("empties 1,000 archived cards across filters, removes attachments, and keeps active cards", async ({ page }) => {
    test.setTimeout(90_000);
    await openApp(page);
    await openWorkspace(page);
    await createBoard(page, "Large archive");
    const activeId = await createCard(page, "Keep active");
    const archivedId = await createCard(page, "Discard attachment");
    await page.getByTestId(`card-open-${archivedId}`).click();
    await queueAttachmentPick(page, ["/mock/uploads/old.pdf"]);
    await page.getByTestId("add-attachment").click();
    await expect.poll(async () => (await snapshot(page)).attachments.length).toBe(1);
    await page.getByTestId("archive-card").click();
    const template = (await snapshot(page)).cards.find((file) => file.file_name === `${archivedId}.md`)!;
    await page.evaluate(({ content, originalId }) => {
      const api = (window as unknown as { __LIMN_E2E__: { externalEditCard(name: string, content: string, silent?: boolean): void } }).__LIMN_E2E__;
      for (let index = 1; index < 1000; index++) {
        const id = `card_archive_${index}`;
        api.externalEditCard(`${id}.md`, content.replaceAll(originalId, id)
          .replace(/^title: .*$/m, `title: "Old card ${index}"`)
          .replace(/^boardId: .*$/m, 'boardId: "deleted-board"'), index < 999);
      }
    }, { content: template.content, originalId: archivedId });
    // The silent fixture writes intentionally bypass incremental watch events.
    await openApp(page, { reset: false });
    await page.getByTestId("nav-archive").click();
    await expect(page.getByTestId("archive-count")).toHaveText("1000");
    await page.getByTestId("archive-search").fill("Discard attachment");
    await expect(page.getByTestId("archive-result-count")).toContainText("1 archived card ·");
    await page.getByTestId("empty-archive").click();
    const dialog = page.getByRole("dialog", { name: "Empty archive?" });
    await expect(dialog).toContainText("all 1000 archived cards");
    await expect(dialog).toContainText("attachments from disk");
    await expect(dialog).toContainText("cannot be undone");
    await page.keyboard.press("Escape");
    expect((await snapshot(page)).cards).toHaveLength(1001);
    await page.getByTestId("empty-archive").click();
    await page.getByTestId("confirm-dialog-submit").click();
    await expect.poll(async () => (await snapshot(page)).cards.length, { timeout: 60_000 }).toBe(1);
    expect((await snapshot(page)).cards[0].file_name).toBe(`${activeId}.md`);
    expect((await snapshot(page)).attachments).toHaveLength(0);
    await expect(page.getByTestId("archive-empty")).toContainText("No archived cards");
    await expect(page.getByTestId("empty-archive")).toBeDisabled();
    await expect(page.getByText("Permanently deleted 1000 archived cards.", { exact: true })).toBeVisible();
    await openApp(page, { reset: false });
    await page.getByTestId("nav-archive").click();
    await expect(page.getByTestId("archive-empty")).toContainText("No archived cards");
  });

  test("keeps a card restored on another device after confirmation opens", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    await createBoard(page, "Concurrent archive");
    const changedId = await createCard(page, "Restored elsewhere");
    await archiveCard(page, changedId);
    const removedId = await createCard(page, "Unchanged archive");
    await archiveCard(page, removedId);
    await page.getByTestId("nav-archive").click();
    await page.getByTestId("empty-archive").click();
    const changed = (await snapshot(page)).cards.find((file) => file.file_name === `${changedId}.md`)!;
    await page.evaluate(({ file_name, content }) => {
      const api = (window as unknown as { __LIMN_E2E__: { externalEditCard(name: string, content: string, silent?: boolean): void } }).__LIMN_E2E__;
      api.externalEditCard(file_name, content.replace(/^archived: .*$/m, "archived: false")
        .replace(/^updatedAt: .*$/m, 'updatedAt: "2099-01-01T00:00:00.000Z"'), true);
    }, changed);
    await page.getByTestId("confirm-dialog-submit").click();
    await expect.poll(async () => (await snapshot(page)).cards.length).toBe(1);
    expect((await snapshot(page)).cards[0].file_name).toBe(changed.file_name);
    await expect(page.getByText(/1 card changed on disk and was kept/)).toBeVisible();
    await expect(page.getByTestId("conflict-banner")).toBeVisible();
  });

  test("reports partial failures and can retry remaining cards", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    await createBoard(page, "Partial archive");
    const failedId = await createCard(page, "Retry me");
    await archiveCard(page, failedId);
    const removedId = await createCard(page, "Delete me");
    await archiveCard(page, removedId);
    await page.getByTestId("nav-archive").click();
    await page.evaluate((id) => {
      const ipc = (window as unknown as { __LIMN_TEST_IPC__: { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> } }).__LIMN_TEST_IPC__;
      const original = ipc.invoke.bind(ipc);
      let failOnce = true;
      ipc.invoke = async (command, args) => {
        if (command === "delete_card_file" && args?.fileName === `${id}.md` && failOnce) {
          failOnce = false;
          throw new Error("Disk unavailable");
        }
        return original(command, args);
      };
    }, failedId);
    await page.getByTestId("empty-archive").click();
    await page.getByTestId("confirm-dialog-submit").click();
    await expect(page.getByText(/1 card could not be deleted/)).toBeVisible();
    expect((await snapshot(page)).cards.map((file) => file.file_name)).toEqual([`${failedId}.md`]);
    await expect(page.getByTestId("empty-archive")).toBeEnabled();
    await page.getByTestId("empty-archive").click();
    await page.getByTestId("confirm-dialog-submit").click();
    await expect(page.getByTestId("archive-empty")).toBeVisible();
    expect((await snapshot(page)).cards).toHaveLength(0);
  });
});
