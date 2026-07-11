# Beta QA Report: Limn

- **Date:** 2026-07-11
- **Tester role:** Expert productivity-app user, non-developer
- **Target:** Limn 0.6.2, Vite dev server at `http://127.0.0.1:1420/?limnE2e`
- **Environment:** macOS 26.5.1, Codex in-app browser, desktop-width pass plus 390x844 narrow viewport check
- **Scenario:** Planned a Q3 client launch for Redwood Labs: created a workspace board, added team members, created launch cards, assigned owners, added labels, due dates, checklist items, notes, comments, saved a filtered view, reloaded for day-two persistence, checked narrow-window behavior, and tried correction/delete flows.
- **Recommendation:** Use after fixes

## Executive Summary

Limn is already useful as a local-first task board for a small team. The board defaults, card detail model, notes rendering, checklist links, labels, due dates, identity-based comments, filter view, and saved views all fit real project work better than a plain spreadsheet and feel lighter than Asana or Notion.

I would use this for a small trusted project after fixing one trust-damaging feedback issue: a normal solo card save produced a banner saying Limn merged edits from another device. That message makes me question whether the app saw a conflict or rewrote my data, even though the edited content persisted correctly.

## Workflow Coverage

| Workflow | Result | Notes |
| --- | --- | --- |
| First-run setup | Pass with caveat | `?limnE2e` workspace opening worked. Plain Vite URL without the harness showed the same welcome screen but could not open a workspace. |
| Core happy path | Pass | Created board, members, cards, due dates, labels, notes, checklist, comment, and saved filter view. |
| Editing and correction | Issue | Edits persisted, but save feedback falsely implied a multi-device merge. Empty card title validation recovered clearly. |
| Error recovery | Pass | Delete card flow showed a specific confirmation naming the card and explaining file removal; cancel preserved the card. |
| Return/reload persistence | Pass | On the non-reset harness URL, reload restored workspace tab, board, card note, label, due date, assignee, active identity, and saved view chip. |
| Keyboard/narrow viewport | Issue | Narrow DOM remained reachable, but the board depends on horizontal column scrolling at 390px. Keyboard-only coverage was light. |

## Would I Use It?

For a small trusted team, yes after the misleading merge banner is fixed. The app has a practical local-first niche: it gives me Trello-like board structure while keeping work in readable files. For a launch checklist or client project, I would prefer it over Apple Notes or a spreadsheet because cards can carry due dates, owners, labels, comments, and checklist links without becoming a mess.

It would not replace Notion for long-form docs or Asana for large team dependency tracking. It could replace a Trello board for a small team if sync conflict messaging feels reliable.

## Bugs

### Medium: Normal Solo Save Reports a Cross-Device Merge

- **Surface:** Card editor save feedback
- **Steps:** Create a board and card. In the card editor, change title, move list, set due date, add labels, assign members, add a note, add a checklist link, add a comment, then click Save.
- **Actual:** The card saved and closed, but the board banner said: "Merged edits from another device into the card."
- **Expected:** A normal save should say the card was saved, or show no conflict-style message. Merge/conflict language should appear only when another device or disk copy was actually involved.
- **Impact:** This undermines trust in a local-first app. As a user, I would wonder whether my card conflicted, whether another teammate changed it, or whether some edits were auto-merged unexpectedly.
- **Evidence:** Observed in the DOM after saving the edited card during the Redwood Labs scenario. The edited card content persisted correctly afterward.

### Medium: Plain Browser Dev Target Looks Usable But Cannot Open a Workspace

- **Surface:** First-run welcome screen at `http://127.0.0.1:1420/`
- **Steps:** Open the Vite dev URL without `?limnE2e`. Click "Open workspace folder."
- **Actual:** The welcome screen remains unchanged. Console-visible errors show missing Tauri IPC (`invoke`) and listener callback failures.
- **Expected:** Either the browser target should show a clear "desktop shell required" message, or the documented browser QA path should be the only exposed/testable target.
- **Impact:** A beta tester or contributor can lose time on a target that appears valid but cannot perform the first core action.
- **Evidence:** `reports/assets/2026-07-11-beta-qa-limn/web-open-workspace-click.png` was captured during this step, though browser screenshot output was blank in this environment.

### Low: Empty Card Submit Remains Enabled

- **Surface:** Add card dialog
- **Steps:** Click Add card, leave Card title empty, click Add card.
- **Actual:** The submit button is enabled; after clicking, the dialog shows "Card title is required" and does not create a blank card.
- **Expected:** Disable the submit button until a non-empty title exists, or focus the field with validation before attempting submission.
- **Impact:** Minor friction. Recovery is clear, but the enabled button invites a predictable failed action.
- **Evidence:** Observed in the Add card dialog during the persistence scenario.

## Usability Notes and Opinions

### Card Depth Is Strong

- **Observation:** Notes, links, labels, due date, assignees, checklist progress, and comments all persisted and resurfaced in both card detail and board summary.
- **Why it matters:** This is enough structure for real launch/project tracking without feeling like a heavy project-management suite.
- **Suggestion:** Keep the card detail model; it is the strongest part of the product right now.

### Filter Is Useful But Completed/Done Language Can Confuse

- **Observation:** The Filter view defaults to Active cards, so a completed card disappears from results. The check-in area also shows "Done," while the board has a separate Done list.
- **Why it matters:** In board tools, users often treat Done as a list/column. Here it can also mean completed status.
- **Suggestion:** Consider using "Completed" consistently in the Filter check-in, or explaining that the default view hides completed cards.

### Saved Views Feel Worth Keeping

- **Observation:** A text filter could be saved as "Quote follow-ups" / "Reload checks"; the saved view chip survived reload.
- **Why it matters:** Recurring task review is where a local board becomes a daily tool instead of a one-off checklist.
- **Suggestion:** Consider restoring the last active saved view after reload, or making it clearer that saved views are available chips rather than session state.

### Narrow View Is Serviceable, Not Mobile-First

- **Observation:** At 390px width the board stayed contained, but columns extended horizontally inside the board area.
- **Why it matters:** This is acceptable for quick review, but not ideal for long mobile editing sessions.
- **Suggestion:** Treat narrow-width support as a secondary "review/check status" mode unless mobile editing is a product goal.

## Questions

- Is the misleading merge banner specific to the browser harness, or can it happen in the packaged Tauri app?
- Should completed cards remain in their current list by design, or should completing a card optionally move it to Done?
- Should saved filters restore automatically after reload, or is the board intentionally the default return view?

## Coverage Gaps

- Did not exercise the packaged Tauri app's native folder picker, real filesystem writes, real attachment file picker, or OS-level drag/drop.
- Did not verify Slack webhook posting, updater behavior, actual `.ics` file contents, or real cloud-sync conflict files.
- Screenshot capture through the in-app browser produced blank dark images in this environment, so this report relies mainly on DOM observations and interaction outcomes.
- Keyboard-only testing was limited; modal focus and common button labels were checked indirectly through accessible roles, but a full tab-order pass remains needed.
