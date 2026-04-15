import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CollabRuntimeStore } from "./runtime-store.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agents-collab-store-"));
}

test("CollabRuntimeStore persists agents and submissions", () => {
  const dir = createTempDir();
  const store = new CollabRuntimeStore(dir);

  store.saveAgent({
    id: "agent_1",
    description: "worker",
    agentType: "worker",
    depth: 1,
    status: "queued",
    createdAt: "2026-03-15T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
    pendingTasks: 1,
    completedTasks: 0,
    recentSubmissionIds: [],
    closed: false,
  });
  store.saveSubmission({
    id: "sub_1",
    agentId: "agent_1",
    prompt: "do work",
    status: "queued",
    createdAt: "2026-03-15T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
  });

  assert.equal(store.loadAgent("agent_1")?.description, "worker");
  assert.equal(store.loadSubmission("sub_1")?.agentId, "agent_1");
  assert.equal(store.listAgents().length, 1);
  assert.equal(store.listSubmissions().length, 1);
});
