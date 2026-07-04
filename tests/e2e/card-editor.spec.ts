import { test, expect } from "@playwright/test";
import { dropFiles, openApp, openWorkspace, queueAttachmentPick, setUpdaterMode, snapshot } from "./harness";

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

  test("reopening a card lands in read mode before edit mode", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("View Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Review launch plan");
    await page.getByTestId("text-dialog-submit").click();

    await expect(page.getByTestId("card-title-input")).toHaveValue("Review launch plan");
    await page.getByTestId("card-notes-input").fill("Read the plan before editing it.");
    await page.getByTestId("save-card").click();

    await page.getByTestId(/card-open-.*/).click();
    await expect(page.getByTestId("card-view")).toBeVisible();
    await expect(page.getByTestId("card-view-title")).toHaveText("Review launch plan");
    await expect(page.getByTestId("card-view-notes")).toContainText("Read the plan before editing it.");
    await expect(page.getByTestId("card-title-input")).toBeHidden();

    await page.getByTestId("edit-card").click();
    await expect(page.getByTestId("card-title-input")).toHaveValue("Review launch plan");
    await expect(page.getByTestId("card-notes-input")).toContainText("Read the plan before editing it.");
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
    const stepTitle = page.locator('[data-testid^="subtask-"][data-testid$="-title"]').last();
    await stepTitle.fill("Collect assets");
    const stepLink = page.locator('[data-testid^="subtask-"][data-testid$="-url"]').last();
    await expect(stepLink).toBeVisible();
    const [stepTitleBox, stepLinkBox] = await Promise.all([stepTitle.boundingBox(), stepLink.boundingBox()]);
    expect(stepTitleBox).not.toBeNull();
    expect(stepLinkBox).not.toBeNull();
    expect(Math.abs(stepTitleBox!.y + stepTitleBox!.height / 2 - (stepLinkBox!.y + stepLinkBox!.height / 2))).toBeLessThan(4);
    expect(stepLinkBox!.x).toBeGreaterThan(stepTitleBox!.x + stepTitleBox!.width);
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

    await queueAttachmentPick(page, [
      "/mock/uploads/screenshot.png",
      "/mock/uploads/design-spec.pdf",
      "/mock/uploads/final-cover.jpg"
    ]);
    await page.getByTestId("add-attachment").click();

    await expect(page.locator('[data-testid^="attachment-"][data-testid$="-open"]')).toContainText([
      "screenshot.png",
      "design-spec.pdf",
      "final-cover.jpg"
    ]);
    await expect(page.locator('[data-testid^="attachment-"][data-testid$="-thumbnail"]')).toHaveCount(2);

    await expect.poll(async () => (await snapshot(page)).attachments.length).toBe(3);
    const afterAdd = await snapshot(page);
    expect(afterAdd.attachments[0].path).toContain("/att_");
    expect(afterAdd.attachments.map((attachment) => attachment.path)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("-screenshot.png"),
        expect.stringContaining("-design-spec.pdf"),
        expect.stringContaining("-final-cover.jpg")
      ])
    );
    expect(afterAdd.attachments[0].size).toBeGreaterThan(0);
    expect(afterAdd.cards[0].content).toContain('"name":"screenshot.png"');
    expect(afterAdd.cards[0].content).toContain('"name":"design-spec.pdf"');
    expect(afterAdd.cards[0].content).toContain('"name":"final-cover.jpg"');
    expect(afterAdd.cards[0].content).toContain('"storedName"');
    expect(afterAdd.cards[0].content).toContain("Attached 3 files");

    // Opening a non-image attachment routes through the native open command
    // (recorded as an external link by the harness). Images open the lightbox
    // instead, exercised in its own test.
    await page.locator(".attachment-open", { hasText: "design-spec.pdf" }).click();
    await expect.poll(async () => (await snapshot(page)).externalLinks.some((link) => link.startsWith("attachment://"))).toBe(true);

    await page.getByRole("button", { name: "Close" }).click();
    const cardCover = page.getByTestId(/card-.*-image-cover/);
    await expect(cardCover).toBeVisible();
    await expect(cardCover).toHaveAttribute("alt", "final-cover.jpg");

    await page.locator(".task-card", { hasText: "Collect artifacts" }).click();
    await page.locator('[data-testid^="attachment-"][data-testid$="-remove"]').nth(2).click();
    await expect.poll(async () => page.getByTestId(/card-.*-image-cover/).getAttribute("alt")).toBe("screenshot.png");
  });

  test("files dropped onto the open card are attached", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Drop Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Drop target");
    await page.getByTestId("text-dialog-submit").click();

    await expect(page.getByTestId("add-attachment")).toBeVisible();
    await expect(page.getByText("No files yet")).toBeVisible();

    // Simulate the OS dropping files onto the window while the card is open.
    await dropFiles(page, ["/mock/uploads/diagram.png", "/mock/uploads/notes.txt"]);

    await expect(page.locator('[data-testid^="attachment-"][data-testid$="-open"]')).toContainText([
      "diagram.png",
      "notes.txt"
    ]);
    await expect.poll(async () => (await snapshot(page)).attachments.length).toBe(2);
    const dropped = await snapshot(page);
    expect(dropped.cards[0].content).toContain('"name":"diagram.png"');
    expect(dropped.cards[0].content).toContain('"name":"notes.txt"');
    expect(dropped.cards[0].content).toContain("Attached 2 files");
  });

  test("clicking an image attachment opens the lightbox viewer", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Gallery Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Gallery");
    await page.getByTestId("text-dialog-submit").click();

    await queueAttachmentPick(page, [
      "/mock/uploads/one.png",
      "/mock/uploads/spec.pdf",
      "/mock/uploads/two.jpg",
      "/mock/uploads/three.gif"
    ]);
    await page.getByTestId("add-attachment").click();
    await expect(page.locator('[data-testid^="attachment-"][data-testid$="-open"]')).toHaveCount(4);

    // Clicking an image opens the lightbox; the pdf between the images is skipped.
    await page.locator(".attachment-open", { hasText: "one.png" }).click();
    const lightbox = page.getByTestId("attachment-lightbox");
    await expect(lightbox).toBeVisible();
    await expect(page.getByTestId("attachment-lightbox-image")).toHaveAttribute("alt", "one.png");
    await expect(page.getByTestId("attachment-lightbox-caption")).toContainText("1 of 3");

    // Arrow keys flip through the image attachments only, wrapping at the ends.
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("attachment-lightbox-image")).toHaveAttribute("alt", "two.jpg");
    await expect(page.getByTestId("attachment-lightbox-caption")).toContainText("2 of 3");

    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("attachment-lightbox-image")).toHaveAttribute("alt", "three.gif");
    await expect(page.getByTestId("attachment-lightbox-caption")).toContainText("3 of 3");

    // The next button wraps back to the first image.
    await page.getByTestId("attachment-lightbox-next").click();
    await expect(page.getByTestId("attachment-lightbox-image")).toHaveAttribute("alt", "one.png");

    // The reveal button asks the OS to show the file in its file manager.
    await page.getByTestId("attachment-lightbox-reveal").click();
    await expect.poll(async () => (await snapshot(page)).externalLinks.some((link) => link.startsWith("reveal://"))).toBe(true);

    // Escape closes the lightbox but leaves the editor open.
    await page.keyboard.press("Escape");
    await expect(lightbox).toBeHidden();
    await expect(page.getByTestId("add-attachment")).toBeVisible();
  });

  test("files dropped onto a board card are attached to that card", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Board Drop");
    await page.getByTestId("text-dialog-submit").click();

    // Two cards, so we can confirm the drop lands on the one under the pointer.
    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("First card");
    await page.getByTestId("text-dialog-submit").click();
    await page.getByRole("button", { name: "Close" }).click();

    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Second card");
    await page.getByTestId("text-dialog-submit").click();
    await page.getByRole("button", { name: "Close" }).click();

    const secondCard = page.locator(".task-card", { hasText: "Second card" });
    await expect(secondCard).toBeVisible();

    // Drop onto the second card while the board (no editor) is showing.
    await dropFiles(page, ["/mock/uploads/diagram.png"], secondCard);

    // The image cover lands on the second card, and the first card stays bare.
    await expect(secondCard.getByTestId(/card-.*-image-cover/)).toBeVisible();
    await expect(page.locator(".task-card", { hasText: "First card" }).getByTestId(/card-.*-image-cover/)).toHaveCount(0);

    await expect.poll(async () => (await snapshot(page)).attachments.length).toBe(1);
    const snap = await snapshot(page);
    expect(snap.cards.find((file) => file.content.includes("Second card"))?.content).toContain('"name":"diagram.png"');
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
