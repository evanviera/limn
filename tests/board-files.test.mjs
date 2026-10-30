import assert from "node:assert/strict";
import { createBoard, parseWorkspace, parseWorkspaceMeta } from "../.tmp/storage-test/src/storage.js";

const board = { ...createBoard("Shared board"), id: "board_shared", groupId: "first-category", updatedAt: "2026-01-01T00:00:00.000Z" };
const canonical = { file_name: `${board.id}.json`, content: JSON.stringify(board) };
const copiedBoard = { ...board, updatedAt: "2026-02-01T00:00:00.000Z",
  lists: board.lists.map(list => ({ ...list, collapsed: true })) };
const duplicate = { file_name: `${board.id} 2.json`, content: JSON.stringify(copiedBoard) };

function load(boards, parser = parseWorkspace) {
  return parser({ settings: "{}", members: '{"members":[]}', boards, cards: [], card_count: 0, warnings: [] });
}

// Full reload and progressive open must agree, independent of read order or a
// newer timestamp on a sync copy. Parsing must leave all source data untouched.
for (const parser of [parseWorkspace, parseWorkspaceMeta]) {
  for (const files of [[duplicate, canonical], [canonical, duplicate]]) {
    const before = JSON.stringify(files);
    const result = load(files, parser);
    assert.deepEqual(result.boards, [board]);
    assert.equal(result.diagnostics.length, 1);
    assert.match(result.diagnostics[0], /board_shared 2.json duplicates board ID/);
    assert.match(result.diagnostics[0], /Using boards\/board_shared.json/);
    assert.equal(JSON.stringify(files), before);
  }
}

// When only copies survive, keep the newest readable one visible, with a
// deterministic filename tie-break so reloads do not alternate versions.
const older = { file_name: `${board.id} 3.json`, content: canonical.content };
for (const files of [[duplicate, older], [older, duplicate]]) {
  assert.deepEqual(load(files).boards, [copiedBoard]);
}
const tied = { file_name: `${board.id} 3.json`, content: JSON.stringify({ ...copiedBoard, name: "Other copy" }) };
for (const files of [[duplicate, tied], [tied, duplicate]]) {
  assert.deepEqual(load(files).boards, [copiedBoard]);
}

// A broken canonical file must not hide a surviving valid copy.
const recovered = load([{ ...canonical, content: "invalid JSON" }, duplicate]);
assert.deepEqual(recovered.boards, [copiedBoard]);
assert.match(recovered.diagnostics[0], /board_shared.json could not be loaded/);

// Equal display names are allowed when IDs differ; categories can each have an
// Evan board. Deduplication is by identity, never by name or list contents.
const other = { ...board, id: "board_other", groupId: "another-category" };
const distinct = load([canonical, { file_name: `${other.id}.json`, content: JSON.stringify(other) }]);
assert.deepEqual(distinct.boards, [board, other]);
assert.deepEqual(distinct.diagnostics, []);

console.log("duplicate board file tests passed");
