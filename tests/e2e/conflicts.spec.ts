import { expect, test } from "@playwright/test";
import { openApp, openWorkspace, snapshot } from "./harness";

// Drives the in-app conflict review surface end to end: a hard title conflict and
// a version-checked delete each preserve a copy, surface a review banner, list a
// comparison, and are resolved without leaving the app.
test.describe("conflict review", () => {
  test("a hard title conflict is listed, compared, and resolved from the review UI", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Conflict Board");
    await page.getByTestId("text-dialog-submit").click();

    // Creating a card opens it in edit mode — the merge base the editor remembers.
    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Original title");
    await page.getByTestId("text-dialog-submit").click();
    await expect(page.getByTestId("card-title-input")).toHaveValue("Original title");
    await page.waitForTimeout(300);

    // Another device rewrites the same card's title and bumps its version.
    const before = await snapshot(page);
    const cardFile = before.cards[0];
    await page.evaluate(({ fileName, content }) => {
      const api = (window as { __LIMN_E2E__?: { externalEditCard(fileName: string, content: string): void } }).__LIMN_E2E__;
      if (!api) {
        throw new Error("Limn E2E harness not loaded");
      }
      const edited = content
        .replace(/^updatedAt: .*$/m, 'updatedAt: "2026-12-01T00:00:00.000Z"')
        .replace(/^title: .*$/m, 'title: "Remote title"');
      api.externalEditCard(fileName, edited);
    }, { fileName: cardFile.file_name, content: cardFile.content });
    await expect(page.locator(".banner")).toContainText("changed on disk");

    // We rename the title differently and save: title diverges on both sides, so
    // the save preserves our version as a conflict copy.
    const titleInput = page.getByTestId("card-title-input");
    if (!(await titleInput.isVisible())) {
      await page.getByTestId("edit-card").click();
    }
    await titleInput.fill("My title");
    await page.getByTestId("save-card").click();

    // The conflict banner appears; close the editor and open the review surface.
    await expect(page.getByTestId("conflict-banner")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("review-conflicts").click();
    await expect(page.getByTestId("conflict-review")).toBeVisible();

    // The conflict is listed and compares our copy against the current on-disk card.
    await expect(page.getByTestId("conflict-item")).toHaveCount(1);
    const detail = page.getByTestId("conflict-detail");
    await expect(detail).toContainText("My title");
    await expect(detail).toContainText("Remote title");

    // Keep our copy: the artifact is discarded and the card takes our title.
    await page.getByTestId("conflict-keep-mine").click();
    await expect(page.getByTestId("conflict-review-empty")).toBeVisible();
    await expect
      .poll(async () => {
        const shot = await snapshot(page);
        return shot.conflicts.length + shot.cards.filter((file) => file.file_name.includes("_conflict_")).length;
      })
      .toBe(0);
    const cards = (await snapshot(page)).cards;
    expect(cards).toHaveLength(1);
    expect(cards[0].content).toContain("My title");
  });

  test("a version-checked delete is refused, preserved, and reviewable", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Delete Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Doomed card");
    await page.getByTestId("text-dialog-submit").click();
    await expect(page.getByTestId("card-title-input")).toHaveValue("Doomed card");
    await page.waitForTimeout(300);

    // Another device edits the card on disk without waking our watcher, so our
    // known version goes stale.
    const before = await snapshot(page);
    const cardFile = before.cards[0];
    await page.evaluate(({ fileName, content }) => {
      const api = (window as { __LIMN_E2E__?: { externalEditCard(fileName: string, content: string, silent?: boolean): void } }).__LIMN_E2E__;
      if (!api) {
        throw new Error("Limn E2E harness not loaded");
      }
      const edited = content.replace(/^updatedAt: .*$/m, 'updatedAt: "2026-12-01T00:00:00.000Z"');
      api.externalEditCard(fileName, edited, true);
    }, { fileName: cardFile.file_name, content: cardFile.content });

    // Deleting against the stale version is refused; the disk copy is preserved.
    await page.getByTestId("delete-card").click();
    await page.getByTestId("confirm-dialog-submit").click();
    await expect(page.getByText(/not deleted/)).toBeVisible();
    await expect(page.getByTestId("conflict-banner")).toBeVisible();
    // The card was not removed.
    expect((await snapshot(page)).cards).toHaveLength(1);

    // Review lists the preserved delete conflict, then discard it (keep current).
    await page.keyboard.press("Escape");
    await page.getByTestId("review-conflicts").click();
    await expect(page.getByTestId("conflict-item")).toHaveCount(1);
    await page.getByTestId("conflict-discard").click();
    await expect(page.getByTestId("conflict-review-empty")).toBeVisible();
    await expect.poll(async () => (await snapshot(page)).conflicts.length).toBe(0);
  });
});
