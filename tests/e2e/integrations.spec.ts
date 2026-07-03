import { test, expect } from "@playwright/test";
import { openApp, openWorkspace, setUpdaterMode, snapshot } from "./harness";

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
