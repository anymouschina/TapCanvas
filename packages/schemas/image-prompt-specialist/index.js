"use strict";

const { createHash } = require("node:crypto");

const IMAGE_PROMPT_SPECIALIST_REQUEST_VERSION = "image-prompt-request/v1";
const IMAGE_PROMPT_SPECIALIST_EXECUTION_VERSION = "image-prompt-execution/v1";
const IMAGE_PROMPT_SPECIALIST_RESPONSE_VERSION = "image-prompt/v1";
const IMAGE_PROMPT_SPECIALIST_NAME = "image_prompt_specialist";
const IMAGE_PROMPT_SPECIALIST_ERROR_CODES = Object.freeze([
  "specialist_auth_invalid",
  "specialist_replay_rejected",
  "specialist_request_invalid",
  "specialist_evidence_invalid",
  "specialist_idempotency_conflict",
  "specialist_model_binding_invalid",
  "specialist_unavailable",
  "specialist_timeout",
  "specialist_output_invalid",
  "specialist_model_inheritance_failed",
]);

const REQUEST_KEYS = new Set([
  "schemaVersion",
  "requestId",
  "correlationId",
  "idempotencyKey",
  "actor",
  "scope",
  "commercialContext",
  "operation",
  "evidence",
  "promptModel",
]);
const EXECUTION_REQUEST_KEYS = new Set(["schemaVersion", "request", "relayGrant"]);
const ACTOR_KEYS = new Set(["tenantId", "userId"]);
const SCOPE_KEYS = new Set(["projectId", "canvasId", "nodeId", "nodeRevision"]);
const COMMERCIAL_CONTEXT_KEYS = new Set([
  "generationTaskId",
  "billingOrderId",
  "quoteFingerprint",
]);
const OPERATION_KEYS = new Set(["command", "objective", "parameters"]);
const EVIDENCE_KEYS = new Set(["currentPrompt", "negativePrompt", "references"]);
const REFERENCE_KEYS = new Set([
  "resourceId",
  "mediaType",
  "semanticRole",
  "ordinal",
  "contentDigest",
  "accessUrl",
]);
const MODEL_KEYS = new Set([
  "catalogRecordId",
  "modelKey",
  "configurationRevision",
  "providerEndpointVersionId",
  "providerCredentialVersionId",
]);
const RESPONSE_KEYS = new Set(["schemaVersion", "imagePrompt", "structuredPrompt", "trace"]);
const STRUCTURED_PROMPT_KEYS = new Set([
  "version",
  "shotIntent",
  "spatialLayout",
  "cameraPlan",
  "lightingPlan",
  "continuityConstraints",
  "negativeConstraints",
]);
const TRACE_KEYS = new Set([
  "requestId",
  "correlationId",
  "specialist",
  "evidenceDigest",
  "model",
  "usage",
  "startedAt",
  "completedAt",
]);
const TRACE_MODEL_KEYS = new Set([
  "catalogRecordId",
  "modelKey",
  "configurationRevision",
  "providerEndpointVersionId",
  "providerCredentialVersionId",
  "effectiveModel",
]);
const USAGE_KEYS = new Set(["inputTokens", "outputTokens", "totalTokens"]);
const SEMANTIC_ROLES = new Set(["source", "character", "style", "scene"]);

function failure(error) {
  return { ok: false, error };
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function rejectUnsupportedKeys(value, allowed, path) {
  const unsupported = Object.keys(value).filter((key) => !allowed.has(key));
  return unsupported.length > 0
    ? `${path} contains unsupported key: ${unsupported.sort()[0]}`
    : null;
}

function parseRecord(value, allowed, path) {
  if (!isPlainRecord(value)) return failure(`${path} must be an object`);
  const unsupported = rejectUnsupportedKeys(value, allowed, path);
  return unsupported ? failure(unsupported) : { ok: true, value };
}

function parseString(value, path, maxLength) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    return failure(`${path} must be a non-empty trimmed string`);
  }
  if (value.length > maxLength) return failure(`${path} exceeds ${maxLength} characters`);
  return { ok: true, value };
}

function parseOptionalString(value, path, maxLength) {
  if (typeof value === "undefined") return { ok: true, value: undefined };
  return parseString(value, path, maxLength);
}

