import { createHash } from "node:crypto";

export const AUTHOR_SOURCE_REPRESENTATION = "harness_accepted_pre_host_compilation_candidate";
const identityKeys = ["ownerId", "flowId", "flowVersionId", "sourceExecutionId", "rootNodeId", "rootNodeRunId", "leafNodeId", "taskId", "sessionId", "turnId"];
const record = value => value !== null && typeof value === "object" && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
class ProtocolIssue extends Error {
  constructor(code, path) { super(code); this.code = code; this.path = path; }
}
const issue = (code, path) => { throw new ProtocolIssue(code, path); };
const text = (value, path) => {
  if (typeof value !== "string" || !value.trim()) issue("author_source_text_invalid", path);
  return value;
};
const fields = (value, keys, path) => {
  if (!record(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    issue("author_source_record_shape_invalid", path);
  }
  return value;
};
const hash = (value, path) => {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) issue("author_source_hash_invalid", path);
  return value;
};
export function authorSourceTextHash(value) {
  if (typeof value !== "string") issue("author_source_text_invalid", "/text");
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

/** Exact JSON facts, with no getters, sparse arrays, cycles or coercion. Key
 * order is retained: hash convention is SHA-256 of UTF-8 JSON.stringify. */
function json(value, path = "/facts", ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || ancestors.has(value)) issue("author_source_json_invalid", path);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Reflect.ownKeys(value).some(key => key !== "length" && (typeof key !== "string"
        || String(Number(key)) !== key || !Number.isSafeInteger(Number(key)) || Number(key) < 0 || Number(key) >= value.length))) {
        issue("author_source_json_invalid", path);
      }
      const rows = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) issue("author_source_json_invalid", path);
        rows.push(json(descriptor.value, path, ancestors));
      }
      return Object.freeze(rows);
    }
    if (!record(value) || Reflect.ownKeys(value).some(key => typeof key !== "string")) issue("author_source_json_invalid", path);
    const rows = [];
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) issue("author_source_json_invalid", path);
      rows.push([key, json(descriptor.value, path, ancestors)]);
    }
    return Object.freeze(Object.fromEntries(rows));
  } finally { ancestors.delete(value); }
}
function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
  return value;
}
/** JSON object insertion order is not durable through codecs or JSONB. Arrays
 * and exact string bytes remain ordered facts; object keys use canonical order. */
export function authorSourceJsonHash(value) { return authorSourceTextHash(JSON.stringify(canonicalJson(json(value)))); }

/** A returned harness acceptance fact, never a provider response or a caller
 * supplied candidate. Authentication and recording at the successful typed
 * return boundary belong to the host; this only validates its JSON receipt. */
