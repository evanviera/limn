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
        const input = element as HTMLTextAreaElement;
        const start = input.value.indexOf(selectedText);
        input.setSelectionRange(start, start + selectedText.length);
      }, text);
    }

    await selectNotesText("Review");
    await page.getByTestId("notes-italic").click();
    await expect(notesInput).toHaveValue("*Review* launch status at www.example.org/status.");

    await selectNotesText("launch");
    await page.getByTestId("notes-bold").click();
    await expect(notesInput).toHaveValue("*Review* **launch** status at www.example.org/status.");

    await selectNotesText("status");
    await page.getByTestId("notes-link").click();
    await expect(page.getByTestId("notes-link-form")).toBeVisible();
    await page.getByTestId("notes-link-url").fill("example.com/spec");
    await page.getByTestId("notes-link-apply").click();

    await expect(notesInput).toHaveValue("*Review* **launch** [status](https://example.com/spec) at www.example.org/status.");
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

  test("manually written Markdown note links render on list cards", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Markdown Notes Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Publish update");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("card-notes-input").fill("Review the [launch spec](https://example.com/spec).\nTrack status at www.example.org/status.");
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
