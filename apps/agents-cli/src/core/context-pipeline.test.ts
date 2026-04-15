import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveAgentRunContext } from "./context-pipeline.js";
import type { AgentConfig } from "../types/index.js";

function createConfig(workspaceRoot: string): AgentConfig {
  return {
    apiBaseUrl: "https://example.test/v1",
    apiKey: "test-key",
    model: "gpt-5.2",
    apiStyle: "responses",
    stream: true,
    memoryDir: ".agents/memory",
    skillsDir: "skills",
    workspaceRoot,
    worldApiUrl: "",
    maxTurns: 12,
    maxSubagentDepth: 2,
    agentIntro: "system",
  };
}

test("context pipeline emits source diagnostics and consolidated prompt fragment", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-context-"));
  fs.writeFileSync(path.join(root, "IDENTITY.md"), "Identity rules", "utf-8");
  fs.writeFileSync(path.join(root, "AGENTS.md"), "Workspace rules", "utf-8");
  fs.mkdirSync(path.join(root, ".agents", "memory"), { recursive: true });

  const resolved = await resolveAgentRunContext({
    config: createConfig(root),
    cwd: root,
    prompt: "do work",
    requiredSkills: [],
    capabilityGrant: {
      tools: ["read_file"],
      readableRoots: [root],
      writableRoots: [root],
      network: "approved",
      budgets: {
        maxToolCalls: 8,
        maxTokens: 1000,
        maxWallTimeMs: 1000,
      },
    },
    runEnvelope: {
      runId: "run-1",
      entrypoint: "run",
      userPrompt: "do work",
      workspaceRoot: root,
      modelPolicy: {
        defaultModel: "gpt-5.2",
        maxTurns: 12,
        maxAgentDepth: 2,
      },
      capabilityGrant: {
        tools: ["read_file"],
        readableRoots: [root],
        writableRoots: [root],
        network: "approved",
        budgets: {
          maxToolCalls: 8,
          maxTokens: 1000,
          maxWallTimeMs: 1000,
        },
      },
      contextRequest: {
        localResourcePaths: [],
        requiredSkills: [],
      },
    },
    localResourcePaths: [],
    toolCalls: [],
    currentModel: "gpt-5.2",
    toolContextMeta: {
      diagnosticContext: { planningRequired: true },
      generationContract: { version: "v1" },
      canvasCapabilityManifest: {
        version: "1",
        summary: "canvas",
        localCanvasTools: [],
        remoteTools: [],
        nodeSpecs: {},
      },
      sessionAssetInputs: [{ assetRefId: "hero", url: "https://example.test/hero.png" }],
    },
  });

  assert.ok(resolved.contextPromptFragment.includes("Persona Context"));
  assert.ok(resolved.contextPromptFragment.includes("Workspace Context"));
  assert.ok(resolved.contextPromptFragment.includes("System Snapshot"));
  assert.ok(resolved.contextPromptFragment.includes("Runtime Diagnostics"));
  assert.ok(resolved.contextPromptFragment.includes("Generation Contract"));
  assert.ok(resolved.contextPromptFragment.includes("Canvas Capability Context"));
  assert.ok(resolved.contextPromptFragment.includes("Request Scope"));
  assert.equal(resolved.runtimeMeta.currentModel, "gpt-5.2");
  assert.deepEqual(resolved.runtimeMeta.currentRequiredSkills, []);
  assert.deepEqual(
    resolved.contextDiagnostics.sources.map((source) => source.id),
    [
      "persona",
      "workspace_rules",
      "system_snapshot",
      "memory",
      "runtime_diagnostics",
      "generation_contract",
      "canvas_capability",
      "request_scope",
    ],
  );
});

test("context pipeline preserves provider order and records truncation per source budget", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-context-truncate-"));
  fs.writeFileSync(path.join(root, "IDENTITY.md"), "Identity rules", "utf-8");
  fs.writeFileSync(path.join(root, "AGENTS.md"), "Workspace rules", "utf-8");
  fs.mkdirSync(path.join(root, ".agents", "memory"), { recursive: true });

  const resolved = await resolveAgentRunContext({
    config: createConfig(root),
    cwd: root,
    prompt: "do work",
    requiredSkills: [],
    capabilityGrant: {
      tools: ["read_file"],
      readableRoots: [root],
      writableRoots: [root],
      network: "approved",
      budgets: {
        maxToolCalls: 8,
        maxTokens: 1000,
        maxWallTimeMs: 1000,
      },
    },
    runEnvelope: {
      runId: "run-2",
      entrypoint: "run",
      userPrompt: "do work",
      workspaceRoot: root,
      modelPolicy: {
        defaultModel: "gpt-5.2",
        maxTurns: 12,
        maxAgentDepth: 2,
      },
      capabilityGrant: {
        tools: ["read_file"],
        readableRoots: [root],
        writableRoots: [root],
        network: "approved",
        budgets: {
          maxToolCalls: 8,
          maxTokens: 1000,
          maxWallTimeMs: 1000,
        },
      },
      contextRequest: {
        localResourcePaths: [],
        requiredSkills: [],
      },
    },
    localResourcePaths: [],
    toolCalls: [],
    currentModel: "gpt-5.2",
    toolContextMeta: {
      diagnosticContext: {
        repeated: "x".repeat(4_000),
      },
      sessionAssetInputs: [{ assetRefId: "hero", url: "https://example.test/hero.png" }],
    },
  });

  const runtimeDiagnostics = resolved.contextDiagnostics.sources.find(
    (source) => source.id === "runtime_diagnostics",
  );
  assert.ok(runtimeDiagnostics);
  assert.equal(runtimeDiagnostics?.truncated, true);
  assert.equal(runtimeDiagnostics?.budgetChars, 2_000);
});
