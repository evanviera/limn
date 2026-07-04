import { test, expect } from "@playwright/test";
import { openApp, openWorkspace, setUpdaterMode, snapshot } from "./harness";

test.describe("smoke", () => {
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

  test("notes bold toolbar toggles cleanly while typing (no stray markers)", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Toggle Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Format notes");
    await page.getByTestId("text-dialog-submit").click();

    const notesInput = page.getByTestId("card-notes-input");
    await notesInput.click();

    // Word/Google-Docs muscle memory: bold on, type a word, bold off, keep typing.
    await page.getByTestId("notes-bold").click();
    await page.keyboard.type("brand");
    await page.getByTestId("notes-bold").click();
    await page.keyboard.type(" guidelines. Reference:");

    await expect(notesInput.locator("strong")).toHaveText("brand");

    await page.getByTestId("save-card").click();

    const saved = await snapshot(page);
    expect(saved.cards[0].content).toContain("**brand** guidelines. Reference:");
    expect(saved.cards[0].content).not.toContain("****");

    const notes = page.getByTestId(/card-notes-.*/);
    await expect(notes.locator("strong")).toHaveText("brand");
    await expect(notes).not.toContainText("**");
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
});
