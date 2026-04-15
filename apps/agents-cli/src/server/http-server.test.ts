import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { startAgentsHttpServer } from "./http-server.js";

test("agents http server streams canonical named SSE events plus item-level v2 events", async () => {
  const server = await startAgentsHttpServer(
    {
      cwd: process.cwd(),
      runner: {
        async run(_prompt: string, _cwd: string, options?: {
          onToolStart?: (payload: {
            toolCallId: string;
            name: string;
            args: Record<string, unknown>;
            startedAt: string;
          }) => void;
          onToolCall?: (payload: {
            toolCallId: string;
            name: string;
            args: Record<string, unknown>;
            output: string;
            outputJson?: Record<string, unknown>;
            outputChars: number;
            outputHead: string;
            outputTail: string;
            status: "succeeded" | "failed" | "denied" | "blocked";
            startedAt: string;
            finishedAt: string;
            durationMs: number;
            errorMessage?: string;
          }) => void;
          onTextDelta?: (delta: string) => void;
          onTurn?: (turn: {
            turn: number;
            text: string;
            textPreview: string;
            textChars: number;
            toolCallCount: number;
            toolNames: string[];
            finished: boolean;
          }) => void;
        }): Promise<string> {
          options?.onToolStart?.({
            toolCallId: "tool_1",
            name: "TodoWrite",
            args: { items: [{ content: "收敛 SSE 协议" }] },
            startedAt: "2026-03-19T10:00:00.000Z",
          });
          options?.onToolCall?.({
            toolCallId: "tool_1",
            name: "TodoWrite",
            args: { items: [{ content: "收敛 SSE 协议" }] },
            output: "Todo\n[>] 收敛 SSE 协议",
            outputChars: 18,
            outputHead: "Todo\n[>] 收敛 SSE 协议",
            outputTail: "Todo\n[>] 收敛 SSE 协议",
            status: "succeeded",
            startedAt: "2026-03-19T10:00:00.000Z",
            finishedAt: "2026-03-19T10:00:01.000Z",
            durationMs: 1000,
          });
          options?.onTextDelta?.("你好");
          options?.onTurn?.({
            turn: 1,
            text: "最终结果",
            textPreview: "最终结果",
            textChars: 4,
            toolCallCount: 1,
            toolNames: ["TodoWrite"],
            finished: true,
          });
          return "最终结果";
        },
      } as never,
    },
    {
      host: "127.0.0.1",
      port: 43123,
      token: "test-token",
    },
  );

  try {
    const response = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-agents-user-id": "user-1",
      },
      body: JSON.stringify({
        prompt: "测试 SSE",
        stream: true,
        userId: "user-1",
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /event: thread\.started/);
    assert.match(body, /event: turn\.started/);
    assert.match(body, /event: item\.started/);
    assert.match(body, /event: item\.updated/);
    assert.match(body, /event: item\.completed/);
    assert.match(body, /event: todo_list/);
    assert.match(body, /"inProgressCount":1/);
    assert.match(body, /event: tool/);
    assert.match(body, /"phase":"started"/);
    assert.match(body, /"phase":"completed"/);
    assert.match(body, /event: content/);
    assert.match(body, /event: result/);
    assert.match(body, /"todoList"/);
    assert.match(body, /"todoEvents"/);
    assert.match(body, /"pendingCount":0/);
    assert.match(body, /event: turn\.completed/);
    assert.match(body, /event: done/);
  } finally {
    await server.close();
  }
});

test("agents http server aborts the active run when the client disconnects", async () => {
  let abortReason = "";
  let resolveAbortObserved: (() => void) | null = null;
  const abortObserved = new Promise<void>((resolve) => {
    resolveAbortObserved = resolve;
  });
  const server = await startAgentsHttpServer(
    {
      cwd: process.cwd(),
      runner: {
        async run(
          _prompt: string,
          _cwd: string,
          options?: { abortSignal?: AbortSignal },
        ): Promise<string> {
          assert.ok(options?.abortSignal);
          return await new Promise<string>((_resolve, reject) => {
            const onAbort = () => {
              abortReason =
                options.abortSignal?.reason instanceof Error
                  ? options.abortSignal.reason.message
                  : String(options.abortSignal?.reason || "");
              resolveAbortObserved?.();
              reject(new Error("aborted"));
            };
            if (options.abortSignal?.aborted) {
              onAbort();
              return;
            }
            options.abortSignal?.addEventListener("abort", onAbort, { once: true });
          });
        },
      } as never,
    },
    {
      host: "127.0.0.1",
      port: 43127,
      token: "test-token",
    },
  );

  try {
    const controller = new AbortController();
    const response = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-agents-user-id": "user-1",
      },
      body: JSON.stringify({
        prompt: "测试断连回收",
        stream: true,
        userId: "user-1",
      }),
      signal: controller.signal,
    });

    assert.equal(response.status, 200);
    controller.abort();
    await response.body?.cancel().catch(() => undefined);
    await Promise.race([
      abortObserved,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timed out waiting for server abort")), 1500),
      ),
    ]);
    assert.match(abortReason, /客户端|SSE 写入失败|关闭了连接/);
  } finally {
    await server.close();
  }
});

