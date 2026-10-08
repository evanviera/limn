import { test, expect, type Page } from "@playwright/test";
import { openApp, openWorkspace, setUpdaterMode, snapshot, queueAttachmentPick } from "./harness";

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

  test("board header uses focused View, More, and Add list actions", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Editorial Board");
    await page.getByTestId("text-dialog-submit").click();

    await expect(page.getByTestId("board-view-menu-toggle")).toContainText("View");
    await expect(page.getByTestId("board-more-menu")).toContainText("More");
    await expect(page.getByTestId("compact-board-toggle")).toHaveCount(0);
    await expect(page.getByTestId("add-list")).toContainText("Add list");

    await page.getByTestId("board-view-menu-toggle").click();
    await expect(page.getByRole("group", { name: "Card display" })).toBeVisible();
    await expect(page.getByTestId("compact-board-toggle")).toContainText("Compact cards");
    await expect(page.getByTestId("compact-completed-toggle")).toContainText("Compact completed");

    await page.getByTestId("board-more-menu").click();
    await expect(page.getByTestId("context-menu").getByRole("menuitem", { name: "Rename board" })).toBeVisible();
    await expect(page.getByTestId("context-menu").getByRole("menuitem", { name: "Delete board" })).toBeVisible();
  });

  test("a plain browser tab (no desktop shell) explains it needs the desktop app", async ({ page }) => {
    // Load the app without the E2E harness (and outside Tauri), so no backend can
    // service a folder pick. The welcome screen must say so rather than offer an
    // Open button that silently fails.
    await page.goto("/");
    await expect(page.getByTestId("welcome-desktop-required")).toBeVisible();
    await expect(page.getByTestId("welcome-open-workspace")).toHaveCount(0);
  });

  test("the add-card dialog blocks submission until a title is typed", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Validation Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("add-card-todo").click();
    const submit = page.getByTestId("text-dialog-submit");
    // Empty and whitespace-only titles keep the button disabled; a real title
    // enables it. No failed-submit "title is required" round-trip.
    await expect(submit).toBeDisabled();
    await page.getByTestId("text-dialog-input").fill("   ");
    await expect(submit).toBeDisabled();
    await page.getByTestId("text-dialog-input").fill("Draft the brief");
    await expect(submit).toBeEnabled();
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

  test("board categories can be collapsed and expanded", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Roadmap");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("create-board-category").click();
    await page.getByTestId("text-dialog-input").fill("Client Work");
    await page.getByTestId("text-dialog-submit").click();

    const initialState = await snapshot(page);
    const board = JSON.parse(initialState.boards[0].content) as { id: string };
    const group = (initialState.settings.boardGroups as Array<{ id: string; name: string }>)[0];
    const groupHeading = page.getByTestId(`board-group-${group.id}`);
    const toggle = page.getByTestId(`board-group-collapse-${group.id}`);

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("No boards in this category.")).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText("No boards in this category.")).toBeHidden();

    await toggle.click();
    await page.getByTestId(`board-nav-${board.id}`).click({ button: "right" });
    await page.getByTestId("context-menu").getByRole("menuitem", { name: "Move to Client Work" }).click();
    await expect(groupHeading).toContainText("1 board");
    await expect(page.getByTestId(`board-nav-${board.id}`)).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId(`board-nav-${board.id}`)).toBeHidden();

    await openApp(page, { reset: false });
    await expect(page.getByTestId(`board-group-collapse-${group.id}`)).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId(`board-nav-${board.id}`)).toBeHidden();
    await page.getByTestId(`board-group-collapse-${group.id}`).click();
    await expect(page.getByTestId(`board-nav-${board.id}`)).toBeVisible();
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

  test("a list context menu can sort manually ordered cards by due date", async ({ page }) => {
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

    const todoList = page.getByTestId("list-todo");
    const titles = () => todoList.locator(".task-card h3").allTextContents();
    expect(await titles()).toEqual(["Earlier", "Later"]);

    // Manually put the earlier card last so the due-date action has an explicit
    // order to replace.
    const earlier = todoList.locator(".task-card").first();
    const later = todoList.locator(".task-card").last();
    const earlierBox = await earlier.boundingBox();
    const laterBox = await later.boundingBox();
    if (!earlierBox || !laterBox) {
      throw new Error("card bounding boxes unavailable");
    }
    await page.mouse.move(earlierBox.x + earlierBox.width / 2, earlierBox.y + earlierBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(earlierBox.x + earlierBox.width / 2, earlierBox.y + earlierBox.height / 2 + 20);
    await page.mouse.move(laterBox.x + laterBox.width / 2, laterBox.y + laterBox.height - 2);
    await page.mouse.up();
    await expect.poll(titles).toEqual(["Later", "Earlier"]);

    await page.getByTestId("list-title-todo").click({ button: "right" });
    await page.getByTestId("context-menu").getByRole("menuitem", { name: "Sort cards by due date" }).click();

    await expect.poll(titles).toEqual(["Earlier", "Later"]);
    await expect.poll(async () => {
      const state = await snapshot(page);
      return state.cards.map((file) => Number(file.content.match(/^order:\s*(-?\d+(?:\.\d+)?)$/m)?.[1] ?? NaN));
    }).toEqual([0, 0]);
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

    // Selective mode reacts to completion state without shrinking active cards.
    await page.getByTestId("board-view-menu-toggle").click();
    await page.getByTestId("compact-completed-toggle").click();
    await expect(page.getByTestId("compact-completed-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(card).not.toHaveClass(/compact/);
    await card.getByTestId(/card-open-/).click();
    await page.getByTestId("card-view-complete").click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(card).toHaveClass(/compact/);
    await expect(card.locator(".label-row")).toHaveCount(0);

    await openApp(page, { reset: false });
    await expect(card).toHaveClass(/compact/);
    await page.getByTestId("board-view-menu-toggle").click();
    await expect(page.getByTestId("compact-completed-toggle")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("compact-completed-toggle").click();
    await expect(card).not.toHaveClass(/compact/);
    await expect(card.locator(".label-row")).toContainText("Planning");

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

    await openApp(page, { reset: false });
    await expect(card).toHaveClass(/compact/);
    await page.getByTestId("board-view-menu-toggle").click();
    await expect(page.getByTestId("compact-board-toggle")).toHaveAttribute("aria-pressed", "true");
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

  test("a list context menu can archive and permanently delete all of its cards", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Batch Board");
    await page.getByTestId("text-dialog-submit").click();

    async function createCard(title: string) {
      await page.getByTestId("add-card-todo").click();
      await page.getByTestId("text-dialog-input").fill(title);
      await page.getByTestId("text-dialog-submit").click();
      await expect(page.getByTestId("card-title-input")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("card-title-input")).toBeHidden();
    }

    await createCard("Alpha");
    await createCard("Beta");

    const todoList = page.getByTestId("list-todo");
    const todoTitle = page.getByTestId("list-title-todo");
    await todoTitle.click({ button: "right" });
    const menu = page.getByTestId("context-menu");
    await expect(menu.getByRole("menuitem", { name: "Archive all cards" })).toBeEnabled();
    await menu.getByRole("menuitem", { name: "Archive all cards" }).click();
    await expect(page.getByRole("dialog", { name: "Archive all cards" })).toContainText('Archive 2 cards in "To Do"?');
    await page.getByTestId("confirm-dialog-submit").click();

    await expect(todoList.locator(".task-card")).toHaveCount(0);
    await expect.poll(async () => {
      const state = await snapshot(page);
      return state.cards.filter((file) => /^archived:\s*true$/m.test(file.content)).length;
    }).toBe(2);

    // Delete-all still includes the hidden archived cards assigned to the list.
    await todoTitle.click({ button: "right" });
    await expect(menu.getByRole("menuitem", { name: "Archive all cards" })).toBeDisabled();
    await expect(menu.getByRole("menuitem", { name: "Delete all cards" })).toBeEnabled();
    await menu.getByRole("menuitem", { name: "Delete all cards" }).click();
    await expect(page.getByRole("dialog", { name: "Delete all cards" })).toContainText('Permanently delete 2 cards in "To Do"?');
    await page.getByTestId("confirm-dialog-submit").click();

    await expect.poll(async () => (await snapshot(page)).cards.length).toBe(0);
    await todoTitle.click({ button: "right" });
    await expect(menu.getByRole("menuitem", { name: "Delete all cards" })).toBeDisabled();
  });

  test("dragging a card over an empty list keeps the placeholder as a stable drop target", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Flow Board");
    await page.getByTestId("text-dialog-submit").click();

    // Seed a single card in To Do; In Progress stays empty.
    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Alpha");
    await page.getByTestId("text-dialog-submit").click();
    await expect(page.getByTestId("card-title-input")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("card-title-input")).toBeHidden();

    const emptyPlaceholder = page.getByTestId("list-in-progress").locator(".empty-list");
    await expect(emptyPlaceholder).toHaveCount(1);

    const alpha = page.getByTestId("list-todo").locator(".task-card").first();
    const alphaBox = await alpha.boundingBox();
    const targetBox = await page.getByTestId("list-in-progress").boundingBox();
    if (!alphaBox || !targetBox) {
      throw new Error("bounding boxes unavailable");
    }

    await page.mouse.move(alphaBox.x + alphaBox.width / 2, alphaBox.y + alphaBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(alphaBox.x + alphaBox.width / 2, alphaBox.y + alphaBox.height / 2 + 20);
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);

    // The placeholder must stay mounted (never swapped for the 2px indicator) so
    // the empty column keeps a constant height and the drop target does not
    // flicker under the pointer. It highlights instead of collapsing.
    await expect(emptyPlaceholder).toHaveCount(1);
    await expect(emptyPlaceholder).toHaveClass(/is-drop-target/);

    await page.mouse.up();

    await expect.poll(async () => page.getByTestId("list-in-progress").locator(".task-card h3").allTextContents()).toEqual(["Alpha"]);
    await expect(page.getByTestId("list-todo").locator(".task-card")).toHaveCount(0);
  });

  test("boards can be reordered by dragging in the sidebar", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    async function createBoard(name: string) {
      await page.getByTestId("create-board").click();
      await page.getByTestId("text-dialog-input").fill(name);
      await page.getByTestId("text-dialog-submit").click();
      await expect(page.locator(".board-nav-item", { hasText: name })).toBeVisible();
    }

    // No manual order yet, so boards read in creation order.
    await createBoard("Alpha");
    await createBoard("Beta");
    await createBoard("Gamma");

    const boardNames = () => page.locator(".board-nav-item").allTextContents();
    expect(await boardNames()).toEqual(["Alpha", "Beta", "Gamma"]);

    // Drag Alpha below Gamma.
    const alpha = page.locator(".board-nav-item", { hasText: "Alpha" });
    const gamma = page.locator(".board-nav-item", { hasText: "Gamma" });
    const alphaBox = await alpha.boundingBox();
    const gammaBox = await gamma.boundingBox();
    if (!alphaBox || !gammaBox) {
      throw new Error("board bounding boxes unavailable");
    }

    await page.mouse.move(alphaBox.x + alphaBox.width / 2, alphaBox.y + alphaBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(alphaBox.x + alphaBox.width / 2, alphaBox.y + alphaBox.height / 2 + 20);
    await page.mouse.move(gammaBox.x + gammaBox.width / 2, gammaBox.y + gammaBox.height - 2);
    await page.mouse.up();

    await expect.poll(async () => boardNames()).toEqual(["Beta", "Gamma", "Alpha"]);

    // The moved board carries an explicit order that survives a reload.
    await expect.poll(async () => {
      const state = await snapshot(page);
      const alphaBoard = state.boards
        .map((file) => JSON.parse(file.content) as { name: string; order: number })
        .find((board) => board.name === "Alpha");
      return alphaBoard?.order ?? 0;
    }).toBeGreaterThan(0);
  });

  test("dragging a board in the sidebar shows drop feedback", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    async function createBoard(name: string) {
      await page.getByTestId("create-board").click();
      await page.getByTestId("text-dialog-input").fill(name);
      await page.getByTestId("text-dialog-submit").click();
      await expect(page.locator(".board-nav-item", { hasText: name })).toBeVisible();
    }

    await createBoard("Alpha");
    await createBoard("Beta");

    const alpha = page.locator(".board-nav-item", { hasText: "Alpha" });
    const beta = page.locator(".board-nav-item", { hasText: "Beta" });
    const alphaBox = await alpha.boundingBox();
    const betaBox = await beta.boundingBox();
    if (!alphaBox || !betaBox) {
      throw new Error("board bounding boxes unavailable");
    }

    // Press Alpha and drag onto Beta. Mid-drag the UI should show the picked-up
    // board, exactly one insertion line, and the window-wide grabbing cursor.
    await page.mouse.move(alphaBox.x + alphaBox.width / 2, alphaBox.y + alphaBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(betaBox.x + betaBox.width / 2, betaBox.y + betaBox.height - 2);

    await expect(page.locator(".board-nav-item.dragging")).toHaveCount(1);
    await expect(page.locator(".board-nav-item.drop-before, .board-nav-item.drop-after")).toHaveCount(1);
    await expect(page.locator("body.is-board-dragging")).toHaveCount(1);

    await page.mouse.up();

    // All drag feedback clears once the pointer is released.
    await expect(page.locator(".board-nav-item.dragging")).toHaveCount(0);
    await expect(page.locator("body.is-board-dragging")).toHaveCount(0);
  });

  test("the boards sidebar can be resized and the width persists", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    const shell = page.locator(".app-shell");
    const resizer = page.getByTestId("sidebar-resizer");

    const sidebarWidth = () =>
      shell.evaluate((element) =>
        Number(getComputedStyle(element).getPropertyValue("--sidebar-width").replace("px", "").trim())
      );

    const initial = await sidebarWidth();
    const box = await resizer.boundingBox();
    if (!box) {
      throw new Error("resizer bounding box unavailable");
    }

    // Drag the divider 80px to the right to widen the sidebar.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2);
    await page.mouse.up();

    await expect.poll(sidebarWidth).toBeGreaterThan(initial + 60);
    const resized = await sidebarWidth();

    // The width is per-computer: it survives reopening without a reset.
    await openApp(page, { reset: false });
    await openWorkspace(page);
    await expect.poll(sidebarWidth).toBe(resized);
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


test.describe("moving cards between boards", () => {
  async function createBoard(page: Page, name: string) {
    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill(name);
    await page.getByTestId("text-dialog-submit").click();
    await expect(page.locator(".board-nav-item", { hasText: name })).toBeVisible();
    const state = await snapshot(page);
    return JSON.parse(state.boards.find((file) => JSON.parse(file.content).name === name)!.content);
  }

  async function createCard(page: Page, title: string, listId = "todo") {
    await page.getByTestId(`add-card-${listId}`).click();
    await page.getByTestId("text-dialog-input").fill(title);
    await page.getByTestId("text-dialog-submit").click();
    await expect(page.getByTestId("card-title-input")).toHaveValue(title);
  }

  async function editBoard(page: Page, board: { id: string; lists: Array<{ id: string; name: string }> }) {
    const file = (await snapshot(page)).boards.find((item) => JSON.parse(item.content).id === board.id)!;
    await page.evaluate(({ fileName, next }) => {
      document.dispatchEvent(new CustomEvent("limn-e2e-command", { detail: {
        type: "externalEditBoard", fileName, board: { ...next, updatedAt: "2026-12-01T00:00:00.000Z" }
      } }));
    }, { fileName: file.file_name, next: board });
  }

  function location(content: string) {
    return {
      boardId: JSON.parse(content.match(/^boardId: (.*)$/m)![1]),
      listId: JSON.parse(content.match(/^listId: (.*)$/m)![1])
    };
  }

  function preservedContent(content: string) {
    return content.replace(/^(boardId|listId|order|updatedAt|activity): .*\n/gm, "");
  }

  for (const pointer of ["mouse", "pen"] as const) {
    test(`${pointer} drag to a sidebar board preserves the card and appends it to the destination`, async ({ page }) => {
      await openApp(page);
      await openWorkspace(page);
      const source = await createBoard(page, "Source");
      await createCard(page, "Move this", "in-progress");
      await page.getByTestId("card-notes-input").fill("Keep the brief and https://example.com/reference");
      await page.getByTestId("card-due-input").fill("2027-01-15");
      await page.getByTestId("card-labels-input").fill("SOAH, casting");
      await page.getByTestId("add-subtask").click();
      await page.locator('[data-testid^="subtask-"][data-testid$="-title"]').last().fill("Keep this checklist");
      await queueAttachmentPick(page, ["/mock/brief.pdf"]);
      await page.getByTestId("add-attachment").click();
      await expect(page.locator(".attachment-name", { hasText: "brief.pdf" })).toBeVisible();
      await page.getByTestId("save-card").click();
      await expect(page.getByTestId("card-title-input")).toBeHidden();
      const before = (await snapshot(page)).cards[0];

      const target = await createBoard(page, "Destination");
      await createCard(page, "Already here");
      await page.getByTestId("save-card").click();
      // Give the destination different list ids. Mouse matches by name; pen
      // has no match and falls back to the first list, even with a shared id.
      const targetListId = "todo";
      await editBoard(page, { ...target, lists: [
        { id: targetListId, name: pointer === "mouse" ? " in PROGRESS " : "Incoming" },
        { id: "review", name: "Review" }
      ] });
      await expect(page.getByTestId(`list-${targetListId}`)).toBeVisible();
      await page.getByTestId(`board-nav-${source.id}`).click();
      const movedCard = page.getByTestId("list-in-progress").locator(".task-card");
      await expect(movedCard).toHaveCount(1);
      if (pointer === "pen") {
        await page.evaluate(() => Object.defineProperty(PointerEvent.prototype, "pointerType", { configurable: true, get: () => "pen" }));
      }
      const cardBox = (await movedCard.boundingBox())!;
      const sourceBox = (await page.getByTestId(`board-nav-${source.id}`).boundingBox())!;
      const targetBox = (await page.getByTestId(`board-nav-${target.id}`).boundingBox())!;
      await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 20);
      await page.mouse.down();
      await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
      await expect(page.locator(".card-drop-target")).toHaveCount(0);
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
      await expect(page.getByTestId(`board-nav-${target.id}`)).toHaveClass(/card-drop-target/);
      await expect.poll(async () => (await page.getByTestId("card-drag-preview").boundingBox())!.x).toBeGreaterThan(targetBox.x + targetBox.width);
      await expect(page.locator(".drop-indicator")).toHaveCount(0);
      await page.mouse.up();
      await expect(movedCard).toHaveCount(0);
      await expect(page.locator(".card-drop-target, body.is-card-dragging")).toHaveCount(0);
      await expect(page.getByTestId(`board-nav-${source.id}`)).toHaveClass(/active/);
      await expect(page.locator(".banner")).toContainText("moved to Destination");
      await expect.poll(async () => location((await snapshot(page)).cards.find((file) => file.file_name === before.file_name)!.content))
        .toEqual({ boardId: target.id, listId: targetListId });
      const after = await snapshot(page);
      expect(after.cards).toHaveLength(2);
      expect(preservedContent(after.cards.find((file) => file.file_name === before.file_name)!.content)).toBe(preservedContent(before.content));
      expect(after.cards.find((file) => file.file_name === before.file_name)!.content).toContain("Moved from Source / In Progress to Destination");
      expect(after.attachments).toHaveLength(1);

      await openApp(page, { reset: false });
      await page.getByTestId(`board-nav-${target.id}`).click();
      const titles = page.getByTestId(`list-${targetListId}`).locator(".task-card h3");
      await expect(titles).toHaveText(["Already here", "Move this"]);
    });
  }

  test("right-click move chooses the board and list, supports Escape, and survives reload", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    const source = await createBoard(page, "Source");
    await createCard(page, "Choose a location");
    await page.getByTestId("save-card").click();
    const target = await createBoard(page, "Destination");
    const third = await createBoard(page, "Another board");
    await page.getByTestId(`board-nav-${source.id}`).click();
    const card = page.locator(".task-card");
    async function openMove() {
      await card.click({ button: "right" });
      await page.getByTestId("context-menu").getByRole("menuitem", { name: "Move to board…", exact: true }).click();
      await expect(page.getByTestId("move-card-dialog")).toBeVisible();
    }
    await openMove();
    await expect(page.getByTestId("move-card-board")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("move-card-dialog")).toBeHidden();
    expect(location((await snapshot(page)).cards[0].content).boardId).toBe(source.id);
    await openMove();
    await page.getByTestId("move-card-board").selectOption(third.id);
    await page.getByTestId("move-card-list").selectOption("done");
    await page.getByTestId("move-card-board").selectOption(target.id);
    await expect(page.getByTestId("move-card-list")).toHaveValue("todo");
    await page.getByTestId("move-card-list").selectOption("in-progress");
    await page.getByTestId("move-card-submit").click();
    await expect(page.getByTestId("move-card-dialog")).toBeHidden();
    await expect(card).toHaveCount(0);
    expect(location((await snapshot(page)).cards[0].content)).toEqual({ boardId: target.id, listId: "in-progress" });
    await openApp(page, { reset: false });
    await page.getByTestId(`board-nav-${target.id}`).click();
    await expect(page.getByTestId("list-in-progress").locator(".task-card h3")).toHaveText("Choose a location");
  });

  test("a board losing its lists while the move dialog is open blocks submission", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    const source = await createBoard(page, "Source");
    await createCard(page, "Stay here");
    await page.getByTestId("save-card").click();
    const target = await createBoard(page, "Destination");
    await page.getByTestId(`board-nav-${source.id}`).click();
    await page.locator(".task-card").click({ button: "right" });
    await page.getByTestId("context-menu").getByRole("menuitem", { name: "Move to board…", exact: true }).click();
    await editBoard(page, { ...target, lists: [] });
    await expect(page.getByTestId("move-card-list")).toBeDisabled();
    await expect(page.getByTestId("move-card-submit")).toBeDisabled();
    await expect(page.getByTestId("move-card-dialog")).toContainText("Add a list to this board");
    await page.keyboard.press("Escape");
    expect(location((await snapshot(page)).cards[0].content).boardId).toBe(source.id);
    const targetNav = page.getByTestId(`board-nav-${target.id}`);
    await expect(targetNav).not.toHaveAttribute("data-card-drop-board-id");
    const cardBox = (await page.locator(".task-card").boundingBox())!;
    const targetBox = (await targetNav.boundingBox())!;
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 20);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
    await expect(page.locator(".card-drop-target")).toHaveCount(0);
    await page.mouse.up();
    expect(location((await snapshot(page)).cards[0].content).boardId).toBe(source.id);
    await expect(page.locator("body.is-card-dragging")).toHaveCount(0);
  });

  test("failed moves keep the card in place and retries merge remote comments and assignments", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    const source = await createBoard(page, "Source");
    await createCard(page, "Retry this move");
    await page.getByTestId("save-card").click();
    const before = (await snapshot(page)).cards[0];
    const target = await createBoard(page, "Destination");
    await page.getByTestId(`board-nav-${source.id}`).click();
    await page.locator(".task-card").click({ button: "right" });
    await page.getByTestId("context-menu").getByRole("menuitem", { name: "Move to board…", exact: true }).click();
    // Refuse one write as the real backend could do for an unavailable drive.
    await page.evaluate(() => {
      const ipc = (window as any).__LIMN_TEST_IPC__;
      const invoke = ipc.invoke.bind(ipc);
      let failOnce = true;
      ipc.invoke = async (command: string, args: unknown) => {
        if (command === "write_card_file" && failOnce) {
          failOnce = false;
          throw new Error("Drive unavailable");
        }
        return invoke(command, args);
      };
    });
    await page.getByTestId("move-card-submit").click();
    await expect(page.getByTestId("move-card-dialog")).toBeVisible();
    await expect(page.getByTestId("move-card-dialog").getByRole("alert")).toContainText("could not be completed");
    await expect(page.locator(".banner")).toContainText("Drive unavailable");
    expect((await snapshot(page)).cards[0]).toEqual(before);
    // A sync edit lands while the app still has the old version. The move must
    // go through the normal three-way save path rather than overwrite it.
    const remoteComment = { id: "remote-comment", authorId: "remote-member", authorName: "Jenny", body: "Keep this discussion", createdAt: "2026-12-01T00:00:00.000Z" };
    const remote = before.content
      .replace(/^assignees: .*$/m, 'assignees: ["remote-member"]')
      .replace(/^comments: .*$/m, `comments: ${JSON.stringify([remoteComment])}`)
      .replace(/^updatedAt: .*$/m, 'updatedAt: "2026-12-01T00:00:00.000Z"');
    await page.evaluate(({ fileName, content }) => (window as any).__LIMN_E2E__.externalEditCard(fileName, content, true),
      { fileName: before.file_name, content: remote });
    await page.getByTestId("move-card-submit").click();
    await expect(page.getByTestId("move-card-dialog")).toBeHidden();
    await expect(page.locator(".banner-error")).toHaveCount(0);
    await expect(page.locator(".task-card")).toHaveCount(0);
    const after = (await snapshot(page)).cards[0];
    expect(after.file_name).toBe(before.file_name);
    expect(location(after.content)).toEqual({ boardId: target.id, listId: "todo" });
    expect(after.content).toContain('assignees: ["remote-member"]');
    expect(after.content).toContain(JSON.stringify(remoteComment));
    expect((await snapshot(page)).conflicts).toHaveLength(0);
  });

});


