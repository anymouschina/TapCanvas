const test = require("node:test");
const assert = require("node:assert/strict");
const { projectAtomicAuthorSelfCheck, projectAtomicAuthorSelfCheckMetadata } = require("./index.cjs");
const receipt = {
  version: 1, status: "performed", scopeHash: `sha256:${"a".repeat(64)}`, candidateHash: `sha256:${"b".repeat(64)}`,
  evidenceFingerprint: "c".repeat(64), execution: { model: "author", reasoningEffort: "high" },
  criteria: [{ requirement: "Fulfill source obligation", evidenceIds: ["source-1"], assessment: "revision_required", rationale: "Source fact still differs", revisionAction: "Revise source fact" }],
  inferenceCalls: [{ model: "author", reasoningEffort: "high", startedAt: "2026-09-30T00:00:00Z", finishedAt: "2026-09-30T00:00:01Z", status: "completed", usage: { totalTokens: 5, reasoningTokens: 1 } }],
};
test("independent atomic observations retain true model receipts without author drafts", () => {
  assert.deepEqual(projectAtomicAuthorSelfCheck({ ...receipt, candidate: "private draft", revisions: [] }, receipt.candidateHash), { receipt, issue: null });
  assert.equal(projectAtomicAuthorSelfCheckMetadata({ atomicAuthorSelfCheck: receipt }).atomicAuthorSelfCheck.criteria[0].assessment, "revision_required");
});
test("single-inference non-execution cannot claim independent criteria or inferred success", () => {
  const unavailable = { ...receipt, status: "not_performed", reason: "single_inference_contract", criteria: [], inferenceCalls: [] };
  assert.deepEqual(projectAtomicAuthorSelfCheck(unavailable), { receipt: unavailable, issue: null });
  for (const value of [{ ...unavailable, criteria: receipt.criteria }, { ...receipt, inferenceCalls: [] }, { ...receipt, criteria: [] }, { ...receipt, execution: {} }, { ...receipt, inferenceCalls: [{ ...receipt.inferenceCalls[0], usage: { totalTokens: -1 } }] },
    { ...receipt, inferenceCalls: [{ ...receipt.inferenceCalls[0], model: "another-model" }] },
    { ...receipt, inferenceCalls: [{ ...receipt.inferenceCalls[0], reasoningEffort: "low" }] },
    { ...receipt, inferenceCalls: [{ ...receipt.inferenceCalls[0], finishedAt: "invalid-timestamp" }] }]) {
    assert.equal(projectAtomicAuthorSelfCheck(value).issue.reason, "invalid_receipt");
  }
});
test("candidate identity and malformed diagnostics remain explicit across metadata normalization", () => {
  const expectedCandidateHash = `sha256:${"d".repeat(64)}`;
  const mismatch = projectAtomicAuthorSelfCheckMetadata({ atomicAuthorSelfCheck: receipt }, expectedCandidateHash);
  assert.deepEqual(mismatch, { atomicAuthorSelfCheckProjectionIssue: { reason: "candidate_identity_mismatch", observedCandidateHash: receipt.candidateHash, expectedCandidateHash } });
  assert.deepEqual(projectAtomicAuthorSelfCheckMetadata(JSON.parse(JSON.stringify(mismatch))), mismatch);
  assert.deepEqual(projectAtomicAuthorSelfCheckMetadata({ atomicAuthorSelfCheckProjectionIssue: { reason: "unknown" } }), { atomicAuthorSelfCheckProjectionIssue: { reason: "invalid_projection_issue" } });
  assert.deepEqual(projectAtomicAuthorSelfCheckMetadata({}), {});
});
