import { ToolHandler } from "./registry.js";
import { MemoryStore, MemoryStoreKind } from "../memory/store.js";
import {
  resolveMemoryRoot,
  searchLayeredMemory,
  syncMemorySummaryArtifacts,
} from "../memory/layered.js";

export function createMemoryTools(defaultMemoryRoot: string): ToolHandler[] {
  const getStore = (meta?: Record<string, unknown>) =>
    new MemoryStore(resolveMemoryRoot(meta, defaultMemoryRoot));
  const syncArtifacts = (meta?: Record<string, unknown>) =>
    syncMemorySummaryArtifacts(resolveMemoryRoot(meta, defaultMemoryRoot));

  const saveTool: ToolHandler = {
    definition: {
      name: "memory_save",
      description: "保存长期记忆条目（支持分层 store、来源与重要度）。",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "要保存的内容" },
          tags: { type: "array", items: { type: "string" }, description: "标签" },
          store: {
            type: "string",
            enum: ["core", "episodic", "semantic", "procedural", "vault"],
            description: "记忆分层，默认 semantic",
          },
          source: { type: "string", description: "来源标识，例如 agents-team-book-metadata" },
          importance: { type: "number", description: "重要度 0~1，默认 0.6" },
        },
        required: ["content"],
      },
    },
    async execute(args, ctx, toolCallId) {
      const store = getStore(ctx.meta);
      const content = String(args.content ?? "");
      const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
      const storeKind = parseStoreKind(args.store);
      const source = typeof args.source === "string" ? args.source : undefined;
      const importance = typeof args.importance === "number" ? args.importance : undefined;
      const entry = await store.save(content, tags, {
        ...(storeKind ? { store: storeKind } : {}),
        ...(source ? { source } : {}),
        ...(importance !== undefined ? { importance } : {}),
      });
      syncArtifacts(ctx.meta);
      return { toolCallId, content: JSON.stringify(entry) };
    },
  };

  const searchTool: ToolHandler = {
    definition: {
      name: "memory_search",
      description: "检索长期记忆条目。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索关键词" },
          limit: { type: "number", description: "最大返回数量" },
          store: {
            type: "string",
            enum: ["core", "episodic", "semantic", "procedural", "vault"],
            description: "指定检索某个 store",
          },
          includeArchived: { type: "boolean", description: "是否包含已归档记忆" },
        },
        required: ["query"],
      },
    },
    async execute(args, ctx, toolCallId) {
      const query = String(args.query ?? "");
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      const storeKind = parseStoreKind(args.store);
      const includeArchived = args.includeArchived === true;
      const results = searchLayeredMemory({
        memoryRoot: resolveMemoryRoot(ctx.meta, defaultMemoryRoot),
        query,
        ...(limit !== undefined ? { limit } : {}),
        ...(storeKind ? { store: storeKind } : {}),
        ...(includeArchived ? { includeArchived: true } : {}),
      });
      return { toolCallId, content: JSON.stringify(results) };
    },
  };

  const forgetTool: ToolHandler = {
    definition: {
      name: "memory_forget",
      description: "归档记忆（通过 id 或 query 匹配），不会物理删除。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "精确记忆 ID" },
          query: { type: "string", description: "模糊匹配内容或标签" },
        },
      },
    },
    async execute(args, ctx, toolCallId) {
      const store = getStore(ctx.meta);
      const id = typeof args.id === "string" ? args.id : undefined;
      const query = typeof args.query === "string" ? args.query : undefined;
      const result = await store.forget({
        ...(id ? { id } : {}),
        ...(query ? { query } : {}),
      });
      syncArtifacts(ctx.meta);
      return { toolCallId, content: JSON.stringify(result) };
    },
  };

  const reflectTool: ToolHandler = {
    definition: {
      name: "memory_reflect",
      description:
        "生成待审批反思（含 reward request 与记忆预览），不会直接落盘为正式反思。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "可选过滤关键词" },
          limit: { type: "number", description: "最多纳入多少条记忆（默认 5）" },
          minDecayScore: { type: "number", description: "最小衰减分阈值（默认 0.3）" },
          requestedTokens: { type: "number", description: "可直接指定申请 token 总量" },
          extraTokens: { type: "number", description: "额外申请 token" },
          penaltyTokens: { type: "number", description: "自罚 token" },
          extraReason: { type: "string", description: "额外申请原因" },
          penaltyReason: { type: "string", description: "自罚原因" },
        },
      },
    },
    async execute(args, ctx, toolCallId) {
      const store = getStore(ctx.meta);
      const result = await store.prepareReflection({
        ...(typeof args.query === "string" ? { query: args.query } : {}),
        ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
        ...(typeof args.minDecayScore === "number" ? { minDecayScore: args.minDecayScore } : {}),
        ...(typeof args.requestedTokens === "number" ? { requestedTokens: args.requestedTokens } : {}),
        ...(typeof args.extraTokens === "number" ? { extraTokens: args.extraTokens } : {}),
        ...(typeof args.penaltyTokens === "number" ? { penaltyTokens: args.penaltyTokens } : {}),
        ...(typeof args.extraReason === "string" ? { extraReason: args.extraReason } : {}),
        ...(typeof args.penaltyReason === "string" ? { penaltyReason: args.penaltyReason } : {}),
      });
      return { toolCallId, content: JSON.stringify(result) };
    },
  };

  const reflectCommitTool: ToolHandler = {
    definition: {
      name: "memory_reflect_commit",
      description:
        "审批 memory_reflect 生成的待处理反思。批准后写入 reflections/rewards/log；拒绝则仅记录 reward 决策。",
      parameters: {
        type: "object",
        properties: {
          reflectionId: { type: "string", description: "待审批反思 ID（必须匹配 pending）" },
          decision: {
            type: "string",
            enum: ["approved", "reduced", "rejected"],
            description: "审批结果",
          },
          approvedTokens: { type: "number", description: "最终批准 token 数（可为 0）" },
          reason: { type: "string", description: "审批原因" },
        },
        required: ["reflectionId", "decision", "approvedTokens", "reason"],
      },
    },
    async execute(args, ctx, toolCallId) {
      const store = getStore(ctx.meta);
      const reflectionId = String(args.reflectionId ?? "").trim();
      const decision = parseDecision(args.decision);
      const approvedTokens = Number(args.approvedTokens ?? NaN);
      const reason = String(args.reason ?? "").trim();
      const result = await store.commitReflection({
        reflectionId,
        decision,
        approvedTokens,
        reason,
      });
      syncArtifacts(ctx.meta);
      return { toolCallId, content: JSON.stringify(result) };
    },
  };

  return [saveTool, searchTool, forgetTool, reflectTool, reflectCommitTool];
}

function parseStoreKind(input: unknown): MemoryStoreKind | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim().toLowerCase();
  if (value === "core") return "core";
  if (value === "episodic") return "episodic";
  if (value === "semantic") return "semantic";
  if (value === "procedural") return "procedural";
  if (value === "vault") return "vault";
  return undefined;
}

function parseDecision(input: unknown): "approved" | "reduced" | "rejected" {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (value === "approved") return "approved";
  if (value === "reduced") return "reduced";
  if (value === "rejected") return "rejected";
  throw new Error("decision 仅支持 approved | reduced | rejected。");
}
