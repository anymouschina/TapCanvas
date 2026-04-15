import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "../types/index.js";
import { compactMessagesForTurn } from "./message-compaction.js";

test("message compaction preserves assistant tool call when retained suffix contains its tool output", () => {
  const messages: Message[] = [
    {
      role: "user",
      content: "u0-" + "x".repeat(160),
    },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call_linked",
          name: "read_file",
          arguments: "{\"path\":\"a.txt\"}",
        },
      ],
    },
    {
      role: "tool",
      content: "tool-output-" + "y".repeat(160),
      toolCallId: "call_linked",
    },
    {
      role: "assistant",
      content: "final-" + "z".repeat(160),
    },
  ];

  const compacted = compactMessagesForTurn({
    messages,
    kind: "preflight",
    maxChars: 320,
    preserveLastMessages: 2,
  });

  assert.ok(compacted.event);
  assert.equal(compacted.messages[0]?.role, "user");
  assert.match(compacted.messages[0]?.content || "", /runtime_compaction_summary/);
  assert.equal(compacted.messages[1]?.role, "assistant");
  assert.equal(compacted.messages[1]?.toolCalls?.[0]?.id, "call_linked");
  assert.equal(compacted.messages[2]?.role, "tool");
  assert.equal(compacted.messages[2]?.toolCallId, "call_linked");
});

test("message compaction preserves whole api rounds instead of slicing inside assistant turns", () => {
  const messages: Message[] = [
    { role: "user", content: "u0-" + "a".repeat(120) },
    { role: "assistant", content: "a1-" + "b".repeat(120) },
    { role: "user", content: "u1-" + "c".repeat(120) },
    { role: "assistant", content: "a2-" + "d".repeat(120) },
  ];

  const compacted = compactMessagesForTurn({
    messages,
    kind: "preflight",
    maxChars: 320,
    preserveLastMessages: 1,
  });

  assert.ok(compacted.event);
  assert.equal(compacted.messages[0]?.role, "user");
  assert.match(compacted.messages[0]?.content || "", /runtime_compaction_summary/);
  assert.equal(compacted.messages[1]?.role, "assistant");
  assert.match(compacted.messages[1]?.content || "", /^a2-/);
  assert.equal(compacted.messages.length, 2);
});
