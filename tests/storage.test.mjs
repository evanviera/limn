import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addActivity, attachmentDisplayName, attachmentStoredName, createBoard, createCard, createComment, parseCard, parseWorkspace, serializeCard } from "../.tmp/storage-test/src/storage.js";
import { ORDER_STEP, compareCardsByOrder, nextOrderForList, placeInList } from "../.tmp/storage-test/src/lib/ordering.js";
import { buildCalendar, describeDue, dueReminderCount } from "../.tmp/storage-test/src/lib/dueDate.js";
import {
  EMPTY_FILTER,
  FILTER_PRESETS,
  UNASSIGNED_ASSIGNEE,
  collectLabels,
  filterCards,
  filterIsActive,
  matchesDue
} from "../.tmp/storage-test/src/lib/filter.js";
import {
  mergeBoard,
  mergeCard,
  mergeMembers,
  mergeSettings,
  threeWayListById,
  threeWayScalar,
  threeWayStringSet
} from "../.tmp/storage-test/src/lib/merge.js";
import { resolveConflictWrite } from "../.tmp/storage-test/src/lib/mergeWrite.js";
import { buildConflict, buildConflicts } from "../.tmp/storage-test/src/lib/conflicts.js";
import { listNameTriggersMoveNotification, parseMovedToListNames } from "../.tmp/storage-test/src/lib/notifications.js";
import { cardDeepLink, parseCardDeepLink } from "../.tmp/storage-test/src/lib/deepLink.js";
import { buildInboxItems, inboxSeenAtKey, inboxUnreadCount, isInboxItemUnread } from "../.tmp/storage-test/src/lib/inbox.js";
import { buildRecurringSuccessor, nextRecurrenceDate, normalizeRecurrence, recurrenceValidation } from "../.tmp/storage-test/src/lib/recurrence.js";

const baseCard = {
  id: "card_one",
  title: "Title: with colon and \"quotes\"",
  boardId: "board_one",
  listId: "todo",
  assignees: ["ada", "grace"],
  labels: ["bug, parser", "external edit"],
  due: "2026-07-01",
  order: 3000,
  completed: false,
  archived: false,
  createdAt: "2026-06-27T00:00:00.000Z",
  updatedAt: "2026-06-27T01:00:00.000Z",
  activity: [
    {
      id: "activity_one",
      type: "created",
      message: "Created card",
      createdAt: "2026-06-27T00:00:00.000Z"
    }
  ],
  subtasks: [
    {
      id: "subtask_one",
      title: "Open the brief",
      completed: true,
      url: "https://example.com/brief",
      items: [
        { id: "subtask_item_one", text: "Read the launch checklist", url: "" },
        { id: "subtask_item_two", text: "Reference brief", url: "https://example.com/reference" }
      ]
    },
    { id: "subtask_two", title: "Review with team", completed: false, url: "", items: [] }
  ],
  attachments: [
    { id: "att_one", name: "screenshot.png", storedName: "att_one-screenshot.png", size: 20480, addedAt: "2026-06-27T00:30:00.000Z" },
    { id: "att_two", name: "spec, final.pdf", storedName: "att_two-spec__final.pdf", size: 1048576, addedAt: "2026-06-27T00:31:00.000Z" }
  ],
  comments: [
    { id: "comment_one", authorId: "ada", authorName: "Ada Lovelace", body: "Kicking this off — @grace can you review?", createdAt: "2026-06-27T00:40:00.000Z" },
    { id: "comment_two", authorId: "grace", authorName: "Grace Hopper", body: "On it.\nWill report back.", createdAt: "2026-06-27T00:45:00.000Z", editedAt: "2026-06-27T00:46:00.000Z" }
  ],
  body: "Notes with --- inside the body stay intact.\nSecond line.\n",
  fileName: "card_one.md"
};

// --- Inbox projection + device-local unread high-water mark ---
const inboxMembers = [
  { id: "ada", name: "Ada Lovelace", color: "#000" },
  { id: "grace", name: "Grace Hopper", color: "#111" }
];
const inboxItems = buildInboxItems([
  baseCard,
  {
    ...baseCard,
    id: "card_two",
    archived: false,
    assignees: ["grace"],
    comments: [
      { id: "other", authorId: "ada", authorName: "Ada Lovelace", body: "A regular follow-up.", createdAt: "2026-06-27T00:38:00.000Z" },
      { id: "self", authorId: "grace", authorName: "Grace Hopper", body: "note to @Grace", createdAt: "2026-06-27T00:50:00.000Z" }
    ],
    activity: [
      { id: "assigned", type: "assigned", message: "Assigned", createdAt: "2026-06-27T00:30:00.000Z" },
      { id: "moved", type: "moved", message: "Moved", createdAt: "2026-06-27T00:35:00.000Z" },
      { id: "completed", type: "completed", message: "Complete", createdAt: "2026-06-27T00:36:00.000Z" },
      { id: "updated", type: "updated", message: "Updated", createdAt: "2026-06-27T00:37:00.000Z" }
    ]
  },
  { ...baseCard, id: "archived", archived: true }
], "grace", inboxMembers);
assert.deepEqual(inboxItems.map((item) => item.kind), ["mention", "comment", "completed", "moved", "assigned"]);
assert.equal(inboxItems[0].label, "Ada Lovelace mentioned you");
assert.equal(inboxItems[1].label, "Ada Lovelace commented");
assert.equal(inboxItems.filter((item) => item.kind === "mention").length, 1);
assert.equal(inboxUnreadCount(inboxItems, "2026-06-27T00:34:00.000Z"), 4);
assert.equal(isInboxItemUnread(inboxItems.at(-1), "2026-06-27T00:30:00.000Z"), false);
assert.equal(inboxSeenAtKey("/work:space", "grace"), "limn:inbox:seenAt:/work:space:grace");

const roundTripped = parseCard(serializeCard(baseCard), baseCard.fileName);
assert.deepEqual(roundTripped, baseCard);