export function normalizeHarnessAcceptedAuthorSource(value) {
  if (value === undefined || value === null) return null;
  const source = json(value, "/acceptedAuthorSource");
  fields(source, ["version", "representation", "identity", "acceptance", "candidate", "candidateHash", "authorContract", "sourceContext"], "/acceptedAuthorSource");
  if (source.version !== 1 || source.representation !== AUTHOR_SOURCE_REPRESENTATION) issue("author_source_representation_invalid", "/acceptedAuthorSource/representation");
  fields(source.identity, ["taskId", "sessionId", "turnId"], "/acceptedAuthorSource/identity");
  for (const key of ["taskId", "sessionId", "turnId"]) text(source.identity[key], `/acceptedAuthorSource/identity/${key}`);
  const candidateHash = authorSourceTextHash(text(source.candidate, "/acceptedAuthorSource/candidate"));
  equal(hash(source.candidateHash, "/acceptedAuthorSource/candidateHash"), candidateHash, "author_source_candidate_hash_mismatch", "/acceptedAuthorSource/candidateHash");
  fields(source.authorContract, ["ref", "value", "hash"], "/acceptedAuthorSource/authorContract");
  if (!record(source.authorContract.value)) issue("author_source_contract_invalid", "/acceptedAuthorSource/authorContract/value");
  const contractHash = authorSourceJsonHash(source.authorContract.value);
  equal(hash(source.authorContract.hash, "/acceptedAuthorSource/authorContract/hash"), contractHash, "author_source_contract_mismatch", "/acceptedAuthorSource/authorContract/hash");
  equal(text(source.authorContract.ref, "/acceptedAuthorSource/authorContract/ref"), `${source.identity.turnId}#/acceptedAuthorSource/authorContract/value`, "author_source_contract_mismatch", "/acceptedAuthorSource/authorContract/ref");
  fields(source.acceptance, ["kind", "receiptRef", "candidateHash", "authorContractHash"], "/acceptedAuthorSource/acceptance");
  if (source.acceptance.kind !== "harness_accepted_candidate") issue("author_source_acceptance_invalid", "/acceptedAuthorSource/acceptance/kind");
  equal(text(source.acceptance.receiptRef, "/acceptedAuthorSource/acceptance/receiptRef"), source.identity.turnId, "author_source_acceptance_identity_mismatch", "/acceptedAuthorSource/acceptance/receiptRef");
  equal(hash(source.acceptance.candidateHash, "/acceptedAuthorSource/acceptance/candidateHash"), candidateHash, "author_source_acceptance_identity_mismatch", "/acceptedAuthorSource/acceptance/candidateHash");
  equal(hash(source.acceptance.authorContractHash, "/acceptedAuthorSource/acceptance/authorContractHash"), contractHash, "author_source_acceptance_identity_mismatch", "/acceptedAuthorSource/acceptance/authorContractHash");
  fields(source.sourceContext, ["value", "hash"], "/acceptedAuthorSource/sourceContext");
  if (typeof source.sourceContext.value !== "string") issue("author_source_text_invalid", "/acceptedAuthorSource/sourceContext/value");
  equal(hash(source.sourceContext.hash, "/acceptedAuthorSource/sourceContext/hash"), authorSourceTextHash(source.sourceContext.value), "author_source_frozen_input_mismatch", "/acceptedAuthorSource/sourceContext/hash");
  return source;
}
const equal = (left, right, code, path) => { if (left !== right) issue(code, path); };

/**
 * Trust is supplied by the host's owner-authorized durable lookup, never by a
 * model string, caller-supplied raw body or a hash. This pure verifier does not
 * perform that lookup, run converters, check semantic quality or infer schema.
 * It verifies independently supplied actual forward outputs against that host's
 * saved delivery. Evidence belongs in the existing node output evidence ledger.
 */
