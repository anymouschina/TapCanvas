import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CollabMailboxStore } from "./mailbox-store.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agents-collab-mailbox-"));
}

test("CollabMailboxStore persists unread mailbox messages and marks them read", () => {
  const dir = createTempDir();
  const store = new CollabMailboxStore(dir);

  store.saveMessage({
    id: "mail_1",
    toAgentId: "agent_1",
    fromAgentId: "agent_root",
    subject: "next step",
    body: "please verify the change",
    createdAt: "2026-03-15T00:00:00.000Z",
  });
  store.saveMessage({
    id: "mail_2",
    toAgentId: "agent_1",
    body: "follow up",
    createdAt: "2026-03-15T00:01:00.000Z",
    readAt: "2026-03-15T00:02:00.000Z",
  });

  assert.equal(store.unreadCount("agent_1"), 1);
  assert.deepEqual(
    store.listMessagesForAgent("agent_1").map((item) => item.id),
    ["mail_1"]
  );
  assert.deepEqual(
    store.listMessagesForAgent("agent_1", { includeRead: true }).map((item) => item.id),
    ["mail_1", "mail_2"]
  );

  const updated = store.markRead(["mail_1"], "2026-03-15T00:03:00.000Z");
  assert.equal(updated.length, 1);
  assert.equal(store.loadMessage("mail_1")?.readAt, "2026-03-15T00:03:00.000Z");
  assert.equal(store.unreadCount("agent_1"), 0);
});
