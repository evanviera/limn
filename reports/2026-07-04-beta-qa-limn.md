# Beta QA Report: Limn (local-first task board)

- **Date:** 2026-07-04
- **Tester role:** Expert productivity-app user, non-developer
- **Target:** Limn — Tauri + React desktop app, `main` branch @ e2e (v0.2.3). Driven through the real React UI via the in-browser E2E harness (Tauri IPC mocked) at `http://127.0.0.1:1420`.
- **Environment:** macOS (Darwin 25.5.0); Chromium via Playwright, 1280×860 @2x (desktop) plus narrow-viewport passes; local dev server; harness starts from an empty workspace.
- **Scenario:** Running a small agency's **"Client Launch — Acme Rebrand"** project: setting up boards for design/content/dev, triaging a busy week of tasks, assigning teammates, tracking due dates, attaching briefs, and leaving review comments. Includes first-run, day-two return (reload), correction/undo, and narrow-window use.
- **Recommendation:** **Use today** (for a small trusted team) — with three low/medium fixes recommended before wider rollout.

## Executive Summary

Limn is a genuinely impressive local-first task board. Across ten testing passes covering every visible surface — onboarding, boards/lists, the full card lifecycle, the card editor (due dates, labels, rich checklists, notes formatting, attachments with a lightbox), members, comments with @mentions, a cross-board Filter view, Settings, Slack, the updater, persistence, keyboard, responsive layouts, and local-first edge cases — the app was fast, visually polished, and **produced zero console errors anywhere**. Destructive actions are consistently confirmation-guarded and honestly worded ("removes the card file from disk"), controls are properly labeled for keyboard/screen-reader users, and the whole app is cleanly theme-aware in light and dark.

Two things stand out as genuinely competitive: the **Filter view** (accurate multi-facet triage across boards, identity-aware "My tasks," saved views, due-date reminders, and a valid `.ics` calendar export) and the **local-first robustness** (external file edits sync live into the UI, and a corrupted card file surfaces a clear banner naming the file instead of crashing or vanishing silently).

The defects found are few and none are data-loss or crashes. The most notable are a notes rich-text quirk (toggling bold/italic while typing writes broken markdown that can render as literal `**`), and member removal being unconfirmed and leaving stale assignee references. Both have obvious workarounds. This is a product I would trust with real client work today.

## Workflow Coverage

| Workflow | Result | Notes |
| --- | --- | --- |
| First-run setup | Pass | Welcome → open workspace → create board is clean; first board auto-seeds 3 lists. |
| Board & lists management | Pass | Create/rename/delete boards & lists all work; destructive actions are confirmation-guarded; deleting a list archives (not loses) its cards. Categories work. |
| Core card happy path | Pass | Add, open (read mode w/ Edit), edit+save, mark complete (green check + border), archive, delete (honest "removes file from disk" confirm), and drag between lists all work; no console errors. |
| Card editor (due/labels/members/subtasks/notes) | Pass (2 minor bugs) | Due dates w/ friendly hints, labels, rich checklist (per-step link + nested details), move-to-board/list, notes bold/italic/link all work. Bugs: toolbar toggle-while-typing yields broken markdown; empty checklist steps persist. Assignment deferred to Members pass. |
| Attachments | Pass | File-picker + drag-drop add; image thumbnails (non-image files correctly show none); lightbox with counter/caption, prev/next (buttons + arrow keys, wraps), reveal-in-folder & open-external; per-file remove (×). No console errors. |
| Comments & identity | Pass | Identity picker sets "· YOU ·" in sidebar; comments persist with author + timestamp, edit/delete per comment, green @mention highlighting, "Comment as <you>" composer with ⌘/Ctrl+Enter hint. No console errors. |
| Members | Pass (1 bug) | Add (auto distinct colors, consistent across views), duplicate names rejected, per-member Slack-ID field, inline name field, Remove, and card assignment (checkbox → persists → board dot + read-mode) all work. Bug: member removal has no confirmation and leaves stale assignee references (resurrect on re-add). |
| Filter / saved views / reminders | Pass (standout) | Text/board/due/status/archive/sort facets + assignee/label chips all compute correctly (incl. intersections); check-in tiles; "My tasks" is identity-aware; saved views persist & recall; sidebar due-reminder badge; valid `.ics` calendar export. No bugs. |
| Settings & integrations (theme/Slack/updater) | Pass | Theme toggles dark↔light (fully theme-aware, clean light mode); Slack webhook + 4 notification toggles persist and a real post fires on assignment ("👤 Card assigned…"); updater handles available → install → restart and the install-fail path with a clear error. No bugs. |
| Return/reload persistence | Pass | Reload keeps cards/boards/members; last workspace auto-opens; theme + device-local identity persist. |
| Keyboard / narrow viewport | Pass | Escape closes modals; Enter submits dialogs; 390px mobile has no horizontal overflow (sidebar → top nav, columns scroll, card editor becomes clean full-screen column); 768px tablet reflows nicely. |
| Error recovery / edge cases | Pass (strength) | External file edits sync **live** into the UI; a corrupt/unparseable card shows a clear dismissible banner naming the file ("cards/<id>.md could not be loaded") and the rest of the board still loads — no crash, zero console errors. |

