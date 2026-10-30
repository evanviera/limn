import { test, expect, type Page, type Locator } from "@playwright/test";
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

async function submitText(page: Page, value: string) {
  await page.getByTestId("text-dialog-input").fill(value);
  await page.getByTestId("text-dialog-submit").click();
  await expect(page.getByTestId("text-dialog-input")).toBeHidden();
}

async function drag(page: Page, source: Locator, target: Locator, fraction = 0.5) {
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + 20);
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * fraction);
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
    const column = page.getByTestId(`overview-board-${first.id}`).getByTestId("list-in-progress");
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

  test("preserves single-board list and card formatting as the window resizes", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    const board = await createBoard(page, "A long board title that wraps without hiding the collapse button or card counts");
    await createCard(page, "A long task title that remains readable in a narrower overview column");
    const layout = () => page.locator(".columns").evaluate(element => {
      const list = element.querySelector<HTMLElement>(".column")!;
      const stack = list.querySelector<HTMLElement>(".card-stack")!;
      const card = stack.querySelector<HTMLElement>(".task-card")!;
      return {
        listWidth: list.getBoundingClientRect().width,
        cardWidth: card.getBoundingClientRect().width,
        listPadding: getComputedStyle(list).padding,
        cardPadding: getComputedStyle(card).padding,
        listGap: getComputedStyle(element).gap,
        cardGap: getComputedStyle(stack).gap,
        titleFont: getComputedStyle(card.querySelector("h3")!).fontSize
      };
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    const normal = await layout();
    expect(normal.listWidth).toBe(320);
    await page.getByTestId("nav-overview").click();
    expect(await layout()).toEqual(normal);
    // A wider window must leave the fixed-width cards alone; a narrower one
    // scrolls horizontally instead of compressing the lists to fill it.
    for (const width of [2200, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await layout()).toEqual(normal);
    }
    const columns = page.getByTestId(`overview-board-${board.id}`).locator(".columns");
    expect(await columns.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.getByTestId("nav-settings").click();
    await page.getByTestId("list-width-input").fill("420");
    await page.getByTestId("list-width-input").blur();
    await page.getByTestId(`board-nav-${board.id}`).click();
    const custom = await layout();
    expect(custom.listWidth).toBe(420);
    await page.getByTestId("nav-overview").click();
    expect(await layout()).toEqual(custom);
    // Phone-sized windows keep the same horizontal-board layout in both views.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId(`board-nav-${board.id}`).click();
    const phone = await layout();
    await page.getByTestId("nav-overview").click();
    expect(await layout()).toEqual(phone);
    const listBoxes = await columns.locator(".column").evaluateAll(elements => elements.map(el => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y };
    }));
    expect(listBoxes[1].x).toBeGreaterThan(listBoxes[0].x);
    expect(listBoxes[0].y).toBe(listBoxes[1].y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByTestId("overview-view")).toBeVisible();
  });

  test("adds cards and edits, collapses, and archives lists on the intended board", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    const first = await createBoard(page, "First");
    await createCard(page, "First task");
    const second = await createBoard(page, "Second");
    await createCard(page, "Second task");
    await page.getByTestId("nav-overview").click();
    const a = page.getByTestId(`overview-board-${first.id}`);
    const b = page.getByTestId(`overview-board-${second.id}`);
    await a.getByTestId("add-card-in-progress").click();
    await submitText(page, "Added in Overview");
    await expect(page.getByTestId("card-title-input")).toHaveValue("Added in Overview");
    await expect(page.locator(".card-editor-heading h2")).toHaveText("First / In Progress");
    await page.getByTestId("save-card").click();
    await expect(a.getByTestId("list-in-progress")).toContainText("Added in Overview");
    await expect(b.getByTestId("list-in-progress").locator(".task-card")).toHaveCount(0);
    await a.getByTestId("collapse-list-todo").click();
    await expect(a.getByTestId("list-todo")).toHaveClass(/collapsed/);
    await expect(b.getByTestId("list-todo")).not.toHaveClass(/collapsed/);
    await page.getByTestId(`board-nav-${first.id}`).click();
    await expect(page.getByTestId("list-todo")).toHaveClass(/collapsed/);
    await page.getByTestId("nav-overview").click();
    await a.getByTestId("collapse-list-todo").click();
    await expect(a.getByTestId("list-todo")).not.toHaveClass(/collapsed/);
    await b.getByTestId("list-more-todo").click();
    await page.getByRole("menuitem", { name: "Rename list", exact: true }).click();
    await submitText(page, "Second backlog");
    await expect(b.getByTestId("list-title-todo")).toHaveText("Second backlog");
    await expect(a.getByTestId("list-title-todo")).toHaveText("To Do");
    await b.getByTestId("add-list").click();
    await submitText(page, "Review");
    const updated = (await snapshot(page)).boards.map(file => JSON.parse(file.content) as Board).find(board => board.id === second.id)!;
    const review = updated.lists.find(list => list.name === "Review")!;
    await expect(b.getByTestId(`list-${review.id}`)).toBeVisible();
    await expect(a.getByTestId(`list-${review.id}`)).toHaveCount(0);
    await b.getByTestId(`list-more-${review.id}`).click();
    await page.getByRole("menuitem", { name: "Delete list", exact: true }).click();
    await page.getByTestId("confirm-dialog-submit").click();
    await expect(b.getByTestId(`list-${review.id}`)).toHaveCount(0);
    await b.getByTestId("list-title-todo").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Archive all cards", exact: true }).click();
    await page.getByTestId("confirm-dialog-submit").click();
    await expect(b.locator(".task-card")).toHaveCount(0);
    await expect(a.locator(".task-card")).toHaveCount(2);
    await openApp(page, { reset: false });
    await page.getByTestId("nav-overview").click();
    await expect(b.getByTestId("list-title-todo")).toHaveText("Second backlog");
    await expect(a.getByTestId("list-in-progress")).toContainText("Added in Overview");
  });

  for (const pointer of ["mouse", "pen"] as const) {
    test(`${pointer} drag moves and reorders cards within an inactive Overview board`, async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 1400 });
      await openApp(page);
      await openWorkspace(page);
      const first = await createBoard(page, "Source");
      await createCard(page, "Move me");
      await createCard(page, "Stay here");
      const second = await createBoard(page, "Other");
      await createCard(page, "Other task");
      await page.getByTestId("nav-overview").click();
      const a = page.getByTestId(`overview-board-${first.id}`);
      const b = page.getByTestId(`overview-board-${second.id}`);
      if (pointer === "pen") {
        await page.evaluate(() => Object.defineProperty(PointerEvent.prototype, "pointerType", { configurable: true, get: () => "pen" }));
      }
      const todo = a.getByTestId("list-todo");
      const source = todo.locator(".task-card", { hasText: "Move me" });
      await drag(page, source, a.getByTestId("list-in-progress").locator(".empty-list"));
      await expect(a.getByTestId("drop-indicator-in-progress")).toBeVisible();
      await expect(b.getByTestId("drop-indicator-in-progress")).toHaveCount(0);
      await page.mouse.up();
      await expect(a.getByTestId("list-in-progress").locator(".card-open")).toHaveText("Move me");
      await expect(todo.locator(".card-open")).toHaveText("Stay here");
      await expect(b.getByTestId("list-todo").locator(".card-open")).toHaveText("Other task");
      await drag(page, a.getByTestId("list-in-progress").locator(".task-card"), todo.locator(".task-card"), 0.9);
      await page.mouse.up();
      await expect(todo.locator(".card-open")).toHaveText(["Stay here", "Move me"]);
      await drag(page, todo.locator(".task-card").last(), todo.locator(".task-card").first(), 0.1);
      await page.mouse.up();
      await expect(todo.locator(".card-open")).toHaveText(["Move me", "Stay here"]);
      await expect(page.locator("body.is-card-dragging, .drag-preview")).toHaveCount(0);
      await expect(page.getByTestId("nav-overview")).toHaveAttribute("aria-current", "page");
      await openApp(page, { reset: false });
      await page.getByTestId("nav-overview").click();
      await expect(todo.locator(".card-open")).toHaveText(["Move me", "Stay here"]);
    });
  }

  test("drags into an exact position on another board with repeated default list IDs", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1400 });
    await openApp(page);
    await openWorkspace(page);
    const first = await createBoard(page, "Source");
    await createCard(page, "Move across");
    const second = await createBoard(page, "Destination");
    await createCard(page, "Top");
    await createCard(page, "Bottom");
    const before = (await snapshot(page)).cards.find(file => file.content.includes('title: "Move across"'))!;
    await page.getByTestId("nav-overview").click();
    const a = page.getByTestId(`overview-board-${first.id}`);
    const b = page.getByTestId(`overview-board-${second.id}`);
    const target = b.getByTestId("list-todo");
    await drag(page, a.locator(".task-card"), target.locator(".task-card").last(), 0.1);
    await expect(b.getByTestId("drop-indicator-todo")).toBeVisible();
    await expect(a.getByTestId("drop-indicator-todo")).toHaveCount(0);
    await page.mouse.up();
    await expect(target.locator(".card-open")).toHaveText(["Top", "Move across", "Bottom"]);
    await expect(a.locator(".task-card")).toHaveCount(0);
    const after = (await snapshot(page)).cards.find(file => file.file_name === before.file_name)!.content;
    expect(JSON.parse(after.match(/^boardId: (.*)$/m)![1])).toBe(second.id);
    expect(JSON.parse(after.match(/^listId: (.*)$/m)![1])).toBe("todo");
    const preserved = (content: string) => content.replace(/^(boardId|listId|order|updatedAt|activity): .*\n/gm, "");
    expect(preserved(after)).toBe(preserved(before.content));
    await openApp(page, { reset: false });
    await page.getByTestId("nav-overview").click();
    await expect(target.locator(".card-open")).toHaveText(["Top", "Move across", "Bottom"]);
  });

  test("reorders lists on one Overview board without changing another board", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1400 });
    await openApp(page);
    await openWorkspace(page);
    const first = await createBoard(page, "First");
    const second = await createBoard(page, "Second");
    await page.getByTestId("nav-overview").click();
    const a = page.getByTestId(`overview-board-${first.id}`);
    const b = page.getByTestId(`overview-board-${second.id}`);
    const from = (await a.getByTestId("list-drag-todo").boundingBox())!;
    const to = (await a.getByTestId("list-done").boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2);
    await page.mouse.move(to.x + to.width - 2, to.y + to.height / 2);
    await expect(a.locator(".list-drop-before, .list-drop-after")).toHaveCount(1);
    await expect(b.locator(".list-drop-before, .list-drop-after")).toHaveCount(0);
    await page.mouse.up();
    await expect(a.locator(".list-title")).toHaveText(["In Progress", "Done", "To Do"]);
    await expect(b.locator(".list-title")).toHaveText(["To Do", "In Progress", "Done"]);
    await page.getByTestId(`board-nav-${first.id}`).click();
    await expect(page.locator(".list-title")).toHaveText(["In Progress", "Done", "To Do"]);
  });

  test("keeps display controls in sync across Overview boards and the regular board view", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    const first = await createBoard(page, "First");
    await createCard(page, "First task");
    const second = await createBoard(page, "Second");
    await createCard(page, "Second task");
    await openApp(page, { reset: false });
    await page.getByTestId("nav-overview").click();
    const a = page.getByTestId(`overview-board-${first.id}`);
    const b = page.getByTestId(`overview-board-${second.id}`);
    const ids = await page.getByTestId("board-view-menu-toggle").evaluateAll(elements => elements.map(el => el.getAttribute("aria-controls")));
    expect(new Set(ids).size).toBe(2);
    await a.getByTestId("board-view-menu-toggle").click();
    await a.getByTestId("compact-steps-toggle").click();
    await a.getByTestId("compact-steps-toggle").press("Escape");
    await b.getByTestId("board-view-menu-toggle").click();
    await expect(b.getByTestId("compact-steps-toggle")).toHaveAttribute("aria-pressed", "true");
    await b.getByTestId("compact-steps-toggle").click();
    await b.getByTestId("compact-steps-toggle").press("Escape");
    await a.getByTestId("board-view-menu-toggle").click();
    await expect(a.getByTestId("compact-steps-toggle")).toHaveAttribute("aria-pressed", "false");
    await a.getByTestId("compact-board-toggle").click();
    await expect(page.getByTestId("overview-view").locator(".task-card.compact")).toHaveCount(2);
    await a.getByTestId("compact-board-toggle").click();
    await a.getByTestId("compact-completed-toggle").click();
    await b.locator(".task-card").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Mark complete", exact: true }).click();
    await expect(b.locator(".task-card")).toHaveClass(/compact.*completed/);
    await expect(a.locator(".task-card")).not.toHaveClass(/compact/);
    await page.getByTestId(`overview-board-toggle-${second.id}`).click();
    await page.getByTestId(`overview-board-toggle-${second.id}`).click();
    await expect(b.locator(".task-card")).toHaveClass(/compact.*completed/);
    await page.getByTestId(`board-nav-${second.id}`).click();
    await expect(page.locator(".task-card")).toHaveClass(/compact.*completed/);
  });
});