test("agents http server includes deterministic completion trace", async () => {
  const server = await startAgentsHttpServer(
    {
      cwd: process.cwd(),
      runner: {
        async run(_prompt: string, _cwd: string): Promise<string> {
          return "子代理超时未终态，本轮显式失败。";
        },
      } as never,
    },
    {
      host: "127.0.0.1",
      port: 43126,
      token: "test-token",
    },
  );

  try {
    const response = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-agents-user-id": "user-1",
      },
      body: JSON.stringify({
        prompt: "测试 completion trace",
        userId: "user-1",
      }),
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      trace?: {
        completion?: {
          source?: unknown;
          terminal?: unknown;
          allowFinish?: unknown;
        };
      };
    };
    assert.equal(payload.trace?.completion?.source, "deterministic");
    assert.equal(payload.trace?.completion?.terminal, "explicit_failure");
    assert.equal(payload.trace?.completion?.allowFinish, true);
  } finally {
    await server.close();
  }
});

test("agents http server streams structured error details", async () => {
  const server = await startAgentsHttpServer(
    {
      cwd: process.cwd(),
      runner: {
        async run(): Promise<string> {
          const error = new Error("LLM 请求失败: 504 gateway timeout") as Error & {
            code?: string;
            details?: Record<string, unknown>;
          };
          error.code = "llm_http_504";
          error.details = {
            status: 504,
            requestSummary: {
              apiStyle: "responses",
              approxPayloadChars: 54321,
              toolMessageChars: 42000,
            },
          };
          throw error;
        },
      } as never,
    },
    {
      host: "127.0.0.1",
      port: 43129,
      token: "test-token",
    },
  );

  try {
    const response = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-agents-user-id": "user-1",
      },
      body: JSON.stringify({
        prompt: "测试 error details",
        stream: true,
        userId: "user-1",
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /event: error/);
    assert.match(body, /"code":"llm_http_504"/);
    assert.match(body, /"requestSummary"/);
    assert.match(body, /"approxPayloadChars":54321/);
  } finally {
    await server.close();
  }
});

test("agents http server blocks completion when execution planning checklist is missing", async () => {
  const server = await startAgentsHttpServer(
    {
      cwd: process.cwd(),
      runner: {
        async run(): Promise<string> {
          return "已完成执行。";
        },
      } as never,
    },
    {
      host: "127.0.0.1",
      port: 43128,
      token: "test-token",
    },
  );

  try {
    const response = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-agents-user-id": "user-1",
      },
      body: JSON.stringify({
        prompt: "完成第三章漫剧创作",
        userId: "user-1",
        diagnosticContext: {
          planningRequired: true,
          planningMinimumSteps: 2,
        },
      }),
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      trace?: {
        completion?: {
          terminal?: unknown;
          allowFinish?: unknown;
          failureReason?: unknown;
        };
        planning?: {
          hasChecklist?: unknown;
          planningRequired?: unknown;
        };
      };
    };
    assert.equal(payload.trace?.completion?.terminal, "blocked");
    assert.equal(payload.trace?.completion?.allowFinish, false);
    assert.equal(payload.trace?.completion?.failureReason, "planning_checklist_missing");
    assert.equal(payload.trace?.planning?.planningRequired, true);
    assert.equal(payload.trace?.planning?.hasChecklist, false);
  } finally {
    await server.close();
  }
});

test("agents http server blocks completion when execution planning checklist is too short", async () => {
  const server = await startAgentsHttpServer(
    {
      cwd: process.cwd(),
      runner: {
        async run(_prompt: string, _cwd: string, options?: {
          onToolCall?: (payload: {
            toolCallId: string;
            name: string;
            args: Record<string, unknown>;
            output: string;
            outputChars: number;
            outputHead: string;
            outputTail: string;
            status: "succeeded" | "failed" | "denied" | "blocked";
            startedAt: string;
            finishedAt: string;
            durationMs: number;
            errorMessage?: string;
          }) => void;
        }): Promise<string> {
          options?.onToolCall?.({
            toolCallId: "tool_short_plan",
            name: "TodoWrite",
            args: {
              items: [
                {
                  content: "完成第三章漫剧创作",
                  status: "completed",
                  activeForm: "正在完成第三章漫剧创作",
                },
              ],
            },
            output: "[x] 完成第三章漫剧创作",
            outputChars: 15,
            outputHead: "[x] 完成第三章漫剧创作",
            outputTail: "[x] 完成第三章漫剧创作",
            status: "succeeded",
            startedAt: "2026-04-01T14:00:00.000Z",
            finishedAt: "2026-04-01T14:00:01.000Z",
            durationMs: 1000,
          });
          return "已完成执行。";
        },
      } as never,
    },
    {
      host: "127.0.0.1",
      port: 43129,
      token: "test-token",
    },
  );

  try {
    const response = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-agents-user-id": "user-1",
      },
      body: JSON.stringify({
        prompt: "完成第三章漫剧创作",
        userId: "user-1",
        diagnosticContext: {
          planningRequired: true,
          planningMinimumSteps: 2,
        },
      }),
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      trace?: {
        completion?: {
          terminal?: unknown;
          allowFinish?: unknown;
          failureReason?: unknown;
        };
        planning?: {
          latestStepCount?: unknown;
          meetsMinimumStepCount?: unknown;
        };
      };
    };
    assert.equal(payload.trace?.completion?.terminal, "blocked");
    assert.equal(payload.trace?.completion?.allowFinish, false);
    assert.equal(payload.trace?.completion?.failureReason, "planning_checklist_too_short");
    assert.equal(payload.trace?.planning?.latestStepCount, 1);
    assert.equal(payload.trace?.planning?.meetsMinimumStepCount, false);
  } finally {
    await server.close();
  }
});