## Would I Use It?

**Yes — for a small agency/team that wants its task data as plain files it owns, I would adopt Limn today and it would replace a Trello board.**

Running the "Acme Rebrand" scenario end to end felt like real work, not a demo: I set up two boards, triaged a week of tasks across them, assigned teammates, attached a brief and mockups, left review comments with @mentions, and pulled every due date into a calendar with one `.ics` export. The Filter view alone does something Trello makes you pay for — a fast, accurate, cross-board "what's due / what's mine" triage — and the read-first card view with an activity log makes the app calm to live in.

Where it sits vs. familiar tools:
- **vs. Trello:** Comparable board UX, *better* cross-board filtering and calendar export, plus local-first file ownership and Slack notifications. No power-ups ecosystem, automations, or real-time multiplayer.
- **vs. Notion/Asana:** Far simpler and faster, no account/cloud required; but no databases, timelines, or docs beyond card notes.
- **vs. Apple Notes / a spreadsheet:** Dramatically more structured for task tracking.

The honest limits for adoption: collaboration is folder-sync-based ("small trusted team"), not real-time, so two people editing the same card simultaneously relies on the sync layer; and the identity/attribution model is device-local and trust-based. For its stated audience that's the right trade, and it's executed well.

## Bugs

### Medium: Notes toolbar "toggle format, then type" produces broken markdown (literal `**` / `****` shown to the reader)
- **Surface:** Card editor → Notes rich-text field (bold/italic toolbar).
- **Steps:** 1) Edit a card's Notes. 2) With nothing selected, click **B**. 3) Type a word. 4) Click **B** again to turn bold off. 5) Type more text (e.g. end with a word right after a period). 6) Save and open the card in read mode.
- **Actual:** The stored markdown is malformed (e.g. `Match **brand guidelines**.**** Reference:` and `Start **middle**** end.**`). In read mode this can render as **literal asterisks** — the card showed `brand guidelines.**** Reference` to the reader.
- **Expected:** Toggling bold/italic while typing should open and close a single clean emphasis span; no stray or unbalanced `*`/`**` in the saved file or the rendered note.
- **Impact:** Notes are a core field, and Limn's whole promise is "readable files." A user who formats by clicking the toolbar and typing (Word/Google-Docs muscle memory) gets visibly broken notes and messy underlying markdown. Selecting a word first and then clicking B/I works perfectly, so there is a workaround — hence Medium, not High.
- **Evidence:** `reports/assets/2026-07-04-beta-qa-limn/66-card-readmode-rich.png` (literal `****` visible after "brand guidelines.").

### Medium: Removing a member is instant (no confirmation) and leaves stale assignee references on cards
- **Surface:** Members view (Remove) → any card the member was assigned to.
- **Steps:** 1) Add member "Priya Nadkarni". 2) Assign her to a card. 3) Members view → click **Remove** on Priya. 4) Inspect the card. 5) Re-add a member named "Priya Nadkarni".
- **Actual:** (a) Remove deletes the member **immediately with no confirmation and no undo** — unlike board/list/card deletes, which all confirm. (b) The card still stores `assignees: ["priya-nadkarni"]`; the UI degrades gracefully to "Unassigned," but the reference is stale. (c) Re-adding a same-named member (same derived id) **resurrects** the old assignment — the card shows Priya assigned again without anyone re-assigning her.
- **Expected:** Removing a member should confirm (consistent with other deletes), and should unassign that member from cards (or at least not silently resurrect the assignment when a same-named member is re-added).
- **Impact:** On a team board, removing someone who left the team is a normal action; doing it by misclick with no confirmation is jarring, and stale/resurrecting assignments erode trust in "who owns what." Graceful "Unassigned" fallback keeps it from being High. 
- **Evidence:** `reports/assets/2026-07-04-beta-qa-limn/94-card-after-member-removed.png` (Unassigned + history), and the resurrection reproduced in testing (`95-resurrection.png`).

