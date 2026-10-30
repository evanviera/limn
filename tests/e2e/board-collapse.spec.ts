import { test, expect } from "@playwright/test";
import type { Board } from "../../src/types";
import { openApp, openWorkspace, snapshot } from "./harness";

declare global {
  interface Window {
    __LIMN_BOARD_RACE__?: {
      readStarted: boolean;
      readCompleted: boolean;
      writeStarted: boolean;
      releaseRead: () => void;
      releaseWrite: () => void;
      collapsedAgain: boolean;
    };
  }
}

test("a duplicate board file cannot create a second sidebar entry or undo list expansion", async ({ page }) => {
  await openApp(page);
  await openWorkspace(page);
  await page.getByTestId("create-board").click();
  await page.getByTestId("text-dialog-input").fill("Shared board");
  await page.getByTestId("text-dialog-submit").click();
  await page.getByTestId("collapse-list-todo").click();
  await expect.poll(async () => {
    const board = JSON.parse((await snapshot(page)).boards[0].content) as Board;
    return board.lists[0].collapsed;
  }).toBe(true);
  const file = (await snapshot(page)).boards[0];
  const duplicateName = file.file_name.replace(/\.json$/, " 2.json");
  const duplicate = { ...JSON.parse(file.content), updatedAt: "2000-01-01T00:00:00.000Z" } as Board;
  await page.evaluate(({ name, board }) => window.__LIMN_E2E__!.externalEditBoard(name, board),
    { name: duplicateName, board: duplicate });
  await expect(page.getByText(/duplicates board ID/)).toBeVisible();
  const nav = page.getByTestId(`board-nav-${duplicate.id}`);
  await expect(nav).toHaveCount(1);
  const list = page.getByTestId("list-todo");
  await expect(list).toHaveClass(/collapsed/);
  await page.getByTestId("collapse-list-todo").click();
  await expect(list).not.toHaveClass(/collapsed/);
  await expect.poll(async () => {
    const current = (await snapshot(page)).boards.find(value => value.file_name === file.file_name)!;
    return Boolean((JSON.parse(current.content) as Board).lists[0].collapsed);
  }).toBe(false);

  // Another watcher refresh must keep using the writable canonical file, even
  // though the stale duplicate sorts before it and still has collapsed: true.
  const previousReads = (await snapshot(page)).loadWorkspaceCount;
  await page.evaluate(({ name, board }) => window.__LIMN_E2E__!.externalEditBoard(name, board),
    { name: duplicateName, board: duplicate });
  await expect.poll(async () => (await snapshot(page)).loadWorkspaceCount).toBeGreaterThan(previousReads);
  await expect(nav).toHaveCount(1);
  await expect(list).not.toHaveClass(/collapsed/);
  await openApp(page, { reset: false });
  await expect(nav).toHaveCount(1);
  await expect(list).not.toHaveClass(/collapsed/);
  const preserved = (await snapshot(page)).boards.find(value => value.file_name === duplicateName)!;
  expect(JSON.parse(preserved.content)).toEqual(duplicate);
});

for (const delayWrite of [false, true]) {
  test(`expanding a list survives a stale workspace refresh${delayWrite ? " while its save is pending" : " after its save"}`, async ({ page }) => {
    await openApp(page);
    await openWorkspace(page);
    await page.getByTestId("create-board").click();
    await page.getByTestId("text-dialog-input").fill("Workflow Board");
    await page.getByTestId("text-dialog-submit").click();
    await page.getByTestId("collapse-list-todo").click();
    await expect.poll(async () => {
      const board = JSON.parse((await snapshot(page)).boards[0].content) as Board;
      return board.lists[0].collapsed;
    }).toBe(true);
    await openApp(page, { reset: false });
    const list = page.getByTestId("list-todo");
    await expect(list).toHaveClass(/collapsed/);

    // Hold an already-captured disk snapshot, just like a slow cloud read.
    await page.evaluate(delayWrite => {
      const ipc = window.__LIMN_TEST_IPC__!;
      const invoke = ipc.invoke.bind(ipc);
      let releaseRead = () => {};
      let releaseWrite = () => {};
      const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
      const writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
      const state = { readStarted: false, readCompleted: false, writeStarted: false,
        releaseRead, releaseWrite, collapsedAgain: false };
      window.__LIMN_BOARD_RACE__ = state;
      ipc.invoke = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
        if (delayWrite && command === "write_board_file" && !state.writeStarted) {
          state.writeStarted = true;
          await writeGate;
        }
        const result = await invoke<T>(command, args);
        if (command === "load_workspace" && !state.readStarted) {
          state.readStarted = true;
          await readGate;
          state.readCompleted = true;
        }
        return result;
      };
      const file = window.__LIMN_E2E__!.snapshot().boards[0];
      window.__LIMN_E2E__!.externalEditBoard(file.file_name, JSON.parse(file.content));
    }, delayWrite);
    await page.waitForFunction(() => window.__LIMN_BOARD_RACE__!.readStarted);
    await page.getByTestId("collapse-list-todo").click();
    await expect(list).not.toHaveClass(/collapsed/);
    if (delayWrite) await page.waitForFunction(() => window.__LIMN_BOARD_RACE__!.writeStarted);

    // Observe even a brief re-collapse that a later watcher read might repair.
    await list.evaluate(element => {
      new MutationObserver(records => {
        if (element.classList.contains("collapsed") || records.some(record => record.oldValue?.split(" ").includes("collapsed"))) {
          window.__LIMN_BOARD_RACE__!.collapsedAgain = true;
        }
      }).observe(element, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
      window.__LIMN_BOARD_RACE__!.releaseRead();
    });
    await page.waitForFunction(() => window.__LIMN_BOARD_RACE__!.readCompleted);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await page.evaluate(() => window.__LIMN_BOARD_RACE__!.collapsedAgain)).toBe(false);
    await expect(list).not.toHaveClass(/collapsed/);
    await page.evaluate(() => window.__LIMN_BOARD_RACE__!.releaseWrite());
    await expect.poll(async () => {
      const board = JSON.parse((await snapshot(page)).boards[0].content) as Board;
      return Boolean(board.lists[0].collapsed);
    }).toBe(false);
    await openApp(page, { reset: false });
    await expect(list).not.toHaveClass(/collapsed/);

    // A genuinely newer external collapse must still be applied.
    await page.evaluate(() => {
      const file = window.__LIMN_E2E__!.snapshot().boards[0];
      const board = JSON.parse(file.content) as Board;
      board.lists[0].collapsed = true;
      board.lists[0].name = "Incoming work";
      board.updatedAt = "2026-12-01T00:00:00.000Z";
      window.__LIMN_E2E__!.externalEditBoard(file.file_name, board);
    });
    await expect(list).toHaveClass(/collapsed/);
    await expect(list.locator(".collapsed-list-title")).toHaveText("Incoming work");
  });
}
