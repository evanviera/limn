import { test, expect } from "@playwright/test";
import { openApp, openWorkspace, snapshot } from "./harness";

test.describe("discussion", () => {
  test("members identify themselves, then post, edit, and delete comments", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    // Define the project's members.
    await page.getByTestId("nav-members").click();
    await page.getByTestId("member-name-input").fill("Ada Lovelace");
    await page.getByTestId("add-member").click();
    await page.getByTestId("member-name-input").fill("Grace Hopper");
    await page.getByTestId("add-member").click();

    // A board with one card to discuss.
    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Discussion Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Plan the launch");
    await page.getByTestId("text-dialog-submit").click();

    // With no active member chosen yet, the discussion asks who you are.
    await expect(page.getByTestId("comment-input")).toBeHidden();
    await expect(page.getByTestId("comment-identity-prompt")).toBeVisible();
    await page.getByTestId("comment-identify-ada-lovelace").click();

    // Choosing an identity reveals the composer and records it in the sidebar.
    const input = page.getByTestId("comment-input");
    await expect(input).toBeVisible();
    await expect(page.getByTestId("identity-select")).toContainText("Ada Lovelace");

    // Post a comment that mentions another member.
    await input.fill("Kicking this off. @Grace can you review?");
    await page.getByTestId("add-comment").click();

    const list = page.getByTestId("comment-list");
    await expect(list).toContainText("Kicking this off.");
    await expect(list.getByText("Ada Lovelace")).toBeVisible();
    // The recognized @mention is highlighted.
    await expect(list.locator(".mention")).toHaveText("@Grace");
    // Composer clears after posting.
    await expect(input).toHaveValue("");

    // The comment is written into the card file with its author snapshot.
    await expect.poll(async () => (await snapshot(page)).cards[0].content).toContain('"authorId":"ada-lovelace"');
    expect((await snapshot(page)).cards[0].content).toContain('"authorName":"Ada Lovelace"');

    // Edit the comment; it gains an "(edited)" marker.
    const comment = page.locator('[data-testid^="comment-comment_"]').first();
    await comment.locator('[data-testid$="-edit"]').click();
    const editInput = comment.locator('[data-testid$="-edit-input"]');
    await editInput.fill("Kicking this off. Thanks @Grace!");
    await comment.locator('[data-testid$="-edit-save"]').click();
    await expect(comment).toContainText("Thanks @Grace!");
    await expect(comment.getByText("(edited)")).toBeVisible();

    // Delete it; the discussion returns to empty.
    await comment.locator('[data-testid$="-delete"]').click();
    await expect(page.getByTestId("comment-list")).toBeHidden();
    await expect(page.getByText("No comments yet")).toBeVisible();
    await expect.poll(async () => (await snapshot(page)).cards[0].content).toContain("comments: []");
  });

  test("comments are unavailable until a workspace has members", async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);

    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Solo Board");
    await page.getByTestId("text-dialog-submit").click();

    await page.getByTestId("add-card-todo").click();
    await page.getByTestId("text-dialog-input").fill("Lonely card");
    await page.getByTestId("text-dialog-submit").click();

    // No members defined yet, so there is nobody to comment as.
    await expect(page.getByTestId("comment-no-members")).toBeVisible();
    await expect(page.getByTestId("comment-input")).toBeHidden();
    await expect(page.getByTestId("comment-identity-prompt")).toBeHidden();
  });
});
