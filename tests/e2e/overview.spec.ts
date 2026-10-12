import { test, expect, type Page } from "@playwright/test";
import type { Board, BoardGroup } from "../../src/types";
import { openApp, openWorkspace, queueWorkspacePick, snapshot } from "./harness";

async function createCategory(page: Page, name: string) {
  await page.getByTestId("create-board-category").click();
  await page.getByTestId("text-dialog-input").fill(name);
  await page.getByTestId("text-dialog-submit").click();
  await expect(page.getByTestId("text-dialog-input")).toBeHidden();
  return ((await snapshot(page)).settings.boardGroups as BoardGroup[]).find(group => group.name === name)!;
}

async function createBoard(page: Page, name: string, groupId = "") {
  await page.getByTestId("create-board").click();
  await page.getByTestId("text-dialog-input").fill(name);
  if (await page.getByTestId("board-name-category").count()) {
    await page.getByTestId("board-name-category").selectOption(groupId);
  }
  await page.getByTestId("text-dialog-submit").click();
  await expect(page.getByTestId("board-name-dialog")).toBeHidden();
  return (await snapshot(page)).boards.map(file => JSON.parse(file.content) as Board)
    .find(board => board.name === name && (board.groupId ?? "") === groupId)!;
}

async function createCard(page: Page, title: string) {
  await page.getByTestId("add-card-todo").click();
  await page.getByTestId("text-dialog-input").fill(title);
  await page.getByTestId("text-dialog-submit").click();
  await expect(page.getByTestId("card-title-input")).toBeVisible();
  await page.getByTestId("save-card").click();
  await expect(page.getByTestId("card-title-input")).toBeHidden();
}

