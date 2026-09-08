import test from "node:test";
import assert from "node:assert/strict";

import {
  IMAGE_PROMPT_SPECIALIST_ERROR_CODES,
  canonicalImagePromptSpecialistJson,
  imagePromptEvidenceDigest,
  parseImagePromptSpecialistExecutionRequest,
  parseImagePromptSpecialistRequest,
  parseImagePromptSpecialistResponse,
} from "./index.js";

function validRequest() {
  return {
    schemaVersion: "image-prompt-request/v1",
    requestId: "request-1",
    correlationId: "correlation-1",
    idempotencyKey: "image-prompt:task-1",
    actor: { tenantId: "tenant-1", userId: "user-1" },
    scope: {
      projectId: "project-1",
      canvasId: "canvas-1",
      nodeId: "node-1",
      nodeRevision: 7,
    },
    commercialContext: {
      generationTaskId: "task-1",
      billingOrderId: "order-1",
      quoteFingerprint: "b".repeat(64),
    },
    operation: {
      command: "portraitTexture",
      objective: "增强皮肤与发丝的真实质感，同时严格保持人物身份和构图",
      parameters: { textureStrength: 0.65, preserveIdentity: true, note: null },
    },
    evidence: {
      currentPrompt: "月夜湖边，一只白兔向右奔跑",
      negativePrompt: "禁止换脸和构图漂移",
      references: [
        {
          resourceId: "resource-1",
          mediaType: "image",
          semanticRole: "source",
          ordinal: 1,
          contentDigest: "a".repeat(64),
          accessUrl: "https://media.example/source.png?signature=secret",
        },
      ],
    },
    promptModel: {
      catalogRecordId: "model-record-1",
      modelKey: "gpt-5.6",
      configurationRevision: "revision-9",
      providerEndpointVersionId: "endpoint-version-1",
      providerCredentialVersionId: "credential-version-1",
    },
  };
}

test("strict execution envelope requires one request-scoped relay grant", () => {
  const request = validRequest();
  const envelope = {
    schemaVersion: "image-prompt-execution/v1",
    request,
    relayGrant: "g".repeat(43),
  };
  assert.deepEqual(parseImagePromptSpecialistExecutionRequest(envelope), {
    ok: true,
    value: envelope,
  });

  for (const invalid of [
    { ...envelope, relayGrant: "" },
    { ...envelope, relayGrant: "g".repeat(513) },
    { ...envelope, unexpected: true },
    {
      ...envelope,
      request: {
        ...request,
        promptModel: { ...request.promptModel, providerEndpointVersionId: "" },
      },
    },
  ]) {
    assert.equal(parseImagePromptSpecialistExecutionRequest(invalid).ok, false);
  }
});

function validResponse(request) {
  return {
    schemaVersion: "image-prompt/v1",
    imagePrompt: "以参考图1为唯一人物与构图依据，增强真实皮肤纹理与发丝层次，保持五官、姿态、服装、镜头和背景完全一致。",
    trace: {
      requestId: request.requestId,
      correlationId: request.correlationId,
      specialist: "image_prompt_specialist",
      evidenceDigest: imagePromptEvidenceDigest(request.evidence),
      model: {
        ...request.promptModel,
        effectiveModel: request.promptModel.modelKey,
      },
      usage: { inputTokens: 120, outputTokens: 48, totalTokens: 168 },
      startedAt: "2026-09-07T10:00:00.000Z",
      completedAt: "2026-09-07T10:00:01.000Z",
    },
  };
}

test("strict request parser accepts a complete portraitTexture request", () => {
  const request = validRequest();
  assert.deepEqual(parseImagePromptSpecialistRequest(request), { ok: true, value: request });
});

test("request parser rejects unknown fields and missing real source evidence", () => {
  const withUnknown = { ...validRequest(), fallbackPrompt: "do not accept" };
  const unknownResult = parseImagePromptSpecialistRequest(withUnknown);
  assert.equal(unknownResult.ok, false);
  assert.match(unknownResult.error, /unsupported key/i);

  const withoutSource = validRequest();
  withoutSource.evidence.references[0].semanticRole = "style";
  const sourceResult = parseImagePromptSpecialistRequest(withoutSource);
  assert.equal(sourceResult.ok, false);
  assert.match(sourceResult.error, /source/i);
});

test("request parser rejects duplicate ordinals, data URLs and non-scalar parameters", () => {
  const duplicate = validRequest();
  duplicate.evidence.references.push({
    ...duplicate.evidence.references[0],
    resourceId: "resource-2",
  });
  assert.equal(parseImagePromptSpecialistRequest(duplicate).ok, false);

  const inline = validRequest();
  inline.evidence.references[0].accessUrl = "data:image/png;base64,AA==";
  assert.equal(parseImagePromptSpecialistRequest(inline).ok, false);

  const nested = validRequest();
  nested.operation.parameters = { nested: { forbidden: true } };
  assert.equal(parseImagePromptSpecialistRequest(nested).ok, false);
});

