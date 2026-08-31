import assert from "node:assert/strict";
import test from "node:test";

import { BridgeRequestError, parseAgentsChatRequest } from "./contracts.js";

const baseRequest = {
  prompt: "inspect the current canvas",
  stream: true,
  systemPrompt: "Use only confirmed TapCanvas facts.",
  model: "deepseek-chat",
  overrideApiBaseUrl: "https://models.example/v1",
  overrideApiKey: "secret",
  overrideApiStyle: "chat",
};

test("parses direct and deferred TapCanvas tool surfaces without exposing secrets", () => {
  const request = parseAgentsChatRequest({
    ...baseRequest,
    logicalTaskId: "logical-1",
    outputContract: { type: "json" },
		equippedWorkflowCapabilities: [{
			attachmentId: "system-greeting",
			name: "简短问候固定回复",
			summary: "仅处理不带其他任务的简短问候",
		}],
    overrideApiKey: "request-secret",
    remoteTools: [{
      name: "tapcanvas_flow_get",
      description: "Read the current flow",
      parameters: { type: "object", properties: {} },
    }],
    remoteToolCatalog: [{
      name: "tapcanvas_video_generate_to_canvas",
      description: "Generate a video",
      schemaDeferred: true,
      requiredScope: ["project", "canvas"],
      capability: "paid_media_generation",
    }],
    remoteToolConfig: { endpoint: "https://api.example/agents/tools/execute" },
  });

  assert.equal(request.remoteTools.length, 1);
  assert.equal(request.remoteToolCatalog.length, 1);
  assert.equal(request.remoteToolCatalog[0]?.schemaDeferred, true);
  assert.deepEqual(request.turnContext, {
    logicalTaskId: "logical-1",
    outputContract: { type: "json" },
		equippedWorkflowCapabilities: [{
			attachmentId: "system-greeting",
			name: "简短问候固定回复",
			summary: "仅处理不带其他任务的简短问候",
		}],
  });
  assert.equal(Object.hasOwn(request.turnContext, "overrideApiKey"), false);
});

test("rejects a deferred catalog entry without an explicit deferred contract", () => {
  assert.throws(
    () => parseAgentsChatRequest({
      ...baseRequest,
      remoteToolCatalog: [{ name: "unsafe", description: "missing contract" }],
      remoteToolConfig: { endpoint: "https://api.example/agents/tools/execute" },
    }),
    (error: unknown) =>
      error instanceof BridgeRequestError &&
      error.code === "remote_tool_catalog_contract_invalid",
  );
});

test("rejects required external skills when no authenticated resolver is supplied", () => {
  assert.throws(
    () => parseAgentsChatRequest({
      ...baseRequest,
      requiredSkillCalls: ["user-skill:asset-1"],
      externalSkills: [{
        id: "asset-1",
        key: "user-skill:asset-1",
        name: "Storyboard Method",
        description: "User-owned method",
        source: "user",
      }],
    }),
    (error: unknown) =>
      error instanceof BridgeRequestError &&
      error.code === "external_skill_resolver_required",
  );
});
