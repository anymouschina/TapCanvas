import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHOR_SOURCE_REPRESENTATION, authorSourceJsonHash, authorSourceTextHash, verifyServerAuthorSourceRepresentation,
  type AuthorSourceIdentityV1, type ServerAuthorSourceRepresentationV1, type ServerAuthorSourceExpectationsV1,
  type AuthorSourceRevisionAttemptV1,
} from "./index.mjs";

test("JSON hashes survive nested object key ordering while array and text order remain exact", () => {
  const original = { z: [{ b: 2, a: { y: true, x: "原文" } }, 7], a: false };
  const reordered = { a: false, z: [{ a: { x: "原文", y: true }, b: 2 }, 7] };
  assert.equal(authorSourceJsonHash(original), authorSourceJsonHash(reordered));
  assert.notEqual(authorSourceJsonHash(original), authorSourceJsonHash({ ...reordered, z: [7, reordered.z[0]] }));
  assert.notEqual(authorSourceTextHash("原文"), authorSourceTextHash("原文\n"));
});

function fixture(kind: "document" | "table" = "document") {
  const identity: AuthorSourceIdentityV1 = { ownerId: "authorized-owner", flowId: "flow", flowVersionId: "frozen-version",
    sourceExecutionId: "source-execution", rootNodeId: "root", rootNodeRunId: "durable-parent-run",
    leafNodeId: "exact-selected-leaf", taskId: "logical-task", sessionId: "durable-session", turnId: "public-turn" };
  const candidate = kind === "document" ? '{"heading":"Exact author text","body":"No semantic assessment"}' : '{"rows":[{"cells":[1,2]}]}';
  const candidateHash = authorSourceTextHash(candidate);
  const contract = { kind: "json", jsonSchema: { type: "object", required: kind === "document" ? ["heading", "body"] : ["rows"] },
    submissionPolicy: "repair_with_correction", requiredStringFields: kind === "document" ? ["heading", "body"] : [],
    runtimeFacts: { source: "actual frozen task", mode: kind } };
  const inputs = { bindings: [{ sourceNodeRunId: "successful-upstream", portId: "source", value: { revision: 7, mode: kind } }] };
  const contractHash = authorSourceJsonHash(contract), inputHash = authorSourceJsonHash(inputs);
  // These are actual results of two deterministic fixture converters, not
  // inferred text from a delivery hash or replayed author/provider requests.
  const first = JSON.stringify({ author: JSON.parse(candidate) as unknown, inputRevision: inputs.bindings[0]!.value.revision });
  const delivery = JSON.stringify({ format: kind, contents: JSON.parse(first) as unknown });
  const outputs = [first, delivery];
  const converters = [{ id: "test.attach-frozen-input", version: "v1" }, { id: "test.delivery-envelope", version: "v2" }];
  const source: ServerAuthorSourceRepresentationV1 = { version: 1, representation: AUTHOR_SOURCE_REPRESENTATION, identity,
    acceptance: { kind: "harness_accepted_candidate", receiptRef: "source-node-evidence://accepted-checkpoint", candidateHash, authorContractHash: contractHash },
    candidate, candidateHash, authorContract: { ref: "source-capsule://outputContract", value: contract, hash: contractHash },
    frozenInputs: { ref: "source-node-run://inputRefs", hash: inputHash }, conversion: { steps: outputs.map((output, index) => ({
      converterId: converters[index]!.id, converterVersion: converters[index]!.version,
      inputHash: index === 0 ? candidateHash : authorSourceTextHash(outputs[index - 1]!), outputHash: authorSourceTextHash(output),
      frozenInputHash: inputHash, frozenInputRef: "source-node-run://inputRefs" })), deliveryHash: authorSourceTextHash(delivery) } };
  const expected: ServerAuthorSourceExpectationsV1 = { identity, acceptanceRef: source.acceptance.receiptRef, candidateHash,
    authorContract: { ref: source.authorContract.ref, value: contract }, frozenInputs: { ref: source.frozenInputs.ref, value: inputs }, converters };
  const attempt: AuthorSourceRevisionAttemptV1 = { executionId: "independent-revision", targetNodeId: identity.leafNodeId,
    idempotencyKey: "explicit-new-attempt", requestHash: authorSourceTextHash("server-validated-request") };
  return { serverRecord: source, expected, actualForwardOutputs: outputs, savedDelivery: delivery, attempt };
}

