# Limn E2E / UI QA (Playwright)

Browser-driven UI tests and a harness for agentic UI/UX debugging. Playwright
drives the real React UI against the Vite dev server; the `?limnE2e` harness
([`src/testHarness.ts`](../../src/testHarness.ts)) mocks all Tauri IPC in the
browser, so no Tauri window is needed.

> The harness only loads in Vite **DEV** mode, so tests run against
> `npm run dev:vite` — Playwright starts/reuses it automatically
> (see [`playwright.config.ts`](../../playwright.config.ts)).

## Commands

```bash
npm run test:e2e          # headless run
npm run test:e2e:headed   # watch it drive a real browser
npm run test:e2e:ui       # Playwright UI mode (time-travel, picker)
npm run test:e2e:report   # open the last HTML report
```

Target a single file/test: `npx playwright test smoke -g "welcome"`.

## Writing a test

```ts
import { test, expect } from "@playwright/test";
import { openApp, openWorkspace, snapshot } from "./harness";

test("…", async ({ page }) => {
  await openApp(page);        // navigates to /?limnE2e&resetLimnE2e (clean state)
  await openWorkspace(page);  // welcome → mock workspace → board shell
  // drive the UI with page.getByTestId(...) — selectors live on real controls
  const state = await snapshot(page); // inspect mocked boards/cards/members/slack
});
```

## Conventions

- **Select by `data-testid`** (e.g. `create-board`, `text-dialog-input`,
  `nav-settings`). Grep `src/App.tsx` for the full list; don't break these.
- **Assert on harness state** via `snapshot(page)` rather than re-reading the
  DOM when you want to confirm persistence.
- Native `window.prompt`/`confirm` are stubbed by the harness; the app uses
  `TextDialog`/`ConfirmDialog` (`text-dialog-*`, `confirm-dialog-submit`).
- For UI/UX QA, capture evidence with `await page.screenshot({ path: … })` or
  rely on `screenshot: only-on-failure` / `trace: on-first-retry` in the config.
