import assert from "node:assert/strict";
import test from "node:test";

import { buildHarnessExecutionSessionId } from "./harness-runtime.js";

const request = {
  sessionId: "public-session-1",
  userId: "user-1",
};

test("mints a distinct DeepSeek Harness session for every physical execution", () => {
  const first = buildHarnessExecutionSessionId(request, "execution-1");
  const second = buildHarnessExecutionSessionId(request, "execution-2");

  assert.notEqual(first, second);
});

test("derives the same opaque session id from the same physical execution facts", () => {
  const first = buildHarnessExecutionSessionId(request, "execution-1");
  const second = buildHarnessExecutionSessionId(request, "execution-1");

  assert.equal(first, second);
  assert.match(first, /^tapcanvas-[a-f0-9]{64}$/);
  assert.equal(first.includes(request.sessionId), false);
  assert.equal(first.includes(request.userId), false);
});

test("keeps ephemeral physical execution sessions unique without external identity", () => {
  const first = buildHarnessExecutionSessionId({}, "execution-1");
  const second = buildHarnessExecutionSessionId({}, "execution-2");

  assert.notEqual(first, second);
  assert.match(first, /^tapcanvas-[a-f0-9]{64}$/);
});