test("agents http server blocks completion when chapter asset repair is still missing", async () => {
  const server = await startAgentsHttpServer(
    {
      cwd: process.cwd(),
      runner: {
        async run(): Promise<string> {
          return "第2章资产已完成。";
        },
      } as never,
    },
    {
      host: "127.0.0.1",
      port: 43130,
      token: "test-token",
    },
  );

  try {
    const response = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-agents-user-id": "user-1",
      },
      body: JSON.stringify({
        prompt: "补齐第2章前置资产并继续当前章节生产",
        userId: "user-1",
        diagnosticContext: {
          workspaceAction: "chapter_asset_generation",
          chapterAssetRepairRequired: true,
          chapterAssetPreproductionRequiredCount: 2,
          chapterMissingReusableAssets: ["方源 - 成年", "青茅山夜雨山寨"],
          chapterMissingRoleReferences: ["方源 - 成年"],
          chapterMissingSceneProps: ["青茅山夜雨山寨"],
        },
      }),
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      trace?: {
        completion?: {
          terminal?: unknown;
          allowFinish?: unknown;
          failureReason?: unknown;
          requiredActions?: unknown;
        };
      };
    };
    assert.equal(payload.trace?.completion?.terminal, "blocked");
    assert.equal(payload.trace?.completion?.allowFinish, false);
    assert.equal(payload.trace?.completion?.failureReason, "chapter_asset_preproduction_missing");
    assert.deepEqual(payload.trace?.completion?.requiredActions, [
      "先补角色卡资产：方源 - 成年",
      "补齐场景/道具参考图：青茅山夜雨山寨",
      "将上述缺失资产优先写回当前工作台后，再继续章节分镜/图片节点生产：方源 - 成年、青茅山夜雨山寨",
    ]);
  } finally {
    await server.close();
  }
});

test("agents http server retries blocked completion with an internal self-check steer", async () => {
  const seenPrompts: string[] = [];
  const seenEphemeralFlags: boolean[] = [];
  let runCount = 0;
  const server = await startAgentsHttpServer(
    {
      cwd: process.cwd(),
      runner: {
        async run(
          prompt: string,
          _cwd: string,
          options?: {
            ephemeralUserPrompt?: boolean;
            onToolCall?: (payload: {
              toolCallId: string;
              name: string;
              args: Record<string, unknown>;
              output: string;
              outputChars: number;
              outputHead: string;
              outputTail: string;
              status: "succeeded" | "failed" | "denied" | "blocked";
              startedAt: string;
              finishedAt: string;
              durationMs: number;
              errorMessage?: string;
            }) => void;
          },
        ): Promise<string> {
          seenPrompts.push(prompt);
          seenEphemeralFlags.push(options?.ephemeralUserPrompt === true);
          runCount += 1;
          if (runCount === 1) {
            return "已完成执行。";
          }
          options?.onToolCall?.({
            toolCallId: "tool_fix_plan",
            name: "TodoWrite",
            args: {
              items: [
                {
                  content: "先列出第三章执行清单",
                  status: "completed",
                  activeForm: "正在列出第三章执行清单",
                },
                {
                  content: "按清单继续执行并收口",
                  status: "completed",
                  activeForm: "正在按清单继续执行并收口",
                },
              ],
            },
            output: "[x] 先列出第三章执行清单\n[x] 按清单继续执行并收口",
            outputChars: 31,
            outputHead: "[x] 先列出第三章执行清单\n[x] 按清单继续执行并收口",
            outputTail: "[x] 先列出第三章执行清单\n[x] 按清单继续执行并收口",
            status: "succeeded",
            startedAt: "2026-04-02T10:00:00.000Z",
            finishedAt: "2026-04-02T10:00:01.000Z",
            durationMs: 1000,
          });
          return "已补齐 checklist 并完成执行。";
        },
      } as never,
    },
    {
      host: "127.0.0.1",
      port: 43131,
      token: "test-token",
    },
  );

  try {
    const response = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-agents-user-id": "user-1",
      },
      body: JSON.stringify({
        prompt: "完成第三章漫剧创作",
        userId: "user-1",
        diagnosticContext: {
          planningRequired: true,
          planningMinimumSteps: 2,
        },
      }),
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      text: string;
      trace?: {
        completion?: {
          allowFinish?: unknown;
          retryCount?: unknown;
          recoveredAfterRetry?: unknown;
        };
        planning?: {
          latestStepCount?: unknown;
          checklistComplete?: unknown;
        };
      };
    };
    assert.equal(payload.text, "已补齐 checklist 并完成执行。");
    assert.equal(runCount, 2);
    assert.equal(payload.trace?.completion?.allowFinish, true);
    assert.equal(payload.trace?.completion?.retryCount, 1);
    assert.equal(payload.trace?.completion?.recoveredAfterRetry, true);
    assert.equal(payload.trace?.planning?.latestStepCount, 2);
    assert.equal(payload.trace?.planning?.checklistComplete, true);
    assert.equal(seenEphemeralFlags[0], false);
    assert.equal(seenEphemeralFlags[1], true);
    assert.match(seenPrompts[1] || "", /planning_checklist_missing/);
  } finally {
    await server.close();
  }
});

