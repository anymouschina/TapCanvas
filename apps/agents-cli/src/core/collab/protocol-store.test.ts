import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CollabProtocolStore } from "./protocol-store.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agents-collab-protocol-"));
}

test("CollabProtocolStore persists requests and filters pending inbox items", () => {
  const dir = createTempDir();
  const store = new CollabProtocolStore(dir);

  store.saveRequest({
    id: "req_1",
    fromAgentId: "agent_root",
    toAgentId: "agent_worker",
    action: "review_patch",
    input: "{\"path\":\"src/a.ts\"}",
    createdAt: "2026-03-15T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
    status: "pending",
  });
  store.saveRequest({
    id: "req_2",
    fromAgentId: "agent_root",
    toAgentId: "agent_worker",
    action: "summarize",
    input: "{}",
    createdAt: "2026-03-15T00:01:00.000Z",
    updatedAt: "2026-03-15T00:02:00.000Z",
    status: "responded",
    response: {
      responderAgentId: "agent_worker",
      status: "completed",
      output: "done",
      respondedAt: "2026-03-15T00:02:00.000Z",
    },
  });

  assert.equal(store.pendingCount("agent_worker"), 1);
  assert.deepEqual(
    store.listRequestsForAgent("agent_worker").map((item) => item.id),
    ["req_1"]
  );
  assert.deepEqual(
    store.listRequestsForAgent("agent_worker", { includeResponded: true }).map((item) => item.id),
    ["req_1", "req_2"]
  );
  assert.equal(store.loadRequest("req_2")?.response?.status, "completed");
});
