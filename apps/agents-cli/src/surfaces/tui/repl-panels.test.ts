import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSessionPickerEntry,
  buildTimelineEntries,
  createSessionPickerState,
  createTimelineState,
  getSelectedSessionKey,
  moveSessionPickerSelection,
  openSessionPicker,
  recordTimelineRuntimeEvent,
  recordTimelineToolCall,
  recordTimelineTurn,
} from "./repl-panels.js";

test("timeline entries capture run lifecycle and tool summaries", () => {
  const timeline = createTimelineState();
  recordTimelineRuntimeEvent(timeline, {
    type: "run.started",
    prompt: "分析 TUI",
    sessionId: "session-a",
  });
  recordTimelineToolCall(timeline, {
    toolCallId: "tool-1",
    name: "read_file",
    args: { path: "README.md" },
    output: "runtime overview",
    outputChars: 16,
    outputHead: "runtime overview",
    outputTail: "runtime overview",
    status: "succeeded",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1,
  });
  recordTimelineTurn(timeline, {
    turn: 1,
    text: "完成分析",
    textPreview: "完成分析",
    textChars: 4,
    toolCallCount: 1,
    toolNames: ["read_file"],
    finished: true,
  });
  recordTimelineRuntimeEvent(timeline, {
    type: "run.completed",
    result: "结论已输出",
  });

  const entries = buildTimelineEntries(timeline);
  assert.equal(entries[0]?.title, "Run Timeline");
  assert.match(entries[0]?.body ?? "", /已完成/);
  assert.match(entries[1]?.title ?? "", /Run 1/);
  assert.match(entries[2]?.title ?? "", /read_file/);
  assert.match(entries[3]?.title ?? "", /Turn 1/);
});

test("session picker keeps current session selected and navigable", () => {
  const picker = createSessionPickerState();
  openSessionPicker(
    picker,
    [
      {
        key: "chapter-1",
        safeKey: "chapter-1__hash",
        updatedAt: "2026-04-09T00:00:00.000Z",
        messageCount: 8,
        preview: "第一章预览",
      },
      {
        key: "chapter-2",
        safeKey: "chapter-2__hash",
        updatedAt: "2026-04-09T01:00:00.000Z",
        messageCount: 12,
        preview: "第二章预览",
      },
    ],
    "chapter-2",
  );

  assert.equal(getSelectedSessionKey(picker), "chapter-2");
  moveSessionPickerSelection(picker, "up");
  assert.equal(getSelectedSessionKey(picker), "chapter-1");

  const entry = buildSessionPickerEntry(picker, "chapter-2");
  assert.ok(entry);
  assert.match(entry?.body ?? "", /> chapter-1/);
  assert.match(entry?.body ?? "", /chapter-2 · current/);
});