function rejected(input: Parameters<typeof verifyServerAuthorSourceRepresentation>[0], code?: string) {
  const outcome = verifyServerAuthorSourceRepresentation(input);
  assert.equal(outcome.status, "current_action_not_applied");
  if (outcome.status !== "current_action_not_applied") throw new Error("unreachable accepted fixture");
  assert.equal(outcome.diagnostic.currentActionApplied, false);
  if (code) assert.equal(outcome.diagnostic.code, code);
  assert.ok(JSON.stringify(outcome.diagnostic).length < 300);
  return outcome;
}

for (const kind of ["document", "table"] as const) test(`${kind}: actual forward outputs bind canonical candidate, contract and delivery separately`, () => {
  const input = fixture(kind), before = JSON.stringify(input);
  const result = verifyServerAuthorSourceRepresentation(input);
  assert.equal(result.status, "verified");
  if (result.status !== "verified") throw new Error("fixture rejected");
  assert.equal(result.source.representation, "harness_accepted_pre_host_compilation_candidate");
  assert.notEqual(result.attemptBinding.candidateHash, result.attemptBinding.deliveryHash);
  assert.equal(result.source.candidate, input.serverRecord.candidate);
  assert.deepEqual(result.source.authorContract.value, input.expected.authorContract.value);
  assert.equal(result.attemptBinding.sourceEvidenceHash, authorSourceJsonHash(input.serverRecord));
  assert.equal(JSON.stringify(input), before, "original delivery/paid/schema facts are untouched");
  assert.ok(Object.isFrozen(result.source));
});

test("every durable source identity field is independently bound, including owner and parent/leaf/task/session/turn", () => {
  const input = fixture();
  for (const key of Object.keys(input.serverRecord.identity) as (keyof AuthorSourceIdentityV1)[]) rejected({ ...input,
    serverRecord: { ...input.serverRecord, identity: { ...input.serverRecord.identity, [key]: "other-authorized-or-unrelated-resource" } } }, "author_source_identity_mismatch");
});

test("self-reported hashes and an invented provider-raw origin cannot establish accepted source", () => {
  const input = fixture();
  const fake = "Different author body";
  rejected({ ...input, serverRecord: { ...input.serverRecord, candidate: fake, candidateHash: authorSourceTextHash(fake) } }, "author_source_candidate_identity_mismatch");
  rejected({ ...input, serverRecord: { ...input.serverRecord, representation: "original_provider_raw" } }, "author_source_representation_invalid");
  const { candidate: _missing, ...hashOnly } = input.serverRecord;
  rejected({ ...input, serverRecord: hashOnly }, "author_source_record_shape_invalid");
  rejected({ ...input, serverRecord: { ...input.serverRecord, acceptance: { ...input.serverRecord.acceptance, receiptRef: "client-claimed-acceptance" } } }, "author_source_acceptance_identity_mismatch");
});

test("full actual contract and frozen inputs/ref cannot be replaced even with recomputed hashes", () => {
  const input = fixture();
  const changed = { differentContract: "not the original typed contract" }, changedHash = authorSourceJsonHash(changed);
  rejected({ ...input, serverRecord: { ...input.serverRecord, authorContract: { ...input.serverRecord.authorContract, value: changed, hash: changedHash },
    acceptance: { ...input.serverRecord.acceptance, authorContractHash: changedHash } } }, "author_source_contract_mismatch");
  rejected({ ...input, expected: { ...input.expected, frozenInputs: { ...input.expected.frozenInputs, value: { wrongSource: true } } } }, "author_source_frozen_input_mismatch");
  rejected({ ...input, serverRecord: { ...input.serverRecord, frozenInputs: { ...input.serverRecord.frozenInputs, ref: "other-node-run" } } }, "author_source_frozen_input_mismatch");
});

test("converter identity/version, actual results and the ordered forward chain cannot be invented or skipped", () => {
  const input = fixture();
  for (const [key, code] of [["converterVersion", "author_source_converter_mismatch"], ["converterId", "author_source_converter_mismatch"],
    ["inputHash", "author_source_conversion_chain_mismatch"], ["frozenInputHash", "author_source_frozen_input_mismatch"],
    ["frozenInputRef", "author_source_frozen_input_mismatch"]] as const) {
    const value = key.endsWith("Hash") ? authorSourceTextHash("other-facts") : "other-version-or-ref";
    rejected({ ...input, serverRecord: { ...input.serverRecord, conversion: { ...input.serverRecord.conversion,
      steps: input.serverRecord.conversion.steps.map((step, index) => index === 0 ? { ...step, [key]: value } : step) } } }, code);
  }
  rejected({ ...input, actualForwardOutputs: ["wrong actual result", input.savedDelivery] }, "author_source_forward_result_mismatch");
  rejected({ ...input, actualForwardOutputs: [] }, "author_source_conversion_steps_invalid");
  rejected({ ...input, serverRecord: { ...input.serverRecord, conversion: { ...input.serverRecord.conversion,
    steps: [...input.serverRecord.conversion.steps].reverse() } } }, "author_source_converter_mismatch");
});

