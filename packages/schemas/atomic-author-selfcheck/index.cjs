"use strict";

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = value => typeof value === "string" && value.trim().length > 0;
const hash = value => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const fingerprint = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const effort = value => value === null || nonempty(value);
const timestamp = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const count = value => typeof value === "number" && Number.isFinite(value) && value >= 0;

function projectAtomicAuthorSelfCheck(value, expectedCandidateHash) {
  if (value === undefined) return { receipt: null, issue: null };
  const invalid = () => ({ receipt: null, issue: { reason: "invalid_receipt", ...(record(value) && hash(value.candidateHash) ? { observedCandidateHash: value.candidateHash } : {}) } });
  if (!record(value) || value.version !== 1
    || (value.status !== "performed" && value.status !== "not_performed")
    || !hash(value.scopeHash) || !hash(value.candidateHash) || !fingerprint(value.evidenceFingerprint)
    || !Array.isArray(value.criteria) || !Array.isArray(value.inferenceCalls)
    || !record(value.execution) || !nonempty(value.execution.model) || !effort(value.execution.reasoningEffort)
    || (value.reason !== undefined && !nonempty(value.reason))) return invalid();
  if (expectedCandidateHash !== undefined && (!hash(expectedCandidateHash) || value.candidateHash !== expectedCandidateHash)) {
    return { receipt: null, issue: { reason: "candidate_identity_mismatch", observedCandidateHash: value.candidateHash, ...(hash(expectedCandidateHash) ? { expectedCandidateHash } : {}) } };
  }
  const criteria = [];
  for (const item of value.criteria) {
    if (!record(item) || !nonempty(item.requirement) || !nonempty(item.rationale)
      || !Array.isArray(item.evidenceIds) || !item.evidenceIds.every(nonempty)
      || !["met", "revision_required", "diagnostic"].includes(item.assessment)
      || !(item.revisionAction === null || nonempty(item.revisionAction))
      || (item.assessment === "revision_required" && !nonempty(item.revisionAction))) return invalid();
    criteria.push({ requirement: item.requirement, evidenceIds: [...item.evidenceIds], assessment: item.assessment, rationale: item.rationale, revisionAction: item.revisionAction });
  }
  const inferenceCalls = [];
  const usageFields = ["inputTokens", "outputTokens", "reasoningTokens", "cacheReadInputTokens", "cacheCreationInputTokens"];
  for (const item of value.inferenceCalls) {
    if (!record(item) || !nonempty(item.model) || !effort(item.reasoningEffort)
      || item.model !== value.execution.model || item.reasoningEffort !== value.execution.reasoningEffort
      || !timestamp(item.startedAt) || !timestamp(item.finishedAt) || Date.parse(item.finishedAt) < Date.parse(item.startedAt)
      || (item.status !== "completed" && item.status !== "failed")
      || (item.error !== undefined && !nonempty(item.error))) return invalid();
    let usage;
    if (item.usage !== undefined) {
      if (!record(item.usage) || !count(item.usage.totalTokens) || !usageFields.every(key => item.usage[key] === undefined || count(item.usage[key]))) return invalid();
      usage = { totalTokens: item.usage.totalTokens };
      for (const key of usageFields) if (item.usage[key] !== undefined) usage[key] = item.usage[key];
    }
    inferenceCalls.push({ model: item.model, reasoningEffort: item.reasoningEffort, startedAt: item.startedAt, finishedAt: item.finishedAt, status: item.status, ...(usage ? { usage } : {}), ...(item.error !== undefined ? { error: item.error } : {}) });
  }
  if (value.status === "performed" && (criteria.length === 0 || !inferenceCalls.some(item => item.status === "completed"))) return invalid();
  if (value.status === "not_performed" && (criteria.length !== 0 || !nonempty(value.reason))) return invalid();
  return { receipt: { version: 1, status: value.status, scopeHash: value.scopeHash, candidateHash: value.candidateHash, evidenceFingerprint: value.evidenceFingerprint, criteria, ...(value.reason !== undefined ? { reason: value.reason } : {}), execution: { model: value.execution.model, reasoningEffort: value.execution.reasoningEffort }, inferenceCalls }, issue: null };
}

function normalizeAtomicAuthorSelfCheckProjectionIssue(value) {
  if (!record(value) || !["invalid_receipt", "candidate_identity_mismatch", "invalid_projection_issue"].includes(value.reason)
    || (value.observedCandidateHash !== undefined && !hash(value.observedCandidateHash))
    || (value.expectedCandidateHash !== undefined && !hash(value.expectedCandidateHash))) return null;
  return { reason: value.reason, ...(value.observedCandidateHash !== undefined ? { observedCandidateHash: value.observedCandidateHash } : {}), ...(value.expectedCandidateHash !== undefined ? { expectedCandidateHash: value.expectedCandidateHash } : {}) };
}

function projectAtomicAuthorSelfCheckMetadata(value, expectedCandidateHash) {
  if (!record(value)) return {};
  const projection = projectAtomicAuthorSelfCheck(value.atomicAuthorSelfCheck, expectedCandidateHash);
  const issue = projection.issue ?? normalizeAtomicAuthorSelfCheckProjectionIssue(value.atomicAuthorSelfCheckProjectionIssue)
    ?? (Object.prototype.hasOwnProperty.call(value, "atomicAuthorSelfCheckProjectionIssue") ? { reason: "invalid_projection_issue" } : null);
  return { ...(projection.receipt ? { atomicAuthorSelfCheck: projection.receipt } : {}), ...(issue ? { atomicAuthorSelfCheckProjectionIssue: issue } : {}) };
}

exports.projectAtomicAuthorSelfCheck = projectAtomicAuthorSelfCheck;
exports.normalizeAtomicAuthorSelfCheckProjectionIssue = normalizeAtomicAuthorSelfCheckProjectionIssue;
exports.projectAtomicAuthorSelfCheckMetadata = projectAtomicAuthorSelfCheckMetadata;