test("agents http server retries chapter asset repair inside the same request", async () => {
  const seenPrompts: string[] = [];
  const seenEphemeralFlags: boolean[] = [];
  let runCount = 0;
  const server = await startAgentsHttpServer(
    {
      cwd: process.cwd(),
      runner: {
        async run(
          prompt: string,
          _cwd: string,
          options?: {
            ephemeralUserPrompt?: boolean;
            onToolCall?: (payload: {
              toolCallId: string;
              name: string;
              args: Record<string, unknown>;
              output: string;
              outputChars: number;
              outputHead: string;
              outputTail: string;
              status: "succeeded" | "failed" | "denied" | "blocked";
              startedAt: string;
              finishedAt: string;
              durationMs: number;
              errorMessage?: string;
            }) => void;
          },
        ): Promise<string> {
          seenPrompts.push(prompt);
          seenEphemeralFlags.push(options?.ephemeralUserPrompt === true);
          runCount += 1;
          if (runCount === 1) {
            return "第2章资产已完成。";
          }
          options?.onToolCall?.({
            toolCallId: "tool_fix_chapter_assets",
            name: "tapcanvas_flow_patch",
            args: {
              createNodes: [
                {
                  id: "role-anchor-1",
                  data: {
                    kind: "image",
                    label: "方源 - 成年",
                    productionLayer: "preproduction",
                    creationStage: "preproduction",
                    prompt: "成年方源角色卡",
                  },
                },
                {
                  id: "scene-anchor-1",
                  data: {
                    kind: "image",
                    label: "青茅山夜雨山寨",
                    productionLayer: "preproduction",
                    creationStage: "preproduction",
                    prompt: "青茅山夜雨山寨场景参考",
                  },
                },
              ],
            },
            output: "{\"ok\":true}",
            outputChars: 11,
            outputHead: "{\"ok\":true}",
            outputTail: "{\"ok\":true}",
            status: "succeeded",
            startedAt: "2026-04-04T12:30:00.000Z",
            finishedAt: "2026-04-04T12:30:01.000Z",
            durationMs: 1000,
          });
          return "已补齐第2章缺失资产并继续当前章节生产。";
        },
      } as never,
    },
    {
      host: "127.0.0.1",
      port: 43133,
      token: "test-token",
    },
  );

  try {
    const response = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-agents-user-id": "user-1",
      },
      body: JSON.stringify({
        prompt: "补齐第2章前置资产并继续当前章节生产",
        userId: "user-1",
        diagnosticContext: {
          workspaceAction: "chapter_asset_generation",
          chapterAssetRepairRequired: true,
          chapterAssetPreproductionRequiredCount: 2,
          chapterMissingReusableAssets: ["方源 - 成年", "青茅山夜雨山寨"],
          chapterMissingRoleReferences: ["方源 - 成年"],
          chapterMissingSceneProps: ["青茅山夜雨山寨"],
        },
      }),
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      text: string;
      trace?: {
        completion?: {
          allowFinish?: unknown;
          retryCount?: unknown;
          recoveredAfterRetry?: unknown;
        };
      };
    };
    assert.equal(payload.text, "已补齐第2章缺失资产并继续当前章节生产。");
    assert.equal(runCount, 2);
    assert.equal(payload.trace?.completion?.allowFinish, true);
    assert.equal(payload.trace?.completion?.retryCount, 1);
    assert.equal(payload.trace?.completion?.recoveredAfterRetry, true);
    assert.equal(seenEphemeralFlags[0], false);
    assert.equal(seenEphemeralFlags[1], true);
    assert.match(seenPrompts[1] || "", /chapter_asset_preproduction_missing/);
    assert.match(seenPrompts[1] || "", /方源 - 成年/);
    assert.match(seenPrompts[1] || "", /青茅山夜雨山寨/);
  } finally {
    await server.close();
  }
});

