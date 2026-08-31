import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { AgentsChatRequest } from "./contracts.js";
import { HarnessChatLifecycleStore } from "./chat-lifecycle.js";

function request(): AgentsChatRequest {
  return {
    prompt: "你是谁？",
    stream: true,
    systemPrompt: "You are 小T.",
    sessionId: "project:1:flow:1:lane:general",
    userId: "user-1",
    model: "gpt-5.6-luna",
    apiBaseUrl: "http://models.test/v1",
    apiKey: "test-key",
    apiStyle: "openai-responses",
    requiredSkills: [],
    requiredSkillCalls: [],
    externalSkills: [],
    externalSkillResolverConfig: null,
    referenceImages: [],
    assetInputs: [],
    remoteTools: [],
    remoteToolCatalog: [],
    remoteToolConfig: null,
    turnContext: {
      logicalTaskId: "public-chat-turn:1",
      publicTurnId: "public-chat-turn:1",
    },
    raw: { turnDisplayText: "你是谁？" },
  };
}

test("returns a durable idle snapshot before the first Harness turn", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tapcanvas-harness-lifecycle-"));
  try {
    const store = new HarnessChatLifecycleStore(root);
    assert.deepEqual(
      await store.status("user-1", "project:1:flow:1:lane:general"),
      {
        sessionId: "project:1:flow:1:lane:general",
        durable: true,
        activeTurn: false,
        turn: null,
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persists the exact running turn and exposes an interruptible controller", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tapcanvas-harness-lifecycle-"));
  try {
    const store = new HarnessChatLifecycleStore(root);
    const lease = await store.begin(request());
    const running = await store.status("user-1", lease.sessionId);
    assert.equal(running.activeTurn, true);
    assert.equal(running.turn?.turnId, "public-chat-turn:1");
    assert.equal(
      (running.turn?.logicalTaskState as Record<string, unknown>).physicalRunStatus,
      "running",
    );

    const interrupted = await store.interrupt({
      userId: "user-1",
      sessionId: lease.sessionId,
      turnId: lease.turnId,
      reasonCode: "chat_turn_user_interrupt",
    });
    assert.equal(interrupted.interrupted, true);
    assert.equal(interrupted.snapshot.activeTurn, false);
    assert.equal(lease.signal.aborted, true);

    const reloaded = new HarnessChatLifecycleStore(root);
    const persisted = await reloaded.status("user-1", lease.sessionId);
    assert.equal(persisted.activeTurn, false);
    assert.equal(
      (persisted.turn?.logicalTaskState as Record<string, unknown>).status,
      "cancelled",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not report a persisted running checkpoint as live after Bridge restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tapcanvas-harness-lifecycle-"));
  try {
    const firstProcess = new HarnessChatLifecycleStore(root);
    const lease = await firstProcess.begin(request());

    const restartedProcess = new HarnessChatLifecycleStore(root);
    const recovered = await restartedProcess.status("user-1", lease.sessionId);
    assert.equal(recovered.activeTurn, false);
    assert.equal(
      (recovered.turn?.logicalTaskState as Record<string, unknown>).status,
      "failed",
    );
    assert.equal(
      (recovered.turn?.logicalTaskState as Record<string, unknown>).reasonCode,
      "deepseek_harness_process_restarted",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
