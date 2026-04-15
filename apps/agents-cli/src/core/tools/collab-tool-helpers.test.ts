import assert from "node:assert/strict";
import test from "node:test";

import { Message } from "../../types/index.js";
import { readCurrentMessages, sanitizeForkedMessages } from "./collab-tool-helpers.js";

test("sanitizeForkedMessages drops unresolved tool calls and orphan tool outputs", () => {
  const messages: Message[] = [
    {
      role: "user",
      content: "用户要我重试生成。",
    },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call_skill",
          name: "Skill",
          arguments: '{"skill":"agents-team"}',
        },
      ],
    },
    {
      role: "tool",
      content: '<skill-loaded name="agents-team">\n# agents-team\n</skill-loaded>',
      toolCallId: "call_skill",
    },
    {
      role: "assistant",
      content: "我先派一个 research 子代理。",
      toolCalls: [
        {
          id: "call_spawn_inflight",
          name: "spawn_agent",
          arguments: '{"agent_type":"research","prompt":"只输出结论"}',
        },
      ],
    },
    {
      role: "tool",
      content: '{"agent_id":"orphan"}',
      toolCallId: "call_missing_parent",
    },
  ];

  assert.deepEqual(sanitizeForkedMessages(messages), [
    {
      role: "user",
      content: "用户要我重试生成。",
    },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call_skill",
          name: "Skill",
          arguments: '{"skill":"agents-team"}',
        },
      ],
    },
    {
      role: "tool",
      content: '<skill-loaded name="agents-team">\n# agents-team\n</skill-loaded>',
      toolCallId: "call_skill",
    },
    {
      role: "assistant",
      content: "我先派一个 research 子代理。",
    },
  ]);
});

test("readCurrentMessages strips in-flight parent tool calls before fork_context handoff", () => {
  const currentMessages = readCurrentMessages({
    currentMessages: [
      {
        role: "user",
        content: "重试，刚刚生成失败了",
      },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_task",
            name: "task_update",
            arguments: '{"taskId":"task_0005"}',
          },
        ],
      },
      {
        role: "tool",
        content: '{"id":"task_0005","status":"in_progress"}',
        toolCallId: "call_task",
      },
      {
        role: "assistant",
        content: "我继续补齐 team 闭环。",
        toolCalls: [
          {
            id: "call_spawn_current_turn",
            name: "spawn_agent",
            arguments: '{"agent_type":"writer","fork_context":true}',
          },
        ],
      },
    ],
  });

  assert.deepEqual(currentMessages, [
    {
      role: "user",
      content: "重试，刚刚生成失败了",
    },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call_task",
          name: "task_update",
          arguments: '{"taskId":"task_0005"}',
        },
      ],
    },
    {
      role: "tool",
      content: '{"id":"task_0005","status":"in_progress"}',
      toolCallId: "call_task",
    },
    {
      role: "assistant",
      content: "我继续补齐 team 闭环。",
    },
  ]);
});
