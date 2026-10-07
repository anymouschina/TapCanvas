import { expect, it } from "vitest";
import { AUTHOR_SOURCE_REPRESENTATION, authorSourceJsonHash, authorSourceTextHash } from "../../../../../packages/schemas/author-source-representation/index.mjs";
import { admitWorkflowAuthorSource } from "./execution.author-source-admission";
import { projectWorkflowAuthorSource } from "./execution.author-source";
import type { WorkflowNodeOutputV1 } from "./execution.node-runtime";

function fixture(candidate = '{"body":{"content":"exact author text"}}', delivery = '{"body":"exact author text"}') {
  const contract = { kind: "json", submissionPolicy: "repair_with_correction", jsonSchema: {
    type: "object", properties: { body: { type: "object", required: ["content"], properties: { content: { type: "string" } } } }, required: ["body"],
  } };
  const candidateHash = authorSourceTextHash(candidate), contractHash = authorSourceJsonHash(contract);
  const accepted = { version: 1, representation: AUTHOR_SOURCE_REPRESENTATION,
    identity: { taskId: "source-task", sessionId: "actual-source-session", turnId: "actual-source-turn" },
    acceptance: { kind: "harness_accepted_candidate", receiptRef: "actual-source-turn", candidateHash, authorContractHash: contractHash },
    candidate, candidateHash, authorContract: { ref: "actual-source-turn#/acceptedAuthorSource/authorContract/value", value: contract, hash: contractHash },
    sourceContext: { value: "actual frozen author facts", hash: authorSourceTextHash("actual frozen author facts") } };
  const projected = projectWorkflowAuthorSource({ identity: { ownerId: "owner", flowId: "flow", flowVersionId: "original-version",
    sourceExecutionId: "source-execution", leafNodeId: "nested-leaf", taskId: "source-task" }, accepted,
    hostInputText: candidate, deliveryText: delivery, frozenInputs: { source: [{ id: "original-input" }] } });
  expect(projected.authorSourceIssue).toBeUndefined();
  const output: WorkflowNodeOutputV1 = { protocolVersion: "1", nodeId: "nested-leaf", executorRef: "agents.logical-task/v2", executionMode: "once",
    ports: { result: { text: delivery } }, artifacts: [], evidence: { taskId: "source-task", executorCompleted: true, authorSource: projected.authorSource }, itemRuns: [] };
  return { output, ownerId: "owner", flowId: "flow", flowVersionId: "original-version", sourceExecutionId: "source-execution",
    rootNodeId: "root-pipeline", rootNodeRunId: "actual-root-run", savedDelivery: delivery,
    attempt: { executionId: "independent-new-execution", targetNodeId: "nested-leaf", idempotencyKey: "explicit-new-attempt", requestHash: authorSourceTextHash("actual admitted request") } };
}

it("binds a server captured author representation to the actual root receipt and independent attempt without mutating either", () => {
  const input = fixture(), before = structuredClone(input);
  const result = admitWorkflowAuthorSource(input);
  expect(result.status).toBe("verified");
  if (result.status !== "verified") throw new Error(result.diagnostic.code);
  expect(result.source.identity.rootNodeRunId).toBe(input.rootNodeRunId);
  expect(result.source.candidate).not.toBe(input.savedDelivery);
  expect(result.source.authorContract.value).toHaveProperty("jsonSchema");
  expect(result.attemptBinding.executionId).toBe(input.attempt.executionId);
  expect(input).toEqual(before);
});

it("rejects a receipt from another owner, version, execution, leaf, task, delivery or attempted target", () => {
  const input = fixture();
  for (const changed of [{ ...input, ownerId: "other-owner" }, { ...input, flowId: "other-flow" },
    { ...input, flowVersionId: "current-new-version" }, { ...input, sourceExecutionId: "other-source" },
    { ...input, output: { ...input.output, nodeId: "sibling-leaf" } },
    { ...input, output: { ...input.output, evidence: { ...input.output.evidence, taskId: "other-task" } } },
    { ...input, savedDelivery: `${input.savedDelivery}\n` },
    { ...input, attempt: { ...input.attempt, targetNodeId: "sibling-leaf" } },
    { ...input, attempt: { ...input.attempt, executionId: input.sourceExecutionId } }]) {
    expect(admitWorkflowAuthorSource(changed)).toMatchObject({ status: "current_action_not_applied", diagnostic: { currentActionApplied: false } });
  }
});

it("keeps missing source explicit and rejects invented accepted contract references or unregistered conversion facts", () => {
  const input = fixture();
  const missing = { ...input, output: { ...input.output, evidence: { taskId: "source-task" } } };
  expect(admitWorkflowAuthorSource(missing)).toMatchObject({ status: "current_action_not_applied", diagnostic: { code: "author_source_not_recorded" } });
  const kernel = structuredClone(input.output.evidence.authorSource) as Record<string, unknown>;
  const contract = kernel.authorContract as Record<string, unknown>;
  contract.ref = "invented-acceptance";
  expect(admitWorkflowAuthorSource({ ...input, output: { ...input.output, evidence: { ...input.output.evidence, authorSource: kernel } } }))
    .toMatchObject({ status: "current_action_not_applied", diagnostic: { code: "author_source_accepted_receipt_invalid" } });
  const unknown = structuredClone(input.output.evidence.authorSource) as Record<string, unknown>;
  const conversion = unknown.conversion as { steps: { converterId: string }[] };
  conversion.steps[0].converterId = "model-self-reported-converter";
  expect(admitWorkflowAuthorSource({ ...input, output: { ...input.output, evidence: { ...input.output.evidence, authorSource: unknown } } }))
    .toMatchObject({ status: "current_action_not_applied", diagnostic: { code: "author_source_converter_unregistered" } });
});

it("supports actual zero host conversion without manufacturing an identity converter", () => {
  const candidate = ' {"body":"actual exact text"}\n';
  const input = fixture(candidate, candidate);
  const result = admitWorkflowAuthorSource(input);
  expect(result.status).toBe("verified");
  if (result.status === "verified") expect(result.source.conversion.steps).toEqual([]);
});
