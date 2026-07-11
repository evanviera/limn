# Beta QA Report: Limn

- **Date:** 2026-07-11
- **Tester role:** Expert productivity-app user, non-developer
- **Target:** Limn 0.6.3 web test surface at `http://127.0.0.1:1420/?limnE2e`
- **Environment:** macOS, Codex in-app browser, standard desktop viewport plus 390 × 844 narrow viewport; local Vite server; Tauri IPC replaced by the product's browser test harness
- **Scenario:** Plan a small-team Q3 launch, create and advance a task, add notes/checklist/due date/label, add teammates, assign ownership, @mention a teammate, retrieve work through Filter, resize, and return after reload
- **Recommendation:** **Use after fixes**
- **Patch status (2026-07-11):** ✅ All three reported bugs fixed in commit `973297d`, each with e2e regression coverage. Build, storage, Rust, and Playwright suites pass. Original findings are preserved below with a **Resolution** note appended to each.

## Executive Summary

Limn already has a coherent product core. It is fast to understand, pleasant to look at, and unusually good at keeping a task lightweight while still supporting notes, checklists, attachments, ownership, due dates, labels, comments, and activity. I could move from an empty workspace to a credible team task without documentation. Reload persistence passed, and the Filter view is more useful than a typical early-stage board app because it combines search, facets, quick views, check-in counts, saved views, and calendar export.

I would not yet move a real team onto it. The largest issue observed was a false “Merged edits from another device” message after ordinary same-device work (**since fixed — see Bugs**). In a local-first tool, sync/conflict feedback is part of the trust contract; false alarms make users question whether work was overwritten. Beyond that defect, the product still feels closer to an excellent shared board than a complete daily productivity home. It needs a clearer first-run collaboration model, a stronger personal action surface, faster capture, and more legible narrow-window behavior.

## Workflow Coverage

| Workflow | Result | Notes |
| --- | --- | --- |
| First-run setup | Pass with usability gaps | Folder-first promise is clear; no guided explanation of how sharing, identity, backup, or multi-device edits work. |
| Core happy path | Pass | Created a board and a detailed card, then moved it to In Progress. |
| Editing and correction | Pass | Notes, checklist, label, due date, list, assignment, comments, and mention entry all worked. |
| Error recovery | Pass | Empty member submission produced a clear inline message. No console warnings/errors appeared. |
| Return/reload persistence | Pass | Board, card content, list, due date, label, members, assignment, and comment remained after reload. |
| Keyboard/narrow viewport | Issue | Comment shortcut worked. Narrow layout remains operable, but navigation consumes substantial vertical space and the board requires horizontal panning with clipped context. |

## Would I Use It?

After the sync-feedback issue is fixed, I would use Limn for a trusted two-to-five-person team that wants Trello-like coordination without placing its project data in a hosted SaaS. The readable-folder premise is genuinely differentiating, and the card details are better balanced than Trello's increasingly busy card surface.

Today I would use it as a project board alongside a calendar and notes app, not as the place I begin and end my workday. Compared with Todoist or Asana it lacks a convincing personal command center and rapid capture loop. Compared with Notion it is much clearer and faster, but it offers less structure for project briefs and durable knowledge. Its best path is not to become a general-purpose workspace; it is to become the most trustworthy, focused, local-first execution board for a small team.

## Bugs

> **Status: all fixed (2026-07-11, commit `973297d`).** Each bug below carries a **Resolution** note describing the fix and its regression test.

### Medium: False cross-device merge message after ordinary same-device edits — ✅ Fixed

- **Surface:** Global status banner shown on Filter after card discussion and editing
- **Steps:**
  1. Create a card and save notes, a checklist step, label, due date, and list change.
  2. Add members and post a comment from the current identity.
  3. Reopen the card, assign another member, and save.
  4. Open Filter.
