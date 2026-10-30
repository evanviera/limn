import { test, expect, type Page } from "@playwright/test";
import { openApp, openWorkspace, snapshot } from "./harness";

async function createPreviewCard(page: Page, extraStep = false) {
  await openApp(page);
  await openWorkspace(page);
  await page.getByTestId("create-board").click();
  await page.getByTestId("text-dialog-input").fill("Calm board");
  await page.getByTestId("text-dialog-submit").click();
  await page.getByTestId("add-card-todo").click();
  await page.getByTestId("text-dialog-input").fill("Opening credits");
  await page.getByTestId("text-dialog-submit").click();
  await page.getByTestId("save-card").click();
  await expect(page.getByTestId("card-title-input")).toBeHidden();
  const file = (await snapshot(page)).cards[0];
  const steps = [
    { id: "complete", title: "Collect names", url: "", completed: true, items: [] },
    { id: "next", title: "Mockup title sequence", url: "https://example.com/brief", completed: false,
      items: [{ id: "detail", text: "Export reference", url: "https://example.com/reference" }] },
    { id: "last", title: "Review with Jenny", url: "", completed: false, items: [] }
  ];
  if (extraStep) steps.push({ id: "extra", title: "Deliver final", url: "", completed: false, items: [] });
  await page.evaluate(({ file, steps }) => {
    window.__LIMN_E2E__!.externalEditCard(file.file_name, file.content
      .replace(/^subtasks:.*$/m, `subtasks: ${JSON.stringify(steps)}`)
      .replace(/^updatedAt:.*$/m, 'updatedAt: "2026-12-01T00:00:00.000Z"')
      + "\nKeep the full treatment. [Slack thread](https://example.com/slack)");
  }, { file, steps });
  const card = page.getByRole("article", { name: "Opening credits", exact: true });
  await expect(card.locator(".subtask-badge")).toHaveText(`1/${steps.length}`);
  return card;
}

test("calm cards disclose details without opening the editor or changing saved content", async ({ page }) => {
  const card = await createPreviewCard(page);
  const original = (await snapshot(page)).cards;
  await expect(card.getByRole("checkbox")).toHaveCount(2);
  await expect(card.getByTestId("card-subtask-next-link")).toBeVisible();
  await expect(card.getByTestId("card-subtask-last-toggle")).toBeVisible();
  await expect(card.locator("summary")).toHaveText("1 completed");
  await expect(card.getByTestId("card-subtask-complete-toggle")).toBeHidden();
  await expect(card.getByTestId(/^card-preview-/)).toHaveAttribute("aria-expanded", "true");
  await expect(card.getByRole("button", { name: "+1 more step" })).toHaveCount(0);
  await page.getByTestId("board-view-menu-toggle").click();
  const compactSteps = page.getByRole("group", { name: "Card display" }).getByRole("button", { name: /^Compact steps/ });
  await expect(compactSteps).toHaveAttribute("aria-pressed", "false");
  await compactSteps.click();
  await page.getByTestId("board-view-menu-toggle").click();
  await expect(card.getByRole("checkbox")).toHaveCount(1);
  await expect(card.getByTestId("card-subtask-next-link")).toBeVisible();
  await expect(card.getByTestId("card-subtask-item-detail-link")).toHaveCount(0);
  await expect(card.locator(".card-notes-preview")).toHaveCount(0);
  await expect(card.getByTestId("card-subtask-complete-toggle")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "+1 more step" })).toBeVisible();

  const disclosure = card.getByTestId(/^card-preview-/);
  await disclosure.focus();
  await disclosure.press("Enter");
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(disclosure).toBeFocused();
  await expect(page.getByTestId("card-view")).toHaveCount(0);
  await expect(card.getByTestId("card-subtask-item-detail-link")).toBeVisible();
  await expect(card.locator(".card-notes-preview")).toContainText("Keep the full treatment.");
  await expect(card.getByTestId("card-subtask-complete-toggle")).toBeHidden();
  await card.locator("summary").focus();
  await card.locator("summary").press("Enter");
  await expect(card.getByTestId("card-subtask-complete-toggle")).toBeChecked();
  await card.getByRole("link", { name: "Slack thread" }).click();
  await expect.poll(async () => (await snapshot(page)).externalLinks).toContain("https://example.com/slack");
  await card.getByRole("button", { name: "Collapse preview for Opening credits" }).click();
  await expect(card.locator(".card-notes-preview")).toHaveCount(0);
  expect((await snapshot(page)).cards).toEqual(original);
  await card.getByRole("button", { name: "+1 more step" }).focus();
  await card.getByRole("button", { name: "+1 more step" }).press("Enter");
  await expect(disclosure).toBeFocused();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await card.getByRole("button", { name: "Opening credits", exact: true }).click();
  await expect(page.getByTestId("card-view-title")).toHaveText("Opening credits");
});