function parseNonNegativeInteger(value, path) {
  return Number.isSafeInteger(value) && value >= 0
    ? { ok: true, value }
    : failure(`${path} must be a non-negative integer`);
}

function parsePositiveInteger(value, path) {
  return Number.isSafeInteger(value) && value > 0
    ? { ok: true, value }
    : failure(`${path} must be a positive integer`);
}

function parseScalarParameters(value) {
  const parsed = parseRecord(value, new Set(Object.keys(isPlainRecord(value) ? value : {})), "operation.parameters");
  if (!parsed.ok) return parsed;
  const keys = Object.keys(parsed.value);
  if (keys.length > 32) return failure("operation.parameters exceeds 32 entries");
  for (const key of keys) {
    if (!key || key.length > 80) return failure("operation.parameters contains an invalid key");
    const item = parsed.value[key];
    if (
      item !== null &&
      typeof item !== "string" &&
      typeof item !== "number" &&
      typeof item !== "boolean"
    ) {
      return failure(`operation.parameters.${key} must be a scalar value`);
    }
    if (typeof item === "string" && item.length > 1_000) {
      return failure(`operation.parameters.${key} exceeds 1000 characters`);
    }
    if (typeof item === "number" && !Number.isFinite(item)) {
      return failure(`operation.parameters.${key} must be a finite number`);
    }
  }
  return { ok: true, value: { ...parsed.value } };
}

function parseAccessUrl(value, path) {
  const parsed = parseString(value, path, 4_096);
  if (!parsed.ok) return parsed;
  try {
    const url = new URL(parsed.value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return failure(`${path} must use http or https`);
    }
  } catch {
    return failure(`${path} must be an absolute URL`);
  }
  return parsed;
}

function parseDigest(value, path) {
  const parsed = parseString(value, path, 64);
  if (!parsed.ok || parsed.value.length !== 64 || !/^[a-f0-9]{64}$/i.test(parsed.value)) {
    return failure(`${path} must be a SHA-256 hex digest`);
  }
  return parsed;
}

function parseReference(value, index) {
  const path = `evidence.references[${index}]`;
  const parsed = parseRecord(value, REFERENCE_KEYS, path);
  if (!parsed.ok) return parsed;
  const resourceId = parseString(parsed.value.resourceId, `${path}.resourceId`, 160);
  if (!resourceId.ok) return resourceId;
  if (parsed.value.mediaType !== "image") return failure(`${path}.mediaType must be image`);
  if (!SEMANTIC_ROLES.has(parsed.value.semanticRole)) {
    return failure(`${path}.semanticRole is invalid`);
  }
  const ordinal = parsePositiveInteger(parsed.value.ordinal, `${path}.ordinal`);
  if (!ordinal.ok) return ordinal;
  const contentDigest = parseDigest(parsed.value.contentDigest, `${path}.contentDigest`);
  if (!contentDigest.ok) return contentDigest;
  const accessUrl = parseAccessUrl(parsed.value.accessUrl, `${path}.accessUrl`);
  if (!accessUrl.ok) return accessUrl;
  return {
    ok: true,
    value: {
      resourceId: resourceId.value,
      mediaType: "image",
      semanticRole: parsed.value.semanticRole,
      ordinal: ordinal.value,
      contentDigest: contentDigest.value,
      accessUrl: accessUrl.value,
    },
  };
}

