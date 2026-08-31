import assert from "node:assert/strict";
import test from "node:test";

import { buildHarnessDeliveryClosure } from "./delivery-contract.js";

const responseContract = {
  version: 2,
  contractHash: "sha256:identity-contract",
  delivery: {
    mode: "response",
    mediaType: null,
    kind: "answer",
    output: "回答助手身份",
  },
  must: [{ id: "must:identity", statement: "说明助手身份" }],
  unresolved: [],
};

test("binds a completed response-mode turn to the exact final response", () => {
  const closure = buildHarnessDeliveryClosure({
    turnContext: {
      logicalTaskId: "turn-1",
      userIntentContract: responseContract,
    },
    text: "我是小T。",
    harnessCompleted: true,
    exitedAt: "2026-08-31T04:00:00.000Z",
  });

  assert.equal(closure.succeeded, true);
  assert.deepEqual(closure.runOutcome, {
    version: 1,
    terminal: true,
    status: "succeeded",
    reason: "delivery_verified",
  });
  const terminalDelivery = closure.runtime.terminalDelivery as Record<string, unknown>;
  const evidence = terminalDelivery.deliveryEvidence as Array<Record<string, unknown>>;
  assert.match(String((evidence[0]?.attributes as Record<string, unknown>).sha256), /^[a-f0-9]{64}$/u);
});

test("refuses to manufacture success for an executable delivery from response text", () => {
  const closure = buildHarnessDeliveryClosure({
    turnContext: {
      logicalTaskId: "turn-2",
      userIntentContract: {
        ...responseContract,
        delivery: {
          mode: "state_change",
          mediaType: null,
          kind: "canvas_mutation",
          output: "写入画布",
        },
      },
    },
    text: "我已经写入画布。",
    harnessCompleted: true,
  });

  assert.equal(closure.succeeded, false);
  assert.equal(closure.runtime.terminalDelivery, undefined);
  assert.equal(closure.runOutcome.reason, "delivery_verification_missing");
});

test("projects an incomplete Harness turn as an explicit failed physical exit", () => {
  const closure = buildHarnessDeliveryClosure({
    turnContext: { logicalTaskId: "turn-3" },
    text: "",
    harnessCompleted: false,
  });

  assert.equal(closure.succeeded, false);
  assert.equal(closure.runOutcome.reason, "deepseek_harness_turn_incomplete");
});

test("verifies an exact user response from a terminal standard workflow output", () => {
  const closure = buildHarnessDeliveryClosure({
    turnContext: { logicalTaskId: "turn-workflow-response" },
    text: "固定工作流回复",
    harnessCompleted: true,
    exitedAt: "2026-08-31T08:00:00.000Z",
    remoteExecutions: [{
      name: "tapcanvas_equipped_workflow_run",
      args: { idempotencyKey: "stable-key" },
      startedAt: "2026-08-31T07:59:59.000Z",
      finishedAt: "2026-08-31T08:00:00.000Z",
      durationMs: 1_000,
      status: "succeeded",
      outputText: "workflow receipt",
      structuredOutput: {
        ok: true,
        data: {
          protocolVersion: "tapcanvas.workflow-execution-receipt/v1",
          executionId: "execution-1",
          status: "success",
          terminal: true,
          workflowOutputs: [{
            nodeId: "output-1",
            ports: { output: { text: ["固定工作流回复"] } },
            artifacts: [],
          }],
        },
      },
    }],
  });

  assert.equal(closure.succeeded, true);
  assert.equal(closure.runOutcome.reason, "delivery_verified");
  const terminalDelivery = closure.runtime.terminalDelivery as Record<string, unknown>;
  const evidence = terminalDelivery.deliveryEvidence as Array<Record<string, unknown>>;
  assert.deepEqual(evidence.map((item) => item.kind), ["tool_call", "final_response"]);
});

test("rejects a response that differs from the terminal workflow output", () => {
  const closure = buildHarnessDeliveryClosure({
    turnContext: { logicalTaskId: "turn-workflow-mismatch" },
    text: "被改写的回复",
    harnessCompleted: true,
    remoteExecutions: [{
      name: "tapcanvas_equipped_workflow_run",
      args: {},
      startedAt: "2026-08-31T07:59:59.000Z",
      finishedAt: "2026-08-31T08:00:00.000Z",
      durationMs: 1_000,
      status: "succeeded",
      outputText: "workflow receipt",
      structuredOutput: {
        protocolVersion: "tapcanvas.workflow-execution-receipt/v1",
        executionId: "execution-2",
        status: "success",
        terminal: true,
        workflowOutputs: [{ ports: { output: { text: ["原始回复"] } } }],
      },
    }],
  });

  assert.equal(closure.succeeded, false);
  assert.equal(closure.runOutcome.reason, "delivery_verification_missing");
});
