import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCapabilityGrant,
  buildRunEnvelope,
  normalizeWorkspaceResourceRoots,
  readCapabilityGrant,
  uniqueStrings,
} from "./capability-resolver.js";
import type { AgentConfig } from "../types/index.js";

const baseConfig: AgentConfig = {
  apiBaseUrl: "https://example.test/v1",
  apiKey: "test-key",
  model: "gpt-5.2",
  apiStyle: "responses",
  stream: true,
  memoryDir: ".agents/memory",
  skillsDir: "skills",
  workspaceRoot: "/repo",
  worldApiUrl: "",
  maxTurns: 12,
  maxSubagentDepth: 2,
  agentIntro: "system",
};

test("normalizeWorkspaceResourceRoots removes blanks, duplicates and enforces cap", () => {
  const roots = normalizeWorkspaceResourceRoots([
    "",
    " /tmp/a ".trim(),
    "/tmp/a",
    "/tmp/b",
  ]);

  assert.deepEqual(roots, ["/tmp/a", "/tmp/b"]);
});

test("uniqueStrings preserves order and limit", () => {
  assert.deepEqual(uniqueStrings(["a", "b", "a", "c"], 2), ["a", "b"]);
});

test("readCapabilityGrant parses structured capability metadata", () => {
  const grant = readCapabilityGrant({
    capabilityGrant: {
      tools: ["read_file", "write_file", "read_file"],
      readableRoots: ["/repo", "/repo"],
      writableRoots: ["/repo/out"],
      network: "approved",
      budgets: {
        maxToolCalls: 9,
        maxTokens: 2048,
        maxWallTimeMs: 12345,
      },
    },
  });

  assert.deepEqual(grant, {
    tools: ["read_file", "write_file"],
    readableRoots: ["/repo"],
    writableRoots: ["/repo/out"],
    network: "approved",
    budgets: {
      maxToolCalls: 9,
      maxTokens: 2048,
      maxWallTimeMs: 12345,
    },
  });
});

test("buildCapabilityGrant reuses existing grant and merges dynamic tools", () => {
  const grant = buildCapabilityGrant({
    allToolNames: ["read_file", "write_file"],
    dynamicToolNames: ["remote_tool"],
    allowedTools: null,
    workspaceRoot: "/repo",
    localResourcePaths: [],
    existingGrant: {
      tools: ["read_file"],
      readableRoots: ["/repo"],
      writableRoots: ["/repo"],
      network: "approved",
      budgets: {
        maxToolCalls: 8,
        maxTokens: 1000,
        maxWallTimeMs: 5000,
      },
    },
  });

  assert.deepEqual(grant.tools, ["read_file", "remote_tool"]);
  assert.deepEqual(grant.readableRoots, ["/repo"]);
});

test("buildCapabilityGrant derives default grant from workspace and local resources", () => {
  const grant = buildCapabilityGrant({
    allToolNames: ["read_file", "write_file"],
    dynamicToolNames: ["remote_tool"],
    allowedTools: new Set(["read_file", "remote_tool"]),
    workspaceRoot: "/repo",
    localResourcePaths: ["/repo/project-data"],
    existingGrant: null,
  });

  assert.deepEqual(grant.tools, ["read_file", "remote_tool"]);
  assert.deepEqual(grant.readableRoots, ["/repo", "/repo/project-data"]);
  assert.deepEqual(grant.writableRoots, ["/repo"]);
  assert.equal(grant.network, "approved");
});

test("buildRunEnvelope carries runtime contract facts", () => {
  const capabilityGrant = buildCapabilityGrant({
    allToolNames: ["read_file"],
    dynamicToolNames: [],
    allowedTools: null,
    workspaceRoot: "/repo",
    localResourcePaths: ["/repo/project-data"],
    existingGrant: null,
  });

  const envelope = buildRunEnvelope({
    config: baseConfig,
    prompt: "inspect project",
    sessionId: "session-1",
    capabilityGrant,
    localResourcePaths: ["/repo/project-data"],
    requiredSkills: ["agents-team"],
  });

  assert.equal(envelope.entrypoint, "run");
  assert.equal(envelope.sessionId, "session-1");
  assert.equal(envelope.userPrompt, "inspect project");
  assert.deepEqual(envelope.contextRequest, {
    localResourcePaths: ["/repo/project-data"],
    requiredSkills: ["agents-team"],
  });
  assert.equal(envelope.modelPolicy.defaultModel, "gpt-5.2");
});