test.describe("workspace overview", () => {
  test("shows an empty workspace and empty categories", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    await page.getByTestId("nav-overview").click();
    await expect(page.getByTestId("nav-overview")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("overview-view")).toContainText("0 categories · 0 boards · 0 cards");
    await expect(page.getByRole("heading", { name: "No boards yet" })).toBeVisible();
    const category = await createCategory(page, "Future work");
    await expect(page.getByTestId(`overview-category-${category.id}`)).toContainText("No boards in this category.");
    await page.getByTestId(`overview-category-toggle-${category.id}`).click();
    await expect(page.getByTestId(`overview-category-toggle-${category.id}`)).toHaveAttribute("aria-expanded", "false");
  });

  test("stacks categories and boards in sidebar order and isolates repeated list IDs", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    const orchid = await createCategory(page, "Orchid");
    const finance = await createCategory(page, "Finances / Taxes");
    const first = await createBoard(page, "TODO", orchid.id);
    await createCard(page, "Orchid task");
    const files = await createBoard(page, "FILES", orchid.id);
    await createCard(page, "File task");
    const second = await createBoard(page, "TODO", finance.id);
    await createCard(page, "Finance task");
    const loose = await createBoard(page, "Personal");
    await createCard(page, "Personal task");
    // Manual ordering takes precedence over creation order, just as in the sidebar.
    const state = await snapshot(page);
    const file = state.boards.find(file => (JSON.parse(file.content) as Board).id === files.id)!;
    await page.evaluate(({ fileName, board }) => document.dispatchEvent(new CustomEvent("limn-e2e-command", {
      detail: { type: "externalEditBoard", fileName, board }
    })), { fileName: file.file_name, board: { ...files, order: -1000, updatedAt: "2027-01-01T00:00:00.000Z" } });
    await expect.poll(() => page.locator(".board-nav-item").allTextContents()).toEqual(["FILES", "TODO", "TODO", "Personal"]);
    // A collapsed sidebar category must still be expanded in the new Overview.
    await page.getByTestId(`board-group-collapse-${orchid.id}`).click();
    await page.getByTestId("nav-overview").click();
    const overview = page.getByTestId("overview-view");
    await expect(overview.locator(".overview-category-toggle .overview-name")).toHaveText(["Orchid", "Finances / Taxes", "Ungrouped"]);
    await expect(overview.locator(".overview-board-toggle .overview-name")).toHaveText(["FILES", "TODO", "TODO", "Personal"]);
    await expect(overview.locator(".task-card")).toHaveCount(4);
    for (const [board, title] of [[files, "File task"], [first, "Orchid task"], [second, "Finance task"], [loose, "Personal task"]] as const) {
      await expect(page.getByTestId(`overview-board-${board.id}`).locator(".task-card")).toHaveText(title);
    }
    await expect(overview).toContainText("2 categories · 4 boards · 4 cards");
  });

  test("opens the correct board context, edits cards, and excludes archived cards", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    const first = await createBoard(page, "First board");
    await createCard(page, "First task");
    await createBoard(page, "Second board");
    await createCard(page, "Second task");
    await page.getByTestId("nav-overview").click();
    await page.getByTestId(`overview-board-${first.id}`).getByRole("button", { name: "First task", exact: true }).click();
    await expect(page.locator(".card-view-header .eyebrow")).toHaveText("First board / To Do");
    await page.getByTestId("edit-card").click();
    await page.getByTestId("card-title-input").fill("Updated first task");
    await page.getByTestId("card-list-select").selectOption({ label: "In Progress" });
    await page.getByTestId("save-card").click();
    await expect(page.getByTestId("overview-view")).toBeVisible();
    const column = page.getByTestId(`overview-board-${first.id}`).getByRole("region", { name: "First board: In Progress" });
    await expect(column).toContainText("Updated first task");
    await column.getByRole("button", { name: "Updated first task", exact: true }).click();
    await page.getByTestId("card-view-complete").click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(column.locator(".task-card")).toHaveClass(/completed/);
    await column.getByRole("button", { name: "Updated first task", exact: true }).click();
    await page.getByTestId("archive-card").click();
    await expect(page.getByTestId("overview-view").locator(".task-card")).toHaveCount(1);
    await expect(page.getByTestId("overview-view")).toContainText("0 categories · 2 boards · 1 card");
  });

  test("remembers independent board and category folds across navigation, reloads, and workspaces", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    const category = await createCategory(page, "Orchid");
    const board = await createBoard(page, "TODO", category.id);
    await createCard(page, "Remember me");
    // Stop requesting a preference reset before testing persistence.
    await openApp(page, { reset: false });
    await page.getByTestId("nav-overview").click();
    const boardToggle = page.getByTestId(`overview-board-toggle-${board.id}`);
    const categoryToggle = page.getByTestId(`overview-category-toggle-${category.id}`);
    await boardToggle.click();
    await expect(boardToggle).toHaveAttribute("aria-expanded", "false");
    await categoryToggle.focus();
    await page.keyboard.press("Enter");
    await expect(categoryToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId(`board-group-collapse-${category.id}`)).toHaveAttribute("aria-expanded", "true");
    await page.getByTestId("nav-filter").click();
    await page.getByTestId("nav-overview").click();
    await expect(categoryToggle).toHaveAttribute("aria-expanded", "false");
    await page.reload();
    await page.getByTestId("nav-overview").click();
    await expect(categoryToggle).toHaveAttribute("aria-expanded", "false");
    await categoryToggle.click();
    await expect(boardToggle).toHaveAttribute("aria-expanded", "false");
    await boardToggle.click();
    await expect(page.getByTestId("overview-view")).toContainText("Remember me");
    // Collapse A again, open an empty B, and ensure A's content never leaks into B.
    await categoryToggle.click();
    await queueWorkspacePick(page, "/mock/overview-other");
    await page.getByTestId("workspace-tab-add").click();
    await page.getByTestId("nav-overview").click();
    await expect(page.getByTestId("overview-view")).toContainText("0 categories · 0 boards · 0 cards");
    await expect(page.getByTestId(`overview-category-${category.id}`)).toHaveCount(0);
    await page.getByTestId("workspace-tab-/mock/limn-e2e-workspace").click();
    await page.getByTestId("nav-overview").click();
    await expect(categoryToggle).toHaveAttribute("aria-expanded", "false");
  });

  test("fits the default columns at desktop width and reflows at phone width", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    const board = await createBoard(page, "A long board title that wraps without hiding the collapse button or card counts");
    await createCard(page, "A long task title that remains readable in a narrower overview column");
    await page.getByTestId("nav-overview").click();
    await page.setViewportSize({ width: 1024, height: 900 });
    const columns = page.getByTestId(`overview-board-${board.id}`).locator(".overview-columns");
    expect(await columns.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    const listBoxes = await columns.locator(".overview-column").evaluateAll(elements => elements.map(el => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y };
    }));
    expect(listBoxes[0].x).toBe(listBoxes[1].x);
    expect(listBoxes[1].y).toBeGreaterThan(listBoxes[0].y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByTestId("overview-view")).toBeVisible();
  });
});
