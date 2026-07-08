import { test, expect } from "@playwright/test";
import { openApp, openWorkspace, setUpdaterMode, snapshot } from "./harness";

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

  test("theme toggle switches to light mode and persists", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByTestId("theme-toggle")).toContainText("Dark mode");

    await openApp(page, { reset: false });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await openWorkspace(page);
    await expect(page.getByTestId("theme-toggle")).toBeVisible();
    await expect(page.getByTestId("theme-toggle")).toContainText("Dark mode");
  });

  test("list width preferences apply to the board and persist per computer", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    const html = page.locator("html");
    // Fixed width at the 320px default is the out-of-the-box behavior.
    await expect(html).toHaveAttribute("data-list-width-mode", "fixed");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--list-width")))
      .toBe("320px");

    await page.getByTestId("nav-settings").click();

    // Change the fixed width; it applies immediately.
    await page.getByTestId("list-width-input").fill("420");
    await page.getByTestId("list-width-input").blur();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--list-width")))
      .toBe("420px");

    // Out-of-range values are clamped to the supported bounds.
    await page.getByTestId("list-width-input").fill("9999");
    await page.getByTestId("list-width-input").blur();
    await expect(page.getByTestId("list-width-input")).toHaveValue("640");

    // Toggling flexible mode flips the layout attribute.
    await page.getByTestId("list-width-flexible-toggle").check();
    await expect(html).toHaveAttribute("data-list-width-mode", "flexible");

    // Both settings are per-computer, so they survive a reload without a workspace.
    await openApp(page, { reset: false });
    await expect(html).toHaveAttribute("data-list-width-mode", "flexible");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--list-width")))
      .toBe("640px");
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

  test("boards can be organized into categories", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Roadmap");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("create-board-category").click();
    await page.getByTestId("text-dialog-input").fill("Client Work");
    await page.getByTestId("text-dialog-submit").click();

    const stateWithGroup = await snapshot(page);
    const boardFile = stateWithGroup.boards[0];
    const board = JSON.parse(boardFile.content) as { id: string; groupId?: string };
    const group = (stateWithGroup.settings.boardGroups as Array<{ id: string; name: string }>)[0];
    expect(group.name).toBe("Client Work");

    await expect(page.getByTestId(`board-group-${group.id}`)).toContainText("Client Work");
    await expect(page.getByTestId(`board-group-${group.id}`)).toContainText("0 boards");
    await page.getByTestId(`board-nav-${board.id}`).click({ button: "right" });
    await page.getByTestId("context-menu").getByRole("menuitem", { name: "Move to Client Work" }).click();

    await expect(page.getByTestId(`board-group-${group.id}`)).toContainText("1 board");
    await expect.poll(async () => {
      const latest = await snapshot(page);
      return JSON.parse(latest.boards[0].content).groupId;
    }).toBe(group.id);
  });

  test("external workspace change bursts reload once and show the latest board", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Sync Board");
    await page.getByTestId("text-dialog-submit").click();
    await expect.poll(async () => (await snapshot(page)).boards.length).toBe(1);
    await page.waitForTimeout(200);

    const beforeBurst = await snapshot(page);
    const boardFile = beforeBurst.boards[0];
    const board = JSON.parse(boardFile.content) as Record<string, unknown>;
    const boardId = String(board.id);
    const loadCountBeforeBurst = beforeBurst.loadWorkspaceCount;

    await page.evaluate(({ fileName, baseBoard }) => {
      const api = (window as {
        __LIMN_E2E__?: {
          externalEditBoard(fileName: string, board: Record<string, unknown>): void;
        };
      }).__LIMN_E2E__;
      if (!api) {
        throw new Error("Limn E2E harness not loaded");
      }

      api.externalEditBoard(fileName, { ...baseBoard, name: "Remote Sync 1", updatedAt: "2026-06-27T13:00:00.001Z" });
      api.externalEditBoard(fileName, { ...baseBoard, name: "Remote Sync 2", updatedAt: "2026-06-27T13:00:00.002Z" });
      api.externalEditBoard(fileName, { ...baseBoard, name: "Remote Sync 3", updatedAt: "2026-06-27T13:00:00.003Z" });
    }, { fileName: boardFile.file_name, baseBoard: board });

    await expect(page.getByTestId(`board-nav-${boardId}`)).toHaveText("Remote Sync 3");
    await page.waitForTimeout(200);
    expect((await snapshot(page)).loadWorkspaceCount).toBe(loadCountBeforeBurst + 1);
  });

  test("cards in a list sort by due date", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Due Board");
    await page.getByTestId("text-dialog-submit").click();

    async function createDatedCard(title: string, due: string) {
      await page.getByTestId("add-card-todo").click();
      await page.getByTestId("text-dialog-input").fill(title);
      await page.getByTestId("text-dialog-submit").click();
      await expect(page.getByTestId("card-title-input")).toBeVisible();
      await page.getByTestId("card-due-input").fill(due);
      await page.getByTestId("save-card").click();
      await expect(page.getByTestId("card-title-input")).toBeHidden();
    }

    await createDatedCard("Later", "2026-06-16");
    await createDatedCard("Earlier", "2026-06-14");

    const titles = await page.getByTestId("list-todo").locator(".task-card h3").allTextContents();
    expect(titles).toEqual(["Earlier", "Later"]);
  });

  test("compact board mode shows only card titles and footer metadata", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Compact Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Compact candidate");
    await page.getByTestId("text-dialog-submit").click();
    await expect(page.getByTestId("card-title-input")).toBeVisible();
    await page.getByTestId("card-due-input").fill("2026-07-15");
    await page.getByTestId("card-labels-input").fill("Planning");
    await page.keyboard.press("Enter");
    await page.getByTestId("add-subtask").click();
    await page.locator('[data-testid^="subtask-"][data-testid$="-title"]').last().fill("Checklist");
    await page.getByTestId("card-notes-input").fill("This note should collapse in compact mode.");
    await page.getByTestId("save-card").click();
    await expect(page.getByTestId("card-title-input")).toBeHidden();

    const card = page.getByTestId("list-todo").locator(".task-card").first();
    await expect(card.locator("h3")).toContainText("Compact candidate");
    await expect(card.locator(".label-row")).toContainText("Planning");
    await expect(card.locator(".card-subtasks")).toContainText("Checklist");
    await expect(card.locator(".card-notes-preview")).toContainText("This note should collapse");

    await page.getByTestId("compact-board-toggle").click();
    await expect(page.getByTestId("compact-board-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(card).toHaveClass(/compact/);
    await expect(card.locator("h3")).toContainText("Compact candidate");
    await expect(card.locator("footer")).toContainText("0/1");
    // Empty meta is suppressed: an unassigned card shows no "Unassigned" filler.
    await expect(card.locator("footer")).not.toContainText("Unassigned");
    await expect(card.locator(".due-badge")).toBeVisible();
    await expect(card.locator(".label-row")).toHaveCount(0);
    await expect(card.locator(".card-subtasks")).toHaveCount(0);
    await expect(card.locator(".card-notes-preview")).toHaveCount(0);
  });

  test("cards can be reordered within a list by dragging", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Priority Board");
    await page.getByTestId("text-dialog-submit").click();

    async function createCard(title: string) {
      await page.getByTestId("add-card-todo").click();
      await page.getByTestId("text-dialog-input").fill(title);
      await page.getByTestId("text-dialog-submit").click();
      await expect(page.getByTestId("card-title-input")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("card-title-input")).toBeHidden();
    }

    // No due dates → order defaults to 0, so cards read in creation order.
    await createCard("Alpha");
    await createCard("Beta");
    await createCard("Gamma");

    const listTitles = () => page.getByTestId("list-todo").locator(".task-card h3").allTextContents();
    expect(await listTitles()).toEqual(["Alpha", "Beta", "Gamma"]);

    // Drag Alpha to the bottom of the list.
    const alpha = page.getByTestId("list-todo").locator(".task-card").first();
    const gamma = page.getByTestId("list-todo").locator(".task-card").last();
    const alphaBox = await alpha.boundingBox();
    const gammaBox = await gamma.boundingBox();
    if (!alphaBox || !gammaBox) {
      throw new Error("card bounding boxes unavailable");
    }

    await page.mouse.move(alphaBox.x + alphaBox.width / 2, alphaBox.y + alphaBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(alphaBox.x + alphaBox.width / 2, alphaBox.y + alphaBox.height / 2 + 20);
    await page.mouse.move(gammaBox.x + gammaBox.width / 2, gammaBox.y + gammaBox.height - 4);
    await page.mouse.move(gammaBox.x + gammaBox.width / 2, gammaBox.y + gammaBox.height - 2);
    await page.mouse.up();

    await expect.poll(async () => listTitles()).toEqual(["Beta", "Gamma", "Alpha"]);

    // The moved card now carries an explicit order that survives a reload.
    await expect.poll(async () => {
      const state = await snapshot(page);
      const alphaCard = state.cards
        .map((file) => file.content)
        .find((content) => /title:\s*"?Alpha"?/.test(content));
      const match = alphaCard?.match(/^order:\s*(\d+)/m);
      return match ? Number(match[1]) : 0;
    }).toBeGreaterThan(0);
  });

  test("lists can be reordered by dragging", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Workflow Board");
    await page.getByTestId("text-dialog-submit").click();

    const listTitles = () => page.locator(".column-header h2").allTextContents();
    expect(await listTitles()).toEqual(["To Do", "In Progress", "Done"]);

    const todoHandle = page.getByTestId("list-drag-todo");
    const doneList = page.getByTestId("list-done");
    const handleBox = await todoHandle.boundingBox();
    const doneBox = await doneList.boundingBox();
    if (!handleBox || !doneBox) {
      throw new Error("list bounding boxes unavailable");
    }

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2 + 20, handleBox.y + handleBox.height / 2);
    await page.mouse.move(doneBox.x + doneBox.width - 4, doneBox.y + doneBox.height / 2);
    await page.mouse.up();

    await expect.poll(async () => listTitles()).toEqual(["In Progress", "Done", "To Do"]);
    await expect.poll(async () => {
      const state = await snapshot(page);
      const board = JSON.parse(state.boards[0].content) as { lists: Array<{ id: string }> };
      return board.lists.map((list) => list.id);
    }).toEqual(["in-progress", "done", "todo"]);
  });

  test("list drag shows exactly one insertion line, including at the first position", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Workflow Board");
    await page.getByTestId("text-dialog-submit").click();

    const indicators = page.locator(".column.list-drop-before, .column.list-drop-after");

    const doneHandle = page.getByTestId("list-drag-done");
    const todoList = page.getByTestId("list-todo");
    const handleBox = await doneHandle.boundingBox();
    const todoBox = await todoList.boundingBox();
    if (!handleBox || !todoBox) {
      throw new Error("list bounding boxes unavailable");
    }

    // Drag the last list toward the very first position.
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2 - 20, handleBox.y + handleBox.height / 2);
    await page.mouse.move(todoBox.x + 4, todoBox.y + todoBox.height / 2);

    // Never two lines at once, and the leading position must show one.
    await expect.poll(async () => indicators.count()).toBe(1);
    await expect(page.locator(".column:first-child.list-drop-before")).toHaveCount(1);

    await page.mouse.up();
    await expect.poll(async () => {
      const state = await snapshot(page);
      const board = JSON.parse(state.boards[0].content) as { lists: Array<{ id: string }> };
      return board.lists.map((list) => list.id);
    }).toEqual(["done", "todo", "in-progress"]);
  });

  test("a list can be dragged by its title, not just the handle", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Workflow Board");
    await page.getByTestId("text-dialog-submit").click();

    const titleHandle = page.getByTestId("list-title-todo");
    const doneList = page.getByTestId("list-done");
    const titleBox = await titleHandle.boundingBox();
    const doneBox = await doneList.boundingBox();
    if (!titleBox || !doneBox) {
      throw new Error("list bounding boxes unavailable");
    }

    await page.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(titleBox.x + titleBox.width / 2 + 20, titleBox.y + titleBox.height / 2);
    await page.mouse.move(doneBox.x + doneBox.width - 4, doneBox.y + doneBox.height / 2);
    await page.mouse.up();

    await expect.poll(async () => {
      const state = await snapshot(page);
      const board = JSON.parse(state.boards[0].content) as { lists: Array<{ id: string }> };
      return board.lists.map((list) => list.id);
    }).toEqual(["in-progress", "done", "todo"]);
  });

  test("a list can be collapsed to a rail and expanded again", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Workflow Board");
    await page.getByTestId("text-dialog-submit").click();

    const todoList = page.getByTestId("list-todo");
    await expect(todoList).not.toHaveClass(/collapsed/);

    // Collapse: the header cards/add-card disappear and a vertical rail remains.
    await page.getByTestId("collapse-list-todo").click();
    await expect(todoList).toHaveClass(/collapsed/);
    await expect(todoList.locator(".collapsed-list-title")).toHaveText("To Do");
    await expect(page.getByTestId("add-card-todo")).toHaveCount(0);

    // The collapsed state persists to the board file.
    await expect.poll(async () => {
      const state = await snapshot(page);
      const board = JSON.parse(state.boards[0].content) as { lists: Array<{ id: string; collapsed?: boolean }> };
      return board.lists.find((list) => list.id === "todo")?.collapsed;
    }).toBe(true);

    // Expand from the rail restores the full column.
    await page.getByTestId("collapse-list-todo").click();
    await expect(todoList).not.toHaveClass(/collapsed/);
    await expect(page.getByTestId("add-card-todo")).toHaveCount(1);
  });
});
