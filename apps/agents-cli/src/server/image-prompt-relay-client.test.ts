import assert from "node:assert/strict";
import test from "node:test";

import type { AgentConfig } from "../types/index.js";
import type { ImagePromptSpecialistModelBindingV1 } from "./image-prompt-contract.js";
import { ImagePromptSpecialistFailure } from "./image-prompt-specialist.js";
import {
  createImagePromptRelayCall,
  readImagePromptRelayConfig,
  requireImagePromptRelayConfig,
} from "./image-prompt-relay-client.js";

const RELAY_GRANT = "g".repeat(43);
const PROMPT_MODEL: ImagePromptSpecialistModelBindingV1 = {
  catalogRecordId: "catalog-record-1",
  modelKey: "deepseek-chat",
  configurationRevision: "revision-1",
  providerEndpointVersionId: "endpoint-version-1",
  providerCredentialVersionId: "credential-version-1",
};

function config(): AgentConfig {
  return {
    apiBaseUrl: "https://general.example/v1",
    apiKey: "general-token",
    model: "general-model",
    apiStyle: "responses",
    chatThinkingMode: "enabled",
    stream: true,
    memoryDir: ".agents/memory",
    skillsDir: "skills",
    workspaceRoot: process.cwd(),
    worldApiUrl: "",
    maxTurns: 8,
    maxSubagentDepth: 2,
    agentIntro: "test",
  };
}

test("image prompt relay configuration contains only the private base URL", () => {
  assert.equal(readImagePromptRelayConfig({}), null);
  assert.deepEqual(
    readImagePromptRelayConfig({
      AGENTS_IMAGE_PROMPT_RELAY_BASE_URL:
        "https://commercial.example/internal/v1/image-prompt-llm/",
      AGENTS_UNRELATED_TOKEN: "must-not-be-read",
    }),
    { baseUrl: "https://commercial.example/internal/v1/image-prompt-llm" },
  );
});

test("image prompt relay configuration rejects missing or unsafe base URLs", () => {
  assert.throws(
    () => requireImagePromptRelayConfig({}),
    (error: unknown) =>
      error instanceof ImagePromptSpecialistFailure && error.code === "specialist_unavailable",
  );
  assert.throws(
    () =>
      readImagePromptRelayConfig({
        AGENTS_IMAGE_PROMPT_RELAY_BASE_URL: "https://user:pass@commercial.example/internal",
      }),
    (error: unknown) =>
      error instanceof ImagePromptSpecialistFailure && error.code === "specialist_unavailable",
  );
});

test("dedicated relay call uses one request grant and complete body binding", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${RELAY_GRANT}`);
    assert.equal(body.stream, false);
    assert.deepEqual(body.tools, []);
    assert.equal(body.model, PROMPT_MODEL.modelKey);
    assert.deepEqual(body.metadata, {
      schemaVersion: "image-prompt-relay-binding/v1",
      correlationId: "correlation-1",
      generationTaskId: "generation-task-1",
      promptModel: PROMPT_MODEL,
    });
    assert.equal("thinking" in body, false);
    return new Response(JSON.stringify({ code: "upstream_unavailable" }), { status: 503 });
  }) as typeof fetch;

  try {
    const call = createImagePromptRelayCall(config(), {
      baseUrl: "https://commercial.example/internal/v1/image-prompt-llm",
      grant: RELAY_GRANT,
      correlationId: "correlation-1",
      generationTaskId: "generation-task-1",
      promptModel: PROMPT_MODEL,
    });
    await assert.rejects(
      call({
        system: "system",
        messages: [{ role: "user", content: "user" }],
        tools: [],
        model: PROMPT_MODEL.modelKey,
      }),
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dedicated relay preserves stable failures returned by the model relay", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        code: "specialist_model_binding_invalid",
        reason: "frozen model binding no longer matches",
      }),
      { status: 409 },
    )) as typeof fetch;

  try {
    const call = createImagePromptRelayCall(config(), {
      baseUrl: "https://commercial.example/internal/v1/image-prompt-llm",
      grant: RELAY_GRANT,
      correlationId: "correlation-1",
      generationTaskId: "generation-task-1",
      promptModel: PROMPT_MODEL,
    });
    await assert.rejects(
      call({
        system: "system",
        messages: [{ role: "user", content: "user" }],
        tools: [],
        model: PROMPT_MODEL.modelKey,
      }),
      (error: unknown) =>
        error instanceof ImagePromptSpecialistFailure &&
        error.code === "specialist_model_binding_invalid" &&
        error.message === "frozen model binding no longer matches",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