test("agents http server counts anchor-layer image nodes as chapter asset repair evidence", async () => {
  const seenPrompts: string[] = [];
  const seenEphemeralFlags: boolean[] = [];
  let runCount = 0;
  const server = await startAgentsHttpServer(
    {
      cwd: process.cwd(),
      runner: {
        async run(
          prompt: string,
          _cwd: string,
          options?: {
            ephemeralUserPrompt?: boolean;
            onToolCall?: (payload: {
              toolCallId: string;
              name: string;
              args: Record<string, unknown>;
              output: string;
              outputChars: number;
              outputHead: string;
              outputTail: string;
              status: "succeeded" | "failed" | "denied" | "blocked";
              startedAt: string;
              finishedAt: string;
              durationMs: number;
              errorMessage?: string;
            }) => void;
          },
        ): Promise<string> {
          seenPrompts.push(prompt);
          seenEphemeralFlags.push(options?.ephemeralUserPrompt === true);
          runCount += 1;
          if (runCount === 1) {
            return "第5章资产已完成。";
          }
          options?.onToolCall?.({
            toolCallId: "tool_fix_chapter_asset_anchors",
            name: "tapcanvas_flow_patch",
            args: {
              createNodes: [
                {
                  id: "role-anchor-2",
                  data: {
                    kind: "image",
                    label: "方源 - 15岁 角色卡",
                    productionLayer: "anchors",
                    creationStage: "single_variable_expansion",
                    roleCardId: "role-fangyuan-15",
                    referenceView: "three_view",
                    prompt: "少年方源角色卡三视图",
                  },
                },
                {
                  id: "scene-anchor-2",
                  data: {
                    kind: "image",
                    label: "灵泉花海彼岸",
                    productionLayer: "anchors",
                    creationStage: "single_variable_expansion",
                    category: "scene_prop",
                    prompt: "灵泉花海彼岸场景参考图",
                  },
                },
              ],
            },
            output: "{\"ok\":true}",
            outputChars: 11,
            outputHead: "{\"ok\":true}",
            outputTail: "{\"ok\":true}",
            status: "succeeded",
            startedAt: "2026-04-04T12:31:00.000Z",
            finishedAt: "2026-04-04T12:31:01.000Z",
            durationMs: 1000,
          });
          return "已补齐第5章角色卡与场景锚点。";
        },
      } as never,
    },
    {
      host: "127.0.0.1",
      port: 43134,
      token: "test-token",
    },
  );

  try {
    const response = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-agents-user-id": "user-1",
      },
      body: JSON.stringify({
        prompt: "补齐第5章前置资产并继续当前章节生产",
        userId: "user-1",
        diagnosticContext: {
          workspaceAction: "chapter_asset_generation",
          chapterAssetRepairRequired: true,
          chapterAssetPreproductionRequiredCount: 2,
          chapterMissingReusableAssets: ["方源 - 15岁", "灵泉花海彼岸"],
          chapterMissingRoleReferences: ["方源 - 15岁"],
          chapterMissingSceneProps: ["灵泉花海彼岸"],
        },
      }),
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      text: string;
      trace?: {
        completion?: {
          allowFinish?: unknown;
          retryCount?: unknown;
          recoveredAfterRetry?: unknown;
        };
      };
    };
    assert.equal(payload.text, "已补齐第5章角色卡与场景锚点。");
    assert.equal(runCount, 2);
    assert.equal(payload.trace?.completion?.allowFinish, true);
    assert.equal(payload.trace?.completion?.retryCount, 1);
    assert.equal(payload.trace?.completion?.recoveredAfterRetry, true);
    assert.equal(seenEphemeralFlags[0], false);
    assert.equal(seenEphemeralFlags[1], true);
    assert.match(seenPrompts[1] || "", /chapter_asset_preproduction_missing/);
    assert.match(seenPrompts[1] || "", /方源 - 15岁/);
    assert.match(seenPrompts[1] || "", /灵泉花海彼岸/);
  } finally {
    await server.close();
  }
});

test("agents http server does not reset self-check budget on repeated read-only retries", async () => {
  let runCount = 0;
  const seenEphemeralFlags: boolean[] = [];
  const server = await startAgentsHttpServer(
    {
      cwd: process.cwd(),
      runner: {
        async run(
          _prompt: string,
          _cwd: string,
          options?: {
            ephemeralUserPrompt?: boolean;
            onToolCall?: (payload: {
              toolCallId: string;
              name: string;
              args: Record<string, unknown>;
              output: string;
              outputChars: number;
              outputHead: string;
              outputTail: string;
              status: "succeeded" | "failed" | "denied" | "blocked";
              startedAt: string;
              finishedAt: string;
              durationMs: number;
              errorMessage?: string;
            }) => void;
          },
        ): Promise<string> {
          runCount += 1;
          seenEphemeralFlags.push(options?.ephemeralUserPrompt === true);
          if (runCount > 1) {
            options?.onToolCall?.({
              toolCallId: `tool_read_only_${runCount}`,
              name: "tapcanvas_flow_get",
              args: {},
              output: "{\"id\":\"flow-1\",\"nodes\":[]}",
              outputChars: 26,
              outputHead: "{\"id\":\"flow-1\",\"nodes\":[]}",
              outputTail: "{\"id\":\"flow-1\",\"nodes\":[]}",
              status: "succeeded",
              startedAt: "2026-04-04T13:00:00.000Z",
              finishedAt: "2026-04-04T13:00:01.000Z",
              durationMs: 1000,
            });
          }
          return "第5章前置资产已补齐。";
        },
      } as never,
    },
    {
      host: "127.0.0.1",
      port: 43135,
      token: "test-token",
    },
  );

  try {
    const response = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-agents-user-id": "user-1",
      },
      body: JSON.stringify({
        prompt: "补齐第5章前置资产并继续当前章节生产",
        userId: "user-1",
        diagnosticContext: {
          workspaceAction: "chapter_asset_generation",
          chapterAssetRepairRequired: true,
          chapterAssetPreproductionRequiredCount: 2,
          chapterMissingReusableAssets: ["方源 - 15岁", "灵泉花海彼岸"],
          chapterMissingRoleReferences: ["方源 - 15岁"],
          chapterMissingSceneProps: ["灵泉花海彼岸"],
        },
      }),
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      text: string;
      trace?: {
        completion?: {
          allowFinish?: unknown;
          failureReason?: unknown;
          retryCount?: unknown;
        };
      };
    };
    assert.equal(payload.text, "第5章前置资产已补齐。");
    assert.equal(runCount, 3);
    assert.equal(payload.trace?.completion?.allowFinish, false);
    assert.equal(payload.trace?.completion?.failureReason, "chapter_asset_preproduction_missing");
    assert.equal(payload.trace?.completion?.retryCount, 2);
    assert.deepEqual(seenEphemeralFlags, [false, true, true]);
  } finally {
    await server.close();
  }
});