test.describe("board names within categories", () => {
  async function createCategory(page: Page, name: string) {
    await page.getByTestId("create-board-category").click();
    await page.getByTestId("text-dialog-input").fill(name);
    await page.getByTestId("text-dialog-submit").click();
    await expect(page.getByTestId("text-dialog-input")).toBeHidden();
    return ((await snapshot(page)).settings.boardGroups as Array<{ id: string; name: string }>).find((group) => group.name === name)!;
  }

  async function createBoard(page: Page, name: string, groupId = "") {
    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill(name);
    await page.getByTestId("board-name-category").selectOption(groupId);
    await page.getByTestId("text-dialog-submit").click();
    await expect(page.getByTestId("board-name-dialog")).toBeHidden();
    return (await snapshot(page)).boards.map((file) => JSON.parse(file.content))
      .find((board) => board.name === name && (board.groupId ?? "") === groupId);
  }

  async function renameBoard(page: Page, id: string, name: string) {
    await page.getByTestId(`board-nav-${id}`).click({ button: "right" });
    await page.getByTestId("context-menu").getByRole("menuitem", { name: "Rename board" }).click();
    await page.getByTestId("text-dialog-input").fill(name);
    await page.getByTestId("text-dialog-submit").click();
  }

  test("creates same-named boards in different categories and Ungrouped with independent storage", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    const two = await createCategory(page, "Two Embers");
    const soah = await createCategory(page, "SOAH");
    const first = await createBoard(page, "Tasks", two.id);
    // Reject a case/space variant in the same category, then permit it as soon
    // as the user chooses another category in the very same creation dialog.
    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill(" TASKS ");
    await page.getByTestId("board-name-category").selectOption(two.id);
    await page.getByTestId("text-dialog-submit").click();
    await expect(page.getByTestId("board-name-dialog").getByRole("alert")).toContainText("already exists in this category");
    await page.getByTestId("board-name-category").selectOption(soah.id);
    await expect(page.getByTestId("board-name-dialog").getByRole("alert")).toHaveCount(0);
    await page.getByTestId("text-dialog-input").fill("Tasks");
    await page.getByTestId("text-dialog-submit").click();
    await expect(page.getByTestId("board-name-dialog")).toBeHidden();
    const second = (await snapshot(page)).boards.map((file) => JSON.parse(file.content)).find((board) => board.groupId === soah.id);
    const third = await createBoard(page, "Tasks");
    const saved = await snapshot(page);
    expect(saved.boards).toHaveLength(3);
    expect(new Set(saved.boards.map((file) => file.file_name)).size).toBe(3);
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
    // Cards on identically named boards are still kept separate by board id.
    await page.getByTestId(`board-nav-${first.id}`).click();
    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Two Embers task");
    await page.getByTestId("text-dialog-submit").click();
    await page.getByTestId("save-card").click();
    await page.getByTestId(`board-nav-${second.id}`).click();
    await expect(page.locator(".task-card")).toHaveCount(0);
    await openApp(page, { reset: false });
    await page.getByTestId(`board-nav-${first.id}`).click();
    await expect(page.locator(".task-card h3")).toHaveText("Two Embers task");
    await page.locator(".task-card").click({ button: "right" });
    await page.getByTestId("context-menu").getByRole("menuitem", { name: "Move to board…", exact: true }).click();
    await expect(page.getByTestId("move-card-board").locator("option")).toHaveText(["SOAH / Tasks", "Ungrouped / Tasks"]);
    await page.keyboard.press("Escape");
    await page.getByTestId("nav-filter").click();
    await expect(page.getByTestId("filter-board").locator("option")).toHaveText(["All boards", "Two Embers / Tasks", "SOAH / Tasks", "Ungrouped / Tasks"]);
    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("tasks");
    await page.getByTestId("text-dialog-submit").click();
    await expect(page.getByTestId("board-name-dialog").getByRole("alert")).toContainText("already exists in this category");
    expect((await snapshot(page)).boards).toHaveLength(3);
  });

  test("renames within a category while allowing names already used in other categories", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    const two = await createCategory(page, "Two Embers");
    const soah = await createCategory(page, "SOAH");
    await createBoard(page, "Evan", two.id);
    const renamed = await createBoard(page, "Evan - SOAH", soah.id);
    const other = await createBoard(page, "Other", soah.id);
    await renameBoard(page, renamed.id, "Evan");
    await expect(page.getByTestId("board-name-dialog")).toBeHidden();
    await expect(page.getByTestId(`board-nav-${renamed.id}`)).toHaveText("Evan");
    await renameBoard(page, other.id, " evan ");
    await expect(page.getByTestId("board-name-dialog").getByRole("alert")).toContainText("already exists in this category");
    await page.keyboard.press("Escape");
    await renameBoard(page, renamed.id, "EVAN");
    await expect(page.getByTestId("board-name-dialog")).toBeHidden();
    const boards = (await snapshot(page)).boards.map((file) => JSON.parse(file.content));
    expect(boards.find((board) => board.id === other.id).name).toBe("Other");
    expect(boards.find((board) => board.id === renamed.id)).toMatchObject({ name: "EVAN", groupId: soah.id });
  });

  test("category moves and deletion preserve category-local name uniqueness", async ({ page }) => {
    // Keep the board/group targets visible for precise pointer-based checks.
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openApp(page);
    await openWorkspace(page);
    const two = await createCategory(page, "Two Embers");
    const soah = await createCategory(page, "SOAH");
    const empty = await createCategory(page, "Empty");
    const first = await createBoard(page, "Tasks", two.id);
    const second = await createBoard(page, "Tasks", soah.id);
    await createBoard(page, "Tasks");
    await page.getByTestId(`board-nav-${second.id}`).click({ button: "right" });
    await page.getByTestId("context-menu").getByRole("menuitem", { name: "Move to Two Embers" }).click();
    await expect(page.locator(".banner-error")).toContainText("already exists in Two Embers");
    const from = (await page.getByTestId(`board-nav-${second.id}`).boundingBox())!;
    const to = (await page.getByTestId(`board-nav-${first.id}`).boundingBox())!;
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 10 });
    await page.mouse.up();
    expect((await snapshot(page)).boards.map((file) => JSON.parse(file.content)).find((board) => board.id === second.id).groupId).toBe(soah.id);
    await page.getByTestId(`board-group-${soah.id}`).click({ button: "right" });
    await page.getByTestId("context-menu").getByRole("menuitem", { name: "Delete category" }).click();
    await expect(page.locator(".banner-error")).toContainText("already exists in Ungrouped");
    await expect(page.getByTestId("confirm-dialog-submit")).toHaveCount(0);
    await page.getByTestId(`board-nav-${second.id}`).click({ button: "right" });
    await page.getByTestId("context-menu").getByRole("menuitem", { name: "Move to Empty" }).click();
    await expect.poll(async () => (await snapshot(page)).boards.map((file) => JSON.parse(file.content)).find((board) => board.id === second.id).groupId).toBe(empty.id);
    await expect(page.locator(".banner-error")).toHaveCount(0);
  });

  test("creation rechecks names after a remote board arrives while the dialog is open", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    const group = await createCategory(page, "SOAH");
    const existing = await createBoard(page, "Existing", group.id);
    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Tasks");
    await page.getByTestId("board-name-category").selectOption(group.id);
    await page.evaluate((board) => {
      document.dispatchEvent(new CustomEvent("limn-e2e-command", { detail: {
        type: "externalEditBoard", fileName: "remote-board.json", board: { ...board, id: "remote-board", name: "Tasks" }
      } }));
    }, existing);
    await expect(page.getByTestId("board-nav-remote-board")).toBeVisible();
    await page.getByTestId("text-dialog-submit").click();
    await expect(page.getByTestId("board-name-dialog").getByRole("alert")).toContainText("already exists in this category");
    expect((await snapshot(page)).boards).toHaveLength(2);
  });

  test("long category menus remain open while scrolling to another destination", async ({ page }) => {
    // Isolate scrolling inside the menu from sidebar scroll-to-focus events.
    await page.setViewportSize({ width: 1280, height: 1600 });
    await openApp(page);
    await openWorkspace(page);
    for (let index = 1; index <= 10; index += 1) await createCategory(page, `Category ${index}`);
    const board = await createBoard(page, "Tasks");
    await page.getByTestId(`board-nav-${board.id}`).click({ button: "right" });
    const menu = page.getByTestId("context-menu");
    await expect(menu).toBeVisible();
    await menu.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "Move to Category 10", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).boards.map((file) => JSON.parse(file.content))[0].groupId).toBeTruthy();
  });

});
