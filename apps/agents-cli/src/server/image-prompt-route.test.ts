import test from "node:test";
import assert from "node:assert/strict";

import { startAgentsHttpServer } from "./http-server.js";
import { ImagePromptSpecialistFailure } from "./image-prompt-specialist.js";
import type {
  ImagePromptSpecialistExecutionRequestV1,
  ImagePromptSpecialistRequestV1,
  ImagePromptSpecialistResponseV1,
} from "./image-prompt-contract.js";

let nextTestPort = 43240;
const SPECIALIST_TOKEN = "s".repeat(32);
const RELAY_GRANT = "g".repeat(43);

function requestBody(): ImagePromptSpecialistRequestV1 {
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
      nodeRevision: 1,
    },
    commercialContext: {
      generationTaskId: "task-1",
      billingOrderId: "order-1",
      quoteFingerprint: "b".repeat(64),
    },
    operation: {
      command: "portraitTexture",
      objective: "保持身份和构图，只增强真实人像质感",
      parameters: { textureStrength: 0.5 },
    },
    evidence: {
      references: [
        {
          resourceId: "resource-1",
          mediaType: "image",
          semanticRole: "source",
          ordinal: 1,
          contentDigest: "a".repeat(64),
          accessUrl: "https://media.example/source.png",
        },
      ],
    },
    promptModel: {
      catalogRecordId: "model-record-1",
      modelKey: "gpt-5.6",
      configurationRevision: "revision-1",
      providerEndpointVersionId: "endpoint-version-1",
      providerCredentialVersionId: "credential-version-1",
    },
  };
}

function executionBody(): ImagePromptSpecialistExecutionRequestV1 {
  return {
    schemaVersion: "image-prompt-execution/v1",
    request: requestBody(),
    relayGrant: RELAY_GRANT,
  };
}

function responseBody(request: ImagePromptSpecialistRequestV1): ImagePromptSpecialistResponseV1 {
  return {
    schemaVersion: "image-prompt/v1",
    imagePrompt: "严格参考图1，仅提升真实皮肤、发丝和材质细节。",
    trace: {
      requestId: request.requestId,
      correlationId: request.correlationId,
      specialist: "image_prompt_specialist",
      evidenceDigest: "b".repeat(64),
      model: { ...request.promptModel, effectiveModel: request.promptModel.modelKey },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      startedAt: "2026-09-07T10:00:00.000Z",
      completedAt: "2026-09-07T10:00:01.000Z",
    },
  };
}

async function withServer(
  specialist: (
    request: ImagePromptSpecialistRequestV1,
    relayGrant: string,
    signal: AbortSignal,
  ) => Promise<ImagePromptSpecialistResponseV1>,
  run: (url: string) => Promise<void>,
  bodyLimitBytes = 8_000,
): Promise<void> {
  const server = await startAgentsHttpServer(
    {
      cwd: process.cwd(),
      runner: { run: async () => "unused" } as never,
      imagePromptSpecialist: specialist,
    },
    {
      host: "127.0.0.1",
      port: nextTestPort++,
      token: "chat-token",
      specialistToken: SPECIALIST_TOKEN,
      bodyLimitBytes,
    },
  );
  try {
    await run(server.url);
  } finally {
    await server.close();
  }
}

test("private image prompt route passes the request-scoped grant and returns strict JSON", async () => {
  const seen: ImagePromptSpecialistRequestV1[] = [];
  const seenGrants: string[] = [];
  await withServer(
    async (request, relayGrant) => {
      seen.push(request);
      seenGrants.push(relayGrant);
      return responseBody(request);
    },
    async (url) => {
      const denied = await fetch(`${url}/specialists/image-prompt`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer chat-token",
        },
        body: JSON.stringify(executionBody()),
      });
      assert.equal(denied.status, 401);

      const alternateHeaderDenied = await fetch(`${url}/specialists/image-prompt`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-agents-specialist-token": SPECIALIST_TOKEN,
        },
        body: JSON.stringify(executionBody()),
      });
      assert.equal(alternateHeaderDenied.status, 401);

      const accepted = await fetch(`${url}/specialists/image-prompt`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${SPECIALIST_TOKEN}`,
        },
        body: JSON.stringify(executionBody()),
      });
      assert.equal(accepted.status, 200);
      assert.equal(accepted.headers.get("cache-control"), "no-store");
      const body = (await accepted.json()) as ImagePromptSpecialistResponseV1;
      assert.equal(body.schemaVersion, "image-prompt/v1");
      assert.equal(seen.length, 1);
      assert.deepEqual(seenGrants, [RELAY_GRANT]);
    },
  );
});

test("private image prompt route rejects invalid and oversized bodies", async () => {
  await withServer(
    async (request) => responseBody(request),
    async (url) => {
      const invalid = await fetch(`${url}/specialists/image-prompt`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${SPECIALIST_TOKEN}`,
        },
        body: JSON.stringify({ schemaVersion: "wrong" }),
      });
      assert.equal(invalid.status, 400);
      const invalidBody = (await invalid.json()) as { code?: string };
      assert.equal(invalidBody.code, "specialist_request_invalid");

      const oversized = await fetch(`${url}/specialists/image-prompt`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${SPECIALIST_TOKEN}`,
        },
        body: JSON.stringify({ payload: "x".repeat(2_000) }),
      });
      assert.equal(oversized.status, 413);
    },
    1_000,
  );
});

test("private image prompt route preserves stable specialist failure codes", async () => {
  await withServer(
    async () => {
      throw new ImagePromptSpecialistFailure(
        "specialist_model_inheritance_failed",
        "effective model mismatch",
      );
    },
    async (url) => {
      const response = await fetch(`${url}/specialists/image-prompt`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${SPECIALIST_TOKEN}`,
        },
        body: JSON.stringify(executionBody()),
      });
      assert.equal(response.status, 502);
      const body = (await response.json()) as { code?: string; requestId?: string };
      assert.equal(body.code, "specialist_model_inheritance_failed");
      assert.equal(body.requestId, "request-1");
    },
  );
});

test("private image prompt route rejects a weak server token at startup", () => {
  assert.throws(
    () => startAgentsHttpServer(
      {
        cwd: process.cwd(),
        runner: { run: async () => "unused" } as never,
        imagePromptSpecialist: async (request) => responseBody(request),
      },
      {
        host: "127.0.0.1",
        port: nextTestPort++,
        specialistToken: "short-token",
      },
    ),
    (error: unknown) =>
      error instanceof ImagePromptSpecialistFailure &&
      error.code === "specialist_unavailable" &&
      error.message.includes("at least 32 UTF-8 bytes"),
  );
});
