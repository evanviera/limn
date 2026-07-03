import { test, expect } from "@playwright/test";
import { openApp, openWorkspace, queueAttachmentPick, setUpdaterMode, snapshot } from "./harness";

test.describe("smoke", () => {
  test("card editor divider resizes the detail rail", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Resize Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Resizable card");
    await page.getByTestId("text-dialog-submit").click();

    const splitter = page.getByTestId("card-editor-splitter");
    const side = page.getByTestId("card-editor-side");
    await expect(splitter).toBeVisible();
    // Let the workspace watch-refresh that follows creating the card settle before
    // the precise splitter drag, so the drag can't land mid-reconcile.
    await page.waitForTimeout(250);

    const beforeBox = await side.boundingBox();
    const splitterBox = await splitter.boundingBox();
    expect(beforeBox).not.toBeNull();
    expect(splitterBox).not.toBeNull();

    await page.mouse.move(splitterBox!.x + splitterBox!.width / 2, splitterBox!.y + 40);
    await page.mouse.down();
    await page.mouse.move(splitterBox!.x - 120, splitterBox!.y + 40);
    await page.mouse.up();

    await expect.poll(async () => (await side.boundingBox())?.width ?? 0).toBeGreaterThan((beforeBox?.width ?? 0) + 60);

    const widenedBox = await side.boundingBox();
    await splitter.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await side.boundingBox())?.width ?? 0).toBeLessThan(widenedBox!.width);
  });

  test("subtasks support unordered list items with optional links", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Checklist Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Gather launch materials");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("add-subtask").click();
    await page.locator('[data-testid^="subtask-"][data-testid$="-title"]').last().fill("Collect assets");
    await page.locator('[data-testid^="subtask-"][data-testid$="-add-item"]').last().click();
    await page.locator('[data-testid^="subtask-item-"][data-testid$="-text"]').last().fill("Logo files");
    await page.locator('[data-testid^="subtask-"][data-testid$="-add-item"]').last().click();
    await page.locator('[data-testid^="subtask-item-"][data-testid$="-text"]').last().fill("Brand guide");
    await page.locator('[data-testid^="subtask-item-"][data-testid$="-url"]').last().fill("https://example.com/brand");
    await page.getByTestId("save-card").click();

    await expect(page.getByText("Logo files")).toBeVisible();
    const itemLink = page.getByTestId(/card-subtask-item-.*-link/);
    await expect(itemLink).toHaveText("Brand guide");
    await expect(itemLink).toHaveAttribute("href", "https://example.com/brand");

    const saved = await snapshot(page);
    expect(saved.cards[0].content).toContain('"items"');
    expect(saved.cards[0].content).toContain('"text":"Logo files"');
    expect(saved.cards[0].content).toContain('"url":"https://example.com/brand"');
  });

  test("attachments can be added to and removed from a card", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Attachment Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Collect artifacts");
    await page.getByTestId("text-dialog-submit").click();

    await expect(page.getByTestId("add-attachment")).toBeVisible();
    await expect(page.getByText("No files yet")).toBeVisible();

    await queueAttachmentPick(page, ["/mock/uploads/screenshot.png"]);
    await page.getByTestId("add-attachment").click();

    const attachmentOpen = page.locator('[data-testid^="attachment-"][data-testid$="-open"]');
    await expect(attachmentOpen).toContainText("screenshot.png");

    await expect.poll(async () => (await snapshot(page)).attachments.length).toBe(1);
    const afterAdd = await snapshot(page);
    expect(afterAdd.attachments[0].path).toContain("/att_");
    expect(afterAdd.attachments[0].path).toContain("-screenshot.png");
    expect(afterAdd.attachments[0].size).toBeGreaterThan(0);
    expect(afterAdd.cards[0].content).toContain('"name":"screenshot.png"');
    expect(afterAdd.cards[0].content).toContain('"storedName"');
    expect(afterAdd.cards[0].content).toContain("Attached screenshot.png");

    // Opening an attachment routes through the native open command (recorded as an
    // external link by the harness).
    await attachmentOpen.click();
    await expect.poll(async () => (await snapshot(page)).externalLinks.some((link) => link.startsWith("attachment://"))).toBe(true);

    await page.locator('[data-testid^="attachment-"][data-testid$="-remove"]').click();
    await expect(page.getByText("No files yet")).toBeVisible();
    await expect.poll(async () => (await snapshot(page)).attachments.length).toBe(0);
    expect((await snapshot(page)).cards[0].content).toContain("attachments: []");
  });

  test("right-click context menus expose board, editor, and card actions", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Context Board");
    await page.getByTestId("text-dialog-submit").click();

    const contextMenu = page.getByTestId("context-menu");
    await page.getByTestId(/board-nav-.*/).click({ button: "right" });
    await expect(contextMenu).toBeVisible();
    await expect(contextMenu.getByRole("menuitem", { name: "Rename board" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByTestId("list-todo").click({ button: "right" });
    await expect(contextMenu).toBeVisible();
    await contextMenu.getByRole("menuitem", { name: "Add card" }).click();
    await page.getByTestId("text-dialog-input").fill("Context card");
    await page.getByTestId("text-dialog-submit").click();

    await expect(page.getByTestId("card-title-input")).toBeVisible();
    await page.getByTestId("card-labels-input").fill("urgent");
    await page.keyboard.press("Enter");
    await expect(page.locator(".label-chip", { hasText: "urgent" })).toBeVisible();

    const notesInputBox = await page.getByTestId("card-notes-input").boundingBox();
    expect(notesInputBox).not.toBeNull();
    await page.getByTestId("card-notes-input").dispatchEvent("contextmenu", {
      bubbles: true,
      button: 2,
      cancelable: true,
      clientX: notesInputBox!.x + 12,
      clientY: notesInputBox!.y + 12
    });
    await expect(contextMenu).toBeVisible();
    await contextMenu.getByRole("menuitem", { name: "Bold" }).click();
    await expect(page.getByTestId("card-notes-input").locator("strong")).toHaveText("bold text");

    const urgentLabel = page.locator(".label-chip", { hasText: "urgent" });
    const urgentLabelBox = await urgentLabel.boundingBox();
    expect(urgentLabelBox).not.toBeNull();
    await urgentLabel.dispatchEvent("contextmenu", {
      bubbles: true,
      button: 2,
      cancelable: true,
      clientX: urgentLabelBox!.x + 12,
      clientY: urgentLabelBox!.y + 12
    });
    await expect(contextMenu).toBeVisible();
    await contextMenu.getByRole("menuitem", { name: "Remove label" }).click();
    await expect(page.locator(".label-chip", { hasText: "urgent" })).toBeHidden();

    await page.getByTestId("save-card").click();
    await expect(page.getByTestId("card-title-input")).toBeHidden();

    const card = page.locator(".task-card", { hasText: "Context card" }).first();
    await card.click({ button: "right" });
    await expect(contextMenu).toBeVisible();
    await contextMenu.getByRole("menuitem", { name: "Mark complete" }).click();

    await expect(page.locator(".task-card.completed", { hasText: "Context card" })).toBeVisible();
    expect((await snapshot(page)).cards[0].content).toContain("completed: true");
  });
});
