import { test, expect } from "@playwright/test";
import { emitDeepLink, openApp, openWorkspace, setUpdaterMode, snapshot } from "./harness";

test.describe("smoke", () => {
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
    await page.getByTestId("card-view-complete").click();

    await expect.poll(async () => (await snapshot(page)).slack.length).toBe(2);
    posts = (await snapshot(page)).slack;
    expect(posts[1].message).toContain("Assigned to: <@U024BE7LH>");
  });

  test("board-level completion and moves to a tracked list notify Slack", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Ops Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("nav-settings").click();
    await page.getByTestId("slack-webhook-input").fill("https://hooks.slack.com/services/FAKE/FAKE/FAKE");
    await page.getByTestId("save-settings").click();
    await expect.poll(async () => (await snapshot(page)).settings.slackWebhookUrl).toBe("https://hooks.slack.com/services/FAKE/FAKE/FAKE");

    await page.locator('[data-testid^="board-nav-"]').first().click();
    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Ship it");
    await page.getByTestId("text-dialog-submit").click();
    // Creating a card opens the editor; close it so the board is interactive.
    await page.getByTestId("save-card").click();

    // Complete the card straight from the board (context menu) — this path used
    // to skip the Slack notification entirely.
    await page.locator("article.task-card").first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Mark complete" }).click();

    await expect.poll(async () => (await snapshot(page)).slack.length).toBe(1);
    let posts = (await snapshot(page)).slack;
    expect(posts[0].message).toContain("✅ Task completed: Ship it");

    // Moving into the "Done" list (the default tracked list) notifies too.
    await page.locator("article.task-card").first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to Done" }).click();

    await expect.poll(async () => (await snapshot(page)).slack.length).toBe(2);
    posts = (await snapshot(page)).slack;
    expect(posts[1].message).toContain("➡️ Card moved to Done: Ship it");
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

  test("a card deep link opens the referenced card", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Link Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Shareable card");
    await page.getByTestId("text-dialog-submit").click();
    await expect(page.getByTestId("card-title-input")).toHaveValue("Shareable card");
    await page.getByTestId("save-card").click();

    // Creating a card leaves the board without the editor open; a deep link to
    // the card's id (its file is `<id>.md`) should reopen it in read mode.
    const cardFile = (await snapshot(page)).cards[0].file_name;
    const cardId = cardFile.replace(/\.md$/, "");
    await emitDeepLink(page, `limn://card/${cardId}`);

    await expect(page.getByTestId("card-view")).toBeVisible();
    await expect(page.getByTestId("card-view-title")).toHaveText("Shareable card");
  });

  test("a deep link to an unknown card explains it wasn't found", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await emitDeepLink(page, "limn://card/card_missing");

    await expect(page.locator(".banner")).toContainText("isn't in any of your open workspaces");
    await expect(page.getByTestId("card-view")).toHaveCount(0);
  });
});