- **Actual:** Limn displayed “Merged edits from another device into the card.” No other device or external edit participated in the test.
- **Expected:** Normal same-device saves should complete quietly. Cross-device merge copy should appear only when Limn has actually reconciled concurrent changes.
- **Impact:** Users may believe a teammate or sync provider changed their files, or fear that part of their own edit was lost. That undermines the central local-first trust proposition.
- **Evidence:** [filter-merge-banner.png](assets/2026-07-11-beta-qa-limn/filter-merge-banner.png)
- **Reproducibility:** Observed once in one complete scenario; repeat on the native build before release triage.
- **Resolution:** Fixed. Root cause: while a card was open, immediately-persisted actions (posting a comment, adding an attachment, toggling a checklist step) wrote the card to disk and bumped its version, but the editor's merge base stayed pinned to the version the card was opened at. The next editor Save then compared that stale base against the newer disk copy, the compare-and-swap "conflicted", a clean three-way merge ran, and the outcome was reported as a cross-device merge. `persistCard` now advances the editor's merge base on a clean write to the open card, so same-device saves complete quietly. Genuine external-edit merges still report correctly. Covered by the e2e regression *"an immediately-persisted comment does not make the next editor save look like a cross-device merge"* (`tests/e2e/card-editor.spec.ts`). **Note:** originally observed on the browser test surface; a native two-client pass is still worth doing before release for full confidence.

### Medium: Plain browser dev target looks usable but cannot open a workspace — ✅ Fixed

- **Surface:** First-run welcome screen at the Vite URL without `?limnE2e`
- **Steps:** Open `http://127.0.0.1:1420/` and click “Open workspace folder.”
- **Actual:** The welcome screen remains unchanged; the earlier pass recorded missing desktop-shell IPC errors.
- **Expected:** Show a clear “desktop app required” state, or route browser-based testers to the supported harness target.
- **Impact:** Beta testers and contributors can mistake a nonfunctional surface for the product and fail at the first action.
- **Evidence:** Prior-pass notes and `reports/assets/2026-07-11-beta-qa-limn/web-open-workspace-click.png`.
- **Resolution:** Fixed. A new `hasDesktopShell()` check detects when neither the Tauri shell nor the `?limnE2e` test harness is present. In that case the welcome screen now shows a clear “Limn needs the desktop app to open a workspace folder” state (and points contributors to the `?limnE2e` harness) instead of a non-functional Open button; `openWorkspace` also guards the IPC call so it can never throw into the void. Covered by the e2e regression *"a plain browser tab (no desktop shell) explains it needs the desktop app"* (`tests/e2e/board.spec.ts`).

### Low: Empty card submit remains enabled — ✅ Fixed

- **Surface:** Add card dialog
- **Steps:** Open Add card, leave the title empty, and submit.
- **Actual:** The enabled button accepts the click, then displays “Card title is required” without creating a card.
- **Expected:** Disable submission until a non-empty title exists, or focus the field and validate before the attempted submit.
- **Impact:** Recovery is safe and clear, but the interface invites a predictable failed action.
- **Evidence:** Prior pass observation.
- **Resolution:** Fixed. The shared text dialog's submit button is now disabled until a non-whitespace title exists, removing the failed-submit round-trip. This applies to every text dialog (all require a non-empty value), and existing validation (e.g. duplicate-name checks) still runs on submit. Covered by the e2e regression *"the add-card dialog blocks submission until a title is typed"* (`tests/e2e/board.spec.ts`).

## Usability Notes and Opinions

### The first five minutes are clear, but the local-first collaboration model is not

- **Observation:** The welcome screen explains that Limn writes readable files and asks for a folder. After opening one, the user immediately sees boards, identity, members, and Slack settings, but no guided explanation connects them.
- **Why it matters:** A hosted board app quietly owns sync, permissions, backup, and identity. Limn delegates those choices to the user's folder provider, so users need to understand who can access the workspace, how teammates open it, what “You” means, and what happens during concurrent edits.
- **Suggestion:** Add a short first-workspace checklist: name the workspace, choose your identity, invite/share via the folder's existing mechanism, explain backups, and show what conflict recovery looks like. Keep it skippable.

### Filter is promising, but personal work should feel like a destination

- **Observation:** Filter has quick views, check-in counts, rich facets, saved views, and `.ics` export. “My tasks” is one chip among many, and the sidebar has no persistent personal work entry.
- **Why it matters:** Team members return to productivity software to answer “What do I need to do now?” A board-centric navigation model makes that question secondary to project structure.
- **Suggestion:** Promote a personal Today/My Work surface with overdue, due soon, assigned-without-date, and recently mentioned sections. Let it become the default return view per device.

