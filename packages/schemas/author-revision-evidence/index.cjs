"use strict";
const { createHash } = require("node:crypto");
const nonempty = value => typeof value === "string" && value.trim().length > 0;
class AuthorRevisionEvidenceError extends Error {}
const textHash = value => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

/** Preserve a host-verified source binding across the synchronous evidence
 * transport. This checks byte identities, not server ownership or acceptance. */
function boundSource(value, delivery) {
  if (value === undefined) return undefined;
  const source = value?.source, binding = value?.attemptBinding;
  if (!value || value.status !== undefined || Object.keys(value).sort().join(",") !== "attemptBinding,source,sourceEvidenceHash"
    || !source || !binding || binding.version !== 1 || !source.identity
    || source.identity.sourceExecutionId !== delivery.sourceExecutionId
    || source.identity.rootNodeRunId !== delivery.sourceNodeRunId
    || source.identity.leafNodeId !== delivery.targetNodeId
    || source.conversion?.deliveryHash !== delivery.deliveryHash
    || !nonempty(source.candidate) || source.candidateHash !== textHash(source.candidate)
    || value.sourceEvidenceHash !== textHash(JSON.stringify(source))
    || binding.sourceEvidenceHash !== value.sourceEvidenceHash
    || binding.candidateHash !== source.candidateHash || binding.deliveryHash !== delivery.deliveryHash
    || JSON.stringify(binding.sourceIdentity) !== JSON.stringify(source.identity)
    || binding.targetNodeId !== delivery.targetNodeId || !nonempty(binding.executionId)
    || binding.executionId === delivery.sourceExecutionId || !nonempty(binding.idempotencyKey)
    || typeof binding.requestHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(binding.requestHash)) {
    throw new AuthorRevisionEvidenceError("runtime_author_revision_source_binding_invalid");
  }
  const { bindingHash, ...facts } = binding;
  if (bindingHash !== textHash(JSON.stringify(facts))) throw new AuthorRevisionEvidenceError("runtime_author_revision_source_binding_invalid");
  return JSON.parse(JSON.stringify(value));
}

/** Literal RFC6901 tokens only. Existence/author ownership is checked against
 * the verified delivery projection at admission, never inferred from prose. */
function normalizeAuthorRevisionEditablePaths(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) throw new AuthorRevisionEvidenceError("runtime_author_revision_editable_paths_invalid");
  const paths = value.map(path => {
    if (typeof path !== "string" || (path !== "" && !path.startsWith("/"))) throw new AuthorRevisionEvidenceError("runtime_author_revision_editable_paths_invalid");
    const tokens = path === "" ? [] : path.slice(1).split("/").map(token => {
      if (/~(?:[^01]|$)/.test(token)) throw new AuthorRevisionEvidenceError("runtime_author_revision_editable_paths_invalid");
      return token.replace(/~[01]/g, escape => escape === "~0" ? "~" : "/");
    });
    return { path, tokens };
  });
  const prefix = (parent, child) => parent.length <= child.length && parent.every((token, index) => token === child[index]);
  for (let index = 0; index < paths.length; index += 1) {
    if (paths.slice(0, index).some(prior => prefix(prior.tokens, paths[index].tokens) || prefix(paths[index].tokens, prior.tokens))) {
      throw new AuthorRevisionEvidenceError("runtime_author_revision_editable_paths_overlap");
    }
  }
  return Object.freeze(paths.map(item => item.path).sort());
}

/** Delivery evidence is not an original author submission or a continuation. */
function normalizeAuthorRevisionEvidence(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.version !== 1 || value.sourceKind !== "delivery_artifact"
    || !["sourceExecutionId", "sourceNodeRunId", "targetNodeId", "deliveryArtifact", "diagnostic"].every(key => nonempty(value[key]))
    || typeof value.deliveryHash !== "string"
    || value.deliveryHash !== `sha256:${createHash("sha256").update(value.deliveryArtifact, "utf8").digest("hex")}`) {
    throw new AuthorRevisionEvidenceError("runtime_author_revision_evidence_invalid");
  }
  const editablePaths = normalizeAuthorRevisionEditablePaths(value.editablePaths);
  const authorSource = boundSource(value.authorSource, value);
  return { ...Object.fromEntries(["version", "sourceKind", "sourceExecutionId", "sourceNodeRunId", "targetNodeId", "deliveryHash", "deliveryArtifact", "diagnostic"].map(key => [key, value[key]])),
    ...(editablePaths ? { editablePaths } : {}), ...(authorSource ? { authorSource } : {}) };
}

function renderAuthorRevisionEvidence(value) {
  const evidence = normalizeAuthorRevisionEvidence(value);
  return evidence ? [
    "独立交付回执的修订观察：正文是已编译的交付版本，不是原作者提交、旧模型状态或旧工具执行状态。观察不替代本轮真实来源和输出合同，也不是任务终态裁决。",
    "<runtime_author_revision_evidence>", JSON.stringify(evidence), "</runtime_author_revision_evidence>",
    ...(evidence.authorSource ? ["The separately bound authorSource records the harness-accepted candidate before host compilation, its actual admitted contract and the exact forward delivery relation. It does not attest the provider's first response. Use the bound author representation as the revision baseline."] : []),
    ...(evidence.editablePaths ? ["Explicit author authorization: only these literal JSON Pointer subtrees may change in the verified author representation. All other author values and field presence remain exact; diagnostic prose never expands this authorization."] : []),
  ].join("\n") : null;
}

/** A resumed task cannot replace its bound observation, source receipt or artifact bytes. */
function resolveAuthorRevisionEvidence(supplied, persisted) {
  const incoming = normalizeAuthorRevisionEvidence(supplied);
  const retained = normalizeAuthorRevisionEvidence(persisted);
  if (incoming && retained && JSON.stringify(incoming) !== JSON.stringify(retained)) {
    throw new AuthorRevisionEvidenceError("runtime_author_revision_evidence_conflict");
  }
  return incoming || retained;
}

module.exports = { AuthorRevisionEvidenceError, normalizeAuthorRevisionEditablePaths, normalizeAuthorRevisionEvidence, renderAuthorRevisionEvidence, resolveAuthorRevisionEvidence };