function parseModel(value, path, includeEffectiveModel) {
  const parsed = parseRecord(value, includeEffectiveModel ? TRACE_MODEL_KEYS : MODEL_KEYS, path);
  if (!parsed.ok) return parsed;
  const catalogRecordId = parseString(parsed.value.catalogRecordId, `${path}.catalogRecordId`, 160);
  if (!catalogRecordId.ok) return catalogRecordId;
  const modelKey = parseString(parsed.value.modelKey, `${path}.modelKey`, 160);
  if (!modelKey.ok) return modelKey;
  const configurationRevision = parseString(
    parsed.value.configurationRevision,
    `${path}.configurationRevision`,
    160,
  );
  if (!configurationRevision.ok) return configurationRevision;
  const providerEndpointVersionId = parseString(
    parsed.value.providerEndpointVersionId,
    `${path}.providerEndpointVersionId`,
    160,
  );
  if (!providerEndpointVersionId.ok) return providerEndpointVersionId;
  const providerCredentialVersionId = parseString(
    parsed.value.providerCredentialVersionId,
    `${path}.providerCredentialVersionId`,
    160,
  );
  if (!providerCredentialVersionId.ok) return providerCredentialVersionId;
  const effectiveModel = includeEffectiveModel
    ? parseString(parsed.value.effectiveModel, `${path}.effectiveModel`, 160)
    : { ok: true, value: undefined };
  if (!effectiveModel.ok) return effectiveModel;
  return {
    ok: true,
    value: {
      catalogRecordId: catalogRecordId.value,
      modelKey: modelKey.value,
      configurationRevision: configurationRevision.value,
      providerEndpointVersionId: providerEndpointVersionId.value,
      providerCredentialVersionId: providerCredentialVersionId.value,
      ...(includeEffectiveModel ? { effectiveModel: effectiveModel.value } : {}),
    },
  };
}

function parseImagePromptSpecialistRequest(input) {
  const request = parseRecord(input, REQUEST_KEYS, "request");
  if (!request.ok) return request;
  if (request.value.schemaVersion !== IMAGE_PROMPT_SPECIALIST_REQUEST_VERSION) {
    return failure(`request.schemaVersion must be ${IMAGE_PROMPT_SPECIALIST_REQUEST_VERSION}`);
  }
  const requestId = parseString(request.value.requestId, "request.requestId", 160);
  if (!requestId.ok) return requestId;
  const correlationId = parseString(request.value.correlationId, "request.correlationId", 160);
  if (!correlationId.ok) return correlationId;
  const idempotencyKey = parseString(request.value.idempotencyKey, "request.idempotencyKey", 240);
  if (!idempotencyKey.ok) return idempotencyKey;

  const actor = parseRecord(request.value.actor, ACTOR_KEYS, "request.actor");
  if (!actor.ok) return actor;
  const tenantId = parseString(actor.value.tenantId, "request.actor.tenantId", 160);
  if (!tenantId.ok) return tenantId;
  const userId = parseString(actor.value.userId, "request.actor.userId", 160);
  if (!userId.ok) return userId;

  const scope = parseRecord(request.value.scope, SCOPE_KEYS, "request.scope");
  if (!scope.ok) return scope;
  const projectId = parseString(scope.value.projectId, "request.scope.projectId", 160);
  if (!projectId.ok) return projectId;
  const canvasId = parseString(scope.value.canvasId, "request.scope.canvasId", 160);
  if (!canvasId.ok) return canvasId;
  const nodeId = parseString(scope.value.nodeId, "request.scope.nodeId", 160);
  if (!nodeId.ok) return nodeId;
  const nodeRevision = parseNonNegativeInteger(scope.value.nodeRevision, "request.scope.nodeRevision");
  if (!nodeRevision.ok) return nodeRevision;

  const commercial = parseRecord(
    request.value.commercialContext,
    COMMERCIAL_CONTEXT_KEYS,
    "request.commercialContext",
  );
  if (!commercial.ok) return commercial;
  const generationTaskId = parseString(
    commercial.value.generationTaskId,
    "request.commercialContext.generationTaskId",
    160,
  );
  if (!generationTaskId.ok) return generationTaskId;
  const billingOrderId = parseString(
    commercial.value.billingOrderId,
    "request.commercialContext.billingOrderId",
    160,
  );
  if (!billingOrderId.ok) return billingOrderId;
  const quoteFingerprint = parseDigest(
    commercial.value.quoteFingerprint,
    "request.commercialContext.quoteFingerprint",
  );
  if (!quoteFingerprint.ok) return quoteFingerprint;

  const operation = parseRecord(request.value.operation, OPERATION_KEYS, "request.operation");
  if (!operation.ok) return operation;
  if (operation.value.command !== "portraitTexture") {
    return failure("request.operation.command must be portraitTexture");
  }
  const objective = parseString(operation.value.objective, "request.operation.objective", 1_000);
  if (!objective.ok) return objective;
  const parameters = parseScalarParameters(operation.value.parameters);
  if (!parameters.ok) return parameters;

  const evidence = parseRecord(request.value.evidence, EVIDENCE_KEYS, "request.evidence");
  if (!evidence.ok) return evidence;
  const currentPrompt = parseOptionalString(
    evidence.value.currentPrompt,
    "request.evidence.currentPrompt",
    8_000,
  );
  if (!currentPrompt.ok) return currentPrompt;
  const negativePrompt = parseOptionalString(
    evidence.value.negativePrompt,
    "request.evidence.negativePrompt",
    4_000,
  );
  if (!negativePrompt.ok) return negativePrompt;
  if (!Array.isArray(evidence.value.references) || evidence.value.references.length === 0) {
    return failure("request.evidence.references must include a source image");
  }
  if (evidence.value.references.length > 8) {
    return failure("request.evidence.references exceeds 8 entries");
  }
  const references = [];
  const ordinals = new Set();
  for (let index = 0; index < evidence.value.references.length; index += 1) {
    const reference = parseReference(evidence.value.references[index], index);
    if (!reference.ok) return reference;
    if (ordinals.has(reference.value.ordinal)) {
      return failure("request.evidence.references contains duplicate ordinals");
    }
    ordinals.add(reference.value.ordinal);
    references.push(reference.value);
  }
  if (!references.some((reference) => reference.semanticRole === "source")) {
    return failure("request.evidence.references must include a source image");
  }

  const promptModel = parseModel(request.value.promptModel, "request.promptModel", false);
  if (!promptModel.ok) return promptModel;

  return {
    ok: true,
    value: {
      schemaVersion: IMAGE_PROMPT_SPECIALIST_REQUEST_VERSION,
      requestId: requestId.value,
      correlationId: correlationId.value,
      idempotencyKey: idempotencyKey.value,
      actor: { tenantId: tenantId.value, userId: userId.value },
      scope: {
        projectId: projectId.value,
        canvasId: canvasId.value,
        nodeId: nodeId.value,
        nodeRevision: nodeRevision.value,
      },
      commercialContext: {
        generationTaskId: generationTaskId.value,
        billingOrderId: billingOrderId.value,
        quoteFingerprint: quoteFingerprint.value,
      },
      operation: {
        command: "portraitTexture",
        objective: objective.value,
        parameters: parameters.value,
      },
      evidence: {
        ...(typeof currentPrompt.value === "string" ? { currentPrompt: currentPrompt.value } : {}),
        ...(typeof negativePrompt.value === "string" ? { negativePrompt: negativePrompt.value } : {}),
        references,
      },
      promptModel: promptModel.value,
    },
  };
}

