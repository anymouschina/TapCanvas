import type { WorkspaceContext } from "../workspace-context/types.js";

export type ToolCallTrace = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  output: string;
  outputJson?: Record<string, unknown>;
  outputChars: number;
  outputHead: string;
  outputTail: string;
  status: "succeeded" | "failed" | "denied" | "blocked";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  errorMessage?: string;
};

export type LlmTurnTrace = {
  turn: number;
  text: string;
  textPreview: string;
  textChars: number;
  toolCallCount: number;
  toolNames: string[];
  finished: boolean;
};

export type RunHookContext = {
  runId: string;
  cwd: string;
  workspaceRoot: string;
  prompt: string;
  sessionId?: string;
  requiredSkills: string[];
  modelOverride?: string;
  workspaceContext: WorkspaceContext;
  runtimeMeta?: Record<string, unknown>;
  toolCalls: ToolCallTrace[];
};

export type BeforeRunHookPayload = RunHookContext;

export type AfterRunHookPayload = RunHookContext & {
  resultText: string;
};

export type RunErrorHookPayload = RunHookContext & {
  errorMessage: string;
};

export type ToolCallHookPayload = RunHookContext & {
  toolCall: ToolCallTrace;
};

export type AgentsHook = {
  name: string;
  beforeRun?: (payload: BeforeRunHookPayload) => Promise<void>;
  afterRun?: (payload: AfterRunHookPayload) => Promise<void>;
  onRunError?: (payload: RunErrorHookPayload) => Promise<void>;
  onToolCall?: (payload: ToolCallHookPayload) => Promise<void>;
};