test("steps are expanded by default and opt-in compaction persists across board views", async ({ page }) => {
  const card = await createPreviewCard(page, true);
  const moreSteps = card.getByRole("button", { name: "+2 more steps" });
  const disclosure = card.getByTestId(/^card-preview-/);
  await expect(card.getByRole("checkbox")).toHaveCount(3);
  await expect(card.locator("summary")).toHaveText("1 completed");
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(moreSteps).toHaveCount(0);
  await test.info().attach("compact-steps-off", { body: await card.screenshot(), contentType: "image/png" });
  const original = (await snapshot(page)).cards;
  await page.getByTestId("board-view-menu-toggle").click();
  const option = page.getByTestId("compact-steps-toggle");
  await expect(option).toHaveAttribute("aria-pressed", "false");
  await option.click();
  await expect(card.getByRole("checkbox")).toHaveCount(1);
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await expect(moreSteps).toBeVisible();
  await test.info().attach("compact-steps-on", { body: await card.screenshot(), contentType: "image/png" });
  await page.getByTestId("compact-board-toggle").click();
  await expect(moreSteps).toHaveCount(0);
  await page.getByTestId("compact-board-toggle").click();

  await openApp(page, { reset: false });
  await expect(moreSteps).toBeVisible();
  await expect(card.getByRole("checkbox")).toHaveCount(1);
  await page.getByTestId("nav-overview").click();
  await expect(moreSteps).toBeVisible();
  await page.getByTestId("board-view-menu-toggle").click();
  await expect(option).toHaveAttribute("aria-pressed", "true");
  await option.click();
  await expect(moreSteps).toHaveCount(0);
  await expect(card.getByRole("checkbox")).toHaveCount(3);
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");

  // Local chevron overrides remain possible; a mode change reapplies its
  // default to already-mounted cards, including cards expanded manually.
  await page.getByTestId("board-view-menu-toggle").click();
  await disclosure.click();
  await expect(card.getByRole("checkbox")).toHaveCount(1);
  await moreSteps.click();
  await expect(card.getByRole("checkbox")).toHaveCount(3);
  await page.getByTestId("board-view-menu-toggle").click();
  await option.click();
  await expect(card.getByRole("checkbox")).toHaveCount(1);
  await option.click();
  await expect(card.getByRole("checkbox")).toHaveCount(3);
  await openApp(page, { reset: false });
  await expect(moreSteps).toHaveCount(0);
  await expect(card.getByRole("checkbox")).toHaveCount(3);
  await page.getByTestId("board-view-menu-toggle").click();
  await expect(option).toHaveAttribute("aria-pressed", "false");
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  expect((await snapshot(page)).cards).toEqual(original);
});

