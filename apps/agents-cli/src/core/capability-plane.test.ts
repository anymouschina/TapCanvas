import assert from "node:assert/strict";
import test from "node:test";

import {
  type CapabilityProvider,
  type CapabilityProviderFactory,
  getDefaultCapabilityProviderFactories,
  resolveCapabilityPlane,
  resolveCapabilityProviders,
} from "./capability-plane.js";
import { ToolRegistry } from "./tools/registry.js";

test("capability plane merges local, remote and mcp providers into one snapshot", () => {
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: "read_file",
      description: "read",
      parameters: { type: "object" },
    },
    async execute() {
      return { toolCallId: "t1", content: "ok" };
    },
  });
  registry.register({
    definition: {
      name: "spawn_agent",
      description: "spawn",
      parameters: { type: "object" },
    },
    async execute() {
      return { toolCallId: "t2", content: "ok" };
    },
  });

  const resolved = resolveCapabilityPlane({
    registry,
    capabilityGrant: {
      tools: ["read_file", "spawn_agent", "tapcanvas_flow_get", "mcp_lookup"],
      readableRoots: ["/repo"],
      writableRoots: ["/repo"],
      network: "approved",
      budgets: {
        maxToolCalls: 8,
        maxTokens: 1000,
        maxWallTimeMs: 1000,
      },
    },
    allowedTools: null,
    meta: {
      remoteTools: [
        {
          name: "tapcanvas_flow_get",
          description: "remote tool",
          parameters: { type: "object" },
        },
      ],
      mcpTools: [
        {
          name: "mcp_lookup",
          description: "mcp tool",
          parameters: { type: "object" },
        },
      ],
    },
  });

  assert.deepEqual(resolved.snapshot.providers.map((item) => item.kind), ["local", "remote", "mcp"]);
  assert.ok(resolved.snapshot.exposedToolNames.includes("read_file"));
  assert.ok(resolved.snapshot.exposedToolNames.includes("tapcanvas_flow_get"));
  assert.ok(resolved.snapshot.exposedToolNames.includes("mcp_lookup"));
  assert.ok(resolved.snapshot.exposedTeamToolNames.includes("spawn_agent"));
});

test("capability plane can extend the default provider registry without changing core resolver logic", () => {
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: "read_file",
      description: "read",
      parameters: { type: "object" },
    },
    async execute() {
      return { toolCallId: "t1", content: "ok" };
    },
  });

  const providerFactories: CapabilityProviderFactory[] = [
    ...getDefaultCapabilityProviderFactories(),
    {
      kind: "skill",
      name: "skill_bundle_tools",
      create(): CapabilityProvider {
        return {
          kind: "skill",
          name: "skill_bundle_tools",
          listTools() {
            return [
              {
                name: "skill_lookup",
                description: "skill provided tool",
                parameters: { type: "object" },
              },
            ];
          },
        };
      },
    },
  ];

  const resolved = resolveCapabilityPlane({
    registry,
    capabilityGrant: {
      tools: ["read_file", "skill_lookup"],
      readableRoots: ["/repo"],
      writableRoots: ["/repo"],
      network: "approved",
      budgets: {
        maxToolCalls: 8,
        maxTokens: 1000,
        maxWallTimeMs: 1000,
      },
    },
    allowedTools: null,
    providerFactories,
  });

  assert.deepEqual(
    resolved.snapshot.providers.map((item) => item.name),
    ["local_registry", "remote_tools", "mcp_tools", "skill_bundle_tools"],
  );
  assert.ok(resolved.snapshot.exposedToolNames.includes("skill_lookup"));
});

test("capability provider registry preserves provider ordering before plane merge", () => {
  const registry = new ToolRegistry();
  const providers = resolveCapabilityProviders(
    {
      registry,
      capabilityGrant: {
        tools: [],
        readableRoots: ["/repo"],
        writableRoots: ["/repo"],
        network: "approved",
        budgets: {
          maxToolCalls: 8,
          maxTokens: 1000,
          maxWallTimeMs: 1000,
        },
      },
      allowedTools: null,
    },
    getDefaultCapabilityProviderFactories(),
  );

  assert.deepEqual(
    providers.map((provider) => provider.name),
    ["local_registry", "remote_tools", "mcp_tools"],
  );
});

test("capability plane can restrict exposure to a definition-scoped provider bundle", () => {
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: "read_file",
      description: "read",
      parameters: { type: "object" },
    },
    async execute() {
      return { toolCallId: "t1", content: "ok" };
    },
  });

  const resolved = resolveCapabilityPlane({
    registry,
    capabilityGrant: {
      tools: ["read_file", "tapcanvas_flow_get", "mcp_lookup"],
      readableRoots: ["/repo"],
      writableRoots: ["/repo"],
      network: "approved",
      budgets: {
        maxToolCalls: 8,
        maxTokens: 1000,
        maxWallTimeMs: 1000,
      },
    },
    allowedTools: null,
    providerKinds: ["local"],
    meta: {
      remoteTools: [
        {
          name: "tapcanvas_flow_get",
          description: "remote tool",
          parameters: { type: "object" },
        },
      ],
      mcpTools: [
        {
          name: "mcp_lookup",
          description: "mcp tool",
          parameters: { type: "object" },
        },
      ],
    },
  });

  assert.deepEqual(resolved.snapshot.providers.map((item) => item.kind), ["local"]);
  assert.deepEqual(resolved.snapshot.exposedToolNames, ["read_file"]);
});