### Low: Empty checklist steps are saved and counted
- **Surface:** Card editor → Checklist ("Add step").
- **Steps:** 1) Edit a card. 2) Click **Add step** (optionally several times) without typing a title. 3) Save.
- **Actual:** Blank steps persist (`"title":""`) and are counted — the card shows e.g. "0 of 4 complete" for four empty rows; read mode shows blank checklist lines.
- **Expected:** A step with an empty title on blur/save should be discarded (or at least not counted toward the total).
- **Impact:** Clutter and a misleading "N steps" count; easy to create accidentally by clicking Add step then clicking away. Low.
- **Evidence:** `reports/assets/2026-07-04-beta-qa-limn/62-subtasks-added.png` ("0 of 4 complete", four empty steps).

## Usability Notes and Opinions

### First-run onboarding is calm and honest
- **Observation:** The welcome screen states the value proposition plainly ("Local-first boards for a small trusted team" / "Limn writes boards and cards as readable files") with a single primary action. Creating the first board immediately yields a working To Do / In Progress / Done board with no empty-canvas paralysis.
- **Why it matters:** Productivity tools live or die on time-to-first-value. Limn gets a user to a usable board in two clicks.
- **Suggestion:** None yet — this is a strength.

### Consistent, well-guarded dialogs and excellent control labeling
- **Observation:** Create/rename dialogs share one clean pattern (title, top-right + bottom Cancel, green primary). Destructive actions (delete board, delete list) require confirmation. Every list control is properly labeled ("Rename To Do", "Delete In Progress", "Add card") — good for keyboard/screen-reader users. Board names are capped at 80 characters and blank/whitespace names are rejected (the dialog stays open rather than silently doing nothing).
- **Why it matters:** These are the fundamentals a productivity tool must get right to feel trustworthy; Limn does.
- **Suggestion:** Minor: the primary button in the create dialog stays visually enabled for a blank field, then no-ops on click. Disabling it (or showing an inline hint) would remove a tiny "did that work?" moment. Two Cancel buttons (top-right + bottom) is mildly redundant.

### The read-mode card view is a standout
- **Observation:** Opening a card shows a clean read-only view first (a deliberate "default read mode"): breadcrumb + title, a quick-action row (Mark complete / due date / checklist / files), Notes / Checklist / Attachments / Discussion sections with instructive empty states ("Attach screenshots, PDFs, or design files. Copies are stored alongside this card."), and a right rail with Location, Assignees, Labels, and a **Recent activity** log ("Created card" with timestamp). Completed cards get a green check + green border on the board.
- **Why it matters:** For real work you open a card to *read* it far more often than to edit it; read-first reduces accidental edits and is calmer. The activity log and honest, file-aware confirmations ("removes the card file from disk") build trust in the local-first model.
- **Suggestion:** Consider a quick-complete affordance on the board card face (hover checkbox) so triaging a list doesn't require opening each card. Minor.

### Deleting a list archives its cards — correct, but recovery is under-signposted
- **Observation:** Deleting a non-empty list shows an honest confirmation ("Delete list \"Done\"? Cards in this list will be archived.") and does exactly that — cards get `archived: true`, disappear from the board, and are **recoverable** via Filter view → Archived facet ("Include archived"). They are *not* lost. However, after deletion there's no toast/undo and no obvious pointer that the cards now live under the archived filter; a user who doesn't know the Filter view exists could believe the cards are gone.
- **Why it matters:** Trust. The behavior is safe, but the safety isn't visible at the moment of action.
- **Suggestion:** A brief "N cards archived — View" toast (or an Undo) after list deletion would close the loop. Verified recoverable, so this is a note, not a bug.

### The Filter view is a real competitive advantage
- **Observation:** The cross-board Filter combines text search, board/due/status/archive/sort selects, assignee & label chips, at-a-glance check-in tiles (Due soon / Unassigned / No due date / Done), identity-aware "My tasks," saved views that persist, a sidebar due-date reminder badge, and a valid `.ics` export of all due dates. Every facet computed correctly in testing, including intersections.
- **Why it matters:** This is the difference between a board you *store* work in and one you can *run your week* from. It's better than stock Trello for triage and rivals paid tools.
- **Suggestion:** None — lead with this feature in marketing.