export function verifyServerAuthorSourceRepresentation(input) {
  try {
    // Copy before reading so even a getter cannot masquerade as a source fact.
    const args = json(input, "/input");
    fields(args, ["serverRecord", "expected", "actualForwardOutputs", "savedDelivery", "attempt"], "/input");
    const source = fields(args.serverRecord, ["version", "representation", "identity", "acceptance", "candidate", "candidateHash", "authorContract", "frozenInputs", "conversion"], "/serverRecord");
    if (source.version !== 1 || source.representation !== AUTHOR_SOURCE_REPRESENTATION) issue("author_source_representation_invalid", "/serverRecord/representation");
    const expected = fields(args.expected, ["identity", "acceptanceRef", "candidateHash", "authorContract", "frozenInputs", "converters"], "/expected");
    fields(source.identity, identityKeys, "/serverRecord/identity");
    fields(expected.identity, identityKeys, "/expected/identity");
    for (const key of identityKeys) equal(text(source.identity[key], `/serverRecord/identity/${key}`), text(expected.identity[key], `/expected/identity/${key}`), "author_source_identity_mismatch", `/identity/${key}`);
    const candidate = text(source.candidate, "/serverRecord/candidate");
    const candidateHash = authorSourceTextHash(candidate);
    equal(hash(source.candidateHash, "/serverRecord/candidateHash"), candidateHash, "author_source_candidate_hash_mismatch", "/candidateHash");
    equal(hash(expected.candidateHash, "/expected/candidateHash"), candidateHash, "author_source_candidate_identity_mismatch", "/candidateHash");
    const acceptance = fields(source.acceptance, ["kind", "receiptRef", "candidateHash", "authorContractHash"], "/serverRecord/acceptance");
    if (acceptance.kind !== "harness_accepted_candidate") issue("author_source_acceptance_invalid", "/acceptance/kind");
    equal(text(acceptance.receiptRef, "/acceptance/receiptRef"), text(expected.acceptanceRef, "/expected/acceptanceRef"), "author_source_acceptance_identity_mismatch", "/acceptance/receiptRef");
    equal(hash(acceptance.candidateHash, "/acceptance/candidateHash"), candidateHash, "author_source_acceptance_identity_mismatch", "/acceptance/candidateHash");
    fields(source.authorContract, ["ref", "value", "hash"], "/serverRecord/authorContract");
    fields(expected.authorContract, ["ref", "value"], "/expected/authorContract");
    if (!record(source.authorContract.value) || !record(expected.authorContract.value)) issue("author_source_contract_invalid", "/authorContract/value");
    const contractHash = authorSourceJsonHash(expected.authorContract.value);
    equal(authorSourceJsonHash(source.authorContract.value), contractHash, "author_source_contract_mismatch", "/authorContract/value");
    equal(hash(source.authorContract.hash, "/authorContract/hash"), contractHash, "author_source_contract_mismatch", "/authorContract/hash");
    equal(hash(acceptance.authorContractHash, "/acceptance/authorContractHash"), contractHash, "author_source_acceptance_identity_mismatch", "/acceptance/authorContractHash");
    equal(text(source.authorContract.ref, "/authorContract/ref"), text(expected.authorContract.ref, "/expected/authorContract/ref"), "author_source_contract_mismatch", "/authorContract/ref");
    fields(source.frozenInputs, ["ref", "hash"], "/serverRecord/frozenInputs");
    fields(expected.frozenInputs, ["ref", "value"], "/expected/frozenInputs");
    const inputHash = authorSourceJsonHash(expected.frozenInputs.value);
    const inputRef = text(expected.frozenInputs.ref, "/expected/frozenInputs/ref");
    equal(text(source.frozenInputs.ref, "/frozenInputs/ref"), inputRef, "author_source_frozen_input_mismatch", "/frozenInputs/ref");
    equal(hash(source.frozenInputs.hash, "/frozenInputs/hash"), inputHash, "author_source_frozen_input_mismatch", "/frozenInputs/hash");
    const conversion = fields(source.conversion, ["steps", "deliveryHash"], "/serverRecord/conversion");
    if (!Array.isArray(conversion.steps) || !Array.isArray(expected.converters)
      || !Array.isArray(args.actualForwardOutputs) || expected.converters.length !== conversion.steps.length
      || args.actualForwardOutputs.length !== conversion.steps.length) issue("author_source_conversion_steps_invalid", "/conversion/steps");
    let priorHash = candidateHash;
    conversion.steps.forEach((step, index) => {
      const path = `/conversion/steps/${index}`;
      fields(step, ["converterId", "converterVersion", "inputHash", "outputHash", "frozenInputHash", "frozenInputRef"], path);
      const converter = fields(expected.converters[index], ["id", "version"], `/expected/converters/${index}`);
      equal(text(step.converterId, `${path}/converterId`), text(converter.id, `/expected/converters/${index}/id`), "author_source_converter_mismatch", `${path}/converterId`);
      equal(text(step.converterVersion, `${path}/converterVersion`), text(converter.version, `/expected/converters/${index}/version`), "author_source_converter_mismatch", `${path}/converterVersion`);
      equal(hash(step.inputHash, `${path}/inputHash`), priorHash, "author_source_conversion_chain_mismatch", `${path}/inputHash`);
      equal(hash(step.frozenInputHash, `${path}/frozenInputHash`), inputHash, "author_source_frozen_input_mismatch", `${path}/frozenInputHash`);
      equal(text(step.frozenInputRef, `${path}/frozenInputRef`), inputRef, "author_source_frozen_input_mismatch", `${path}/frozenInputRef`);
      const actualHash = authorSourceTextHash(text(args.actualForwardOutputs[index], `/actualForwardOutputs/${index}`));
      equal(hash(step.outputHash, `${path}/outputHash`), actualHash, "author_source_forward_result_mismatch", `${path}/outputHash`);
      priorHash = actualHash;
    });
    const deliveryHash = authorSourceTextHash(text(args.savedDelivery, "/savedDelivery"));
    equal(hash(conversion.deliveryHash, "/conversion/deliveryHash"), deliveryHash, "author_source_delivery_hash_mismatch", "/conversion/deliveryHash");
    equal(priorHash, deliveryHash, "author_source_forward_delivery_mismatch", "/savedDelivery");
    // Explicit zero-step conversion records that no host transformation took
    // place. Never invent an identity converter or infer missing step receipts.
    equal(conversion.steps.length ? args.actualForwardOutputs.at(-1) : candidate, args.savedDelivery,
      "author_source_forward_delivery_mismatch", "/savedDelivery");
    const attempt = fields(args.attempt, ["executionId", "targetNodeId", "idempotencyKey", "requestHash"], "/attempt");
    for (const key of ["executionId", "targetNodeId", "idempotencyKey"]) text(attempt[key], `/attempt/${key}`);
    hash(attempt.requestHash, "/attempt/requestHash");
    if (attempt.executionId === source.identity.sourceExecutionId) issue("author_source_attempt_not_independent", "/attempt/executionId");
    equal(attempt.targetNodeId, source.identity.leafNodeId, "author_source_attempt_target_mismatch", "/attempt/targetNodeId");
    const sourceEvidenceHash = authorSourceJsonHash(source);
    const binding = Object.freeze({ version: 1, ...attempt, sourceEvidenceHash, sourceIdentity: source.identity, candidateHash, deliveryHash });
    return Object.freeze({ status: "verified", source, sourceEvidenceHash, attemptBinding: Object.freeze({ ...binding, bindingHash: authorSourceJsonHash(binding) }) });
  } catch (error) {
    return Object.freeze({ status: "current_action_not_applied", diagnostic: Object.freeze({
      code: error instanceof ProtocolIssue ? error.code : "author_source_protocol_invalid",
      path: error instanceof ProtocolIssue ? error.path : "/input", currentActionApplied: false }) });
  }
}