test("agents http server does not persist internal completion self-check steers into session history", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agents-http-self-check-"));
  let runCount = 0;
  const server = await startAgentsHttpServer(
    {
      cwd: tempRoot,
      runner: {
        async run(
          prompt: string,
          _cwd: string,
          options?: {
            history?: Array<{ role: string; content: string; ephemeral?: boolean }>;
            ephemeralUserPrompt?: boolean;
            onToolCall?: (payload: {
              toolCallId: string;
              name: string;
              args: Record<string, unknown>;
              output: string;
              outputChars: number;
              outputHead: string;
              outputTail: string;
              status: "succeeded" | "failed" | "denied" | "blocked";
              startedAt: string;
              finishedAt: string;
              durationMs: number;
              errorMessage?: string;
            }) => void;
          },
        ): Promise<string> {
          options?.history?.push({
            role: "user",
            content: prompt,
            ...(options?.ephemeralUserPrompt === true ? { ephemeral: true } : {}),
          });
          runCount += 1;
          if (runCount === 1) {
            options?.history?.push({
              role: "assistant",
              content: "已完成执行。",
            });
            return "已完成执行。";
          }
          options?.onToolCall?.({
            toolCallId: "tool_fix_plan_persist",
            name: "TodoWrite",
            args: {
              items: [
                {
                  content: "补 checklist",
                  status: "completed",
                  activeForm: "正在补 checklist",
                },
                {
                  content: "完成收口",
                  status: "completed",
                  activeForm: "正在完成收口",
                },
              ],
            },
            output: "[x] 补 checklist\n[x] 完成收口",
            outputChars: 20,
            outputHead: "[x] 补 checklist\n[x] 完成收口",
            outputTail: "[x] 补 checklist\n[x] 完成收口",
            status: "succeeded",
            startedAt: "2026-04-02T10:10:00.000Z",
            finishedAt: "2026-04-02T10:10:01.000Z",
            durationMs: 1000,
          });
          options?.history?.push({
            role: "assistant",
            content: "最终成功。",
          });
          return "最终成功。";
        },
      } as never,
    },
    {
      host: "127.0.0.1",
      port: 43132,
      token: "test-token",
    },
  );

  try {
    const response = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-agents-user-id": "user-1",
      },
      body: JSON.stringify({
        prompt: "完成第三章漫剧创作",
        userId: "user-1",
        sessionId: "session-self-check",
        diagnosticContext: {
          planningRequired: true,
          planningMinimumSteps: 2,
        },
      }),
    });

    assert.equal(response.status, 200);
    const usersRoot = path.join(tempRoot, ".agents", "memory", "users");
    const discoveredFiles = fs
      .readdirSync(usersRoot, { recursive: true })
      .filter((entry) => typeof entry === "string" && entry.endsWith(".jsonl"));
    assert.equal(discoveredFiles.length, 1);
    const content = fs.readFileSync(path.join(usersRoot, String(discoveredFiles[0] || "")), "utf-8");
    assert.doesNotMatch(content, /runtime_completion_self_check/);
  } finally {
    await server.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("agents http server injects structured output preference into system prompt", async () => {
  let capturedSystemOverride = "";
  const server = await startAgentsHttpServer(
    {
      cwd: process.cwd(),
      runner: {
        async run(_prompt: string, _cwd: string, options?: { systemOverride?: string }): Promise<string> {
          capturedSystemOverride = String(options?.systemOverride || "");
          return "{\"ok\":true}";
        },
      } as never,
    },
    {
      host: "127.0.0.1",
      port: 43124,
      token: "test-token",
    },
  );

  try {
    const response = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-agents-user-id": "user-1",
      },
      body: JSON.stringify({
        prompt: "测试结构化输出",
        userId: "user-1",
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "canvas_write_result",
            schema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
              },
              required: ["ok"],
            },
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.match(capturedSystemOverride, /StructuredOutputPreference:/);
    assert.match(capturedSystemOverride, /json_schema/);
    assert.match(capturedSystemOverride, /canvas_write_result/);
  } finally {
    await server.close();
  }
});