test("final provided forward result must equal saved delivery exact UTF-8 text, not a similar JSON object", () => {
  const input = fixture();
  const equivalent = JSON.stringify(JSON.parse(input.savedDelivery) as unknown, null, 2);
  rejected({ ...input, savedDelivery: equivalent }, "author_source_delivery_hash_mismatch");
  const wrongHash = authorSourceTextHash(equivalent);
  rejected({ ...input, savedDelivery: equivalent, serverRecord: { ...input.serverRecord, conversion: { ...input.serverRecord.conversion,
    deliveryHash: wrongHash } } }, "author_source_forward_delivery_mismatch");
});

test("same source can bind an explicit independent attempt; new keys have distinct binding without replacing source evidence", () => {
  const input = fixture();
  const result = verifyServerAuthorSourceRepresentation(input), repeat = verifyServerAuthorSourceRepresentation(input);
  assert.deepEqual(repeat, result);
  const next = verifyServerAuthorSourceRepresentation({ ...input, attempt: { ...input.attempt, executionId: "another-independent-attempt", idempotencyKey: "new-explicit-key" } });
  assert.equal(result.status, "verified"); assert.equal(next.status, "verified");
  if (result.status === "verified" && next.status === "verified") {
    assert.deepEqual(next.source, result.source);
    assert.notEqual(next.attemptBinding.bindingHash, result.attemptBinding.bindingHash);
  }
  rejected({ ...input, attempt: { ...input.attempt, executionId: input.serverRecord.identity.sourceExecutionId } }, "author_source_attempt_not_independent");
  rejected({ ...input, attempt: { ...input.attempt, targetNodeId: "off-route-sibling" } }, "author_source_attempt_target_mismatch");
});

test("unavailable/malformed history rejects only this action, without reading source bodies, getters or unknown paid state", () => {
  const input = fixture();
  const secret = "PRIVATE_LONG_SOURCE_".repeat(10000);
  rejected({ ...input, serverRecord: null }, "author_source_record_shape_invalid");
  rejected({ ...input, serverRecord: { ...input.serverRecord, candidate: secret } }, "author_source_candidate_hash_mismatch");
  let getterCalls = 0;
  const getter = Object.defineProperty({}, "candidate", { enumerable: true, get() { getterCalls += 1; return secret; } });
  const outcome = rejected({ ...input, serverRecord: getter }, "author_source_json_invalid");
  assert.equal(getterCalls, 0); assert.equal(JSON.stringify(outcome).includes("PRIVATE_LONG_SOURCE_"), false);
  const before = JSON.stringify(input);
  rejected({ ...input, serverRecord: { ...input.serverRecord, paidState: { status: "inference_attempted_unknown" } } }, "author_source_record_shape_invalid");
  assert.equal(JSON.stringify(input), before);
});

test("empty exact expected facts and unknown schema/converter metadata are not silently supplied", () => {
  const input = fixture();
  rejected({ ...input, expected: { ...input.expected, candidateHash: "" } }, "author_source_hash_invalid");
  rejected({ ...input, expected: { ...input.expected, converters: [{ id: "test.attach-frozen-input", version: "" }, input.expected.converters[1]!] } }, "author_source_text_invalid");
  rejected({ ...input, serverRecord: { ...input.serverRecord, authorContract: { ...input.serverRecord.authorContract, value: null } } }, "author_source_contract_invalid");
});

test("explicit zero-step identity relation needs no invented converter but still preserves exact source bytes", () => {
  const original = fixture();
  const input = { ...original, serverRecord: { ...original.serverRecord, conversion: { steps: [], deliveryHash: original.serverRecord.candidateHash } },
    expected: { ...original.expected, converters: [] }, actualForwardOutputs: [], savedDelivery: original.serverRecord.candidate };
  assert.equal(verifyServerAuthorSourceRepresentation(input).status, "verified");
  const equivalent = JSON.stringify(JSON.parse(input.savedDelivery) as unknown, null, 2);
  rejected({ ...input, savedDelivery: equivalent, serverRecord: { ...input.serverRecord, conversion: { steps: [], deliveryHash: authorSourceTextHash(equivalent) } } },
    "author_source_forward_delivery_mismatch");
  rejected({ ...input, actualForwardOutputs: [input.savedDelivery] }, "author_source_conversion_steps_invalid");
  rejected({ ...input, expected: original.expected }, "author_source_conversion_steps_invalid");
  rejected({ ...original, actualForwardOutputs: [] }, "author_source_conversion_steps_invalid");
});
