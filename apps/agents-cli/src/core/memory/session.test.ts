import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { listSessionSummaries, loadSessionMessages, saveSessionMessages, type SessionStore } from "./session.js";

function createStore(dir: string, key: string): SessionStore {
  return {
    dir,
    key,
  };
}

test("session store persists and lists session summaries with original keys", () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-session-store-"));
  const store = createStore(sessionDir, "chapter-3");

  saveSessionMessages(store, [
    { role: "user", content: "先整理第三章任务" },
    { role: "assistant", content: "已整理第三章任务清单。" },
  ]);

  const summaries = listSessionSummaries(sessionDir);

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.key, "chapter-3");
  assert.match(summaries[0]?.preview ?? "", /第三章/);
  assert.equal(loadSessionMessages(store).length, 2);
});

test("session summary listing sorts newer sessions first", async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-session-store-"));

  saveSessionMessages(createStore(sessionDir, "older"), [
    { role: "user", content: "older prompt" },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  saveSessionMessages(createStore(sessionDir, "newer"), [
    { role: "user", content: "newer prompt" },
  ]);

  const summaries = listSessionSummaries(sessionDir);

  assert.equal(summaries[0]?.key, "newer");
  assert.equal(summaries[1]?.key, "older");
});