function parseImagePromptSpecialistExecutionRequest(input) {
  const envelope = parseRecord(input, EXECUTION_REQUEST_KEYS, "executionRequest");
  if (!envelope.ok) return envelope;
  if (envelope.value.schemaVersion !== IMAGE_PROMPT_SPECIALIST_EXECUTION_VERSION) {
    return failure(
      `executionRequest.schemaVersion must be ${IMAGE_PROMPT_SPECIALIST_EXECUTION_VERSION}`,
    );
  }
  const request = parseImagePromptSpecialistRequest(envelope.value.request);
  if (!request.ok) return request;
  const relayGrant = parseString(envelope.value.relayGrant, "executionRequest.relayGrant", 512);
  if (!relayGrant.ok) return relayGrant;
  return {
    ok: true,
    value: {
      schemaVersion: IMAGE_PROMPT_SPECIALIST_EXECUTION_VERSION,
      request: request.value,
      relayGrant: relayGrant.value,
    },
  };
}

function parseStringList(value, path, minimumItems) {
  if (!Array.isArray(value) || value.length < minimumItems || value.length > 12) {
    return failure(`${path} must contain ${minimumItems}-12 strings`);
  }
  const values = [];
  for (let index = 0; index < value.length; index += 1) {
    const parsed = parseString(value[index], `${path}[${index}]`, 600);
    if (!parsed.ok) return parsed;
    values.push(parsed.value);
  }
  return { ok: true, value: values };
}

