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

  test("card notes render on list cards with clickable links", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Notes Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Publish update");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("add-subtask").click();
    await page.locator('[data-testid^="subtask-"][data-testid$="-title"]').last().fill("Approval checklist");

    const notesInput = page.getByTestId("card-notes-input");
    await notesInput.fill("Review launch status at www.example.org/status.");

    async function selectNotesText(text: string) {
      await page.waitForTimeout(50);
      await notesInput.focus();
      await notesInput.evaluate((element, selectedText) => {
        const root = element as HTMLElement;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        let offset = 0;
        let startNode: Text | null = null;
        let endNode: Text | null = null;
        let startOffset = 0;
        let endOffset = 0;
        while (node) {
          const textNode = node as Text;
          const text = textNode.nodeValue ?? "";
          const start = (root.textContent ?? "").indexOf(selectedText);
          const end = start + selectedText.length;
          if (!startNode && start >= offset && start <= offset + text.length) {
            startNode = textNode;
            startOffset = start - offset;
          }
          if (!endNode && end >= offset && end <= offset + text.length) {
            endNode = textNode;
            endOffset = end - offset;
          }
          offset += text.length;
          node = walker.nextNode();
        }
        if (!startNode || !endNode) {
          throw new Error(`Unable to select ${selectedText}`);
        }
        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }, text);
    }

    await selectNotesText("Review");
    await page.getByTestId("notes-italic").click();
    await expect(notesInput.locator("em")).toHaveText("Review");

    await selectNotesText("launch");
    await page.getByTestId("notes-bold").click();
    await expect(notesInput.locator("strong")).toHaveText("launch");

    await selectNotesText("status");
    await page.getByTestId("notes-link").click();
    await expect(page.getByTestId("notes-link-form")).toBeVisible();
    await page.getByTestId("notes-link-url").fill("example.com/spec");
    await page.getByTestId("notes-link-apply").click();

    const editorLink = notesInput.getByRole("link", { name: "status", exact: true });
    await expect(editorLink).toHaveAttribute("href", "https://example.com/spec");
    await expect(notesInput).not.toContainText("[status](https://example.com/spec)");
    await page.getByTestId("save-card").click();

    const notes = page.getByTestId(/card-notes-.*/);
    await expect(notes).toContainText("Review launch status at www.example.org/status.");
    await expect(notes.locator("em")).toHaveText("Review");
    await expect(notes.locator("strong")).toHaveText("launch");
    await expect(page.getByText("Approval checklist")).toBeVisible();
    const notesBelowSubtasks = await notes.evaluate((element) => {
      const subtaskList = element.parentElement?.querySelector(".card-subtasks");
      return Boolean(subtaskList && (subtaskList.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    expect(notesBelowSubtasks).toBe(true);

    const markdownLink = page.getByTestId(/card-note-link-.*-0/);
    await expect(markdownLink).toHaveText("status");
    await expect(markdownLink).toHaveAttribute("href", "https://example.com/spec");

    const bareLink = page.getByTestId(/card-note-link-.*-1/);
    await expect(bareLink).toHaveText("www.example.org/status");
    await expect(bareLink).toHaveAttribute("href", "https://www.example.org/status");

    await bareLink.click();
    await expect(page.getByTestId("card-title-input")).toBeHidden();
    expect((await snapshot(page)).externalLinks).toContain("https://www.example.org/status");
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

  test("manually written Markdown note links render on list cards", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Markdown Notes Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Publish update");
    await page.getByTestId("text-dialog-submit").click();

    const notesInput = page.getByTestId("card-notes-input");
    await notesInput.fill("Review the [launch spec](https://example.com/spec).\nTrack status at www.example.org/status.");
    await expect(notesInput).toContainText("Review the launch spec.");
    await expect(notesInput).not.toContainText("[launch spec](https://example.com/spec)");
    await page.getByTestId("save-card").click();

    const notes = page.getByTestId(/card-notes-.*/);
    await expect(notes).toContainText("Review the launch spec.");
    await expect(notes).toContainText("Track status at www.example.org/status.");

    const markdownLink = page.getByTestId(/card-note-link-.*-0/);
    await expect(markdownLink).toHaveText("launch spec");
    await expect(markdownLink).toHaveAttribute("href", "https://example.com/spec");

    const bareLink = page.getByTestId(/card-note-link-.*-1/);
    await expect(bareLink).toHaveText("www.example.org/status");
    await expect(bareLink).toHaveAttribute("href", "https://www.example.org/status");

    await bareLink.click();
    await expect(page.getByTestId("card-title-input")).toBeHidden();
    expect((await snapshot(page)).externalLinks).toContain("https://www.example.org/status");
  });

  test("note links can be edited and removed in the card editor", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Link Editing Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Publish update");
    await page.getByTestId("text-dialog-submit").click();

    const notesInput = page.getByTestId("card-notes-input");
    await notesInput.fill("Review the [launch spec](https://example.com/spec).");
    await expect(notesInput).toContainText("Review the launch spec.");
    await expect(notesInput).not.toContainText("[launch spec](https://example.com/spec)");

    const editorLink = notesInput.locator("a", { hasText: "launch spec" });
    await expect(editorLink).toHaveAttribute("href", "https://example.com/spec");
    await editorLink.click();

    await expect(page.getByTestId("notes-link-form")).toBeVisible();
    await page.getByTestId("notes-link-label").fill("release spec");
    await page.getByTestId("notes-link-url").fill("example.com/release");
    await page.getByTestId("notes-link-apply").click();

    const updatedLink = notesInput.locator("a", { hasText: "release spec" });
    await expect(updatedLink).toHaveAttribute("href", "https://example.com/release");
    await updatedLink.click();
    await page.getByTestId("notes-link-remove").click();

    await expect(notesInput.locator("a", { hasText: "release spec" })).toHaveCount(0);
    await expect(notesInput).toContainText("Review the release spec.");
    await expect(notesInput).not.toContainText("[release spec](https://example.com/release)");

    await page.getByTestId("save-card").click();
    const saved = await snapshot(page);
    expect(saved.cards[0].content).toContain("Review the release spec.");
    expect(saved.cards[0].content).not.toContain("[release spec]");
  });

  test("Slack notifications tag assigned member handles", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Slack Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("nav-members").click();
    await page.getByTestId("member-name-input").fill("Ada Lovelace");
    await page.getByTestId("add-member").click();
    await page.getByTestId("member-ada-lovelace-slack-handle").fill("U024BE7LH");
    await expect.poll(async () => {
      const member = (await snapshot(page)).members.members[0] as { slackHandle?: string };
      return member.slackHandle;
    }).toBe("U024BE7LH");

    await page.getByTestId("nav-settings").click();
    await page.getByTestId("slack-webhook-input").fill("https://hooks.slack.com/services/FAKE/FAKE/FAKE");
    await page.getByTestId("save-settings").click();
    await expect.poll(async () => (await snapshot(page)).settings.slackWebhookUrl).toBe("https://hooks.slack.com/services/FAKE/FAKE/FAKE");

    await page.locator('[data-testid^="board-nav-"]').first().click();
    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Notify Ada");
    await page.getByTestId("text-dialog-submit").click();
    await page.getByTestId("assignee-ada-lovelace").check();
    await page.getByTestId("save-card").click();

    await expect.poll(async () => (await snapshot(page)).slack.length).toBe(1);
    let posts = (await snapshot(page)).slack;
    expect(posts[0].message).toContain("Assigned to: <@U024BE7LH>");

    await page.getByTestId(/card-open-.*/).click();
    await page.getByTestId("card-completed-input").check();
    await page.getByTestId("save-card").click();

    await expect.poll(async () => (await snapshot(page)).slack.length).toBe(2);
    posts = (await snapshot(page)).slack;
    expect(posts[1].message).toContain("Assigned to: <@U024BE7LH>");
  });

  test("manual update check reports when Limn is up to date", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("nav-settings").click();
    await page.getByTestId("check-updates").click();

    await expect(page.getByTestId("update-status")).toContainText("Limn is up to date.");
  });

  test("available update can be installed and restarted from the banner", async ({ page }) => {
    await openApp(page);
    await setUpdaterMode(page, "available");
    await openApp(page, { reset: false });
    await openWorkspace(page);

    await expect(page.getByTestId("update-banner")).toContainText("Limn 0.2.0 is available.");
    await page.getByTestId("install-update").click();
    await expect(page.getByTestId("update-banner")).toContainText("Restart to finish updating.");
    await expect.poll(async () => (await snapshot(page)).updater.installed).toBe(true);

    await page.getByTestId("restart-update").click();
    await expect.poll(async () => (await snapshot(page)).updater.restarted).toBe(true);
  });

  test("update install failure is shown in settings", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    await setUpdaterMode(page, "install-fail");

    await page.getByTestId("nav-settings").click();
    await page.getByTestId("check-updates").click();
    await expect(page.getByTestId("settings-install-update")).toBeVisible();
    await page.getByTestId("settings-install-update").click();

    await expect(page.getByTestId("update-status")).toContainText("Update install failed: Test install failed");
  });
});
