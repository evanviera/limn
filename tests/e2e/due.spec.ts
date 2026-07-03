import { test, expect } from "@playwright/test";
import { openApp, openWorkspace, snapshot } from "./harness";

// A `YYYY-MM-DD` string `offsetDays` from today (local), matching how the app
// classifies due dates against the real current date.
function dueOffset(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

test.describe("due-date workflow", () => {
  test("groups cards by due status, surfaces reminders, and exports a calendar", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Due Work");
    await page.getByTestId("text-dialog-submit").click();

    async function createCard(title: string, due?: string) {
      await page.getByTestId("add-card-todo").click();
      await page.getByTestId("text-dialog-input").fill(title);
      await page.getByTestId("text-dialog-submit").click();
      await expect(page.getByTestId("card-title-input")).toBeVisible();
      if (due) {
        await page.getByTestId("card-due-input").fill(due);
      }
      await page.getByTestId("save-card").click();
      await expect(page.getByTestId("card-title-input")).toBeHidden();
    }

    await createCard("Overdue task", dueOffset(-2));
    await createCard("Today task", dueOffset(0));
    await createCard("Future task", dueOffset(30));
    await createCard("Someday");

    // Overdue + due-today count nags on the Due nav item.
    await expect(page.getByTestId("due-reminder-count")).toHaveText("2");

    await page.getByTestId("nav-due").click();

    // Cards are bucketed cross-board by how soon they are due.
    await expect(page.getByTestId("due-group-overdue")).toContainText("Overdue task");
    await expect(page.getByTestId("due-group-today")).toContainText("Today task");
    await expect(page.getByTestId("due-group-later")).toContainText("Future task");
    await expect(page.getByTestId("due-group-none")).toContainText("Someday");

    // A due row opens the card editor with the right card.
    await page.getByTestId("due-group-overdue").getByRole("button").first().click();
    await expect(page.getByTestId("card-title-input")).toHaveValue("Overdue task");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("card-title-input")).toBeHidden();

    // Exporting writes an .ics with a VEVENT per dated card (Someday is skipped).
    await page.getByTestId("due-export").click();
    await expect.poll(async () => {
      const state = await snapshot(page);
      const ics = state.exports.find((file) => file.path === "exports/limn-due-dates.ics");
      return ics ? (ics.content.match(/BEGIN:VEVENT/g) ?? []).length : 0;
    }).toBe(3);
  });

  test("completed cards drop out of the reminder count", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Reminder Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Late thing");
    await page.getByTestId("text-dialog-submit").click();
    await expect(page.getByTestId("card-title-input")).toBeVisible();
    await page.getByTestId("card-due-input").fill(dueOffset(-1));
    await page.getByTestId("save-card").click();
    await expect(page.getByTestId("card-title-input")).toBeHidden();

    await expect(page.getByTestId("due-reminder-count")).toHaveText("1");

    // Marking the overdue card complete clears the reminder.
    await page.getByTestId("card-open-" + (await firstCardId(page))).click();
    await page.getByTestId("card-completed-input").check();
    await page.getByTestId("save-card").click();
    await expect(page.getByTestId("card-title-input")).toBeHidden();

    await expect(page.getByTestId("due-reminder-count")).toBeHidden();
  });
});

async function firstCardId(page: import("@playwright/test").Page): Promise<string> {
  const card = page.locator("[data-card-id]").first();
  const id = await card.getAttribute("data-card-id");
  if (!id) {
    throw new Error("no card rendered");
  }
  return id;
}