test("the next unfinished step advances and completed steps remain reversible", async ({ page }) => {
  const card = await createPreviewCard(page);
  await page.getByTestId("board-view-menu-toggle").click();
  await page.getByTestId("compact-steps-toggle").click();
  await page.getByTestId("board-view-menu-toggle").click();
  await card.getByTestId("card-subtask-next-toggle").focus();
  await card.getByTestId("card-subtask-next-toggle").press("Space");
  await expect(card.locator(".subtask-badge")).toHaveText("2/3");
  await expect(card.getByTestId("card-subtask-last-toggle")).toBeVisible();
  await expect(card.getByTestId("card-subtask-last-toggle")).toBeFocused();
  await expect(card.getByTestId("card-subtask-next-toggle")).toHaveCount(0);
  await card.getByTestId("card-subtask-last-toggle").press("Space");
  await expect(card.locator(".subtask-badge")).toHaveText("3/3");
  await expect(card.getByRole("checkbox")).toHaveCount(0);
  await expect(card.getByTestId(/^card-preview-/)).toBeFocused();
  await card.getByRole("button", { name: /^Expand preview/ }).click();
  await card.locator("summary").click();
  await card.getByTestId("card-subtask-next-toggle").click();
  await expect(card.locator(".subtask-badge")).toHaveText("2/3");
  await openApp(page, { reset: false });
  await expect(card.getByTestId("card-subtask-next-toggle")).not.toBeChecked();
  await expect(card.getByRole("checkbox")).toHaveCount(1);
  expect((await snapshot(page)).cards[0].content).toContain("Keep the full treatment.");

  await page.getByTestId("nav-overview").click();
  await expect(card.getByRole("checkbox")).toHaveCount(1);
  await card.getByRole("button", { name: /^Expand preview/ }).click();
  await expect(card.locator(".card-notes-preview")).toBeVisible();
  await page.getByTestId("board-view-menu-toggle").click();
  await page.getByTestId("compact-board-toggle").click();
  await expect(card.getByRole("checkbox")).toHaveCount(0);
  await expect(card.locator(".card-notes-preview")).toHaveCount(0);
  await expect(card.locator(".subtask-badge")).toHaveText("2/3");
});

test("the small due reminder follows identity and completion while assignee names stay accessible", async ({ page }) => {
  const card = await createPreviewCard(page);
  await page.getByTestId("nav-members").click();
  for (const name of ["Ada", "Grace", "Alan"]) {
    await page.getByTestId("member-name-input").fill(name);
    await page.getByTestId("add-member").click();
  }
  const members = (await snapshot(page)).members.members as Array<{ id: string; name: string }>;
  await page.getByTestId("identity-select").click();
  await page.getByRole("menuitem", { name: "Ada", exact: true }).click();
  await page.getByRole("button", { name: "Calm board", exact: true }).click();
  const file = (await snapshot(page)).cards[0];
  await page.evaluate(({ file, ids }) => window.__LIMN_E2E__!.externalEditCard(file.file_name, file.content
    .replace(/^assignees:.*$/m, `assignees: ${JSON.stringify(ids)}`)
    .replace(/^due:.*$/m, 'due: "2020-01-01"')
    .replace(/^updatedAt:.*$/m, 'updatedAt: "2026-12-02T00:00:00.000Z"')), { file, ids: members.map(m => m.id) });
  await expect(page.getByTestId("board-due-reminder")).toContainText("1 card assigned to you");
  await expect(card.getByRole("img", { name: "Assigned to Ada, Grace, Alan" })).toBeVisible();
  await expect(card.locator(".member-dots .avatar")).toHaveCount(3);
  await card.getByRole("button", { name: /^Collapse preview/ }).click();
  await expect(card.locator(".member-dots .avatar")).toHaveCount(1);
  await expect(card.locator(".member-overflow")).toHaveText("+2");
  await page.getByTestId("identity-select").click();
  await page.getByRole("menuitem", { name: "Grace", exact: true }).click();
  await expect(page.getByTestId("board-due-reminder")).toContainText("1 card assigned to you");
  await card.getByRole("button", { name: "Opening credits", exact: true }).click();
  await page.getByTestId("card-view-complete").click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByTestId("board-due-reminder")).toHaveCount(0);
  await expect(page.getByTestId("due-reminder-count")).toHaveCount(0);
});