The earlier pass also found that “Done” can refer both to a board list and to completed status, while Filter hides completed cards by default. Use “Completed” consistently for status or explicitly explain the distinction. Saved-view chips persisted across reload and are worth keeping; consider letting users choose a saved view as their per-device default.

### Capture is clean but not yet fast enough for all-day use

- **Observation:** Adding a card requires choosing a list, opening a dialog, entering a title, then opening the full editor for meaningful details. I did not find a global quick-add or command surface in the visible UI.
- **Why it matters:** During meetings, triage, and email processing, users need to capture a task without navigating back to a specific board/list.
- **Suggestion:** Add a global quick-add action with title-first entry and optional board/list, assignee, and natural-language due date. A keyboard shortcut should work from anywhere.

### Narrow-window board use preserves functionality but loses orientation

- **Observation:** At 390 × 844, workspace tabs and expanded navigation take roughly the upper half of the screen. The board then presents fixed-width columns horizontally; the next column and card are clipped, and long board names truncate in both navigation and the page heading.
- **Why it matters:** Desktop productivity apps are often used beside a browser, document, or meeting window. Narrow split-screen is more important than phone support for Limn.
- **Suggestion:** Collapse the sidebar/navigation behind a compact control at narrow widths, preserve the full board name through a tooltip or secondary detail, and consider a one-column/list-switcher mode for very narrow windows.
- **Evidence:** [board-narrow.png](assets/2026-07-11-beta-qa-limn/board-narrow.png), [filter-narrow.png](assets/2026-07-11-beta-qa-limn/filter-narrow.png)

### The card detail hierarchy is excellent

- **Observation:** Read mode gives status, notes, checklist, attachments, discussion, properties, and activity without exposing every editing control. Edit mode adds controls without turning the card into a settings form.
- **Why it matters:** This supports both quick review and deeper planning, and is a meaningful advantage over productivity tools whose task dialogs become visually exhausting.
- **Suggestion:** Preserve this read/edit separation as the product expands. Resist adding more always-visible fields; use progressive disclosure.

### Slack configuration appears before the core team ritual is established

- **Observation:** Settings offers a webhook and event switches, while the product does not yet visibly establish a native inbox, mention center, or daily review loop.
- **Why it matters:** External notifications can create noise and dependency before users know where Limn itself expects them to process changes.
- **Suggestion:** Prioritize an in-app activity/mention inbox and notification hygiene. Position Slack as an optional delivery channel for defined team events, not the main collaboration backstop.

### Missing capabilities that most constrain product-market fit

These are product gaps observed from the visible experience, not defects:

- A personal Today/My Work home and mention/activity inbox.
- Global rapid capture and a command palette/keyboard navigation model.
- A simple share/onboarding explanation for folder-based collaboration, identity, backup, and conflict recovery.
- Recurring tasks or lightweight routines for operational teams.
- Board templates for common small-team workflows so the empty state does not force process design.
- Stronger planning context above the card level: a board brief, goal/outcome, owner, and target date would be enough; Limn does not need to become a document editor.
- Native reminders surfaced inside Limn, not only calendar export or Slack events.

## Questions

- Is the automatic selection of the first created member as “You” intentional? It is convenient, but the transition happens without explanation and could misattribute comments on a shared computer.
- What is the intended sharing instruction for iCloud Drive, Dropbox, OneDrive, NAS, or Git-backed folders, and which are officially supported?
- Is the Filter view intended to become the personal home, or is a dedicated My Work experience planned?
- What guarantee should users infer from a successful Save: written locally, synced by the folder provider, or merely queued? The UI should name only the guarantee Limn can make.

## Coverage Gaps

- Native Tauri folder picker, filesystem permissions, watcher behavior, offline cloud placeholders, and OS menus were not tested because this pass used the browser test surface.
- Attachments were not added because the browser harness does not represent the full native file workflow.
- Real concurrent editing, conflict review/resolution, and cloud-provider behavior were not exercised; these deserve a dedicated two-client native test.
- Slack delivery and updater behavior were not exercised against external services.
- Multi-workspace tab switching, calendar export file contents, large-board performance, drag-and-drop, archive recovery, destructive confirmations, screen-reader output, and full keyboard-only traversal remain for follow-up passes.
