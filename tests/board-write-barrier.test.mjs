import assert from "node:assert/strict";
import { BoardWriteBarrier } from "../.tmp/storage-test/src/lib/boardWriteBarrier.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// A refresh that starts during a save waits for the persisted result. Another
// workspace remains readable while this one's disk write is delayed.
{
  const barrier = new BoardWriteBarrier();
  const gate = deferred();
  let disk = "collapsed";
  const save = barrier.save("A", async () => { await gate.promise; disk = "expanded"; });
  const refresh = barrier.read("A", async () => disk, () => true);
  assert.equal(await barrier.read("B", async () => "other board", () => true), "other board");
  gate.resolve();
  await save;
  assert.equal(await refresh, "expanded");
}

// Multiple edits can overtake the same captured read. Apply only a new snapshot
// containing all settled writes and an unrelated external edit.
{
  const barrier = new BoardWriteBarrier();
  const captured = deferred();
  const releaseRead = deferred();
  const releaseSave = deferred();
  let disk = { collapsed: true, name: "To Do", otherList: "Backlog" };
  let firstRead = true;
  const refresh = barrier.read("A", async () => {
    const result = { ...disk };
    if (firstRead) {
      firstRead = false;
      captured.resolve();
      await releaseRead.promise;
    }
    return result;
  }, () => true);
  await captured.promise;
  await barrier.save("A", async () => { disk.collapsed = false; });
  const saving = barrier.save("A", async () => { await releaseSave.promise; disk.otherList = "Ready"; });
  disk.name = "Incoming work";
  releaseRead.resolve();
  releaseSave.resolve();
  await saving;
  assert.deepEqual(await refresh, { collapsed: false, name: "Incoming work", otherList: "Ready" });
}

// Failed writes propagate their error without leaving refresh permanently
// blocked; the unchanged disk state can still be recovered.
{
  const barrier = new BoardWriteBarrier();
  const gate = deferred();
  const failure = new Error("Disk unavailable");
  const saving = barrier.save("A", () => gate.promise);
  const rejected = assert.rejects(saving, failure);
  const refresh = barrier.read("A", async () => "persisted state", () => true);
  gate.reject(failure);
  await rejected;
  assert.equal(await refresh, "persisted state");
}

// Switching workspaces invalidates a held snapshot even when no save occurs.
{
  const barrier = new BoardWriteBarrier();
  const captured = deferred();
  const gate = deferred();
  let current = true;
  const refresh = barrier.read("A", async () => { captured.resolve(); return gate.promise; }, () => current);
  await captured.promise;
  current = false;
  gate.resolve("old workspace");
  assert.equal(await refresh, undefined);
}

console.log("board refresh race tests passed");