test("agents http server forwards agents-team execution gate into runtime meta", async () => {
  let capturedSystemOverride = "";
  let capturedMeta: Record<string, unknown> | undefined;
  const server = await startAgentsHttpServer(
    {
      cwd: process.cwd(),
      runner: {
        async run(
          _prompt: string,
          _cwd: string,
          options?: { systemOverride?: string; toolContextMeta?: Record<string, unknown> },
        ): Promise<string> {
          capturedSystemOverride = String(options?.systemOverride || "");
          capturedMeta = options?.toolContextMeta;
          return '{"ok":true}';
        },
      } as never,
    },
    {
      host: "127.0.0.1",
      port: 43125,
      token: "test-token",
    },
  );

  try {
    const response = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-agents-user-id": "user-1",
      },
      body: JSON.stringify({
        prompt: "测试 prompt team gate",
        userId: "user-1",
        requireAgentsTeamExecution: true,
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(capturedMeta?.requireAgentsTeamExecution, true);
    assert.match(capturedSystemOverride, /AgentsTeamExecutionRequirement: true/);
  } finally {
    await server.close();
  }
});

test("agents http server injects checklist-first planning guidance for chapter-grounded execution", async () => {
  let capturedSystemOverride = "";
  let capturedMeta: Record<string, unknown> | undefined;
  const server = await startAgentsHttpServer(
    {
      cwd: process.cwd(),
      runner: {
        async run(
          _prompt: string,
          _cwd: string,
          options?: { systemOverride?: string; toolContextMeta?: Record<string, unknown> },
        ): Promise<string> {
          capturedSystemOverride = String(options?.systemOverride || "");
          capturedMeta = options?.toolContextMeta;
          return '{"ok":true}';
        },
      } as never,
    },
    {
      host: "127.0.0.1",
      port: 43126,
      token: "test-token",
    },
  );

  try {
    const response = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-agents-user-id": "user-1",
      },
      body: JSON.stringify({
        prompt: "完成第二章节的漫剧创作",
        userId: "user-1",
        diagnosticContext: {
          planningRequired: true,
          planningMinimumSteps: 4,
          planningChecklistFirst: true,
          planningReason: "chapter_grounded_canvas_execution",
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(
      (capturedMeta?.diagnosticContext as Record<string, unknown> | undefined)?.planningChecklistFirst,
      true,
    );
    assert.match(capturedSystemOverride, /ChecklistFirstRequirement: true/);
    assert.match(capturedSystemOverride, /first non-Skill action must be TodoWrite/i);
  } finally {
    await server.close();
  }
});

test("agents http server injects asset input @reference semantics into system prompt and runtime meta", async () => {
  let capturedSystemOverride = "";
  let capturedMeta: Record<string, unknown> | undefined;
  const server = await startAgentsHttpServer(
    {
      cwd: process.cwd(),
      runner: {
        async run(
          _prompt: string,
          _cwd: string,
          options?: { systemOverride?: string; toolContextMeta?: Record<string, unknown> },
        ): Promise<string> {
          capturedSystemOverride = String(options?.systemOverride || "");
          capturedMeta = options?.toolContextMeta;
          return '{"ok":true}';
        },
      } as never,
    },
    {
      host: "127.0.0.1",
      port: 43129,
      token: "test-token",
    },
  );

  try {
    const response = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-agents-user-id": "user-1",
      },
      body: JSON.stringify({
        prompt: "测试 asset input 引用语义",
        userId: "user-1",
        assetInputs: [
          {
            assetId: "asset-1",
            assetRefId: "fangyuan_main",
            role: "character",
            name: "方源主参考",
            note: "@fangyuan_main · 主角外观锚点",
            url: "https://example.com/fangyuan-main.png",
          },
        ],
        referenceImageSlots: [
          {
            slot: "图1",
            role: "角色参考",
            label: "方源主参考",
            note: "主角外观锚点",
            url: "https://example.com/fangyuan-main.png",
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    assert.match(capturedSystemOverride, /AssetInputs:/);
    assert.match(capturedSystemOverride, /assetRefId=fangyuan_main/);
    assert.match(capturedSystemOverride, /@assetRefId or @name semantics/);
    assert.match(capturedSystemOverride, /Do not invent new @ identifiers/);
    assert.match(capturedSystemOverride, /semantic anchors/);
    assert.deepEqual(capturedMeta?.sessionAssetInputs, [
      {
        assetId: "asset-1",
        assetRefId: "fangyuan_main",
        role: "character",
        name: "方源主参考",
        note: "@fangyuan_main · 主角外观锚点",
        url: "https://example.com/fangyuan-main.png",
        weight: null,
      },
    ]);
  } finally {
    await server.close();
  }
});

test("agents http server injects generation contract into system prompt and runtime meta", async () => {
  let capturedSystemOverride = "";
  let capturedMeta: Record<string, unknown> | undefined;
  const server = await startAgentsHttpServer(
    {
      cwd: process.cwd(),
      runner: {
        async run(
          _prompt: string,
          _cwd: string,
          options?: { systemOverride?: string; toolContextMeta?: Record<string, unknown> },
        ): Promise<string> {
          capturedSystemOverride = String(options?.systemOverride || "");
          capturedMeta = options?.toolContextMeta;
          return '{"ok":true}';
        },
      } as never,
    },
    {
      host: "127.0.0.1",
      port: 43127,
      token: "test-token",
    },
  );

  try {
    const response = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-agents-user-id": "user-1",
      },
      body: JSON.stringify({
        prompt: "测试 generation contract",
        userId: "user-1",
        generationContract: {
          version: "v1",
          lockedAnchors: ["角色外观", "固定机位"],
          editableVariable: "环境光线",
          forbiddenChanges: ["禁止换脸", "禁止改构图"],
          approvedKeyframeId: "keyframe-7",
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.match(capturedSystemOverride, /GenerationContract:/);
    assert.match(capturedSystemOverride, /lockedAnchors: 角色外观 \| 固定机位/);
    assert.equal(
      (capturedMeta?.generationContract as { approvedKeyframeId?: string } | undefined)?.approvedKeyframeId,
      "keyframe-7",
    );
  } finally {
    await server.close();
  }
});

test("agents http server injects canvas capability manifest into system prompt, runtime meta, and trace", async () => {
  let capturedSystemOverride = "";
  let capturedMeta: Record<string, unknown> | undefined;
  const server = await startAgentsHttpServer(
    {
      cwd: process.cwd(),
      runner: {
        async run(
          _prompt: string,
          _cwd: string,
          options?: { systemOverride?: string; toolContextMeta?: Record<string, unknown> },
        ): Promise<string> {
          capturedSystemOverride = String(options?.systemOverride || "");
          capturedMeta = options?.toolContextMeta;
          return '{"ok":true}';
        },
      } as never,
    },
    {
      host: "127.0.0.1",
      port: 43130,
      token: "test-token",
    },
  );

  try {
    const response = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-agents-user-id": "user-1",
      },
      body: JSON.stringify({
        prompt: "测试 canvas capability manifest",
        userId: "user-1",
        canvasCapabilityManifest: {
          version: "2026-03-31",
          summary: "TapCanvas capability source of truth.",
          localCanvasTools: [
            {
              name: "reflowLayout",
              description: "重排当前画布布局。",
              parameters: { type: "object", properties: { scope: { type: "string" } } },
            },
          ],
          remoteTools: [
            {
              name: "tapcanvas_flow_patch",
              description: "Patch the current TapCanvas flow graph.",
              parameters: { type: "object", properties: { createNodes: { type: "array" } } },
            },
          ],
          nodeSpecs: {
            storyboard: {
              label: "分镜编辑",
              purpose: "手工分镜编辑节点。",
            },
          },
          protocols: {
            flowPatch: {
              supportedCreateNodeTypes: ["taskNode", "groupNode"],
            },
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      trace?: {
        runtime?: {
          canvasCapabilities?: {
            version: string | null;
            localCanvasToolNames: string[];
            remoteToolNames: string[];
            nodeKinds: string[];
          };
        };
      };
    };
    assert.match(capturedSystemOverride, /CanvasCapabilityManifest:/);
    assert.match(capturedSystemOverride, /tapcanvas_flow_patch/);
    assert.match(capturedSystemOverride, /storyboard \(分镜编辑\)/);
    assert.ok(capturedMeta?.canvasCapabilityManifest);
    assert.deepEqual(payload.trace?.runtime?.canvasCapabilities, {
      version: "2026-03-31",
      localCanvasToolNames: ["reflowLayout"],
      remoteToolNames: ["tapcanvas_flow_patch"],
      nodeKinds: ["storyboard"],
    });
  } finally {
    await server.close();
  }
});

test("agents http server rejects malformed generation contract", async () => {
  const server = await startAgentsHttpServer(
    {
      cwd: process.cwd(),
      runner: {
        async run(): Promise<string> {
          return '{"ok":true}';
        },
      } as never,
    },
    {
      host: "127.0.0.1",
      port: 43128,
      token: "test-token",
    },
  );

  try {
    const response = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-agents-user-id": "user-1",
      },
      body: JSON.stringify({
        prompt: "测试 generation contract 错误",
        userId: "user-1",
        generationContract: {
          version: "v1",
          lockedAnchors: ["角色外观"],
          editableVariable: null,
          forbiddenChanges: [],
          approvedKeyframeId: null,
          motionBudget: "fast",
        },
      }),
    });

    assert.equal(response.status, 400);
    const body = (await response.json()) as { error?: string; message?: string };
    assert.equal(body.error, "invalid_request");
    assert.match(String(body.message || ""), /generationContract 无效/);
  } finally {
    await server.close();
  }
});

test("agents http server includes runtime tool exposure in trace output", async () => {
  const server = await startAgentsHttpServer(
    {
      cwd: process.cwd(),
      toolContextMeta: {
        runtimeProfile: "code",
        registeredToolNames: ["Skill", "spawn_agent", "wait"],
        registeredTeamToolNames: ["spawn_agent", "wait"],
      },
      runner: {
        async run(_prompt: string, _cwd: string, options?: { history?: Array<{ role: string; content: string }> }): Promise<string> {
          options?.history?.push({
            role: "user",
            content: '<skill-loaded name="agents-team">\n# agents-team\n</skill-loaded>',
          });
          return '{"ok":true}';
        },
      } as never,
    },
    {
      host: "127.0.0.1",
      port: 43126,
      token: "test-token",
    },
  );

  try {
    const response = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        "x-agents-user-id": "user-1",
      },
      body: JSON.stringify({
        prompt: "测试 runtime trace",
        userId: "user-1",
        requiredSkills: ["agents-team"],
        allowedSubagentTypes: ["writer", "research"],
        requireAgentsTeamExecution: true,
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json() as {
      trace?: {
        runtime?: {
          profile: string;
          registeredToolNames: string[];
          registeredTeamToolNames: string[];
          requiredSkills: string[];
          loadedSkills: string[];
          allowedSubagentTypes: string[];
          requireAgentsTeamExecution: boolean;
        };
      };
    };
    assert.equal(body.trace?.runtime?.profile, "code");
    assert.deepEqual(body.trace?.runtime?.registeredTeamToolNames, ["spawn_agent", "wait"]);
    assert.deepEqual(body.trace?.runtime?.requiredSkills, ["agents-team"]);
    assert.deepEqual(body.trace?.runtime?.loadedSkills, ["agents-team"]);
    assert.deepEqual(body.trace?.runtime?.allowedSubagentTypes, ["writer", "research"]);
    assert.equal(body.trace?.runtime?.requireAgentsTeamExecution, true);
  } finally {
    await server.close();
  }
});
