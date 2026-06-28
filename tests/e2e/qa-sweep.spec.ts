import { test, expect, type ConsoleMessage } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openApp, openWorkspace, snapshot } from "./harness";

/**
 * QA evidence sweep — opt-in, run via `QA_SWEEP=1 npx playwright test qa-sweep`.
 *
 * This is NOT a pass/fail test. It drives Limn into every representative UI
 * state, screenshots each surface, and records console errors / page errors and
 * ARIA snapshots into `qa-artifacts/`. The `limn-qa` skill then reads those
 * artifacts (plus the source) to produce a findings report. It does not assert
 * on the UI, so it won't "fail" on the very issues it's meant to surface.
 *
 * Skipped during normal `npm run test:e2e` so the smoke suite stays fast.
 */
test.skip(!process.env.QA_SWEEP, "QA sweep is opt-in; set QA_SWEEP=1 to run.");

const ARTIFACTS = path.resolve(process.cwd(), "qa-artifacts");

// Bound every action so an optional `.catch()` step can't eat the whole test
// budget waiting on an element that never becomes actionable.
test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 8000 });

test("qa evidence sweep", async ({ page }, testInfo) => {
  // Capture is single-shot; give it room and don't let one slow step abort it.
  test.setTimeout(180_000);

  rmSync(ARTIFACTS, { recursive: true, force: true });
  mkdirSync(ARTIFACTS, { recursive: true });

  const consoleEvents: Array<{ type: string; text: string; location?: string }> = [];
  const pageErrors: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      const loc = msg.location();
      consoleEvents.push({
        type: msg.type(),
        text: msg.text(),
        location: loc?.url ? `${loc.url}:${loc.lineNumber}:${loc.columnNumber}` : undefined
      });
    }
  });
  page.on("pageerror", (err) => pageErrors.push(err.stack ?? err.message));

  const captured: string[] = [];
  let n = 0;
  async function shot(name: string, opts: { fullPage?: boolean } = {}) {
    const file = `${String(++n).padStart(2, "0")}-${name}.png`;
    await page.screenshot({ path: path.join(ARTIFACTS, file), fullPage: opts.fullPage ?? false });
    captured.push(file);
  }
  // ariaSnapshot is a cheap structural a11y view (roles/names) per surface.
  async function aria(name: string) {
    const snap = await page.locator("body").ariaSnapshot();
    writeFileSync(path.join(ARTIFACTS, `aria-${name}.yaml`), snap);
  }

  // Wrap each surface so a single broken flow doesn't lose the rest of the run.
  async function step(title: string, fn: () => Promise<void>) {
    try {
      await test.step(title, fn);
    } catch (err) {
      consoleEvents.push({ type: "sweep-error", text: `step "${title}" failed: ${String(err)}` });
    }
  }

  await step("welcome", async () => {
    await openApp(page);
    await shot("welcome");
    await aria("welcome");
  });

  await step("open workspace -> empty board shell", async () => {
    await openWorkspace(page);
    await shot("board-shell-empty");
  });

  await step("create board", async () => {
    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("QA Board");
    await shot("text-dialog");
    await aria("text-dialog");
    await page.getByTestId("text-dialog-submit").click();
    await shot("board-empty");
  });

  await step("add two lists", async () => {
    for (const name of ["To Do", "Doing"]) {
      await page.getByTestId("add-list").click();
      await page.getByTestId("text-dialog-input").fill(name);
      await page.getByTestId("text-dialog-submit").click();
      await expect(page.getByTestId("text-dialog-input")).toBeHidden();
    }
    await shot("board-with-lists");
  });

  function firstAddCardTestId(): Promise<string> {
    return page.locator('[data-testid^="add-card-"]').first().getAttribute("data-testid").then((v) => v ?? "");
  }

  await step("add a plain card", async () => {
    const addCard = await firstAddCardTestId();
    await page.getByTestId(addCard).click();
    await page.getByTestId("text-dialog-input").fill("Write the launch email");
    await page.getByTestId("text-dialog-submit").click();
    // Adding a card opens its editor (card auto-selected).
    await expect(page.getByTestId("card-title-input")).toBeVisible();
    await shot("card-editor");
    await aria("card-editor");
  });

  await step("card editor: subtasks, completion, due, labels", async () => {
    await page.getByTestId("card-due-input").fill("2026-07-15");
    await page.getByTestId("card-labels-input").fill("launch, urgent");
    for (const item of ["Draft copy", "Get review", "Schedule send"]) {
      await page.getByTestId("add-subtask").click();
      const lastTitle = page.locator('[data-testid^="subtask-"][data-testid$="-title"]').last();
      await lastTitle.fill(item).catch(() => {});
    }
    // Mark one subtask complete so the board shows the completed treatment.
    await page.locator('[data-testid^="subtask-"][data-testid$="-toggle"]').first().check().catch(() => {});
    await page.getByTestId("card-completed-input").check().catch(() => {});
    await shot("card-editor-filled", { fullPage: true });
    await page.getByTestId("card-notes-input").fill("Coordinate with Slack announcement.\nDouble-check the date.");
    await page.getByTestId("save-card").click();
    await shot("board-with-card");
  });

  await step("keyboard focus visibility on board", async () => {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await shot("keyboard-focus-1");
    await page.keyboard.press("Tab");
    await shot("keyboard-focus-2");
  });

  await step("narrow viewport overflow check (board)", async () => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await shot("board-narrow-1024");
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await step("confirm (destructive) dialog", async () => {
    // Open the editor again and trigger the delete confirmation, then cancel.
    const card = page.locator('[data-testid^="card-"]').first();
    await card.click();
    await expect(page.getByTestId("card-title-input")).toBeVisible();
    await page.getByTestId("delete-card").click();
    await expect(page.getByTestId("confirm-dialog-submit")).toBeVisible();
    await shot("confirm-dialog-destructive");
    await aria("confirm-dialog");
    // Dismiss deterministically via the dialog's own Cancel button (Escape on
    // stacked modals is ambiguous — left for the agent to probe directly).
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).first().click();
    await expect(page.getByTestId("confirm-dialog-submit")).toBeHidden();
    // Close the still-open editor modal so it doesn't block the sidebar nav.
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("card-title-input")).toBeHidden();
  });

  await step("members view", async () => {
    await page.getByTestId("nav-members").click();
    await shot("members-empty");
    await page.getByTestId("member-name-input").fill("Ada Lovelace");
    await page.getByTestId("add-member").click();
    await shot("members-with-one");
    await aria("members");
  });

  await step("settings view", async () => {
    await page.getByTestId("nav-settings").click();
    await shot("settings");
    await aria("settings");
    await page.getByTestId("slack-webhook-input").fill("https://hooks.slack.com/services/FAKE/FAKE/FAKE");
    await shot("settings-filled");
  });

  // Persist the collected diagnostics alongside the screenshots.
  const finalSnapshot = await snapshot(page).catch(() => null);
  writeFileSync(
    path.join(ARTIFACTS, "diagnostics.json"),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        viewport: { width: 1440, height: 900 },
        screenshots: captured,
        consoleErrorsAndWarnings: consoleEvents,
        pageErrors,
        harnessSnapshot: finalSnapshot
      },
      null,
      2
    )
  );

  await testInfo.attach("qa-diagnostics", {
    path: path.join(ARTIFACTS, "diagnostics.json"),
    contentType: "application/json"
  });

  // Intentionally no UI assertions — this run only gathers evidence.
  expect(captured.length).toBeGreaterThan(0);
});