test("request parser requires complete frozen provider model identity", () => {
  const missingEndpointVersion = validRequest();
  delete missingEndpointVersion.promptModel.providerEndpointVersionId;
  const endpointResult = parseImagePromptSpecialistRequest(missingEndpointVersion);
  assert.equal(endpointResult.ok, false);
  assert.match(endpointResult.error, /providerEndpointVersionId/);

  const missingCredentialVersion = validRequest();
  delete missingCredentialVersion.promptModel.providerCredentialVersionId;
  const credentialResult = parseImagePromptSpecialistRequest(missingCredentialVersion);
  assert.equal(credentialResult.ok, false);
  assert.match(credentialResult.error, /providerCredentialVersionId/);
});

test("request parser requires the commercial quote fingerprint to be a SHA-256 digest", () => {
  const request = validRequest();
  request.commercialContext.quoteFingerprint = "not-a-digest";
  const result = parseImagePromptSpecialistRequest(request);
  assert.equal(result.ok, false);
  assert.match(result.error, /quoteFingerprint.*SHA-256/i);
});

test("strict response parser validates prompt, usage, timestamps and nested keys", () => {
  const request = validRequest();
  const response = validResponse(request);
  assert.deepEqual(parseImagePromptSpecialistResponse(response), { ok: true, value: response });

  const emptyPrompt = { ...response, imagePrompt: " " };
  assert.equal(parseImagePromptSpecialistResponse(emptyPrompt).ok, false);

  const negativeUsage = {
    ...response,
    trace: { ...response.trace, usage: { inputTokens: -1, outputTokens: 1, totalTokens: 0 } },
  };
  assert.equal(parseImagePromptSpecialistResponse(negativeUsage).ok, false);

  const wrongTotal = {
    ...response,
    trace: { ...response.trace, usage: { inputTokens: 5, outputTokens: 4, totalTokens: 8 } },
  };
  assert.equal(parseImagePromptSpecialistResponse(wrongTotal).ok, false);

  const reversedTime = {
    ...response,
    trace: {
      ...response.trace,
      startedAt: "2026-09-07T10:00:02.000Z",
      completedAt: "2026-09-07T10:00:01.000Z",
    },
  };
  assert.equal(parseImagePromptSpecialistResponse(reversedTime).ok, false);

  const nestedUnknown = {
    ...response,
    trace: { ...response.trace, secretProviderPayload: "forbidden" },
  };
  assert.equal(parseImagePromptSpecialistResponse(nestedUnknown).ok, false);

  const missingEndpointVersion = {
    ...response,
    trace: {
      ...response.trace,
      model: { ...response.trace.model },
    },
  };
  delete missingEndpointVersion.trace.model.providerEndpointVersionId;
  assert.equal(parseImagePromptSpecialistResponse(missingEndpointVersion).ok, false);

  const missingCredentialVersion = {
    ...response,
    trace: {
      ...response.trace,
      model: { ...response.trace.model },
    },
  };
  delete missingCredentialVersion.trace.model.providerCredentialVersionId;
  assert.equal(parseImagePromptSpecialistResponse(missingCredentialVersion).ok, false);
});

test("response parser accepts the optional strict structured prompt", () => {
  const request = validRequest();
  const response = {
    ...validResponse(request),
    structuredPrompt: {
      version: "v2",
      shotIntent: "在不改变身份的前提下提升人像真实质感",
      spatialLayout: ["沿用来源图前中后景"],
      cameraPlan: ["沿用来源图机位与焦段"],
      lightingPlan: ["沿用来源图光向，只增强皮肤与发丝材质响应"],
      continuityConstraints: ["五官、发型、服装、姿态和背景保持一致"],
      negativeConstraints: ["禁止换脸、磨皮塑料感和构图漂移"],
    },
  };
  assert.equal(parseImagePromptSpecialistResponse(response).ok, true);

  response.structuredPrompt.extra = "forbidden";
  assert.equal(parseImagePromptSpecialistResponse(response).ok, false);
});

test("canonical JSON and evidence digest are stable across object key order", () => {
  const request = validRequest();
  const reorderedEvidence = {
    references: request.evidence.references.map((reference) => ({
      accessUrl: "https://media.example/source.png?signature=refreshed",
      contentDigest: reference.contentDigest,
      ordinal: reference.ordinal,
      semanticRole: reference.semanticRole,
      mediaType: reference.mediaType,
      resourceId: reference.resourceId,
    })),
    negativePrompt: request.evidence.negativePrompt,
    currentPrompt: request.evidence.currentPrompt,
  };
  assert.equal(
    imagePromptEvidenceDigest(request.evidence),
    imagePromptEvidenceDigest(reorderedEvidence),
  );
  assert.equal(
    canonicalImagePromptSpecialistJson({ z: 1, a: { d: 2, c: 3 } }),
    '{"a":{"c":3,"d":2},"z":1}',
  );
});

test("the public error-code contract is complete and immutable", () => {
  assert.deepEqual(IMAGE_PROMPT_SPECIALIST_ERROR_CODES, [
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
  assert.equal(Object.isFrozen(IMAGE_PROMPT_SPECIALIST_ERROR_CODES), true);
});
