export type Role = "user" | "assistant" | "tool";

export type Message = {
  role: Role;
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  ephemeral?: boolean;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type RemoteToolDefinition = ToolDefinition;

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ArtifactRef = {
  id: string;
  kind: string;
  path?: string;
  summary?: string;
};

export type CapabilityBudget = {
  maxToolCalls: number;
  maxTokens: number;
  maxWallTimeMs: number;
};

export type CapabilityGrant = {
  tools: string[];
  readableRoots: string[];
  writableRoots: string[];
  network: "none" | "approved";
  budgets: CapabilityBudget;
};

export type ContextSourceKind =
  | "persona"
  | "workspace_rules"
  | "system_snapshot"
  | "memory"
  | "runtime_diagnostics"
  | "generation_contract"
  | "canvas_capability"
  | "request_scope";

export type ContextSourceDiagnostic = {
  id: string;
  kind: ContextSourceKind;
  summary: string;
  chars: number;
  budgetChars: number;
  truncated: boolean;
};

export type ContextDiagnostics = {
  totalChars: number;
  totalBudgetChars: number;
  sources: ContextSourceDiagnostic[];
};

export type CapabilityProviderKind = "local" | "remote" | "mcp" | "skill";

export type CapabilityProviderSnapshot = {
  kind: CapabilityProviderKind;
  name: string;
  toolNames: string[];
  toolCount: number;
};

export type CapabilitySnapshot = {
  providers: CapabilityProviderSnapshot[];
  exposedToolNames: string[];
  exposedTeamToolNames: string[];
};

export type ToolPolicyVerdict = "allow" | "deny" | "requires_approval";

export type ToolPolicyScope = "tool" | "path" | "command";

export type ToolPolicySource = "system" | "project" | "user" | "request" | "runtime_grant";

export type ToolPolicyDecision = {
  verdict: ToolPolicyVerdict;
  reason: string;
  source: ToolPolicySource;
  scope: ToolPolicyScope;
};

export type ToolPolicySummary = {
  totalDecisions: number;
  allowCount: number;
  denyCount: number;
  requiresApprovalCount: number;
  uniqueDeniedSignatures: string[];
};

export type AgentExecutionMode = "direct" | "private_workspace";

export type AgentIsolationMode = "shared_workspace" | "private_workspace";

export type AgentDefinitionModelPolicy = {
  inheritFromParent?: boolean;
  defaultModel?: string;
};

export type AgentDefinition = {
  name: string;
  description: string;
  tools: string[];
  prompt: string;
  team?: boolean;
  executionMode?: AgentExecutionMode;
  isolationMode?: AgentIsolationMode;
  modelPolicy?: AgentDefinitionModelPolicy;
  skillBundle?: string[];
  capabilityProviderBundle?: CapabilityProviderKind[];
};

export type EvidenceBundle = {
  id: string;
  kind:
    | "persona"
    | "workspace_rule"
    | "skill"
    | "file_excerpt"
    | "task_state";
  source: string;
  summary: string;
  content: string;
  visibility: "orchestrator" | "worker" | "all";
};

export type RunEnvelope = {
  runId: string;
  entrypoint: "run" | "repl" | "serve";
  userPrompt: string;
  sessionId?: string;
  workspaceRoot: string;
  modelPolicy: {
    defaultModel: string;
    maxTurns: number;
    maxAgentDepth: number;
  };
  capabilityGrant: CapabilityGrant;
  contextRequest: {
    localResourcePaths: string[];
    requiredSkills: string[];
  };
};

export type ToolResultPayload = {
  text: string;
  artifacts?: ArtifactRef[];
  structuredOutput?: unknown;
};

export type ToolResult = {
  toolCallId: string;
  content: string;
  payload?: ToolResultPayload;
};

export type AgentConfig = {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  apiStyle: "responses" | "chat";
  stream: boolean;
  memoryDir: string;
  skillsDir: string;
  workspaceRoot: string;
  worldApiUrl: string;
  maxTurns: number;
  maxSubagentDepth: number;
  agentIntro: string;
};

export type LLMResponse = {
  text: string;
  toolCalls: ToolCall[];
};

export type LLMRequest = {
  system: string;
  messages: Message[];
  tools: ToolDefinition[];
  model?: string;
  onTextDelta?: (delta: string) => void;
  abortSignal?: AbortSignal;
};