function parseStructuredPrompt(value) {
  if (typeof value === "undefined") return { ok: true, value: undefined };
  const parsed = parseRecord(value, STRUCTURED_PROMPT_KEYS, "response.structuredPrompt");
  if (!parsed.ok) return parsed;
  if (parsed.value.version !== "v2") {
    return failure("response.structuredPrompt.version must be v2");
  }
  const shotIntent = parseString(
    parsed.value.shotIntent,
    "response.structuredPrompt.shotIntent",
    600,
  );
  if (!shotIntent.ok) return shotIntent;
  const spatialLayout = parseStringList(
    parsed.value.spatialLayout,
    "response.structuredPrompt.spatialLayout",
    1,
  );
  if (!spatialLayout.ok) return spatialLayout;
  const cameraPlan = parseStringList(
    parsed.value.cameraPlan,
    "response.structuredPrompt.cameraPlan",
    1,
  );
  if (!cameraPlan.ok) return cameraPlan;
  const lightingPlan = parseStringList(
    parsed.value.lightingPlan,
    "response.structuredPrompt.lightingPlan",
    1,
  );
  if (!lightingPlan.ok) return lightingPlan;
  const continuityConstraints = parseStringList(
    parsed.value.continuityConstraints,
    "response.structuredPrompt.continuityConstraints",
    1,
  );
  if (!continuityConstraints.ok) return continuityConstraints;
  const negativeConstraints = parseStringList(
    parsed.value.negativeConstraints,
    "response.structuredPrompt.negativeConstraints",
    1,
  );
  if (!negativeConstraints.ok) return negativeConstraints;
  return {
    ok: true,
    value: {
      version: "v2",
      shotIntent: shotIntent.value,
      spatialLayout: spatialLayout.value,
      cameraPlan: cameraPlan.value,
      lightingPlan: lightingPlan.value,
      continuityConstraints: continuityConstraints.value,
      negativeConstraints: negativeConstraints.value,
    },
  };
}

function parseUsage(value) {
  const parsed = parseRecord(value, USAGE_KEYS, "response.trace.usage");
  if (!parsed.ok) return parsed;
  const inputTokens = parseNonNegativeInteger(
    parsed.value.inputTokens,
    "response.trace.usage.inputTokens",
  );
  if (!inputTokens.ok) return inputTokens;
  const outputTokens = parseNonNegativeInteger(
    parsed.value.outputTokens,
    "response.trace.usage.outputTokens",
  );
  if (!outputTokens.ok) return outputTokens;
  const totalTokens = parseNonNegativeInteger(
    parsed.value.totalTokens,
    "response.trace.usage.totalTokens",
  );
  if (!totalTokens.ok) return totalTokens;
  if (totalTokens.value !== inputTokens.value + outputTokens.value) {
    return failure("response.trace.usage.totalTokens must equal inputTokens + outputTokens");
  }
  return {
    ok: true,
    value: {
      inputTokens: inputTokens.value,
      outputTokens: outputTokens.value,
      totalTokens: totalTokens.value,
    },
  };
}

function parseTimestamp(value, path) {
  const parsed = parseString(value, path, 64);
  if (!parsed.ok) return parsed;
  const milliseconds = Date.parse(parsed.value);
  return Number.isFinite(milliseconds)
    ? { ok: true, value: parsed.value, milliseconds }
    : failure(`${path} must be an ISO timestamp`);
}

