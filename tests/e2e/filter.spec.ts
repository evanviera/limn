import { test, expect, type Page } from "@playwright/test";
import { openApp, openWorkspace, snapshot } from "./harness";

// A `YYYY-MM-DD` string `offsetDays` from today (local), matching how the app
// classifies due dates against the real current date.
function dueOffset(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

interface CardOptions {
  due?: string;
  labels?: string[];
  completed?: boolean;
  assigneeId?: string;
}

async function createCard(page: Page, title: string, options: CardOptions = {}): Promise<void> {
  await page.getByTestId("add-card-todo").click();
  await page.getByTestId("text-dialog-input").fill(title);
  await page.getByTestId("text-dialog-submit").click();
  await expect(page.getByTestId("card-title-input")).toBeVisible();
  if (options.due) {
    await page.getByTestId("card-due-input").fill(options.due);
  }
  for (const label of options.labels ?? []) {
    await page.getByTestId("card-labels-input").fill(label);
    await page.getByTestId("card-labels-input").press("Enter");
  }
  if (options.assigneeId) {
    await page.getByTestId(`assignee-${options.assigneeId}`).check();
  }
  if (options.completed) {
    await page.getByTestId("card-completed-input").check();
  }
  await page.getByTestId("save-card").click();
  await expect(page.getByTestId("card-title-input")).toBeHidden();
}

const rows = (page: Page) => page.locator('[data-testid^="filter-row-"]');
const rowWith = (page: Page, title: string) => rows(page).filter({ hasText: title });

test.describe("filter, presets, and saved views", () => {
  test("surfaces due reminders in filter and exports a calendar", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Due Work");
    await page.getByTestId("text-dialog-submit").click();

    await createCard(page, "Overdue task", { due: dueOffset(-2) });
    await createCard(page, "Today task", { due: dueOffset(0) });
    await createCard(page, "Future task", { due: dueOffset(30) });
    await createCard(page, "Someday");

    // Overdue + due-today count now nudges from the Filter nav item.
    await expect(page.getByTestId("due-reminder-count")).toHaveText("2");
    await page.getByTestId("due-reminder-count").click();
    await expect(page.getByTestId("filter-due")).toHaveValue("soon");
    await expect(page.getByTestId("filter-sort")).toHaveValue("due");
    await expect(rows(page)).toHaveCount(2);
    await expect(rowWith(page, "Overdue task")).toBeVisible();
    await expect(rowWith(page, "Today task")).toBeVisible();
    await expect(rowWith(page, "Future task")).toHaveCount(0);
    await expect(rowWith(page, "Someday")).toHaveCount(0);

    // A filtered result opens the card editor with the right card.
    await rowWith(page, "Overdue task").click();
    await expect(page.getByTestId("card-view-title")).toHaveText("Overdue task");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("card-view")).toBeHidden();

    // Exporting writes an .ics with a VEVENT per dated card (Someday is skipped).
    await page.getByTestId("due-export").click();
    await expect.poll(async () => {
      const state = await snapshot(page);
      const ics = state.exports.find((file) => file.path === "exports/limn-due-dates.ics");
      return ics ? (ics.content.match(/BEGIN:VEVENT/g) ?? []).length : 0;
    }).toBe(3);
  });

  test("filters cards by text, label, due, and status, then opens a result", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Filter Work");
    await page.getByTestId("text-dialog-submit").click();

    await createCard(page, "Parser crash", { labels: ["bug"], due: dueOffset(-2) });
    await createCard(page, "Write docs", { labels: ["docs"] });
    await createCard(page, "Ship release", { labels: ["docs"], due: dueOffset(3), completed: true });

    await page.getByTestId("nav-filter").click();

    // The default view lists active, non-archived cards (the completed one is hidden).
    await expect(page.getByTestId("filter-result-count")).toHaveText("2 cards");
    await expect(rows(page)).toHaveCount(2);
    await expect(rowWith(page, "Ship release")).toHaveCount(0);
    await expect(page.getByTestId("filter-checkin-due")).toContainText("1");
    await expect(page.getByTestId("filter-checkin-unassigned")).toContainText("2");
    await expect(page.getByTestId("filter-checkin-nodue")).toContainText("1");
    await expect(page.getByTestId("filter-checkin-done")).toContainText("1");

    // Check-in tiles jump directly to common review queues.
    await page.getByTestId("filter-checkin-done").click();
    await expect(page.getByTestId("filter-completion")).toHaveValue("completed");
    await expect(page.getByTestId("filter-active-completion")).toContainText("Status: Completed");
    await expect(rows(page)).toHaveCount(1);
    await expect(rowWith(page, "Ship release")).toBeVisible();
    await page.getByTestId("filter-active-completion").click();
    await expect(page.getByTestId("filter-completion")).toHaveValue("active");
    await expect(rowWith(page, "Ship release")).toHaveCount(0);

    // Free text narrows to matching titles/notes/labels.
    await page.getByTestId("filter-input").fill("parser");
    await expect(rows(page)).toHaveCount(1);
    await expect(rowWith(page, "Parser crash")).toBeVisible();

    // The label facet is an independent filter.
    await page.getByTestId("filter-input").fill("");
    await page.getByTestId("filter-label-bug").click();
    await expect(page.getByTestId("filter-active-label-bug")).toContainText("Label: bug");
    await expect(rows(page)).toHaveCount(1);
    await expect(rowWith(page, "Parser crash")).toBeVisible();
    await page.getByTestId("filter-active-label-bug").click();
    await expect(page.getByTestId("filter-active-label-bug")).toHaveCount(0);

    // The due facet surfaces overdue work regardless of board.
    await page.getByTestId("filter-due").selectOption("overdue");
    await expect(rows(page)).toHaveCount(1);
    await expect(rowWith(page, "Parser crash")).toBeVisible();

    // Switching the status facet reveals completed cards.
    await page.getByTestId("filter-due").selectOption("any");
    await page.getByTestId("filter-completion").selectOption("completed");
    await expect(rows(page)).toHaveCount(1);
    await expect(rowWith(page, "Ship release")).toBeVisible();

    // A result opens the card editor for that card.
    await rowWith(page, "Ship release").click();
    await expect(page.getByTestId("card-view-title")).toHaveText("Ship release");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("card-view")).toBeHidden();
  });

  test("saves the current filter as a view, re-applies it, and deletes it", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("View Work");
    await page.getByTestId("text-dialog-submit").click();

    await createCard(page, "Alpha task", { labels: ["urgent"] });
    await createCard(page, "Beta task");

    await page.getByTestId("nav-filter").click();

    // Configure a filter and save it as a named view.
    await page.getByTestId("filter-input").fill("alpha");
    await page.getByTestId("filter-save-view").click();
    await page.getByTestId("text-dialog-input").fill("Alpha only");
    await page.getByTestId("text-dialog-submit").click();

    const savedChip = page.getByTestId("filter-presets").getByRole("button", { name: "Alpha only" });
    await expect(savedChip).toBeVisible();

    // It is persisted into the workspace settings (folder-synced).
    await expect.poll(async () => {
      const views = (await snapshot(page)).settings.savedViews as Array<{ name: string; filter: { text: string } }>;
      return views.map((view) => `${view.name}:${view.filter.text}`);
    }).toContain("Alpha only:alpha");

    // Clearing resets the filter; re-applying the view restores it.
    await page.getByTestId("filter-clear").click();
    await expect(page.getByTestId("filter-input")).toHaveValue("");
    await savedChip.click();
    await expect(page.getByTestId("filter-input")).toHaveValue("alpha");
    await expect(savedChip).toHaveClass(/active/);

    // Deleting the view (via its context menu) removes it everywhere.
    await savedChip.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete view" }).click();
    await page.getByTestId("confirm-dialog-submit").click();
    await expect(page.getByTestId("filter-presets").getByRole("button", { name: "Alpha only" })).toHaveCount(0);
    await expect.poll(async () => (await snapshot(page)).settings.savedViews as unknown[]).toEqual([]);
  });

  test("scopes to the current member via the My tasks preset and Unassigned facet", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    // Define a member and adopt that identity on this device.
    await page.getByTestId("nav-members").click();
    await page.getByTestId("member-name-input").fill("Ada Lovelace");
    await page.getByTestId("add-member").click();
    const memberId = (await snapshot(page)).members.members[0] as { id: string };
    await page.getByTestId("identity-select").click();
    await page.getByRole("menuitem", { name: "Ada Lovelace" }).click();
    await expect(page.getByTestId("identity-select")).toContainText("Ada Lovelace");

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Owned Work");
    await page.getByTestId("text-dialog-submit").click();

    await createCard(page, "My card", { assigneeId: memberId.id });
    await createCard(page, "Loose card");

    await page.getByTestId("nav-filter").click();

    // "My tasks" scopes to cards assigned to whoever is using this device.
    await page.getByTestId("filter-preset-my-tasks").click();
    await expect(page.getByTestId("filter-preset-my-tasks")).toHaveClass(/active/);
    await expect(rows(page)).toHaveCount(1);
    await expect(rowWith(page, "My card")).toBeVisible();

    // The Unassigned facet finds cards without an owner.
    await page.getByTestId("filter-clear").click();
    await page.getByTestId("filter-assignee-unassigned").click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rowWith(page, "Loose card")).toBeVisible();
  });
});