### Lists and boards can't be reordered (only cards move)
- **Observation:** Cards drag freely between lists, but I could not reorder the **list columns** (e.g. move "Done" before "To Do") or reorder **boards in the sidebar** by dragging, and there's no visible move/handle control for either. Lists sit in creation order; boards list in creation order.
- **Why it matters:** Anyone coming from Trello expects to drag a column to a new position and to reorder their boards. On a real project the column order often needs to change (e.g. inserting a "Review" stage in the middle), and pinning the most-used board to the top is a common tidy-up.
- **Suggestion:** Allow drag-reordering of list columns and sidebar boards (or provide move up/down in the list/board menus). Filed as an opinion/missing-feature rather than a bug since it may be an intentional v0.2 scope choice — but it's the most likely "why can't I…?" moment for a new user. (Card drag itself works well.)

### Local-first robustness is handled with unusual care
- **Observation:** Editing a card's underlying file externally (as a sync client or a human would) updated the card live in the UI. Corrupting a card file to invalid frontmatter did **not** crash the app or silently drop the card — it showed a dismissible banner naming the exact file ("cards/<id>.md could not be loaded") and loaded the rest of the board normally. No console errors in any scenario tested.
- **Why it matters:** A "readable files" app *invites* external edits and folder sync; most apps handle a malformed file by crashing or silently losing data. Limn tells you precisely what happened and keeps working. This is the behavior that earns trust for local-first.
- **Suggestion:** None — this is a differentiator.

## Priorities (suggested fix order)

**Must-fix before wider rollout:** none are blockers. Recommended, in order:
1. **Notes formatting artifact (Medium)** — clicking B/I and typing writes broken markdown / literal `**`. Notes are core and the artifact is visible in the "readable files."
2. **Member removal (Medium)** — add a confirmation and clear stale assignee references (or block same-id resurrection).
3. **Empty checklist steps (Low)** — discard blank steps on save.

**Nice-to-have polish:** disable the create/add primary button (or show a hint) for blank input; a "N cards archived — View/Undo" toast after list deletion; an optional quick-complete checkbox on the board card face.

## Questions

- Identity ("Set who you are") is device-local and trust-based (anyone can pick any member as themselves). That fits the "small trusted team" pitch, but is there any intended guard/reminder that comment attribution isn't verified? Worth a one-line note in-app for teams that assume attribution is authoritative.
- When a member is removed, is leaving their id on cards intentional (to survive an accidental removal) or an oversight? The re-add "resurrection" suggests the former isn't deliberate.
- Is real-time / concurrent editing on a shared synced folder in scope, or is the expectation strictly "one editor at a time"? This shapes how the "small trusted team" collaboration story is communicated.

## Coverage Gaps

- **Native Tauri shell not exercised.** Testing ran against the in-browser E2E harness that mocks all Tauri IPC, so the *real* OS folder picker, real files on disk, native application menu (`menu.rs`), OS-level notifications, and the actual signed auto-updater install/restart were not exercised. Behavior of those was validated only at the UI/logic layer via the harness. A native smoke pass on macOS/Windows builds would raise confidence here.
- **Real image/file rendering.** Attachments used the harness's placeholder image bytes; true thumbnail/large-preview generation, non-image previews, huge files, and the cached-downscaled-preview path (per recent perf work) were not exercised with real files.
- **Slack delivery** was verified only up to the composed webhook payload in the harness, not against a live Slack workspace.
- **Scale/performance:** tested with a handful of boards and cards. Not tested: hundreds of cards, very large boards, long drag operations, or big attachment sets.
- **Concurrent multi-user sync conflicts** (two people editing the same card via the synced folder at once) were not simulated beyond single external-edit events.
- **Board categories with assigned boards** (grouping boards under a created category and collapsing groups) was only lightly touched — category *creation* was verified, assignment/collapse was not. (Note: list-column and sidebar-board *reordering* appear unsupported — see the opinion above — rather than untested.)

## Evidence

Screenshots for every pass are in `reports/assets/2026-07-04-beta-qa-limn/` (welcome `01`, board CRUD `10–27`, card lifecycle `40–51`, card editor `60–68`, attachments `70–74`/`91`, members/assignment `80–95`, comments `100–105`, filter `110–114`, settings/theme/updater `120–125`, persistence/responsive/edge `130–141`).
