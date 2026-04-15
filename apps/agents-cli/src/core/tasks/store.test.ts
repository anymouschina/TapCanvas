import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TaskStore } from "./store.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agents-task-store-"));
}

test("TaskStore persists tasks and clears dependencies on completion", () => {
  const dir = createTempDir();
  const store = new TaskStore(dir);

  const setup = store.create({ subject: "setup project" });
  const impl = store.create({ subject: "implement feature", blockedBy: [setup.id] });

  assert.equal(store.get(impl.id).status, "blocked");

  const completed = store.update(setup.id, { status: "completed" });
  assert.equal(completed.status, "completed");

  const unblocked = store.get(impl.id);
  assert.equal(unblocked.status, "pending");
  assert.deepEqual(unblocked.blockedBy, []);
});

test("TaskStore syncs reverse dependency edges when blocks are added", () => {
  const dir = createTempDir();
  const store = new TaskStore(dir);

  const parse = store.create({ subject: "parse" });
  const emit = store.create({ subject: "emit" });

  store.update(parse.id, { addBlocks: [emit.id] });

  const emitTask = store.get(emit.id);
  assert.deepEqual(emitTask.blockedBy, [parse.id]);
  assert.equal(emitTask.status, "blocked");
});

test("TaskStore claims next available task with owner and workspace lane", () => {
  const dir = createTempDir();
  const store = new TaskStore(dir);

  const claimed = store.create({ subject: "claimed already", owner: "agent_a" });
  const ready = store.create({ subject: "ready task" });
  store.create({ subject: "blocked task", blockedBy: [ready.id] });

  const next = store.claimNextAvailable({
    owner: "agent_worker",
    workspaceLane: "/tmp/agent_worker/repo",
  });

  assert.equal(next?.id, ready.id);
  assert.equal(next?.owner, "agent_worker");
  assert.equal(next?.workspaceLane, "/tmp/agent_worker/repo");
  assert.equal(next?.status, "in_progress");
  assert.equal(store.get(claimed.id).owner, "agent_a");
});

test("TaskStore claimNextAvailable respects workspace lane matching", () => {
  const dir = createTempDir();
  const store = new TaskStore(dir);

  store.create({ subject: "lane a task", workspaceLane: "/tmp/lane-a" });
  const laneB = store.create({ subject: "lane b task", workspaceLane: "/tmp/lane-b" });
  const shared = store.create({ subject: "shared task" });

  const nextForLaneB = store.claimNextAvailable({
    owner: "agent_b",
    workspaceLane: "/tmp/lane-b",
  });

  assert.equal(nextForLaneB?.id, laneB.id);
  assert.equal(nextForLaneB?.workspaceLane, "/tmp/lane-b");

  const nextForLaneC = store.claimNextAvailable({
    owner: "agent_c",
    workspaceLane: "/tmp/lane-c",
  });

  assert.equal(nextForLaneC?.id, shared.id);
  assert.equal(nextForLaneC?.workspaceLane, "/tmp/lane-c");
});

test("TaskStore claim fails explicitly on workspace lane mismatch", () => {
  const dir = createTempDir();
  const store = new TaskStore(dir);

  const task = store.create({ subject: "lane locked task", workspaceLane: "/tmp/lane-a" });

  assert.throws(
    () =>
      store.claim(task.id, {
        owner: "agent_b",
        workspaceLane: "/tmp/lane-b",
      }),
    /task lane mismatch/
  );
});
