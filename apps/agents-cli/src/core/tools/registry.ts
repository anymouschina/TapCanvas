import { CapabilityGrant, ToolDefinition, ToolResult } from "../../types/index.js";

export type ToolContext = {
  cwd: string;
  depth: number;
  meta?: Record<string, unknown>;
  // Mutable per-run state shared across tool calls.
  state: ToolRuntimeState;
};

export type ToolRuntimeState = {
  cache: {
    readFile: Map<string, ToolCacheEntry>;
    bash: Map<string, ToolCacheEntry>;
  };
  guard: {
    duplicateToolCallLimit: number;
    duplicateToolCallCount: Map<string, number>;
    readFileBudgetPerPath?: number;
    readFileUsageByPath?: Map<string, FileReadUsage>;
  };
};

export type FileReadWindow = {
  startLine: number;
  endLine: number | null;
};

export type FileReadUsage = {
  reads: number;
  windows: FileReadWindow[];
};

export type ToolCacheEntry = {
  content: string;
  expiresAt: number;
};

export type ToolHandler = {
  definition: ToolDefinition;
  execute: (
    args: Record<string, unknown>,
    ctx: ToolContext,
    toolCallId: string
  ) => Promise<ToolResult>;
};

export class ToolRegistry {
  private handlers = new Map<string, ToolHandler>();

  register(handler: ToolHandler) {
    this.handlers.set(handler.definition.name, handler);
  }

  list(): ToolDefinition[] {
    return Array.from(this.handlers.values()).map((h) => h.definition);
  }

  listForGrant(grant?: CapabilityGrant | null): ToolDefinition[] {
    if (!grant) return this.list();
    const allowed = new Set(grant.tools);
    return Array.from(this.handlers.values())
      .filter((handler) => allowed.has(handler.definition.name))
      .map((handler) => handler.definition);
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
    toolCallId: string
  ) {
    const handler = this.handlers.get(name);
    if (!handler) {
      throw new Error(`未知工具: ${name}`);
    }
    return handler.execute(args, ctx, toolCallId);
  }
}
