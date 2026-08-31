import assert from "node:assert/strict";
import test from "node:test";

import {
  HarnessEventProjector,
  type BridgeStreamEvent,
} from "./event-projector.js";

test("projects the strict current status-update contract without legacy fields", () => {
  const events: BridgeStreamEvent[] = [];
  const projector = new HarnessEventProjector("thread-1", (event) => events.push(event));

  projector.start("private prompt that must not be projected");

  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    event: "thread.started",
    data: { threadId: "thread-1" },
  });
  assert.equal(events[1]?.event, "status-update");
  assert.equal(events[1]?.data.threadId, "thread-1");
  assert.equal(events[1]?.data.turnId, projector.turnId);
  assert.equal(events[1]?.data.phase, "agent_reasoning");
  assert.equal(events[1]?.data.llmTurn, 1);
  assert.equal(typeof events[1]?.data.startedAt, "string");
  assert.notEqual(events[1]?.data.startedAt, "");
  assert.equal(Object.hasOwn(events[1]?.data ?? {}, "status"), false);
  assert.equal(Object.hasOwn(events[1]?.data ?? {}, "runtime"), false);
  assert.equal(Object.hasOwn(events[1]?.data ?? {}, "promptPreview"), false);
});
