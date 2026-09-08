import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import type { LLMRequest, LLMResponse } from "../types/index.js";
import {
  ImagePromptSpecialistFailure,
  executeImagePromptSpecialist,
  type ImagePromptSpecialistDependencies,
} from "./image-prompt-specialist.js";
import type { ImagePromptSpecialistRequestV1 } from "./image-prompt-contract.js";

function request(): ImagePromptSpecialistRequestV1 {
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
      nodeRevision: 3,
    },
    commercialContext: {
      generationTaskId: "task-1",
      billingOrderId: "order-1",
      quoteFingerprint: "b".repeat(64),
    },
    operation: {
      command: "portraitTexture",
      objective: "增强真实皮肤与发丝质感，并保持身份、构图和背景不变",
      parameters: { textureStrength: 0.65 },
    },
    evidence: {
      currentPrompt: "月夜湖边的白兔",
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
      configurationRevision: "revision-1",
      providerEndpointVersionId: "endpoint-version-1",
      providerCredentialVersionId: "credential-version-1",
    },
  };
}

function dependencies(
  call: (input: LLMRequest) => Promise<LLMResponse>,
): ImagePromptSpecialistDependencies {
  const times = [
    new Date("2026-09-07T10:00:00.000Z"),
    new Date("2026-09-07T10:00:01.000Z"),
  ];
  return {
    call,
    getRole: () => ({
      name: "image_prompt_specialist",
      description: "图片提示词专家",
      tools: [],
      prompt: "你是图片提示词专家，只根据已确认事实产出严格 JSON。",
      capabilityProviderBundle: ["local"],
      executionMode: "direct",
      isolationMode: "shared_workspace",
    }),
    getSkillContent: (name) =>
      name === "tapcanvas-prompt-specialists"
        ? "# Skill: tapcanvas-prompt-specialists\n\n只输出可执行的 imagePrompt。"
        : null,
    now: () => times.shift() ?? new Date("2026-09-07T10:00:01.000Z"),
  };
}

test("image prompt specialist runs once without tools and preserves exact model binding", async () => {
  const capturedRequests: LLMRequest[] = [];
  const result = await executeImagePromptSpecialist(
    request(),
    dependencies(async (input) => {
      capturedRequests.push(input);
      return {
        text: JSON.stringify({
          imagePrompt:
            "人物外观与构图严格参考图1，仅增强皮肤毛孔、细微绒毛和发丝层次，保留五官、姿态、服装、光向与背景。",
        }),
        toolCalls: [],
        model: "gpt-5.6",
        usage: { inputTokens: 100, outputTokens: 45, totalTokens: 145 },
      };
    }),
  );

  const captured = capturedRequests[0];
  assert.ok(captured);
  assert.equal(captured.model, "gpt-5.6");
  assert.deepEqual(captured.tools, []);
  assert.match(captured.system, /tapcanvas-prompt-specialists/);
  assert.match(captured.system, /imagePrompt: non-empty trimmed string/);
  assert.match(captured.system, /spatialLayout: array of 1-12 non-empty strings/);
  assert.match(captured.system, /omit the entire structuredPrompt field/);
  assert.match(captured.system, /never return null, a partial object, or an empty required array/);
  assert.doesNotMatch(captured.system, /accessUrl/);
  assert.equal(captured.messages.length, 1);
  assert.match(captured.messages[0].content, /https:\/\/media\.example\/source\.png/);
  assert.equal(result.schemaVersion, "image-prompt/v1");
  assert.equal(result.trace.model.effectiveModel, "gpt-5.6");
  assert.deepEqual(result.trace.usage, {
    inputTokens: 100,
    outputTokens: 45,
    totalTokens: 145,
  });
});

test("image prompt specialist rejects tools, markdown JSON and model inheritance drift", async () => {
  await assert.rejects(
    executeImagePromptSpecialist(
      request(),
      dependencies(async () => ({
        text: '{"imagePrompt":"valid"}',
        toolCalls: [{ id: "call-1", name: "canvas.read", arguments: "{}" }],
        model: "gpt-5.6",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      })),
    ),
    (error: unknown) =>
      error instanceof ImagePromptSpecialistFailure &&
      error.code === "specialist_output_invalid",
  );

  await assert.rejects(
    executeImagePromptSpecialist(
      request(),
      dependencies(async () => ({
        text: '```json\n{"imagePrompt":"valid"}\n```',
        toolCalls: [],
        model: "gpt-5.6",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      })),
    ),
    (error: unknown) =>
      error instanceof ImagePromptSpecialistFailure &&
      error.code === "specialist_output_invalid",
  );

  await assert.rejects(
    executeImagePromptSpecialist(
      request(),
      dependencies(async () => ({
        text: '{"imagePrompt":"valid"}',
        toolCalls: [],
        model: "fallback-model",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      })),
    ),
    (error: unknown) =>
      error instanceof ImagePromptSpecialistFailure &&
      error.code === "specialist_model_inheritance_failed",
  );
});

test("image prompt specialist fails when role, skill or usage evidence is missing", async () => {
  const missingRole = dependencies(async () => ({ text: "{}", toolCalls: [] }));
  missingRole.getRole = () => null;
  await assert.rejects(
    executeImagePromptSpecialist(request(), missingRole),
    (error: unknown) =>
      error instanceof ImagePromptSpecialistFailure &&
      error.code === "specialist_unavailable",
  );

  const missingSkill = dependencies(async () => ({ text: "{}", toolCalls: [] }));
  missingSkill.getSkillContent = () => null;
  await assert.rejects(
    executeImagePromptSpecialist(request(), missingSkill),
    (error: unknown) =>
      error instanceof ImagePromptSpecialistFailure &&
      error.code === "specialist_unavailable",
  );

  await assert.rejects(
    executeImagePromptSpecialist(
      request(),
      dependencies(async () => ({
        text: '{"imagePrompt":"valid"}',
        toolCalls: [],
        model: "gpt-5.6",
      })),
    ),
    (error: unknown) =>
      error instanceof ImagePromptSpecialistFailure &&
      error.code === "specialist_output_invalid",
  );
});

test("bundled definitions include the no-tool image prompt specialist", () => {
  const definitionsPath = fileURLToPath(
    new URL("../../agent-definitions/defaults.json", import.meta.url),
  );
  const definitions = JSON.parse(fs.readFileSync(definitionsPath, "utf8")) as Array<{
    name?: string;
    tools?: unknown;
  }>;
  const definition = definitions.find((item) => item.name === "image_prompt_specialist");
  assert.ok(definition);
  assert.deepEqual(definition.tools, []);
});