// --- Recurrence: local-calendar cadence, validation, serialization, and copies ---
assert.equal(nextRecurrenceDate("2026-07-01", { interval: 3, unit: "day" }, "2026-07-01"), "2026-07-04");
assert.equal(nextRecurrenceDate("2026-07-01", { interval: 2, unit: "week" }, "2026-07-01"), "2026-07-15");
assert.equal(nextRecurrenceDate("2026-01-31", { interval: 1, unit: "month", anchorDay: 31 }, "2026-01-31"), "2026-02-28");
assert.equal(nextRecurrenceDate("2026-02-28", { interval: 1, unit: "month", anchorDay: 31 }, "2026-02-28"), "2026-03-31");
assert.equal(nextRecurrenceDate("2026-07-20", { interval: 3, unit: "day" }, "2026-07-01"), "2026-07-23", "early completion keeps cadence");
assert.equal(nextRecurrenceDate("2026-07-01", { interval: 3, unit: "day" }, "2026-07-20"), "2026-07-22", "late completion skips missed dates");
for (const interval of [0, -1, 1.5, Number.NaN]) {
  assert.match(recurrenceValidation({ interval, unit: "day" }, "2026-07-01"), /positive whole number/);
}
assert.match(recurrenceValidation({ interval: 1, unit: "day" }, ""), /requires a due date/);
assert.equal(normalizeRecurrence({ interval: 0, unit: "day" }, "2026-07-01"), undefined);

const recurringCard = {
  ...baseCard,
  recurrence: { interval: 1, unit: "month", anchorDay: 31 },
  recurrenceNextId: "card_successor",
  completed: true
};
assert.deepEqual(parseCard(serializeCard(recurringCard), recurringCard.fileName), recurringCard);
const successor = buildRecurringSuccessor(recurringCard, "2026-07-10", "2026-07-10T12:00:00.000Z");
assert.ok(successor);
assert.equal(successor.id, "card_successor");
assert.equal(successor.due, "2026-08-31");
assert.equal(successor.completed, false);
assert.equal(successor.archived, false);
assert.deepEqual(successor.labels, recurringCard.labels);
assert.deepEqual(successor.assignees, recurringCard.assignees);
assert.equal(successor.body, recurringCard.body);
assert.equal(successor.subtasks.every((item) => !item.completed), true);
assert.deepEqual(successor.attachments, []);
assert.deepEqual(successor.comments, []);
assert.equal(successor.activity.length, 1);
assert.equal(successor.activity[0].type, "created");
assert.equal(successor.recurrenceSourceId, recurringCard.id);
assert.equal(successor.recurrenceNextId, undefined);
assert.notStrictEqual(successor.subtasks, recurringCard.subtasks);

const legacyWithoutRecurrence = parseCard(serializeCard(baseCard), baseCard.fileName);
assert.equal(legacyWithoutRecurrence.recurrence, undefined);

// createComment snapshots author + name and stamps id/createdAt; no editedAt yet.
const freshComment = createComment("ada", "Ada Lovelace", "  Trimmed on the way in  ");
assert.equal(freshComment.authorId, "ada");
assert.equal(freshComment.authorName, "Ada Lovelace");
assert.equal(freshComment.body, "  Trimmed on the way in  ");
assert.equal(freshComment.editedAt, undefined);
assert.match(freshComment.id, /^comment_/);

// New cards start with an empty discussion.
assert.deepEqual(createCard("board_one", "todo", "Fresh").comments, []);

// --- Precise card ordering ---

// New cards default to order 0 (unordered / due-date mode) and round-trip.
assert.equal(createCard("board_one", "todo", "Fresh").order, 0);
assert.equal(parseCard(serializeCard(baseCard), baseCard.fileName).order, 3000);

// nextOrderForList: an all-unordered list stays in due-date mode (0); a curated
// list appends below its current maximum.
assert.equal(nextOrderForList([]), 0);
assert.equal(nextOrderForList([{ order: 0 }, { order: 0 }]), 0);
assert.equal(nextOrderForList([{ order: 1000 }, { order: 3000 }]), 3000 + ORDER_STEP);

// compareCardsByOrder: order wins; equal orders fall back to due date.
const sortByOrder = (list) => list.slice().sort(compareCardsByOrder).map((card) => card.id);
assert.deepEqual(
  sortByOrder([
    { id: "b", order: 2000, due: "2026-01-01", createdAt: "", title: "" },
    { id: "a", order: 1000, due: "2026-12-01", createdAt: "", title: "" }
  ]),
  ["a", "b"]
);
assert.deepEqual(
  sortByOrder([
    { id: "later", order: 0, due: "2026-06-16", createdAt: "", title: "" },
    { id: "earlier", order: 0, due: "2026-06-14", createdAt: "", title: "" }
  ]),
  ["earlier", "later"]
);

// placeInList: a midpoint between spaced neighbours touches only the moved card.
const spacedSiblings = [{ id: "a", order: 1000 }, { id: "b", order: 2000 }, { id: "c", order: 3000 }];
const midPlacement = placeInList(spacedSiblings, 1);
assert.equal(midPlacement.order, 1500);
assert.deepEqual(midPlacement.rebalance, []);
assert.equal(placeInList(spacedSiblings, 0).order, 0);
assert.equal(placeInList(spacedSiblings, 3).order, 4000);
assert.equal(placeInList([], 0).order, ORDER_STEP);

// Inserting between equal (legacy zero) neighbours renormalizes the whole list
// to distinct, spaced orders and reports the siblings that changed.
const renormPlacement = placeInList([{ id: "a", order: 0 }, { id: "b", order: 0 }], 1);
assert.equal(renormPlacement.order, 2000);
assert.deepEqual(renormPlacement.rebalance, [{ id: "a", order: 1000 }, { id: "b", order: 3000 }]);

// --- Due-date workflow ---

const dueNow = new Date(2026, 6, 3, 12, 0, 0); // 2026-07-03 local, noon
assert.equal(describeDue("", dueNow).status, "none");
assert.equal(describeDue("bogus", dueNow).status, "none");
assert.equal(describeDue("2026-07-03", dueNow).status, "today");
assert.equal(describeDue("2026-07-03", dueNow).label, "Due today");
assert.equal(describeDue("2026-07-01", dueNow).status, "overdue");
assert.equal(describeDue("2026-07-01", dueNow).days, -2);
assert.equal(describeDue("2026-07-01", dueNow).label, "Overdue by 2 days");
assert.equal(describeDue("2026-07-04", dueNow).status, "soon");
assert.equal(describeDue("2026-07-04", dueNow).label, "Due tomorrow");
assert.equal(describeDue("2026-07-06", dueNow).status, "soon");
assert.equal(describeDue("2026-07-20", dueNow).status, "later");