function parseImagePromptSpecialistResponse(input) {
  const response = parseRecord(input, RESPONSE_KEYS, "response");
  if (!response.ok) return response;
  if (response.value.schemaVersion !== IMAGE_PROMPT_SPECIALIST_RESPONSE_VERSION) {
    return failure(`response.schemaVersion must be ${IMAGE_PROMPT_SPECIALIST_RESPONSE_VERSION}`);
  }
  const imagePrompt = parseString(response.value.imagePrompt, "response.imagePrompt", 8_000);
  if (!imagePrompt.ok) return imagePrompt;
  const structuredPrompt = parseStructuredPrompt(response.value.structuredPrompt);
  if (!structuredPrompt.ok) return structuredPrompt;
  const trace = parseRecord(response.value.trace, TRACE_KEYS, "response.trace");
  if (!trace.ok) return trace;
  const requestId = parseString(trace.value.requestId, "response.trace.requestId", 160);
  if (!requestId.ok) return requestId;
  const correlationId = parseString(
    trace.value.correlationId,
    "response.trace.correlationId",
    160,
  );
  if (!correlationId.ok) return correlationId;
  if (trace.value.specialist !== IMAGE_PROMPT_SPECIALIST_NAME) {
    return failure(`response.trace.specialist must be ${IMAGE_PROMPT_SPECIALIST_NAME}`);
  }
  const evidenceDigest = parseDigest(
    trace.value.evidenceDigest,
    "response.trace.evidenceDigest",
  );
  if (!evidenceDigest.ok) return evidenceDigest;
  const model = parseModel(trace.value.model, "response.trace.model", true);
  if (!model.ok) return model;
  const usage = parseUsage(trace.value.usage);
  if (!usage.ok) return usage;
  const startedAt = parseTimestamp(trace.value.startedAt, "response.trace.startedAt");
  if (!startedAt.ok) return startedAt;
  const completedAt = parseTimestamp(trace.value.completedAt, "response.trace.completedAt");
  if (!completedAt.ok) return completedAt;
  if (completedAt.milliseconds < startedAt.milliseconds) {
    return failure("response.trace.completedAt cannot be before startedAt");
  }
  return {
    ok: true,
    value: {
      schemaVersion: IMAGE_PROMPT_SPECIALIST_RESPONSE_VERSION,
      imagePrompt: imagePrompt.value,
      ...(structuredPrompt.value ? { structuredPrompt: structuredPrompt.value } : {}),
      trace: {
        requestId: requestId.value,
        correlationId: correlationId.value,
        specialist: IMAGE_PROMPT_SPECIALIST_NAME,
        evidenceDigest: evidenceDigest.value,
        model: model.value,
        usage: usage.value,
        startedAt: startedAt.value,
        completedAt: completedAt.value,
      },
    },
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainRecord(value)) return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    result[key] = canonicalize(value[key]);
  }
  return result;
}

function canonicalImagePromptSpecialistJson(value) {
  return JSON.stringify(canonicalize(value));
}

function evidenceDigestInput(evidence) {
  if (!isPlainRecord(evidence)) return evidence;
  return {
    ...(typeof evidence.currentPrompt === "string"
      ? { currentPrompt: evidence.currentPrompt }
      : {}),
    ...(typeof evidence.negativePrompt === "string"
      ? { negativePrompt: evidence.negativePrompt }
      : {}),
    references: Array.isArray(evidence.references)
      ? evidence.references.map((reference) =>
          isPlainRecord(reference)
            ? {
                resourceId: reference.resourceId,
                mediaType: reference.mediaType,
                semanticRole: reference.semanticRole,
                ordinal: reference.ordinal,
                contentDigest: reference.contentDigest,
              }
            : reference,
        )
      : evidence.references,
  };
}

function imagePromptEvidenceDigest(evidence) {
  return createHash("sha256")
    .update(canonicalImagePromptSpecialistJson(evidenceDigestInput(evidence)))
    .digest("hex");
}

exports.IMAGE_PROMPT_SPECIALIST_REQUEST_VERSION = IMAGE_PROMPT_SPECIALIST_REQUEST_VERSION;
exports.IMAGE_PROMPT_SPECIALIST_EXECUTION_VERSION = IMAGE_PROMPT_SPECIALIST_EXECUTION_VERSION;
exports.IMAGE_PROMPT_SPECIALIST_RESPONSE_VERSION = IMAGE_PROMPT_SPECIALIST_RESPONSE_VERSION;
exports.IMAGE_PROMPT_SPECIALIST_NAME = IMAGE_PROMPT_SPECIALIST_NAME;
exports.IMAGE_PROMPT_SPECIALIST_ERROR_CODES = IMAGE_PROMPT_SPECIALIST_ERROR_CODES;
exports.parseImagePromptSpecialistRequest = parseImagePromptSpecialistRequest;
exports.parseImagePromptSpecialistExecutionRequest = parseImagePromptSpecialistExecutionRequest;
exports.parseImagePromptSpecialistResponse = parseImagePromptSpecialistResponse;
exports.canonicalImagePromptSpecialistJson = canonicalImagePromptSpecialistJson;
exports.imagePromptEvidenceDigest = imagePromptEvidenceDigest;
