import type {
  CapabilityGrant,
  CapabilityProviderKind,
  CapabilityProviderSnapshot,
  CapabilitySnapshot,
  ToolDefinition,
} from "../types/index.js";
import type { ToolRegistry } from "./tools/registry.js";
import { getAllTeamToolNames } from "./subagent/types.js";
import { normalizeRemoteToolDefinitions } from "./tools/remote.js";

export type CapabilityProviderContext = {
  registry: ToolRegistry;
  capabilityGrant: CapabilityGrant;
  allowedTools: Set<string> | null;
  meta?: Record<string, unknown>;
};

export type CapabilityProvider = {
  kind: CapabilityProviderKind;
  name: string;
  listTools: () => ToolDefinition[];
};

export type CapabilityProviderFactory = {
  kind: CapabilityProviderKind;
  name: string;
  create: (context: CapabilityProviderContext) => CapabilityProvider;
};

function normalizeCapabilityProviderKinds(value: Iterable<string> | undefined): CapabilityProviderKind[] {
  if (!value) return [];
  const out: CapabilityProviderKind[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = String(item || "").trim();
    if (
      (normalized !== "local" &&
        normalized !== "remote" &&
        normalized !== "mcp" &&
        normalized !== "skill") ||
      seen.has(normalized)
    ) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function filterDefinitions(
  tools: ToolDefinition[],
  grant: CapabilityGrant,
  allowedTools: Set<string> | null,
): ToolDefinition[] {
  const grantTools = new Set(grant.tools);
  return tools.filter((tool) => {
    if (!grantTools.has(tool.name)) return false;
    if (allowedTools && !allowedTools.has(tool.name)) return false;
    return true;
  });
}

function createLocalCapabilityProvider(context: CapabilityProviderContext): CapabilityProvider {
  return {
    kind: "local",
    name: "local_registry",
    listTools: () => filterDefinitions(context.registry.list(), context.capabilityGrant, context.allowedTools),
  };
}

function createRemoteCapabilityProvider(context: CapabilityProviderContext): CapabilityProvider {
  return {
    kind: "remote",
    name: "remote_tools",
    listTools: () =>
      filterDefinitions(
        normalizeRemoteToolDefinitions(context.meta?.remoteTools),
        context.capabilityGrant,
        context.allowedTools,
      ),
  };
}

function createMcpCapabilityProvider(context: CapabilityProviderContext): CapabilityProvider {
  return {
    kind: "mcp",
    name: "mcp_tools",
    listTools: () =>
      filterDefinitions(
        normalizeRemoteToolDefinitions(context.meta?.mcpTools),
        context.capabilityGrant,
        context.allowedTools,
      ),
  };
}

const DEFAULT_CAPABILITY_PROVIDER_FACTORIES: CapabilityProviderFactory[] = [
  {
    kind: "local",
    name: "local_registry",
    create: createLocalCapabilityProvider,
  },
  {
    kind: "remote",
    name: "remote_tools",
    create: createRemoteCapabilityProvider,
  },
  {
    kind: "mcp",
    name: "mcp_tools",
    create: createMcpCapabilityProvider,
  },
];

export function resolveCapabilityProviders(
  context: CapabilityProviderContext,
  factories: CapabilityProviderFactory[] = DEFAULT_CAPABILITY_PROVIDER_FACTORIES,
  allowedProviderKinds?: Iterable<CapabilityProviderKind>,
): CapabilityProvider[] {
  const providerKinds = normalizeCapabilityProviderKinds(allowedProviderKinds);
  const allowedKindSet = providerKinds.length > 0 ? new Set(providerKinds) : null;
  return factories
    .filter((factory) => !allowedKindSet || allowedKindSet.has(factory.kind))
    .map((factory) => factory.create(context));
}

export function resolveCapabilityPlane(input: {
  registry: ToolRegistry;
  capabilityGrant: CapabilityGrant;
  allowedTools: Set<string> | null;
  meta?: Record<string, unknown>;
  providerFactories?: CapabilityProviderFactory[];
  providerKinds?: Iterable<CapabilityProviderKind>;
}): {
  tools: ToolDefinition[];
  snapshot: CapabilitySnapshot;
} {
  const providers = resolveCapabilityProviders(
    {
      registry: input.registry,
      capabilityGrant: input.capabilityGrant,
      allowedTools: input.allowedTools,
      ...(input.meta ? { meta: input.meta } : {}),
    },
    input.providerFactories,
    input.providerKinds,
  );
  const snapshotProviders: CapabilityProviderSnapshot[] = [];
  const merged: ToolDefinition[] = [];
  const seen = new Set<string>();
  for (const provider of providers) {
    const providerTools = provider.listTools();
    const uniqueProviderToolNames = providerTools.map((tool) => tool.name);
    snapshotProviders.push({
      kind: provider.kind,
      name: provider.name,
      toolNames: uniqueProviderToolNames,
      toolCount: providerTools.length,
    });
    for (const tool of providerTools) {
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      merged.push(tool);
    }
  }
  const teamToolNames = new Set(getAllTeamToolNames());
  return {
    tools: merged,
    snapshot: {
      providers: snapshotProviders,
      exposedToolNames: merged.map((tool) => tool.name),
      exposedTeamToolNames: merged
        .map((tool) => tool.name)
        .filter((toolName) => teamToolNames.has(toolName)),
    },
  };
}

export function getDefaultCapabilityProviderFactories(): CapabilityProviderFactory[] {
  return DEFAULT_CAPABILITY_PROVIDER_FACTORIES.slice();
}