// Reminder count = overdue + due-today among active (not completed/archived).
assert.equal(
  dueReminderCount(
    [
      { due: "2026-07-01", completed: false, archived: false },
      { due: "2026-07-03", completed: false, archived: false },
      { due: "2026-07-03", completed: true, archived: false },
      { due: "2026-07-01", completed: false, archived: true },
      { due: "2026-08-01", completed: false, archived: false }
    ],
    dueNow
  ),
  2
);

// buildCalendar emits one all-day VEVENT per dated entry, escaping TEXT values
// and skipping entries without a valid due date.
const ics = buildCalendar(
  [
    { uid: "card_x", title: "Ship, now; done", due: "2026-07-15", completed: true, description: "Board · Doing" },
    { uid: "card_y", title: "No date", due: "" }
  ],
  "My cal",
  new Date(Date.UTC(2026, 6, 3, 9, 30, 0))
);
assert.match(ics, /BEGIN:VCALENDAR/);
assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 1);
assert.match(ics, /DTSTART;VALUE=DATE:20260715/);
assert.match(ics, /DTEND;VALUE=DATE:20260716/);
assert.match(ics, /SUMMARY:✓ Ship\\, now\\; done/);
assert.match(ics, /DTSTAMP:20260703T093000Z/);

// --- Filter, presets, and saved views ---

