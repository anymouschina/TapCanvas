const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { normalizeAuthorRevisionEvidence, renderAuthorRevisionEvidence, resolveAuthorRevisionEvidence } = require("./index.cjs");
const deliveryArtifact = "compiled delivery without the original envelope";
const fixture = { version: 1, sourceKind: "delivery_artifact", sourceExecutionId: "execution-a",
  sourceNodeRunId: "run-a", targetNodeId: "author-a", deliveryArtifact,
  deliveryHash: `sha256:${createHash("sha256").update(deliveryArtifact).digest("hex")}`, diagnostic: "Observation from the actual delivered fields" };
test("retains exact delivery identity and treats it as evidence instead of an edit candidate", () => {
  assert.deepEqual(normalizeAuthorRevisionEvidence({ ...fixture, candidate: "wrong raw candidate", restoreTurn: true }), fixture);
  const prompt = renderAuthorRevisionEvidence(fixture);
  assert.deepEqual(JSON.parse(prompt.split("<runtime_author_revision_evidence>\n")[1].split("\n</runtime_author_revision_evidence>")[0]), fixture);
  assert.ok(!prompt.includes("wrong raw candidate"));
});
test("rejects mismatched delivery bytes and structurally incomplete evidence", () => {
  assert.throws(() => normalizeAuthorRevisionEvidence({ ...fixture, deliveryArtifact: deliveryArtifact + "changed" }));
  assert.throws(() => normalizeAuthorRevisionEvidence({ ...fixture, sourceKind: "original_candidate" }));
  assert.throws(() => normalizeAuthorRevisionEvidence({ ...fixture, sourceNodeRunId: "" }));
  assert.equal(normalizeAuthorRevisionEvidence(undefined), null);
});
test("capsule-only recovery binds the exact receipt and rejects replacement identities or observations", () => {
  const persisted = JSON.parse(JSON.stringify(fixture));
  assert.deepEqual(resolveAuthorRevisionEvidence(undefined, persisted), fixture);
  assert.deepEqual(resolveAuthorRevisionEvidence({ ...fixture, ignored: true }, persisted), fixture);
  for (const key of ["sourceExecutionId", "sourceNodeRunId", "targetNodeId", "diagnostic"]) {
    assert.throws(() => resolveAuthorRevisionEvidence({ ...fixture, [key]: "different" }, persisted), /runtime_author_revision_evidence_conflict/);
  }
  const replacement = "another valid artifact";
  assert.throws(() => resolveAuthorRevisionEvidence({ ...fixture, deliveryArtifact: replacement,
    deliveryHash: `sha256:${createHash("sha256").update(replacement).digest("hex")}` }, persisted), /runtime_author_revision_evidence_conflict/);
  assert.throws(() => resolveAuthorRevisionEvidence(undefined, { ...fixture, deliveryArtifact: replacement }), /runtime_author_revision_evidence_invalid/);
});
test("explicit literal editable paths survive receipts and cold binding without inferring permissions", () => {
  const evidence = { ...fixture, editablePaths: ["/z/~0", "/a/~1"] };
  const retained = normalizeAuthorRevisionEvidence(evidence);
  assert.deepEqual(retained.editablePaths, ["/a/~1", "/z/~0"]);
  assert.deepEqual(resolveAuthorRevisionEvidence(undefined, JSON.parse(JSON.stringify(retained))), retained);
  assert.throws(() => resolveAuthorRevisionEvidence({ ...fixture, editablePaths: ["/a"] }, retained), /conflict/);
  assert.throws(() => resolveAuthorRevisionEvidence(fixture, retained), /conflict/);
  assert.throws(() => resolveAuthorRevisionEvidence(retained, fixture), /conflict/);
  for (const editablePaths of [[], ["relative"], ["/bad~2"], ["/a", "/a/b"], ["/a", "/a"], ["", "/a"]]) {
    assert.throws(() => normalizeAuthorRevisionEvidence({ ...fixture, editablePaths }), /editable_paths/);
  }
  assert.deepEqual(normalizeAuthorRevisionEvidence({ ...fixture, editablePaths: [""] }).editablePaths, [""]);
});
