import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addActivity, attachmentDisplayName, attachmentStoredName, createBoard, createCard, parseCard, parseWorkspace, serializeCard } from "../.tmp/storage-test/src/storage.js";

const baseCard = {
  id: "card_one",
  title: "Title: with colon and \"quotes\"",
  boardId: "board_one",
  listId: "todo",
  assignees: ["ada", "grace"],
  labels: ["bug, parser", "external edit"],
  due: "2026-07-01",
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
  body: "Notes with --- inside the body stay intact.\nSecond line.\n",
  fileName: "card_one.md"
};

const roundTripped = parseCard(serializeCard(baseCard), baseCard.fileName);
assert.deepEqual(roundTripped, baseCard);

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
  cardMovedToDone: true,
  cardCompleted: true,
  cardAssigned: true,
  subtaskCompleted: true
});
assert.deepEqual(workspace.settings.boardGroups, []);
assert.deepEqual(workspace.membersFile.members, []);
assert.equal(workspace.boards.length, 1);
assert.equal(workspace.boards[0].groupId, undefined);
assert.equal(workspace.cards.length, 1);
assert.equal(workspace.diagnostics.length, 4);
assert(workspace.diagnostics.some((diagnostic) => diagnostic.includes("settings.json is invalid JSON")));
assert(workspace.diagnostics.some((diagnostic) => diagnostic.includes("boards/bad.json")));
assert(workspace.diagnostics.some((diagnostic) => diagnostic.includes("cards/bad.md")));
assert(workspace.diagnostics.some((diagnostic) => diagnostic.includes("bad-utf8.md")));

const workspaceRoot = await mkdtemp(join(tmpdir(), "limn-storage-e2e-"));
try {
  await mkdir(join(workspaceRoot, ".workspace"), { recursive: true });
  await mkdir(join(workspaceRoot, "boards"), { recursive: true });
  await mkdir(join(workspaceRoot, "cards"), { recursive: true });

  const settings = {
    schemaVersion: 1,
    workspaceName: "Acceptance Workspace",
    slackWebhookUrl: "http://127.0.0.1:9/slack",
    slackNotifications: {
      cardMovedToDone: true,
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
