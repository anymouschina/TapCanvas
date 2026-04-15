import type { Message, ToolCall } from "../../types/index.js";
import type { RunHookContext, ToolCallTrace } from "../hooks/types.js";
import type { ToolRuntimeState } from "../tools/registry.js";

export function createToolRuntimeState(
  state?: ToolRuntimeState,
  duplicateToolCallLimit = 3,
): ToolRuntimeState {
  if (state) return state;
  return {
    cache: {
      readFile: new Map(),
      bash: new Map(),
    },
    guard: {
      duplicateToolCallLimit,
      duplicateToolCallCount: new Map(),
      readFileBudgetPerPath: undefined,
      readFileUsageByPath: new Map(),
    },
  };
}

export class AgentSessionEngine {
  private readonly loadedSkills: Set<string>;
  private readonly state: ToolRuntimeState;

  constructor(
    private readonly messages: Message[],
    private readonly runtimeMeta: Record<string, unknown>,
    private readonly hookContext: RunHookContext,
    options?: {
      loadedSkills?: Set<string>;
      state?: ToolRuntimeState;
      duplicateToolCallLimit?: number;
    },
  ) {
    this.loadedSkills = options?.loadedSkills ?? new Set<string>();
    this.state = createToolRuntimeState(
      options?.state,
      options?.duplicateToolCallLimit ?? 3,
    );
    if (!this.runtimeMeta.policySummary || typeof this.runtimeMeta.policySummary !== "object") {
      this.runtimeMeta.policySummary = {
        totalDecisions: 0,
        allowCount: 0,
        denyCount: 0,
        requiresApprovalCount: 0,
        uniqueDeniedSignatures: [],
      };
    }
    if (!this.runtimeMeta.usageSummary || typeof this.runtimeMeta.usageSummary !== "object") {
      this.runtimeMeta.usageSummary = {
        turnCount: 0,
        assistantChars: 0,
        toolCallCount: 0,
      };
    }
    if (!this.runtimeMeta.abortState || typeof this.runtimeMeta.abortState !== "object") {
      this.runtimeMeta.abortState = {
        aborted: false,
      };
    }
    if (!Array.isArray(this.runtimeMeta.pendingTeamWaits)) {
      this.runtimeMeta.pendingTeamWaits = [];
    }
  }

  getMessages(): Message[] {
    return this.messages;
  }

  getRuntimeMeta(): Record<string, unknown> {
    return this.runtimeMeta;
  }

  getHookContext(): RunHookContext {
    return this.hookContext;
  }

  getToolCalls(): ToolCallTrace[] {
    return this.hookContext.toolCalls;
  }

  getLoadedSkills(): Set<string> {
    return this.loadedSkills;
  }

  getState(): ToolRuntimeState {
    return this.state;
  }

  appendUserPrompt(prompt: string, ephemeral = false): void {
    this.messages.push({
      role: "user",
      content: prompt,
      ...(ephemeral ? { ephemeral: true } : {}),
    });
  }

  recordCurrentMessages(): void {
    this.runtimeMeta.currentMessages = this.messages;
  }

  recordCompletionTrace(value: unknown): void {
    this.runtimeMeta.completionTrace = value;
  }

  recordTurn(text: string, toolCallCount: number): void {
    const usageSummary =
      this.runtimeMeta.usageSummary && typeof this.runtimeMeta.usageSummary === "object"
        ? this.runtimeMeta.usageSummary as Record<string, unknown>
        : {};
    this.runtimeMeta.usageSummary = {
      turnCount: Number(usageSummary.turnCount ?? 0) + 1,
      assistantChars: Number(usageSummary.assistantChars ?? 0) + String(text || "").length,
      toolCallCount: Number(usageSummary.toolCallCount ?? 0) + Math.max(0, Math.trunc(toolCallCount)),
    };
  }

  recordPendingTeamWait(message: string): void {
    const list = Array.isArray(this.runtimeMeta.pendingTeamWaits)
      ? this.runtimeMeta.pendingTeamWaits as unknown[]
      : [];
    this.runtimeMeta.pendingTeamWaits = [
      ...list,
      {
        at: new Date().toISOString(),
        message: String(message || "").trim(),
      },
    ].slice(-8);
  }

  markAborted(reason: string): void {
    this.runtimeMeta.abortState = {
      aborted: true,
      reason: String(reason || "").trim(),
    };
  }

  buildSystem(baseSystem: string, collaborationFragment: string): string {
    const system = [baseSystem, collaborationFragment]
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join("\n\n");
    this.runtimeMeta.currentSystem = system;
    return system;
  }

  appendAssistantMessage(text: string, toolCalls: ToolCall[]): void {
    if (!text && toolCalls.length === 0) return;
    this.messages.push({
      role: "assistant",
      content: text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    });
  }

  appendToolMessage(message: { role: "tool"; content: string; toolCallId: string }): void {
    this.messages.push(message);
  }
}