/** Validate a server-verified evidence envelope in transport. This does not
 * authenticate a caller, authorize a source or repeat forward conversion. */
export function normalizeVerifiedAuthorSourceEvidence(value) {
  if (value === undefined || value === null) return null;
  const envelope = json(value, "/authorSource");
  fields(envelope, ["source", "sourceEvidenceHash", "attemptBinding"], "/authorSource");
  const source = fields(envelope.source, ["version", "representation", "identity", "acceptance", "candidate", "candidateHash", "authorContract", "frozenInputs", "conversion"], "/authorSource/source");
  if (source.version !== 1 || source.representation !== AUTHOR_SOURCE_REPRESENTATION) issue("author_source_representation_invalid", "/authorSource/source/representation");
  fields(source.identity, identityKeys, "/authorSource/source/identity");
  for (const key of identityKeys) text(source.identity[key], `/authorSource/source/identity/${key}`);
  const candidateHash = authorSourceTextHash(text(source.candidate, "/authorSource/source/candidate"));
  equal(hash(source.candidateHash, "/authorSource/source/candidateHash"), candidateHash, "author_source_candidate_hash_mismatch", "/authorSource/source/candidateHash");
  fields(source.authorContract, ["ref", "value", "hash"], "/authorSource/source/authorContract");
  text(source.authorContract.ref, "/authorSource/source/authorContract/ref");
  if (!record(source.authorContract.value)) issue("author_source_contract_invalid", "/authorSource/source/authorContract/value");
  const contractHash = authorSourceJsonHash(source.authorContract.value);
  equal(hash(source.authorContract.hash, "/authorSource/source/authorContract/hash"), contractHash, "author_source_contract_mismatch", "/authorSource/source/authorContract/hash");
  const acceptance = fields(source.acceptance, ["kind", "receiptRef", "candidateHash", "authorContractHash"], "/authorSource/source/acceptance");
  if (acceptance.kind !== "harness_accepted_candidate") issue("author_source_acceptance_invalid", "/authorSource/source/acceptance/kind");
  text(acceptance.receiptRef, "/authorSource/source/acceptance/receiptRef");
  equal(hash(acceptance.candidateHash, "/authorSource/source/acceptance/candidateHash"), candidateHash, "author_source_acceptance_identity_mismatch", "/authorSource/source/acceptance/candidateHash");
  equal(hash(acceptance.authorContractHash, "/authorSource/source/acceptance/authorContractHash"), contractHash, "author_source_acceptance_identity_mismatch", "/authorSource/source/acceptance/authorContractHash");
  fields(source.frozenInputs, ["ref", "hash"], "/authorSource/source/frozenInputs");
  const frozenRef = text(source.frozenInputs.ref, "/authorSource/source/frozenInputs/ref");
  const frozenHash = hash(source.frozenInputs.hash, "/authorSource/source/frozenInputs/hash");
  fields(source.conversion, ["steps", "deliveryHash"], "/authorSource/source/conversion");
  if (!Array.isArray(source.conversion.steps)) issue("author_source_conversion_steps_invalid", "/authorSource/source/conversion/steps");
  let priorHash = candidateHash;
  source.conversion.steps.forEach((step, index) => {
    const path = `/authorSource/source/conversion/steps/${index}`;
    fields(step, ["converterId", "converterVersion", "inputHash", "outputHash", "frozenInputHash", "frozenInputRef"], path);
    text(step.converterId, `${path}/converterId`); text(step.converterVersion, `${path}/converterVersion`);
    equal(hash(step.inputHash, `${path}/inputHash`), priorHash, "author_source_conversion_chain_mismatch", `${path}/inputHash`);
    equal(hash(step.frozenInputHash, `${path}/frozenInputHash`), frozenHash, "author_source_frozen_input_mismatch", `${path}/frozenInputHash`);
    equal(text(step.frozenInputRef, `${path}/frozenInputRef`), frozenRef, "author_source_frozen_input_mismatch", `${path}/frozenInputRef`);
    priorHash = hash(step.outputHash, `${path}/outputHash`);
  });
  const deliveryHash = hash(source.conversion.deliveryHash, "/authorSource/source/conversion/deliveryHash");
  equal(priorHash, deliveryHash, "author_source_forward_delivery_mismatch", "/authorSource/source/conversion/deliveryHash");
  const sourceEvidenceHash = authorSourceJsonHash(source);
  equal(hash(envelope.sourceEvidenceHash, "/authorSource/sourceEvidenceHash"), sourceEvidenceHash, "author_source_evidence_hash_mismatch", "/authorSource/sourceEvidenceHash");
  const binding = fields(envelope.attemptBinding, ["version", "executionId", "targetNodeId", "idempotencyKey", "requestHash", "sourceEvidenceHash", "sourceIdentity", "candidateHash", "deliveryHash", "bindingHash"], "/authorSource/attemptBinding");
  if (binding.version !== 1) issue("author_source_attempt_binding_invalid", "/authorSource/attemptBinding/version");
  for (const key of ["executionId", "targetNodeId", "idempotencyKey"]) text(binding[key], `/authorSource/attemptBinding/${key}`);
  hash(binding.requestHash, "/authorSource/attemptBinding/requestHash");
  if (binding.executionId === source.identity.sourceExecutionId) issue("author_source_attempt_not_independent", "/authorSource/attemptBinding/executionId");
  equal(binding.targetNodeId, source.identity.leafNodeId, "author_source_attempt_target_mismatch", "/authorSource/attemptBinding/targetNodeId");
  fields(binding.sourceIdentity, identityKeys, "/authorSource/attemptBinding/sourceIdentity");
  for (const key of identityKeys) equal(binding.sourceIdentity[key], source.identity[key], "author_source_identity_mismatch", `/authorSource/attemptBinding/sourceIdentity/${key}`);
  for (const [key, expected] of [["sourceEvidenceHash", sourceEvidenceHash], ["candidateHash", candidateHash], ["deliveryHash", deliveryHash]]) equal(hash(binding[key], `/authorSource/attemptBinding/${key}`), expected, "author_source_attempt_binding_invalid", `/authorSource/attemptBinding/${key}`);
  const { bindingHash, ...unsigned } = binding;
  equal(hash(bindingHash, "/authorSource/attemptBinding/bindingHash"), authorSourceJsonHash(unsigned), "author_source_attempt_binding_hash_mismatch", "/authorSource/attemptBinding/bindingHash");
  return envelope;
}
