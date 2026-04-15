import type { AgentDefinition } from "../../types/index.js";
import {
  getActiveAgentDefinitions,
  getAgentDefinition,
} from "./definitions.js";

type GetToolsForAgentOptions = {
  inheritedTools?: Iterable<string>;
  blockDelegation?: boolean;
};

export const CHILD_DELEGATION_BLOCKED_TOOLS = ["spawn_agent", "Task"] as const;
const CHILD_NON_ORCHESTRATOR_COORDINATION_BLOCKED_TOOLS = [
  ...CHILD_DELEGATION_BLOCKED_TOOLS,
  "send_input",
  "resume_agent",
  "wait",
  "close_agent",
  "list_agents",
  "agent_workspace_import",
] as const;

const ALL_TEAM_TOOLS = [
  "spawn_agent",
  "send_input",
  "resume_agent",
  "idle_agent",
  "wait",
  "close_agent",
  "list_agents",
  "agent_workspace_import",
  "mailbox_send",
  "mailbox_read",
  "protocol_request",
  "protocol_read",
  "protocol_respond",
  "protocol_get",
] as const;

export type AgentType = string;

export function getAgentDefinitions(): Record<string, AgentDefinition> {
  return Object.fromEntries(getActiveAgentDefinitions().entries());
}

export const AGENT_TYPES: Record<string, AgentDefinition> = new Proxy(
  {},
  {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      return getAgentDefinition(prop) ?? undefined;
    },
    ownKeys() {
      return Array.from(getActiveAgentDefinitions().keys());
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop !== "string") return undefined;
      const value = getAgentDefinition(prop);
      if (!value) return undefined;
      return {
        enumerable: true,
        configurable: true,
        value,
      };
    },
  },
);

export function getAgentDescriptions(): string {
  return Array.from(getActiveAgentDefinitions().values())
    .map((cfg) => `- ${cfg.name}: ${cfg.description}`)
    .join("\n");
}

export function getAgentTypeNames(): AgentType[] {
  return Array.from(getActiveAgentDefinitions().keys());
}

export function getTeamAgentTypes(): AgentType[] {
  return Array.from(getActiveAgentDefinitions().values())
    .filter((cfg) => cfg.team === true)
    .map((cfg) => cfg.name);
}

export function getAllTeamToolNames(): string[] {
  return Array.from(ALL_TEAM_TOOLS);
}

export function getTeamAgentDescriptions(): string {
  return Array.from(getActiveAgentDefinitions().values())
    .filter((cfg) => cfg.team === true)
    .map((cfg) => `- ${cfg.name}: ${cfg.description}`)
    .join("\n");
}

function normalizeToolNames(values: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function filterBlockedDelegationTools(agentType: AgentType, toolNames: string[]): string[] {
  const blockedTools = new Set<string>(
    agentType === "orchestrator"
      ? CHILD_DELEGATION_BLOCKED_TOOLS
      : CHILD_NON_ORCHESTRATOR_COORDINATION_BLOCKED_TOOLS
  );
  return toolNames.filter((toolName) => !blockedTools.has(toolName));
}

export function getToolsForAgent(agentType: AgentType, options?: GetToolsForAgentOptions): Set<string> {
  const baseTools = getAgentDefinition(agentType)?.tools ?? [];
  const inheritedTools = options?.inheritedTools ? Array.from(options.inheritedTools) : [];
  const merged = normalizeToolNames([...baseTools, ...inheritedTools]);
  const filtered = options?.blockDelegation === true
    ? filterBlockedDelegationTools(agentType, merged)
    : merged;
  return new Set(filtered);
}

export function getSystemPromptForAgent(agentType: AgentType): string {
  return String(getAgentDefinition(agentType)?.prompt || "").trim();
}

export function isAgentType(value: string): value is AgentType {
  return getActiveAgentDefinitions().has(String(value || "").trim());
}