const searchNow = new Date(2026, 6, 3, 12, 0, 0); // 2026-07-03 local, noon
const searchCards = [
  { id: "a", title: "Fix parser bug", body: "crash on newline", boardId: "b1", listId: "todo", assignees: ["ada"], labels: ["bug"], due: "2026-07-05", completed: false, archived: false, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-03T00:00:00.000Z" },
  { id: "b", title: "Write docs", body: "getting started guide", boardId: "b1", listId: "todo", assignees: [], labels: ["docs"], due: "", completed: false, archived: false, createdAt: "2026-07-02T00:00:00.000Z", updatedAt: "2026-07-04T00:00:00.000Z" },
  { id: "c", title: "Release notes", body: "", boardId: "b2", listId: "todo", assignees: ["grace"], labels: ["docs", "release"], due: "2026-07-01", completed: true, archived: false, createdAt: "2026-06-30T00:00:00.000Z", updatedAt: "2026-07-02T00:00:00.000Z" },
  { id: "d", title: "Old idea", body: "", boardId: "b2", listId: "todo", assignees: ["ada"], labels: [], due: "", completed: false, archived: true, createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-05T00:00:00.000Z" }
];
const runFilter = (overrides) => filterCards(searchCards, { ...EMPTY_FILTER, ...overrides }, searchNow).map((card) => card.id);

// The empty filter keeps active (not completed, not archived) cards, newest-updated first.
assert.deepEqual(runFilter({}), ["b", "a"]);

// Free text is AND-matched across title, notes, and labels (case-insensitive).
assert.deepEqual(runFilter({ text: "parser" }), ["a"]);
assert.deepEqual(runFilter({ text: "docs", completion: "any" }), ["b", "c"]);
assert.deepEqual(runFilter({ text: "release notes", completion: "any" }), ["c"]);
assert.deepEqual(runFilter({ text: "nomatch" }), []);

// Assignee facet matches ANY selected member; the sentinel matches the unassigned.
assert.deepEqual(runFilter({ assignees: ["ada"], completion: "any", archived: "any" }), ["a", "d"]);
assert.deepEqual(runFilter({ assignees: [UNASSIGNED_ASSIGNEE] }), ["b"]);

// Label facet matches ANY selected label; board facet scopes to one board.
assert.deepEqual(runFilter({ labels: ["docs"], completion: "any" }), ["b", "c"]);
assert.deepEqual(runFilter({ boardId: "b2", completion: "any", archived: "any" }), ["c", "d"]);

// Due facet is day-delta based.
assert.deepEqual(runFilter({ due: "soon" }), ["a"]);
assert.deepEqual(runFilter({ due: "none" }), ["b"]);
assert.deepEqual(runFilter({ due: "overdue", completion: "any" }), ["c"]);

// Completion + archived facets widen the default active scope.
assert.deepEqual(runFilter({ completion: "completed", archived: "any" }), ["c"]);
assert.deepEqual(runFilter({ archived: "archived" }), ["d"]);

// Sort options reorder the same result set.
assert.deepEqual(runFilter({ completion: "any", archived: "any", sort: "title" }), ["a", "d", "c", "b"]);
assert.deepEqual(runFilter({ completion: "any", archived: "any", sort: "created" }), ["b", "a", "c", "d"]);

// matchesDue classifies by whole-day delta.
assert.equal(matchesDue({ due: "2026-07-01" }, "overdue", searchNow), true);
assert.equal(matchesDue({ due: "2026-07-03" }, "today", searchNow), true);
assert.equal(matchesDue({ due: "2026-07-05" }, "soon", searchNow), true);
assert.equal(matchesDue({ due: "2026-07-20" }, "later", searchNow), true);
assert.equal(matchesDue({ due: "" }, "none", searchNow), true);
assert.equal(matchesDue({ due: "" }, "has", searchNow), false);
assert.equal(matchesDue({ due: "2026-07-05" }, "any", searchNow), true);

// collectLabels de-duplicates case-insensitively and sorts.
assert.deepEqual(collectLabels(searchCards), ["bug", "docs", "release"]);

// filterIsActive treats the empty filter as "not filtering".
assert.equal(filterIsActive(EMPTY_FILTER), false);
assert.equal(filterIsActive({ ...EMPTY_FILTER, text: "x" }), true);
assert.equal(filterIsActive({ ...EMPTY_FILTER, completion: "any" }), true);
assert.equal(filterIsActive({ ...EMPTY_FILTER, assignees: ["ada"] }), true);

// Presets build filters; "My tasks" scopes to the current identity (empty when unset).
const presetIds = FILTER_PRESETS.map((preset) => preset.id);
assert.deepEqual(presetIds, ["my-tasks", "due-soon", "recently-updated"]);
const myTasks = FILTER_PRESETS.find((preset) => preset.id === "my-tasks");
assert.deepEqual(myTasks.build("ada").assignees, ["ada"]);
assert.deepEqual(myTasks.build("").assignees, []);
assert.equal(myTasks.requiresIdentity, true);
assert.equal(FILTER_PRESETS.find((preset) => preset.id === "due-soon").build("").due, "soon");

// Attachment path helpers sanitize names and strip directory prefixes.
assert.equal(attachmentDisplayName("/Users/ada/Pictures/diagram final.png"), "diagram final.png");
assert.equal(attachmentDisplayName("C:\\Users\\ada\\report.pdf"), "report.pdf");
assert.equal(attachmentStoredName("att_abc", "My Report (v2).pdf"), "att_abc-My_Report_v2_.pdf");
assert.equal(attachmentStoredName("att_abc", "/tmp/.hidden config"), "att_abc-hidden_config");

// Cards written before sub-tasks existed have no `subtasks` line and default to [].
const legacyCard = parseCard(
  [
    "---",
    "id: card_legacy",
    "title: Legacy card",
    "boardId: board_one",
    "listId: todo",
    "assignees: []",
    "labels: []",
    "due: \"\"",
    "completed: false",
    "archived: false",
    "createdAt: 2026-06-27T00:00:00.000Z",
    "updatedAt: 2026-06-27T01:00:00.000Z",
    "activity: []",
    "---",
    "Body"
  ].join("\n"),
  "card_legacy.md"
);
assert.deepEqual(legacyCard.subtasks, []);
// Cards written before attachments existed have no `attachments` line and default to [].
assert.deepEqual(legacyCard.attachments, []);
// Cards written before comments existed have no `comments` line and default to [].
assert.deepEqual(legacyCard.comments, []);

const quotedFalse = parseCard(
  [
    "---",
    "id: \"card_two\"",
    "title: \"External card\"",
    "boardId: \"board_one\"",
    "listId: \"todo\"",
    "assignees: [\"ada\"]",
    "labels: [\"qa\"]",
    "due: \"\"",
    "completed: \"false\"",
    "archived: \"false\"",
    "createdAt: \"2026-06-27T00:00:00.000Z\"",
    "updatedAt: \"2026-06-27T01:00:00.000Z\"",
    "activity: []",
    "---",
    "Body"
  ].join("\r\n"),
  "card_two.md"
);
assert.equal(quotedFalse.completed, false);
assert.equal(quotedFalse.archived, false);
assert.equal(quotedFalse.body, "Body");

const workspace = parseWorkspace({
  settings: "{not-json",
  members: "{\"schemaVersion\":1,\"members\":\"bad\"}",
  boards: [
    {
      file_name: "board_one.json",
      content: JSON.stringify({
        schemaVersion: 1,
        id: "board_one",
        name: "Launch",
        lists: [],
        createdAt: "2026-06-27T00:00:00.000Z",
        updatedAt: "2026-06-27T00:00:00.000Z"
      })
    },
    { file_name: "bad.json", content: "{bad" }
  ],
  cards: [
    { file_name: "card_one.md", content: serializeCard(baseCard) },
    { file_name: "bad.md", content: "no frontmatter" }
  ],
  warnings: ["bad-utf8.md could not be read"]
});

assert.equal(workspace.settings.workspaceName, "Limn Workspace");
assert.deepEqual(workspace.settings.slackNotifications, {
  cardCompleted: true,
  cardAssigned: true,
  subtaskCompleted: true
});
assert.equal(workspace.settings.slackMovedToListNames, "Done");
assert.deepEqual(workspace.settings.boardGroups, []);
assert.deepEqual(workspace.settings.savedViews, []);
assert.deepEqual(workspace.membersFile.members, []);
assert.equal(workspace.boards.length, 1);
assert.equal(workspace.boards[0].groupId, undefined);
assert.equal(workspace.cards.length, 1);
assert.equal(workspace.diagnostics.length, 4);
assert(workspace.diagnostics.some((diagnostic) => diagnostic.includes("settings.json is invalid JSON")));
assert(workspace.diagnostics.some((diagnostic) => diagnostic.includes("boards/bad.json")));
assert(workspace.diagnostics.some((diagnostic) => diagnostic.includes("cards/bad.md")));
assert(workspace.diagnostics.some((diagnostic) => diagnostic.includes("bad-utf8.md")));

// Saved views round-trip through settings: valid views keep their filter,
// duplicate/missing ids are dropped, and each filter facet is normalized.
const savedViewWorkspace = parseWorkspace({
  settings: JSON.stringify({
    schemaVersion: 1,
    workspaceName: "Views",
    slackWebhookUrl: "",
    slackNotifications: {},
    boardGroups: [],
    savedViews: [
      {
        id: "view_1",
        name: "Blocking bugs",
        filter: { text: "bug", boardId: "b1", assignees: ["ada"], labels: ["docs"], due: "soon", completion: "any", archived: "active", sort: "due" },
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z"
      },
      { id: "view_1", name: "Duplicate id is dropped" },
      { name: "Missing id is dropped" },
      { id: "view_2", name: "Bad facets fall back", filter: { due: "bogus", completion: 5, sort: "nope", assignees: "x" } }
    ],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  }),
  members: JSON.stringify({ schemaVersion: 1, members: [] }),
  boards: [],
  cards: [],
  warnings: []
});
assert.equal(savedViewWorkspace.settings.savedViews.length, 2);
assert.deepEqual(savedViewWorkspace.settings.savedViews[0].filter, {
  text: "bug",
  boardId: "b1",
  assignees: ["ada"],
  labels: ["docs"],
  due: "soon",
  completion: "any",
  archived: "active",
  sort: "due"
});
assert.deepEqual(savedViewWorkspace.settings.savedViews[1].filter, {
  text: "",
  boardId: "",
  assignees: [],
  labels: [],
  due: "any",
  completion: "active",
  archived: "active",
  sort: "updated"
});

// Move-notification config migrates from the legacy `cardMovedToDone` boolean:
// an absent field defaults to "Done", but an explicit legacy `false` disables it.
const migratedDefault = parseWorkspace({
  settings: JSON.stringify({ schemaVersion: 1, workspaceName: "Legacy", slackWebhookUrl: "", slackNotifications: { cardMovedToDone: true, cardCompleted: true, cardAssigned: true, subtaskCompleted: true } }),
  members: JSON.stringify({ schemaVersion: 1, members: [] }),
  boards: [],
  cards: [],
  warnings: []
});
assert.equal(migratedDefault.settings.slackMovedToListNames, "Done");
assert.equal("cardMovedToDone" in migratedDefault.settings.slackNotifications, false);

const migratedDisabled = parseWorkspace({
  settings: JSON.stringify({ schemaVersion: 1, workspaceName: "Legacy", slackWebhookUrl: "", slackNotifications: { cardMovedToDone: false, cardCompleted: true, cardAssigned: true, subtaskCompleted: true } }),
  members: JSON.stringify({ schemaVersion: 1, members: [] }),
  boards: [],
  cards: [],
  warnings: []
});
assert.equal(migratedDisabled.settings.slackMovedToListNames, "");

// Move-notification list matching: comma-separated, trimmed, case-insensitive,
// de-duplicated; empty config and blank list names never match.
assert.deepEqual(parseMovedToListNames("Done, Shipped ,done"), ["done", "shipped"]);
assert.deepEqual(parseMovedToListNames("  ,  "), []);
assert.equal(listNameTriggersMoveNotification("Done", "done, shipped"), true);
assert.equal(listNameTriggersMoveNotification("  done  ", "Done"), true);
assert.equal(listNameTriggersMoveNotification("In Progress", "Done, Shipped"), false);
assert.equal(listNameTriggersMoveNotification("Done", ""), false);
assert.equal(listNameTriggersMoveNotification("", "Done"), false);

// --- Conflict-aware merge engine ---

// Field primitives: three-way scalar resolution.
assert.deepEqual(threeWayScalar("a", "a", "a"), { value: "a", conflict: false });
assert.deepEqual(threeWayScalar("a", "b", "a"), { value: "b", conflict: false }); // only ours changed
assert.deepEqual(threeWayScalar("a", "a", "c"), { value: "c", conflict: false }); // only theirs changed
assert.deepEqual(threeWayScalar("a", "b", "b"), { value: "b", conflict: false }); // both to same value
assert.deepEqual(threeWayScalar("a", "b", "c"), { value: "c", conflict: true }); // divergent -> keep theirs, flag

// Set merge: adds from either side union; a removal by either side wins.
assert.deepEqual(threeWayStringSet(["a", "b"], ["a", "b", "c"], ["a", "b", "d"]), ["a", "b", "c", "d"]);
assert.deepEqual(threeWayStringSet(["a", "b"], ["a"], ["a", "b"]), ["a"]); // ours removed b
assert.deepEqual(threeWayStringSet(["a", "b"], ["b", "a"], ["a", "b"]), ["b", "a"]); // our order preserved
assert.deepEqual(threeWayStringSet([], ["x"], ["x"]), ["x"]); // concurrent identical add

// Keyed-list merge: union of adds, honour deletes, keep an edit over a delete.
const listMerge = threeWayListById(
  [{ id: "1", v: "base" }, { id: "2", v: "base" }],
  [{ id: "1", v: "ours" }, { id: "2", v: "base" }, { id: "3", v: "new-ours" }],
  [{ id: "2", v: "base" }],
  { id: (item) => item.id, mergeItem: (b, o, t) => (JSON.stringify(o) === JSON.stringify(b) ? t : o) }
);
// id 1: ours edited it, theirs deleted -> our edit survives. id 2: unchanged, present. id 3: our add.
assert.deepEqual(listMerge, [{ id: "1", v: "ours" }, { id: "2", v: "base" }, { id: "3", v: "new-ours" }]);
// A delete of an untouched item is honoured.
assert.deepEqual(
  threeWayListById([{ id: "1", v: "b" }], [{ id: "1", v: "b" }], [], { id: (i) => i.id, mergeItem: (b, o, t) => t }),
  []
);

const mkCard = (overrides = {}) => ({
  id: "card_m",
  title: "Title",
  boardId: "b1",
  listId: "todo",
  assignees: [],
  labels: [],
  due: "",
  order: 0,
  completed: false,
  archived: false,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  activity: [],
  subtasks: [],
  attachments: [],
  comments: [],
  body: "",
  fileName: "card_m.md",
  ...overrides
});

// Card merge: structured data (labels, assignees, comments, activity) unions
// cleanly with no user involvement.
const cardBase = mkCard({ labels: ["bug"], assignees: ["ada"], comments: [{ id: "c1", authorId: "ada", authorName: "Ada", body: "hi", createdAt: "2026-07-01T00:00:00.000Z" }] });
const cardOurs = mkCard({
  labels: ["bug", "ui"],
  assignees: ["ada", "grace"],
  updatedAt: "2026-07-01T03:00:00.000Z",
  comments: [
    { id: "c1", authorId: "ada", authorName: "Ada", body: "hi", createdAt: "2026-07-01T00:00:00.000Z" },
    { id: "c2", authorId: "ada", authorName: "Ada", body: "our comment", createdAt: "2026-07-01T02:00:00.000Z" }
  ]
});
const cardTheirs = mkCard({
  labels: ["bug", "backend"],
  assignees: ["ada"],
  updatedAt: "2026-07-01T02:30:00.000Z",
  comments: [
    { id: "c1", authorId: "ada", authorName: "Ada", body: "hi", createdAt: "2026-07-01T00:00:00.000Z" },
    { id: "c3", authorId: "grace", authorName: "Grace", body: "their comment", createdAt: "2026-07-01T01:00:00.000Z" }
  ]
});
const cardMerged = mergeCard(cardBase, cardOurs, cardTheirs);
assert.equal(cardMerged.clean, true);
assert.deepEqual(cardMerged.value.labels, ["bug", "ui", "backend"]);
assert.deepEqual(cardMerged.value.assignees, ["ada", "grace"]);
// Comments from both sides are unioned and ordered by createdAt.
assert.deepEqual(cardMerged.value.comments.map((c) => c.id), ["c1", "c3", "c2"]);
// The merged version adopts the later of the two updatedAt values.
assert.equal(cardMerged.value.updatedAt, "2026-07-01T03:00:00.000Z");

// A field only one side changed is taken automatically, no conflict.
const dueOnlyTheirs = mergeCard(mkCard({ due: "" }), mkCard({ due: "" }), mkCard({ due: "2026-08-01", updatedAt: "2026-07-02T00:00:00.000Z" }));
assert.equal(dueOnlyTheirs.clean, true);
assert.equal(dueOnlyTheirs.value.due, "2026-08-01");

// Divergent free text (title / body) is a hard conflict the caller must preserve.
const titleClash = mergeCard(mkCard({ title: "A" }), mkCard({ title: "Ours" }), mkCard({ title: "Theirs" }));
assert.equal(titleClash.clean, false);
assert.deepEqual(titleClash.conflicts, ["title"]);
const bodyClash = mergeCard(mkCard({ body: "base" }), mkCard({ body: "ours body" }), mkCard({ body: "their body" }));
assert.deepEqual(bodyClash.conflicts, ["body"]);
// Structural clashes (both moved list) resolve to disk without a hard conflict.
const listClash = mergeCard(mkCard({ listId: "todo" }), mkCard({ listId: "doing" }), mkCard({ listId: "done" }));
assert.equal(listClash.clean, true);
assert.equal(listClash.value.listId, "done");

// Board merge: list renames reconcile, adds union, deletes are honoured.
const boardBase = { schemaVersion: 1, id: "b1", name: "Board", lists: [{ id: "todo", name: "To Do" }, { id: "doing", name: "Doing" }], createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" };
const boardOurs = { ...boardBase, updatedAt: "2026-07-01T02:00:00.000Z", lists: [{ id: "todo", name: "Backlog" }, { id: "doing", name: "Doing" }, { id: "review", name: "Review" }] };
const boardTheirs = { ...boardBase, updatedAt: "2026-07-01T01:00:00.000Z", lists: [{ id: "doing", name: "In Progress" }] };
const boardMerged = mergeBoard(boardBase, boardOurs, boardTheirs);
assert.equal(boardMerged.clean, true);
// todo: ours renamed it (theirs deleted, our edit wins). doing: theirs renamed. review: our add.
assert.deepEqual(boardMerged.value.lists, [{ id: "todo", name: "Backlog" }, { id: "doing", name: "In Progress" }, { id: "review", name: "Review" }]);
const boardNameClash = mergeBoard(boardBase, { ...boardBase, name: "Ours" }, { ...boardBase, name: "Theirs" });
assert.deepEqual(boardNameClash.conflicts, ["name"]);

// Settings merge: never hard-conflicts; different edits union.
const settingsBase = { schemaVersion: 1, workspaceName: "WS", slackWebhookUrl: "", slackMovedToListNames: "Done", slackNotifications: { cardCompleted: true, cardAssigned: true, subtaskCompleted: true }, boardGroups: [], savedViews: [], createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" };
const settingsOurs = { ...settingsBase, slackWebhookUrl: "https://hook", updatedAt: "2026-07-01T02:00:00.000Z", savedViews: [{ id: "v1", name: "Mine", filter: EMPTY_FILTER, createdAt: "x", updatedAt: "x" }] };
const settingsTheirs = { ...settingsBase, slackNotifications: { ...settingsBase.slackNotifications, cardCompleted: false }, updatedAt: "2026-07-01T01:00:00.000Z" };
const settingsMerged = mergeSettings(settingsBase, settingsOurs, settingsTheirs);
assert.equal(settingsMerged.clean, true);
assert.equal(settingsMerged.value.slackWebhookUrl, "https://hook"); // our change
assert.equal(settingsMerged.value.slackNotifications.cardCompleted, false); // their change
assert.equal(settingsMerged.value.savedViews.length, 1); // our added view

// Members merge: adds union, removals honoured, never hard-conflicts.
const membersBase = { schemaVersion: 1, updatedAt: "2026-07-01T00:00:00.000Z", members: [{ id: "ada", name: "Ada", color: "#111" }, { id: "grace", name: "Grace", color: "#222" }] };
const membersOurs = { ...membersBase, updatedAt: "2026-07-01T02:00:00.000Z", members: [{ id: "ada", name: "Ada Lovelace", color: "#111" }, { id: "grace", name: "Grace", color: "#222" }] };
const membersTheirs = { ...membersBase, updatedAt: "2026-07-01T01:00:00.000Z", members: [{ id: "ada", name: "Ada", color: "#111" }, { id: "alan", name: "Alan", color: "#333" }] };
const membersMerged = mergeMembers(membersBase, membersOurs, membersTheirs);
assert.equal(membersMerged.clean, true);
// ada: our rename wins. grace: theirs deleted, unchanged by us -> dropped. alan: their add.
assert.deepEqual(membersMerged.value.members.map((m) => `${m.id}:${m.name}`), ["ada:Ada Lovelace", "alan:Alan"]);

// --- Conflict-write orchestration ---

// A fake adapter drives resolveConflictWrite without any real IO.
function fakeAdapter({ script, merge }) {
  const writes = [];
  const attempts = [...script];
  return {
    log: writes,
    async write(content, expectedVersion) {
      writes.push({ content, expectedVersion });
      return attempts.shift();
    },
    merge,
    ours: () => "OURS",
    copies: writes,
    async writeConflictCopy() {
      writes.push({ copy: true });
      return ".workspace/conflicts/x_conflict_1.json";
    }
  };
}

// Clean first write -> "written".
{
  const adapter = fakeAdapter({ script: [{ conflict: false, currentContent: null }] });
  const outcome = await resolveConflictWrite("OURS", "v0", adapter);
  assert.equal(outcome.status, "written");
}

// Conflict, clean merge, retry lands -> "merged".
{
  const adapter = fakeAdapter({
    script: [
      { conflict: true, currentContent: "THEIRS" },
      { conflict: false, currentContent: null }
    ],
    merge: () => ({ content: "MERGED", conflict: false, theirsVersion: "v1" })
  });
  const outcome = await resolveConflictWrite("OURS", "v0", adapter);
  assert.equal(outcome.status, "merged");
  // The retry writes the merged content, CAS-ing against the disk version.
  assert.deepEqual(adapter.log[1], { content: "MERGED", expectedVersion: "v1" });
}

// Conflict, hard merge -> conflict copy preserved + best-effort merge written.
{
  const adapter = fakeAdapter({
    script: [
      { conflict: true, currentContent: "THEIRS" },
      { conflict: false, currentContent: null }
    ],
    merge: () => ({ content: "MERGED", conflict: true, theirsVersion: "v1" })
  });
  const outcome = await resolveConflictWrite("OURS", "v0", adapter);
  assert.equal(outcome.status, "conflict");
  assert.match(outcome.copyPath, /_conflict_/);
}

// Remote delete surfaces as "restored".
{
  const adapter = fakeAdapter({
    script: [
      { conflict: true, currentContent: null },
      { conflict: false, currentContent: null }
    ]
  });
  const outcome = await resolveConflictWrite("OURS", "v0", adapter);
  assert.equal(outcome.status, "restored");
  // The restore write is unconditional.
  assert.equal(adapter.log[1].expectedVersion, undefined);
}

// --- Conflict review: enumeration + resolution proposals ---

const emptyMembersFile = { schemaVersion: 1, members: [], updatedAt: "" };

// A card conflict copy is classified, paired with the live card, and offers a
// "keep mine", a lossless "merged" union, and a field-by-field comparison.
const conflictCard = mkCard({
  id: "card_c1",
  title: "Local title",
  body: "local body",
  labels: ["mine"],
  comments: [{ id: "cm_local", authorId: "ada", authorName: "Ada", body: "mine", createdAt: "2026-07-01T00:00:00.000Z" }],
  updatedAt: "2026-07-01T01:00:00.000Z",
  fileName: "card_c1.md"
});
const liveCard = mkCard({
  id: "card_c1",
  title: "Remote title",
  body: "remote body",
  labels: ["theirs"],
  comments: [{ id: "cm_remote", authorId: "grace", authorName: "Grace", body: "theirs", createdAt: "2026-07-01T00:30:00.000Z" }],
  updatedAt: "2026-07-01T02:00:00.000Z",
  fileName: "card_c1.md"
});
const cardEntities = { cards: [liveCard], boards: [], settings: null, membersFile: emptyMembersFile };

const cardConflict = buildConflict(
  { relative_path: "cards/card_c1_conflict_20260701.md", file_name: "card_c1_conflict_20260701.md", content: serializeCard(conflictCard) },
  cardEntities
);
assert.equal(cardConflict.kind, "card");
assert.equal(cardConflict.entityId, "card_c1");
assert.equal(cardConflict.parsed, true);
assert.equal(cardConflict.currentMissing, false);
// "Keep mine" writes the preserved copy to the real card file (not the copy name).
assert.equal(cardConflict.mine.kind, "card");
assert.equal(cardConflict.mine.card.title, "Local title");
assert.equal(cardConflict.mine.card.fileName, "card_c1.md");
assert.equal(cardConflict.mine.base.id, "card_c1");
// The proposed merge keeps the current on-disk text but unions both sides'
// structured data (no comment or label is dropped).
assert.equal(cardConflict.merged.card.title, "Remote title");
assert.deepEqual([...cardConflict.merged.card.labels].sort(), ["mine", "theirs"]);
assert.deepEqual(cardConflict.merged.card.comments.map((comment) => comment.id).sort(), ["cm_local", "cm_remote"]);
const titleRow = cardConflict.fields.find((field) => field.label === "Title");
assert.equal(titleRow.mine, "Local title");
assert.equal(titleRow.theirs, "Remote title");
assert.equal(titleRow.differs, true);

// A copy whose entity was deleted on disk is flagged as orphaned: it can be
// restored ("keep mine" with no base) but there is no merge target.
const orphanConflict = buildConflict(
  { relative_path: "cards/card_gone_conflict_1.md", file_name: "card_gone_conflict_1.md", content: serializeCard(mkCard({ id: "card_gone", title: "Ghost", fileName: "card_gone.md" })) },
  cardEntities
);
assert.equal(orphanConflict.currentMissing, true);
assert.equal(orphanConflict.merged, null);
assert.equal(orphanConflict.mine.base, undefined);

// A board conflict copy in .workspace/conflicts is classified from its stem and
// merged the same way (disk name wins, columns union).
const boardCopy = { schemaVersion: 1, id: "board_z", name: "Local board", lists: [{ id: "todo", name: "To Do" }, { id: "extra", name: "Extra" }], createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T01:00:00.000Z" };
const liveBoard = { schemaVersion: 1, id: "board_z", name: "Remote board", lists: [{ id: "todo", name: "To Do" }], createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T02:00:00.000Z" };
const boardConflict = buildConflict(
  { relative_path: ".workspace/conflicts/board_z_conflict_9.json", file_name: "board_z_conflict_9.json", content: `${JSON.stringify(boardCopy, null, 2)}\n` },
  { cards: [], boards: [liveBoard], settings: null, membersFile: emptyMembersFile }
);
assert.equal(boardConflict.kind, "board");
assert.equal(boardConflict.mine.board.name, "Local board");
assert.equal(boardConflict.merged.board.name, "Remote board");
assert.deepEqual(boardConflict.merged.board.lists.map((list) => list.id).sort(), ["extra", "todo"]);

// An unreadable copy still surfaces (for discard) but offers no resolution entity.
const unreadable = buildConflict(
  { relative_path: "cards/card_bad_conflict_1.md", file_name: "card_bad_conflict_1.md", content: "not frontmatter" },
  cardEntities
);
assert.equal(unreadable.parsed, false);
assert.equal(unreadable.mine, null);
assert.equal(unreadable.merged, null);

// Non-conflict file names are ignored by classification.
assert.equal(
  buildConflict({ relative_path: "cards/card_live.md", file_name: "card_live.md", content: serializeCard(mkCard()) }, cardEntities),
  null
);
const enumerated = buildConflicts(
  [
    { relative_path: "cards/card_c1_conflict_1.md", file_name: "card_c1_conflict_1.md", content: serializeCard(conflictCard) },
    { relative_path: "cards/plain.md", file_name: "plain.md", content: "x" }
  ],
  cardEntities
);
assert.equal(enumerated.length, 1, "non-conflict files are dropped from the review list");

const workspaceRoot = await mkdtemp(join(tmpdir(), "limn-storage-e2e-"));
try {
  await mkdir(join(workspaceRoot, ".workspace"), { recursive: true });
  await mkdir(join(workspaceRoot, "boards"), { recursive: true });
  await mkdir(join(workspaceRoot, "cards"), { recursive: true });

  const settings = {
    schemaVersion: 1,
    workspaceName: "Acceptance Workspace",
    slackWebhookUrl: "http://127.0.0.1:9/slack",
    slackMovedToListNames: "Shipped, Done",
    slackNotifications: {
      cardCompleted: false,
      cardAssigned: true,
      subtaskCompleted: false
    },
    boardGroups: [
      {
        id: "group_launch",
        name: "Launch",
        createdAt: "2026-06-27T00:00:00.000Z",
        updatedAt: "2026-06-27T00:00:00.000Z"
      }
    ],
    createdAt: "2026-06-27T00:00:00.000Z",
    updatedAt: "2026-06-27T00:00:00.000Z"
  };
  const membersFile = {
    schemaVersion: 1,
    members: [
      { id: "ada", name: "Ada Lovelace", color: "#2563eb", slackHandle: "@ada" },
      { id: "grace", name: "Grace Hopper", color: "#0f766e" }
    ]
  };
  const board = {
    ...createBoard("Launch Board"),
    id: "board_acceptance",
    groupId: "group_launch",
    lists: [
      { id: "todo", name: "To Do" },
      { id: "doing", name: "Doing" },
      { id: "done", name: "Done" }
    ],
    createdAt: "2026-06-27T00:00:00.000Z",
    updatedAt: "2026-06-27T00:00:00.000Z"
  };

  let card = {
    ...createCard(board.id, "todo", "Draft release notes"),
    id: "card_acceptance",
    fileName: "card_acceptance.md",
    title: "Draft release notes",
    assignees: ["ada"],
    labels: ["docs", "release"],
    due: "2026-07-01",
    attachments: [
      { id: "att_release", name: "notes.pdf", storedName: "att_release-notes.pdf", size: 4096, addedAt: "2026-06-27T00:00:00.000Z" }
    ],
    comments: [
      { id: "comment_acceptance", authorId: "ada", authorName: "Ada Lovelace", body: "Blocked on assets @grace", createdAt: "2026-06-27T00:00:00.000Z" }
    ],
    body: "Initial notes",
    createdAt: "2026-06-27T00:00:00.000Z",
    updatedAt: "2026-06-27T00:00:00.000Z"
  };
  card = addActivity({ ...card, listId: "doing", completed: true, body: "External edits survive reload." }, "completed", "Marked complete");
  const deletedCard = {
    ...createCard(board.id, "todo", "Throwaway card"),
    id: "card_deleted",
    fileName: "card_deleted.md"
  };

  await writeFile(join(workspaceRoot, ".workspace/settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
  await writeFile(join(workspaceRoot, ".workspace/members.json"), `${JSON.stringify(membersFile, null, 2)}\n`);
  await writeFile(join(workspaceRoot, "boards/board_acceptance.json"), `${JSON.stringify(board, null, 2)}\n`);
  await writeFile(join(workspaceRoot, "cards/card_acceptance.md"), serializeCard(card));
  await writeFile(join(workspaceRoot, "cards/card_deleted.md"), serializeCard(deletedCard));
  await unlink(join(workspaceRoot, "cards/card_deleted.md"));

  const reloaded = await readWorkspaceFiles(workspaceRoot);
  assert.equal(reloaded.settings.workspaceName, "Acceptance Workspace");
  assert.deepEqual(reloaded.settings.slackNotifications, settings.slackNotifications);
  assert.equal(reloaded.settings.slackMovedToListNames, "Shipped, Done");
  assert.deepEqual(reloaded.settings.boardGroups, settings.boardGroups);
  assert.equal(reloaded.membersFile.members.length, 2);
  assert.equal(reloaded.membersFile.members[0].slackHandle, "@ada");
  assert.equal(reloaded.boards[0].groupId, "group_launch");
  assert.equal(reloaded.boards[0].lists.length, 3);
  assert.equal(reloaded.cards.length, 1);
  assert.equal(reloaded.cards[0].title, "Draft release notes");
  assert.equal(reloaded.cards[0].listId, "doing");
  assert.equal(reloaded.cards[0].completed, true);
  assert.deepEqual(reloaded.cards[0].assignees, ["ada"]);
  assert.deepEqual(reloaded.cards[0].labels, ["docs", "release"]);
  assert.deepEqual(reloaded.cards[0].attachments, [
    { id: "att_release", name: "notes.pdf", storedName: "att_release-notes.pdf", size: 4096, addedAt: "2026-06-27T00:00:00.000Z" }
  ]);
  assert.deepEqual(reloaded.cards[0].comments, [
    { id: "comment_acceptance", authorId: "ada", authorName: "Ada Lovelace", body: "Blocked on assets @grace", createdAt: "2026-06-27T00:00:00.000Z" }
  ]);
  assert.equal(reloaded.cards[0].body, "External edits survive reload.");

  const externallyEdited = serializeCard({ ...reloaded.cards[0], title: "Externally renamed card", labels: ["external, comma"], updatedAt: "2026-06-27T02:00:00.000Z" });
  await writeFile(join(workspaceRoot, "cards/card_acceptance.md"), externallyEdited);

  const afterExternalEdit = await readWorkspaceFiles(workspaceRoot);
  assert.equal(afterExternalEdit.cards[0].title, "Externally renamed card");
  assert.deepEqual(afterExternalEdit.cards[0].labels, ["external, comma"]);

  const cardFiles = await readdir(join(workspaceRoot, "cards"));
  assert.deepEqual(cardFiles, ["card_acceptance.md"]);
} finally {
  await rm(workspaceRoot, { recursive: true, force: true });
}

// Card deep links: round-trip and reject anything that isn't a safe card link.
assert.equal(cardDeepLink("card_abc"), "limn://card/card_abc");
assert.equal(parseCardDeepLink(cardDeepLink("card_abc")), "card_abc");
assert.equal(parseCardDeepLink("  limn://card/card_abc  "), "card_abc");
// A slash in the id survives encoding but must be rejected on parse so it can't
// escape the cards/ directory; a plain space is harmless and round-trips.
assert.equal(parseCardDeepLink(cardDeepLink("weird/id")), null);
assert.equal(parseCardDeepLink(cardDeepLink("has space")), "has space");
assert.equal(parseCardDeepLink("limn://card/"), null);
assert.equal(parseCardDeepLink("limn://board/b1"), null);
assert.equal(parseCardDeepLink("https://example.com/card/x"), null);
assert.equal(parseCardDeepLink("limn://card/..%2Fetc"), null);
assert.equal(parseCardDeepLink("limn://card/a%2Fb"), null);

console.log("storage tests passed");

async function readWorkspaceFiles(root) {
  const boardFiles = (await readdir(join(root, "boards"))).sort();
  const cardFiles = (await readdir(join(root, "cards"))).sort();
  return parseWorkspace({
    settings: await readFile(join(root, ".workspace/settings.json"), "utf8"),
    members: await readFile(join(root, ".workspace/members.json"), "utf8"),
    boards: await Promise.all(
      boardFiles.map(async (fileName) => ({
        file_name: fileName,
        content: await readFile(join(root, "boards", fileName), "utf8")
      }))
    ),
    cards: await Promise.all(
      cardFiles.map(async (fileName) => ({
        file_name: fileName,
        content: await readFile(join(root, "cards", fileName), "utf8")
      }))
    ),
    warnings: []
  });
}
