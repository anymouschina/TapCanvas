import { randomUUID } from "node:crypto";

import {
  AgentConfig,
  CapabilityGrant,
  CapabilityProviderKind,
  Message,
  ToolDefinition,
} from "../types/index.js";
import { LLMClient } from "../llm/client.js";
import { ToolRegistry } from "./tools/registry.js";
import { SkillLoader } from "./skills/loader.js";
import { getAgentDescriptions } from "./subagent/types.js";
import { normalizeToolOutput } from "./message-limits.js";
import { HookRunner } from "./hooks/runner.js";
import type { LlmTurnTrace, RunHookContext, ToolCallTrace } from "./hooks/types.js";
import { evaluateToolPolicy, recordPolicyDecision } from "./policy-engine.js";
import { BackgroundTaskManager } from "./background/manager.js";
import { executeRemoteTool } from "./tools/remote.js";
import {
  maybeWaitForPendingTeamAgents,
  type PendingTeamAgentsWaitDecision,
} from "./completion/pending-team-agents.js";
import { buildToolCallTrace } from "./tool-call-trace.js";
import {
  buildCapabilityGrant,
  buildRunEnvelope,
  normalizeWorkspaceResourceRoots,
  readCapabilityGrant,
} from "./capability-resolver.js";
import { resolveAgentRunContext } from "./context-pipeline.js";
import { finalizeRunResult, joinSystemSections, reportRunError } from "./finish-policy.js";
import { extractMemoryInsights } from "./memory/extractor.js";
import { AgentSessionEngine } from "./session/session-engine.js";
import { resolveCapabilityPlane } from "./capability-plane.js";
import { executeAgentTurn } from "./turn-engine.js";
import { recordToolBatchSummary } from "./tool-batch-summary.js";
import { normalizeRemoteToolDefinitions } from "./tools/remote.js";
import { buildRuntimeChannelSystemFragment, readRuntimeChannelDescriptor } from "../runtime/channel.js";

const STRICT_TEAM_FAILURE_TOOL_NAMES = new Set<string>([
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
]);

type RunOptions = {
  depth?: number;
  workspaceResourceRoots?: string[];
  systemOverride?: string;
  sessionId?: string;
  ephemeralUserPrompt?: boolean;
  requiredSkills?: string[];
  maxTurns?: number;
  modelOverride?: string;
  compactPrelude?: boolean;
  allowedTools?: Set<string> | null;
  onToolStart?: (payload: {
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
    startedAt: string;
  }) => void;
  onToolCall?: (toolCall: ToolCallTrace) => void;
  onTurn?: (turn: LlmTurnTrace) => void;
  onTextDelta?: (delta: string) => void;
  abortSignal?: AbortSignal;
  history?: Message[];
  toolContextMeta?: Record<string, unknown>;
  state?: import("./tools/registry.js").ToolRuntimeState;
};

type FinishBlockDecision = {
  reason: string;
  message: string;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  const text = typeof reason === "string" ? reason.trim() : "";
  throw new Error(text || "运行已中止。");
}

function readCapabilityProviderBundle(meta?: Record<string, unknown>): CapabilityProviderKind[] | null {
  const value = meta?.capabilityProviderBundle;
  if (!Array.isArray(value)) return null;
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
  return out.length > 0 ? out : null;
}


function buildSystemBootstrap(
  config: AgentConfig,
  skills: SkillLoader,
  options?: { compact?: boolean; requiredSkills?: string[]; capabilityGrant?: CapabilityGrant | null }
) {
  const compact = options?.compact === true;
  const requiredSkills = Array.isArray(options?.requiredSkills)
    ? options.requiredSkills.map((s) => String(s || "").trim()).filter(Boolean)
    : [];
  const rules = [
    "默认身份是通用型智能体助手与编排器，不要因为具备代码工具就自动把任务收窄成 code agent 工作流。",
    "当任务与某个 Skill 的描述匹配时，立即调用 Skill 工具加载该技能。",
    "非平凡的执行型任务必须先建立 TodoWrite checklist；Skill 只提供知识，不替代 planning。",
    "默认单代理完成任务；只有任务复杂且拆分有明确收益时，才使用子代理/多代理工具。",
    "多步任务优先使用 task_create/task_update/task_list/task_get 维护持久化任务图。",
    "TodoWrite 仅用于短期清单提示，不得替代主任务系统。",
    "当现有 Skill 无法满足任务质量要求时，可以新增 Skill；但禁止删除、覆盖或修改任何现有 Skill。",
    "优先使用工具解决问题，不要只解释不行动。",
    "完成后用简洁中文总结产出。",
  ].join("\n- ");
  const capabilityBlock = options?.capabilityGrant
    ? [
        "**Capability Grant**",
        `- tools: ${options.capabilityGrant.tools.join(", ") || "none"}`,
        `- readableRoots: ${options.capabilityGrant.readableRoots.join(", ") || "none"}`,
        `- writableRoots: ${options.capabilityGrant.writableRoots.join(", ") || "none"}`,
        `- network: ${options.capabilityGrant.network}`,
      ].join("\n")
    : "";
  const skillBlock = skills.renderSkillsSection({ requiredSkills });
  const subagentsBlock = compact
    ? ""
    : [
        "**可用团队角色**（通过 orchestrator + spawn_agent + mailbox_* + protocol_* 使用；Task 已不再是主路径）：",
        getAgentDescriptions(),
      ].join("\n");
  return [
    config.agentIntro,
    `你正在 ${config.workspaceRoot} 作为智能体运行。`,
    "循环：plan -> 使用工具 act -> report。",
    "",
    skillBlock,
    ...(capabilityBlock ? ["", capabilityBlock] : []),
    ...(subagentsBlock ? ["", subagentsBlock] : []),
    "",
    "规则：",
    `- ${rules}`,
  ].join("\n");
}

function injectBackgroundNotifications(
  messages: Message[],
  meta: Record<string, unknown> | undefined
): void {
  const manager = meta?.backgroundTaskManager;
  if (!(manager instanceof BackgroundTaskManager)) return;
  const currentAgentId = typeof meta?.currentAgentId === "string" ? meta.currentAgentId.trim() : "";
  const audience = currentAgentId || "root";
  const notifications = manager.drainNotifications(audience);
  if (notifications.length === 0) return;
  const lines = notifications.map(
    (item) => `- ${item.taskId} [${item.status}] ${item.summary}`
  );
  messages.push({
    role: "user",
    content: [
      "<background-notifications>",
      ...lines,
      "</background-notifications>",
      "以上后台任务状态已更新，请基于这些真实结果继续决策。",
    ].join("\n"),
  });
}

export class AgentRunner {
  constructor(
    private config: AgentConfig,
    private registry: ToolRegistry,
    private client: LLMClient,
    private skills: SkillLoader,
    private hooks: HookRunner,
  ) {}

  async run(prompt: string, cwd: string, options: RunOptions = {}) {
    const userPrompt = String(prompt || "").trim();
    const messages: Message[] = options.history ?? [];
    const requiredSkills = Array.isArray(options.requiredSkills)
      ? options.requiredSkills.map((s) => String(s || "").trim()).filter(Boolean)
      : [];
    const localResourcePaths = normalizeWorkspaceResourceRoots(
      options.workspaceResourceRoots ?? options.toolContextMeta?.localResourcePaths,
    );
    const toolCalls: ToolCallTrace[] = [];
    const effectiveModel = String(options.modelOverride || this.config.model || "").trim();
    const capabilityGrant = buildCapabilityGrant({
      allToolNames: this.registry.list().map((tool) => tool.name),
      dynamicToolNames: [
        ...normalizeRemoteToolDefinitions(options.toolContextMeta?.remoteTools).map((tool) => tool.name),
        ...normalizeRemoteToolDefinitions(options.toolContextMeta?.mcpTools).map((tool) => tool.name),
      ],
      allowedTools: options.allowedTools ?? null,
      workspaceRoot: this.config.workspaceRoot,
      localResourcePaths,
      existingGrant: readCapabilityGrant(options.toolContextMeta),
    });
    const runEnvelope = buildRunEnvelope({
      config: this.config,
      prompt: userPrompt,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      capabilityGrant,
      localResourcePaths,
      requiredSkills,
    });
    const { memoryRoot, runtimeMeta, hookContext, contextPromptFragment } =
      await resolveAgentRunContext({
        config: this.config,
        cwd,
        prompt: userPrompt,
        requiredSkills,
        capabilityGrant,
        runEnvelope,
        localResourcePaths,
        toolCalls,
      ...(options.toolContextMeta ? { toolContextMeta: options.toolContextMeta } : {}),
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      currentModel: effectiveModel,
    });
    if (options.toolContextMeta) {
      Object.assign(options.toolContextMeta, runtimeMeta);
    }
    const session = new AgentSessionEngine(messages, runtimeMeta, hookContext, {
      loadedSkills: collectLoadedSkills(messages),
      state: options.state,
      duplicateToolCallLimit: getDuplicateToolCallLimit(),
    });
    await this.hooks.beforeRun(hookContext);
    try {
      const bootstrapSystem = buildSystemBootstrap(this.config, this.skills, {
        compact: options.compactPrelude === true,
        requiredSkills,
        capabilityGrant,
      });
      session.appendUserPrompt(userPrompt, options.ephemeralUserPrompt === true);
      session.recordCurrentMessages();

      let lastText = "";
      const depth = options.depth ?? 0;
      const maxTurns = Number.isFinite(options.maxTurns)
        ? Math.max(1, Math.min(this.config.maxTurns, Math.trunc(options.maxTurns || 1)))
        : this.config.maxTurns;
      const allowedTools = options.allowedTools ?? null;
      const toolContextMeta: Record<string, unknown> = runtimeMeta;
      const baseSystem = joinSystemSections(
        bootstrapSystem,
        options.systemOverride ?? "",
        contextPromptFragment,
        buildRuntimeChannelSystemFragment(readRuntimeChannelDescriptor(toolContextMeta) ?? undefined),
      );
      const state = session.getState();
      const loadedSkills = session.getLoadedSkills();
      if (allowedTools && allowedTools.size === 0) {
        session.getMessages().push({
          role: "user",
          content:
            "本轮工具已禁用。禁止输出任何工具调用或伪调用文本（如 TodoWrite/read_file/bash/write_file/edit_file）。只输出最终结果正文。",
        });
      }

      for (let turn = 0; turn < maxTurns; turn += 1) {
        throwIfAborted(options.abortSignal);
        injectBackgroundNotifications(session.getMessages(), toolContextMeta);
        this.skills.reloadSkills();
        const capabilityPlane = resolveCapabilityPlane({
          registry: this.registry,
          capabilityGrant,
          allowedTools,
          meta: toolContextMeta,
          ...(readCapabilityProviderBundle(toolContextMeta)
            ? { providerKinds: readCapabilityProviderBundle(toolContextMeta) ?? undefined }
            : {}),
        });
        toolContextMeta.capabilitySnapshot = capabilityPlane.snapshot;
        const tools = filterTools(capabilityPlane.tools, allowedTools);
        const skillTool = tools.find((tool) => tool.name === "Skill");
        if (skillTool) {
          skillTool.description = buildSkillToolDescription(this.skills, requiredSkills);
        }
        const system = session.buildSystem(
          baseSystem,
          buildCollaborationSystemFragment(toolContextMeta)
        );
        const response = await executeAgentTurn({
          client: this.client,
          session,
          system,
          tools,
          ...(options.modelOverride ? { modelOverride: options.modelOverride } : {}),
          ...(options.onTextDelta ? { onTextDelta: options.onTextDelta } : {}),
          ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
        });
        throwIfAborted(options.abortSignal);
        const turnText = String(response.text || "");
        session.recordTurn(turnText, response.toolCalls.length);
        const finishBlock =
          response.toolCalls.length === 0
            ? readFinishBlockDecision({
                toolCalls,
                meta: toolContextMeta,
              })
            : null;
        const allowFinish = response.toolCalls.length === 0 && finishBlock === null;
        if (response.toolCalls.length === 0) {
          const pendingTeamWaitDecision = await this.waitForPendingTeamAgentsUntilSettled({
            toolCalls,
            meta: toolContextMeta,
            hookContext,
            abortSignal: options.abortSignal,
            onToolCall: options.onToolCall,
          });
          if (pendingTeamWaitDecision.kind !== "none") {
            session.recordPendingTeamWait(pendingTeamWaitDecision.message);
            session.getMessages().push({
              role: "user",
              content: pendingTeamWaitDecision.message,
            });
            turn -= 1;
            continue;
          }
        }
        const turnTrace: LlmTurnTrace = {
          turn: turn + 1,
          text: turnText,
          textPreview: turnText.trim().length > 1000 ? `${turnText.trim().slice(0, 1000)}…` : turnText.trim(),
          textChars: turnText.length,
          toolCallCount: response.toolCalls.length,
          toolNames: response.toolCalls.map((call) => call.name),
          finished: allowFinish,
        };
        options.onTurn?.(turnTrace);
        if (response.text || response.toolCalls.length > 0) {
          if (response.text) {
            lastText = response.text;
          }
          session.appendAssistantMessage(response.text || "", response.toolCalls);
        }

        if (response.toolCalls.length === 0) {
          if (finishBlock) {
            session.recordCompletionTrace({
              allowFinish: false,
              terminal: "blocked",
              reason: finishBlock.reason,
            });
            session.appendUserPrompt(finishBlock.message, true);
            turn -= 1;
            continue;
          }
          const resultText = lastText || "";
          const extractedInsights = await extractMemoryInsights({
            client: this.client,
            ...(effectiveModel ? { model: effectiveModel } : {}),
            prompt: userPrompt,
            resultText,
            toolSummary: summarizeToolUsageForMemory(toolCalls),
            ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
          });
          session.recordCompletionTrace({ allowFinish: true, terminal: "success" });
          return finalizeRunResult({
            hooks: this.hooks,
            hookContext,
            runtimeMeta,
            memoryRoot,
            prompt: userPrompt,
            resultText,
            messages: session.getMessages(),
            toolCalls,
            ...(options.sessionId ? { sessionId: options.sessionId } : {}),
            requiredSkills,
            ...(effectiveModel ? { model: effectiveModel } : {}),
            ...(extractedInsights.length > 0 ? { extractedInsights } : {}),
          });
        }

        const preparedCalls: PreparedToolCall[] = response.toolCalls.map((call) => {
          const args = safeParseArgs(call.arguments);
          const duplicate = trackDuplicateToolCall(state, call.name, args);
          return {
            call,
            args,
            ...(duplicate.blocked ? { blockedError: duplicate.message } : {}),
          };
        });
        const executionBatches = buildExecutionBatches(preparedCalls);
        let shouldContinueAfterPendingTeamWait = false;
        for (let batchIndex = 0; batchIndex < executionBatches.length; batchIndex += 1) {
          throwIfAborted(options.abortSignal);
          const batch = executionBatches[batchIndex];
          const outcomes = batch.parallel
            ? await this.executeParallelBatch(
                batch.calls,
                cwd,
                depth,
                state,
                toolContextMeta,
                hookContext,
                requiredSkills,
                allowedTools,
                loadedSkills,
                options.onToolStart,
                options.onToolCall
              )
            : [await this.executePreparedCall(batch.calls[0], {
                cwd,
                depth,
                state,
                toolContextMeta,
                hookContext,
                requiredSkills,
                allowedTools,
                loadedSkills,
                onToolStart: options.onToolStart,
                onToolCall: options.onToolCall,
              })];
          for (const outcome of outcomes) {
            session.appendToolMessage(outcome.message);
          }
          recordToolBatchSummary(
            toolContextMeta,
            hookContext.toolCalls.slice(Math.max(0, hookContext.toolCalls.length - outcomes.length)),
          );

          const pendingTeamWaitDecision = await this.waitForPendingTeamAgentsUntilSettled({
            toolCalls,
            meta: toolContextMeta,
            hookContext,
            abortSignal: options.abortSignal,
            onToolCall: options.onToolCall,
          });
          if (pendingTeamWaitDecision.kind === "none") {
            continue;
          }

          const remainingCalls = executionBatches
            .slice(batchIndex + 1)
            .flatMap((remainingBatch) => remainingBatch.calls);
          if (remainingCalls.length > 0) {
            const blockedRemaining = await this.blockPreparedCalls(
              remainingCalls,
              "未执行：已有 team 子代理尚未结束，runtime 必须先等待子代理终态后才能继续。若这些调用仍然需要，请在下一轮重新发起。",
              {
                cwd,
                depth,
                state,
                toolContextMeta,
                hookContext,
                requiredSkills,
                allowedTools,
                loadedSkills,
                onToolStart: options.onToolStart,
                onToolCall: options.onToolCall,
              },
            );
            for (const outcome of blockedRemaining) {
              session.appendToolMessage(outcome.message);
            }
            recordToolBatchSummary(
              toolContextMeta,
              hookContext.toolCalls.slice(Math.max(0, hookContext.toolCalls.length - blockedRemaining.length)),
            );
          }

          session.getMessages().push({
            role: "user",
            content: pendingTeamWaitDecision.message,
          });
          session.recordPendingTeamWait(pendingTeamWaitDecision.message);
          turn -= 1;
          shouldContinueAfterPendingTeamWait = true;
          break;
        }
        if (shouldContinueAfterPendingTeamWait) {
          continue;
        }
      }
      const fallbackText = lastText || "达到最大轮次，未完成。";
      session.recordCompletionTrace({ allowFinish: false, terminal: "blocked", reason: "max_turns" });
      return finalizeRunResult({
        hooks: this.hooks,
        hookContext,
        runtimeMeta,
        memoryRoot,
        prompt: userPrompt,
        resultText: fallbackText,
        messages: session.getMessages(),
        toolCalls,
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        requiredSkills,
        ...(effectiveModel ? { model: effectiveModel } : {}),
      });
    } catch (error) {
      if (options.abortSignal?.aborted) {
        const reason = error instanceof Error ? error.message : String(error);
        session.markAborted(reason);
      }
      await reportRunError({
        hooks: this.hooks,
        hookContext,
        error,
      });
      throw error;
    }
  }

  private async executeParallelBatch(
    batch: PreparedToolCall[],
    cwd: string,
    depth: number,
    state: import("./tools/registry.js").ToolRuntimeState,
    toolContextMeta: Record<string, unknown> | undefined,
    hookContext: RunHookContext,
    requiredSkills: string[],
    allowedTools: Set<string> | null,
    loadedSkills: Set<string>,
    onToolStart: RunOptions["onToolStart"],
    onToolCall: RunOptions["onToolCall"]
  ): Promise<ToolExecutionOutcome[]> {
    const outcomes: ToolExecutionOutcome[] = new Array(batch.length);
    const concurrency = Math.min(getToolBatchConcurrency(batch), batch.length);
    let cursor = 0;
    const next = () => {
      const current = cursor;
      cursor += 1;
      return current;
    };
    const worker = async () => {
      while (true) {
        const current = next();
        if (current >= batch.length) return;
        try {
          outcomes[current] = await this.executePreparedCall(batch[current], {
            cwd,
            depth,
            state,
            toolContextMeta,
            hookContext,
            requiredSkills,
            allowedTools,
            loadedSkills,
            onToolStart,
            onToolCall,
          });
        } catch (error) {
          outcomes[current] = {
            message: {
              role: "tool",
              content: `工具执行失败: ${(error as Error).message}`,
              toolCallId: batch[current].call.id,
            },
          };
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return outcomes;
  }

  private async blockPreparedCalls(
    batch: PreparedToolCall[],
    reason: string,
    params: {
      cwd: string;
      depth: number;
      state: import("./tools/registry.js").ToolRuntimeState;
      toolContextMeta: Record<string, unknown> | undefined;
      hookContext: RunHookContext;
      requiredSkills: string[];
      allowedTools: Set<string> | null;
      loadedSkills: Set<string>;
      onToolStart?: (payload: {
        toolCallId: string;
        name: string;
        args: Record<string, unknown>;
        startedAt: string;
      }) => void;
      onToolCall?: (toolCall: ToolCallTrace) => void;
    }
  ): Promise<ToolExecutionOutcome[]> {
    const outcomes: ToolExecutionOutcome[] = [];
    for (const prepared of batch) {
      const blockedPrepared: PreparedToolCall = {
        ...prepared,
        blockedError: reason,
      };
      outcomes.push(await this.executePreparedCall(blockedPrepared, params));
    }
    return outcomes;
  }

  private async waitForPendingTeamAgentsUntilSettled(input: {
    toolCalls: ToolCallTrace[];
    meta?: Record<string, unknown>;
    hookContext: RunHookContext;
    abortSignal?: AbortSignal;
    onToolCall?: (toolCall: ToolCallTrace) => void;
  }): Promise<{ kind: "none" } | { kind: "retry"; message: string }> {
    if (
      hasFailedPendingTeamRuntimeWait(input.toolCalls) ||
      hasStoppedPendingTeamRuntimeWaitSinceLatestTeamTool(input.toolCalls)
    ) {
      return { kind: "none" };
    }
    const diagnosticAfterCycles = getPendingTeamWaitDiagnosticAfterCycles();
    const maxWaitCycles = getPendingTeamWaitMaxCycles();
    const maxTotalWaitMs = getPendingTeamWaitMaxTotalMs();
    let waitCycle = 1;
    let totalWaitedMs = 0;
    let hasObservedPendingCycle = false;
    while (true) {
      throwIfAborted(input.abortSignal);
      const pendingTeamWaitDecision = await maybeWaitForPendingTeamAgents({
        toolCalls: input.toolCalls,
        meta: input.meta,
        waitCycle,
        diagnosticAfterCycles,
        maxTotalWaitMs,
        timeoutMs: getPendingTeamWaitTimeoutMs(),
        pollMs: getPendingTeamWaitPollMs(),
        forceSummaryOnNoPending: hasObservedPendingCycle,
        abortSignal: input.abortSignal,
      });
      if (pendingTeamWaitDecision.kind === "none") {
        return { kind: "none" };
      }
      hasObservedPendingCycle = true;
      totalWaitedMs += pendingTeamWaitDecision.waitedMs;

      let effectiveDecision = pendingTeamWaitDecision;
      let exhaustedDecision = buildPendingTeamWaitExhaustedDecision({
        decision: effectiveDecision,
        waitCycle,
        diagnosticAfterCycles,
        maxWaitCycles,
        maxTotalWaitMs,
        totalWaitedMs,
      });
      if (exhaustedDecision) {
        const finalRecheckDecision = await maybeWaitForPendingTeamAgents({
          toolCalls: input.toolCalls,
          meta: input.meta,
          waitCycle,
          diagnosticAfterCycles,
          maxTotalWaitMs,
          timeoutMs: 0,
          pollMs: 0,
          forceSummaryOnNoPending: true,
          abortSignal: input.abortSignal,
        });
        exhaustedDecision.trace.output = JSON.stringify({
          ...(tryParsePendingTeamRuntimeWaitPayload(exhaustedDecision.trace.output) ?? {}),
          finalRecheckPerformed: true,
          finalRecheckRecovered:
            finalRecheckDecision.kind === "retry" && finalRecheckDecision.completed,
        });
        if (finalRecheckDecision.kind === "retry" && finalRecheckDecision.completed) {
          effectiveDecision = finalRecheckDecision;
          exhaustedDecision = null;
        }
      }
      const runtimeWaitToolCall = buildRuntimeWaitToolCall(
        exhaustedDecision ?? effectiveDecision,
      );
      input.hookContext.toolCalls.push(runtimeWaitToolCall);
      await this.hooks.onToolCall({
        ...input.hookContext,
        toolCall: runtimeWaitToolCall,
      });
      input.onToolCall?.(runtimeWaitToolCall);

      if (exhaustedDecision) {
        return {
          kind: "retry",
          message: exhaustedDecision.message,
        };
      }

      if (effectiveDecision.completed) {
        return {
          kind: "retry",
          message: appendPendingTeamWaitAggregate(effectiveDecision.message, {
            totalWaitCycles: waitCycle,
            totalWaitedMs,
          }),
        };
      }
      waitCycle += 1;
    }
  }

  private async executePreparedCall(
    prepared: PreparedToolCall,
    params: {
      cwd: string;
      depth: number;
      state: import("./tools/registry.js").ToolRuntimeState;
      toolContextMeta: Record<string, unknown> | undefined;
      hookContext: RunHookContext;
      requiredSkills: string[];
      allowedTools: Set<string> | null;
      loadedSkills: Set<string>;
      onToolStart?: (payload: {
        toolCallId: string;
        name: string;
        args: Record<string, unknown>;
        startedAt: string;
      }) => void;
      onToolCall?: (toolCall: ToolCallTrace) => void;
    }
  ): Promise<ToolExecutionOutcome> {
    if (prepared.blockedError) {
      const blockedStartedAt = new Date().toISOString();
      params.onToolStart?.({
        toolCallId: prepared.call.id,
        name: prepared.call.name,
        args: prepared.args,
        startedAt: blockedStartedAt,
      });
      const blockedToolCall: ToolCallTrace = {
        ...buildToolCallTrace({
          toolCallId: prepared.call.id,
          name: prepared.call.name,
          args: prepared.args,
          output: prepared.blockedError,
          status: "blocked",
          startedAt: blockedStartedAt,
          finishedAt: blockedStartedAt,
          durationMs: 0,
          errorMessage: prepared.blockedError,
        }),
      };
      params.hookContext.toolCalls.push(blockedToolCall);
      await this.hooks.onToolCall({ ...params.hookContext, toolCall: blockedToolCall });
      params.onToolCall?.(blockedToolCall);
      return {
        message: {
          role: "tool",
          content: `工具执行失败: ${prepared.blockedError}`,
          toolCallId: prepared.call.id,
        },
      };
    }
    return this.executeToolCall({
      call: prepared.call,
      args: prepared.args,
      ...params,
    });
  }

  private async executeToolCall(params: {
    call: { id: string; name: string; arguments: string };
    args: Record<string, unknown>;
    cwd: string;
    depth: number;
    state: import("./tools/registry.js").ToolRuntimeState;
    toolContextMeta: Record<string, unknown> | undefined;
    hookContext: RunHookContext;
    requiredSkills: string[];
    allowedTools: Set<string> | null;
    loadedSkills: Set<string>;
    onToolStart?: (payload: {
      toolCallId: string;
      name: string;
      args: Record<string, unknown>;
      startedAt: string;
    }) => void;
    onToolCall?: (toolCall: ToolCallTrace) => void;
  }): Promise<ToolExecutionOutcome> {
    const {
      call,
      args,
      cwd,
      depth,
      state,
      toolContextMeta,
      hookContext,
      requiredSkills,
      allowedTools,
      loadedSkills,
      onToolStart,
      onToolCall,
    } =
      params;
    const startedAt = new Date();
    const startedAtIso = startedAt.toISOString();
    onToolStart?.({
      toolCallId: call.id,
      name: call.name,
      args,
      startedAt: startedAtIso,
    });
    const planningGateError = readPlanningGateError({
      toolName: call.name,
      args,
      meta: toolContextMeta,
      toolCalls: hookContext.toolCalls,
    });
    if (planningGateError) {
      const blockedToolCall: ToolCallTrace = {
        ...buildToolCallTrace({
          toolCallId: call.id,
          name: call.name,
          args,
          output: planningGateError,
          status: "blocked",
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          errorMessage: planningGateError,
        }),
      };
      hookContext.toolCalls.push(blockedToolCall);
      await this.hooks.onToolCall({ ...hookContext, toolCall: blockedToolCall });
      onToolCall?.(blockedToolCall);
      return {
        message: {
          role: "tool",
          content: `工具执行失败: ${planningGateError}`,
          toolCallId: call.id,
        },
      };
    }
    if (allowedTools && !allowedTools.has(call.name)) {
      const blockedToolCall: ToolCallTrace = {
        ...buildToolCallTrace({
          toolCallId: call.id,
          name: call.name,
          args,
          output: `Error: Tool not allowed for this agent: ${call.name}`,
          status: "blocked",
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          errorMessage: `Tool not allowed for this agent: ${call.name}`,
        }),
      };
      hookContext.toolCalls.push(blockedToolCall);
      await this.hooks.onToolCall({ ...hookContext, toolCall: blockedToolCall });
      onToolCall?.(blockedToolCall);
      return {
        message: {
          role: "tool",
          content: `Error: Tool not allowed for this agent: ${call.name}`,
          toolCallId: call.id,
        },
      };
    }
    const policyDecision = evaluateToolPolicy({
      toolName: call.name,
      args,
      cwd,
      ...(toolContextMeta ? { meta: toolContextMeta } : {}),
    });
    recordPolicyDecision(toolContextMeta, policyDecision);
    if (policyDecision.verdict !== "allow") {
      const status = policyDecision.verdict === "deny" ? "denied" : "blocked";
      const deniedToolCall: ToolCallTrace = {
        ...buildToolCallTrace({
          toolCallId: call.id,
          name: call.name,
          args,
          output: policyDecision.reason,
          status,
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          errorMessage: policyDecision.reason,
          structuredOutput: {
            policyDecision,
          },
        }),
      };
      hookContext.toolCalls.push(deniedToolCall);
      await this.hooks.onToolCall({ ...hookContext, toolCall: deniedToolCall });
      onToolCall?.(deniedToolCall);
      return {
        message: {
          role: "tool",
          content:
            policyDecision.verdict === "requires_approval"
              ? `工具执行需审批: ${policyDecision.reason}`
              : `工具执行失败: ${policyDecision.reason}`,
          toolCallId: call.id,
        },
      };
    }
    try {
      const result =
        (await executeRemoteTool({
          name: call.name,
          args,
          toolCallId: call.id,
          ...(toolContextMeta ? { meta: toolContextMeta } : {}),
        })) ??
        (await this.registry.execute(
          call.name,
          args,
          { cwd, depth, state, ...(toolContextMeta ? { meta: toolContextMeta } : {}) },
          call.id
        ));
      if (call.name === "Skill") {
        const requested = getRequestedSkill(args);
        if (requested) loadedSkills.add(requested);
        for (const loaded of collectLoadedSkills([{ role: "tool", content: result.content }])) {
          loadedSkills.add(loaded);
        }
      }
      if (shouldTreatToolResultAsFailure(call.name, result.content)) {
        const errorMessage = readExplicitToolErrorMessage(result.content);
        const failedToolCall: ToolCallTrace = {
          ...buildToolCallTrace({
            toolCallId: call.id,
            name: call.name,
            args,
            output: result.content,
            status: "failed",
            startedAt: startedAtIso,
            finishedAt: new Date().toISOString(),
            durationMs: Math.max(0, Date.now() - startedAt.getTime()),
            ...(errorMessage ? { errorMessage } : {}),
            structuredOutput: result.payload?.structuredOutput,
          }),
        };
        hookContext.toolCalls.push(failedToolCall);
        await this.hooks.onToolCall({ ...hookContext, toolCall: failedToolCall });
        onToolCall?.(failedToolCall);
        return {
          message: {
            role: "tool",
            content: normalizeToolOutput(result.content, `tool:${call.name}`),
            toolCallId: call.id,
          },
        };
      }
      const toolCall: ToolCallTrace = {
        ...buildToolCallTrace({
          toolCallId: call.id,
          name: call.name,
          args,
          output: result.content,
          status: "succeeded",
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          structuredOutput: result.payload?.structuredOutput,
        }),
      };
      hookContext.toolCalls.push(toolCall);
      await this.hooks.onToolCall({ ...hookContext, toolCall });
      onToolCall?.(toolCall);
      return {
        message: {
          role: "tool",
          content: normalizeToolOutput(result.content, `tool:${call.name}`),
          toolCallId: call.id,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedToolCall: ToolCallTrace = {
        ...buildToolCallTrace({
          toolCallId: call.id,
          name: call.name,
          args,
          output: `工具执行失败: ${errorMessage}`,
          status: "failed",
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
          errorMessage,
        }),
      };
      hookContext.toolCalls.push(failedToolCall);
      await this.hooks.onToolCall({ ...hookContext, toolCall: failedToolCall });
      onToolCall?.(failedToolCall);
      return {
        message: {
          role: "tool",
          content: `工具执行失败: ${errorMessage}`,
          toolCallId: call.id,
        },
      };
    }
  }
}

function readExplicitToolErrorMessage(content: string): string {
  const trimmed = String(content || "").trim();
  return trimmed.startsWith("Error:") ? trimmed.slice("Error:".length).trim() : "";
}

type PlanningDirective = {
  planningRequired: boolean;
  minimumStepCount: number;
  checklistFirst: boolean;
};

type TodoChecklistTrace = {
  totalCount: number;
  completedCount: number;
  inProgressCount: number;
};

function shouldTreatToolResultAsFailure(name: string, content: string): boolean {
  const normalizedName = String(name || "").trim();
  if (!normalizedName || !STRICT_TEAM_FAILURE_TOOL_NAMES.has(normalizedName)) return false;
  return Boolean(readExplicitToolErrorMessage(content));
}

function buildCollaborationSystemFragment(meta: Record<string, unknown> | undefined): string {
  const lines: string[] = [];
  if (Array.isArray(meta?.localResourcePaths) && meta.localResourcePaths.length > 0) {
    lines.push("## Scoped Local Evidence");
    for (const item of meta.localResourcePaths) {
      const pathValue = String(item || "").trim();
      if (!pathValue) continue;
      lines.push(`- allowedLocalPath: ${pathValue}`);
    }
    lines.push(
      "Only gather local evidence from the allowedLocalPath entries above.",
      "Do not say the allowed local paths were missing; they are listed above.",
      "If those paths do not contain enough evidence, stop and report the gap instead of searching .agents, apps, packages, or other workspace directories."
    );
  }
  const toolBatchSummaries = Array.isArray(meta?.toolBatchSummaries)
    ? meta.toolBatchSummaries
        .filter((item) => item && typeof item === "object" && !Array.isArray(item))
        .slice(-3)
        .map((item) => {
          const record = item as Record<string, unknown>;
          return String(record.label || "").trim();
        })
        .filter(Boolean)
    : [];
  if (toolBatchSummaries.length > 0) {
    lines.push("## Recent Tool Batch Summaries");
    for (const item of toolBatchSummaries) {
      lines.push(`- ${item}`);
    }
  }
  const manager = meta?.collabManager;
  if (!manager || typeof manager !== "object") return lines.join("\n").trim();
  const describeForPrompt = (manager as { describeForPrompt?: unknown }).describeForPrompt;
  if (typeof describeForPrompt !== "function") return lines.join("\n").trim();
  const currentAgentId = typeof meta?.currentAgentId === "string" ? meta.currentAgentId : undefined;
  const fragment = describeForPrompt.call(manager, currentAgentId);
  const collab = typeof fragment === "string" ? fragment.trim() : "";
  return [lines.join("\n").trim(), collab].filter(Boolean).join("\n\n").trim();
}

type PreparedToolCall = {
  call: { id: string; name: string; arguments: string };
  args: Record<string, unknown>;
  blockedError?: string;
};

type ToolExecutionOutcome = {
  message: { role: "tool"; content: string; toolCallId: string };
};

function getDuplicateToolCallLimit(): number {
  const raw = Number(process.env.AGENTS_DUPLICATE_TOOL_CALL_LIMIT ?? 3);
  if (!Number.isFinite(raw)) return 3;
  return Math.max(1, Math.trunc(raw));
}

function getSkillToolConcurrency(): number {
  const raw = Number(process.env.AGENTS_SKILL_CONCURRENCY ?? 4);
  if (!Number.isFinite(raw)) return 4;
  return Math.max(1, Math.trunc(raw));
}

function getToolConcurrency(): number {
  const raw = Number(process.env.AGENTS_TOOL_CONCURRENCY ?? 6);
  if (!Number.isFinite(raw)) return 6;
  return Math.max(1, Math.trunc(raw));
}

function getToolBatchConcurrency(batch: PreparedToolCall[]): number {
  const toolLimit = getToolConcurrency();
  const onlySkill = batch.every((item) => item.call.name === "Skill");
  if (!onlySkill) return toolLimit;
  return Math.min(toolLimit, getSkillToolConcurrency());
}

function readEnvMs(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.trunc(raw));
}

function getPendingTeamWaitPollMs(): number {
  return readEnvMs("AGENTS_PENDING_TEAM_WAIT_POLL_MS", 500);
}

function getPendingTeamWaitTimeoutMs(): number {
  return readEnvMs("AGENTS_PENDING_TEAM_WAIT_TIMEOUT_MS", 30000);
}

function getPendingTeamWaitDiagnosticAfterCycles(): number {
  const raw = Number(process.env.AGENTS_PENDING_TEAM_WAIT_DIAGNOSTIC_AFTER_CYCLES ?? 4);
  if (!Number.isFinite(raw)) return 4;
  return Math.max(1, Math.trunc(raw));
}

function getPendingTeamWaitMaxCycles(): number {
  const raw = Number(process.env.AGENTS_PENDING_TEAM_WAIT_MAX_CYCLES ?? 12);
  if (!Number.isFinite(raw)) return 12;
  return Math.max(1, Math.trunc(raw));
}

function getPendingTeamWaitMaxTotalMs(): number {
  return readEnvMs("AGENTS_PENDING_TEAM_WAIT_MAX_TOTAL_MS", 90000);
}

function buildRuntimeWaitToolCall(
  decision: Exclude<PendingTeamAgentsWaitDecision, { kind: "none" }>,
): ToolCallTrace {
  const startedAt = new Date().toISOString();
  return buildToolCallTrace({
    toolCallId: randomUUID(),
    name: "agents_team_runtime_wait",
    args: decision.trace.args,
    output: decision.trace.output,
    status: decision.trace.status,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    ...(decision.trace.errorMessage
      ? { errorMessage: decision.trace.errorMessage }
      : {}),
  });
}

function trackDuplicateToolCall(
  state: import("./tools/registry.js").ToolRuntimeState,
  toolName: string,
  args: Record<string, unknown>
): { blocked: boolean; message: string } {
  if (toolName !== "bash" && toolName !== "read_file" && toolName !== "read_file_range") {
    return { blocked: false, message: "" };
  }
  const signature = `${toolName}:${stableStringify(args)}`;
  const current = (state.guard.duplicateToolCallCount.get(signature) ?? 0) + 1;
  state.guard.duplicateToolCallCount.set(signature, current);
  if (current > 1) {
    console.warn(
      `[agents] duplicate tool call detected tool=${toolName} count=${current} limit=${state.guard.duplicateToolCallLimit} signature=${signature}`
    );
  }
  if (current <= state.guard.duplicateToolCallLimit) {
    return { blocked: false, message: "" };
  }
  return {
    blocked: true,
    message: `重复工具调用超过阈值(${state.guard.duplicateToolCallLimit})：${toolName} args=${stableStringify(
      args
    )}`,
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

function collectLoadedSkills(messages: Message[]): Set<string> {
  const out = new Set<string>();
  for (const msg of messages) {
    const content = String(msg?.content || "");
    if (!content) continue;
    const re = /<skill-loaded\s+name="([^"]+)">/gi;
    let m: RegExpExecArray | null = null;
    while ((m = re.exec(content))) {
      const name = String(m[1] || "").trim();
      if (name) out.add(name);
    }
  }
  return out;
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getRequestedSkill(args: Record<string, unknown>): string {
  const skill = args.skill;
  return typeof skill === "string" ? skill.trim() : "";
}

function readPlanningDirective(meta: Record<string, unknown> | undefined): PlanningDirective {
  const diagnosticContext =
    meta?.diagnosticContext && typeof meta.diagnosticContext === "object" && !Array.isArray(meta.diagnosticContext)
      ? (meta.diagnosticContext as Record<string, unknown>)
      : null;
  const planningRequired = diagnosticContext?.planningRequired === true;
  const rawMinimum = diagnosticContext?.planningMinimumSteps;
  const minimum = typeof rawMinimum === "number" ? rawMinimum : Number(rawMinimum);
  return {
    planningRequired,
    minimumStepCount: Number.isFinite(minimum) ? Math.max(2, Math.min(8, Math.trunc(minimum))) : 2,
    checklistFirst: diagnosticContext?.planningChecklistFirst === true,
  };
}

function parseTodoChecklistTrace(toolCall: ToolCallTrace): TodoChecklistTrace | null {
  if (toolCall.status !== "succeeded") return null;
  if (String(toolCall.name || "").trim() !== "TodoWrite") return null;
  let totalCount = 0;
  let completedCount = 0;
  let inProgressCount = 0;
  for (const line of String(toolCall.output || "").split(/\r?\n/)) {
    const match = line.match(/^\[(x|>| )\]\s+(.+)$/i);
    if (!match) continue;
    const mark = String(match[1] || "").toLowerCase();
    const text = String(match[2] || "").trim();
    if (!text) continue;
    totalCount += 1;
    if (mark === "x") completedCount += 1;
    if (mark === ">") inProgressCount += 1;
    if (totalCount >= 20) break;
  }
  if (totalCount <= 0) return null;
  return {
    totalCount,
    completedCount,
    inProgressCount,
  };
}

function findLatestTodoChecklist(toolCalls: ToolCallTrace[]): TodoChecklistTrace | null {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const parsed = parseTodoChecklistTrace(toolCalls[index]);
    if (parsed) return parsed;
  }
  return null;
}

function isTapCanvasReadOnlyToolName(toolName: string): boolean {
  return /^tapcanvas_.+_(get|list)$/i.test(toolName.trim());
}

function isReadOnlyToolCall(toolName: string, args: Record<string, unknown>): boolean {
  if (
    toolName === "Skill" ||
    toolName === "TodoWrite" ||
    toolName === "read_file" ||
    toolName === "read_file_range" ||
    toolName === "memory_search" ||
    toolName === "list_agents"
  ) {
    return true;
  }
  if (
    toolName === "task_create" ||
    toolName === "task_update" ||
    toolName === "task_get" ||
    toolName === "task_list" ||
    toolName === "task_claim"
  ) {
    return true;
  }
  if (toolName === "bash") {
    const command = typeof args.command === "string" ? args.command.trim() : "";
    return isReadOnlyShellCommand(command);
  }
  if (isTapCanvasReadOnlyToolName(toolName)) {
    return true;
  }
  return false;
}

function readPlanningGateError(input: {
  toolName: string;
  args: Record<string, unknown>;
  meta: Record<string, unknown> | undefined;
  toolCalls: ToolCallTrace[];
}): string | null {
  const directive = readPlanningDirective(input.meta);
  if (!directive.planningRequired) return null;
  const latestChecklist = findLatestTodoChecklist(input.toolCalls);
  if (!latestChecklist && directive.checklistFirst && isTapCanvasReadOnlyToolName(input.toolName)) {
    return [
      "Execution planning required before chapter-scoped evidence reads.",
      "Error: 当前回合要求 checklist-first，读取 book/flow/chapter 证据前必须先创建 TodoWrite checklist。",
      "请先调用 TodoWrite 创建 checklist，再继续读取项目与章节上下文。",
    ].join(" ");
  }
  if (isReadOnlyToolCall(input.toolName, input.args)) return null;
  if (!latestChecklist) {
    return [
      "Execution planning required before side-effectful tool execution.",
      "Error: 当前回合被标记为执行型任务，但在执行写操作前没有找到任何 TodoWrite checklist。",
      "请先调用 TodoWrite 创建 checklist，再继续执行。",
    ].join(" ");
  }
  if (latestChecklist.totalCount < directive.minimumStepCount) {
    return [
      "Execution planning required before side-effectful tool execution.",
      `Error: 当前 TodoWrite checklist 只有 ${latestChecklist.totalCount} 步，少于要求的 ${directive.minimumStepCount} 步。`,
      "请先补足 checklist，再继续执行。",
    ].join(" ");
  }
  return null;
}

function readFinishBlockDecision(input: {
  toolCalls: ToolCallTrace[];
  meta: Record<string, unknown> | undefined;
}): FinishBlockDecision | null {
  const latestChecklist = findLatestTodoChecklist(input.toolCalls);
  if (!latestChecklist) return null;
  const directive = readPlanningDirective(input.meta);
  const minimumStepCount = Math.max(2, directive.minimumStepCount);
  if (latestChecklist.totalCount < minimumStepCount) {
    return {
      reason: "planning_checklist_too_short",
      message: [
        "<runtime_completion_self_check>",
        "本轮尚不能结束：TodoWrite checklist 步骤数不足。",
        `currentChecklist: total=${latestChecklist.totalCount}, completed=${latestChecklist.completedCount}, in_progress=${latestChecklist.inProgressCount}`,
        `requiredMinimumSteps: ${minimumStepCount}`,
        "requiredActions:",
        "- 先补足 TodoWrite checklist 的关键步骤，再继续执行。",
        "</runtime_completion_self_check>",
      ].join("\n"),
    };
  }
  if (latestChecklist.completedCount < latestChecklist.totalCount) {
    const recentFailures = summarizeRecentFailingToolCalls(input.toolCalls);
    return {
      reason: "planning_checklist_incomplete",
      message: [
        "<runtime_completion_self_check>",
        "本轮尚不能结束：TodoWrite checklist 还没有全部完成。",
        `currentChecklist: total=${latestChecklist.totalCount}, completed=${latestChecklist.completedCount}, in_progress=${latestChecklist.inProgressCount}`,
        ...(recentFailures.length > 0
          ? [
              "recentFailures:",
              ...recentFailures.map((item) => `- ${item}`),
            ]
          : []),
        "requiredActions:",
        "- 继续推进 checklist，直到所有关键步骤完成。",
        ...(recentFailures.length > 0
          ? ["- 修复最近失败/阻断的工具调用，或基于失败事实显式报告 blocked。"]
          : []),
        "</runtime_completion_self_check>",
      ].join("\n"),
      };
  }
  const unresolvedFailures = summarizeUnresolvedFailingToolCalls(input.toolCalls);
  if (unresolvedFailures.length > 0) {
    return {
      reason: "unresolved_tool_failures",
      message: [
        "<runtime_completion_self_check>",
        "本轮尚不能结束：仍有未解决的失败/阻断工具调用，不能只靠 TodoWrite 勾选完成态。",
        "unresolvedFailures:",
        ...unresolvedFailures.map((item) => `- ${item}`),
        "requiredActions:",
        "- 先修复这些失败调用，或基于这些失败事实明确输出 blocked/needs-input。",
        "- 在关键证据真实补齐前，不要宣称已完成分析或已完成复刻方案。",
        "</runtime_completion_self_check>",
      ].join("\n"),
    };
  }
  return null;
}

function buildExecutionBatches(calls: PreparedToolCall[]): ExecutionBatch[] {
  const batches: ExecutionBatch[] = [];
  let currentParallel: PreparedToolCall[] = [];
  const flushParallel = () => {
    if (currentParallel.length === 0) return;
    batches.push({ parallel: true, calls: currentParallel });
    currentParallel = [];
  };
  for (const item of calls) {
    if (shouldParallelizeTool(item)) {
      currentParallel.push(item);
      continue;
    }
    flushParallel();
    batches.push({ parallel: false, calls: [item] });
  }
  flushParallel();
  return batches;
}

function summarizeRecentFailingToolCalls(toolCalls: ToolCallTrace[]): string[] {
  return toolCalls
    .filter((toolCall) =>
      toolCall.status === "failed" ||
      toolCall.status === "blocked" ||
      toolCall.status === "denied"
    )
    .slice(-3)
    .map((toolCall) => {
      const detail = String(
        toolCall.errorMessage ||
        toolCall.outputHead ||
        toolCall.outputTail ||
        toolCall.output ||
        "",
      )
        .replace(/\s+/g, " ")
        .trim();
      return detail
        ? `${toolCall.name} [${toolCall.status}] ${detail}`
        : `${toolCall.name} [${toolCall.status}]`;
    });
}

function summarizeUnresolvedFailingToolCalls(toolCalls: ToolCallTrace[]): string[] {
  const unresolved: ToolCallTrace[] = [];
  for (const toolCall of toolCalls) {
    if (
      toolCall.status === "failed" ||
      toolCall.status === "blocked" ||
      toolCall.status === "denied"
    ) {
      unresolved.push(toolCall);
      continue;
    }
    if (toolCall.status === "succeeded" && clearsPriorFailure(toolCall)) {
      unresolved.length = 0;
    }
  }
  return unresolved.slice(-3).map((toolCall) => {
    const detail = String(
      toolCall.errorMessage ||
      toolCall.outputHead ||
      toolCall.outputTail ||
      toolCall.output ||
      "",
    )
      .replace(/\s+/g, " ")
      .trim();
    return detail
      ? `${toolCall.name} [${toolCall.status}] ${detail}`
      : `${toolCall.name} [${toolCall.status}]`;
  });
}

function clearsPriorFailure(toolCall: ToolCallTrace): boolean {
  const name = String(toolCall.name || "").trim();
  if (!name) return false;
  if (name === "TodoWrite" || name === "Skill") return false;
  return true;
}

function shouldParallelizeTool(item: PreparedToolCall): boolean {
  const name = item.call.name;
  if (name === "Skill") return true;
  if (name === "read_file" || name === "read_file_range" || name === "memory_search") return true;
  if (name === "bash") {
    const command = typeof item.args.command === "string" ? item.args.command.trim() : "";
    return isReadOnlyShellCommand(command);
  }
  return false;
}

function isReadOnlyShellCommand(command: string): boolean {
  if (!command) return false;
  if (/[|;&><`$()]/.test(command)) return false;
  const parts = command.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  const [head, sub] = parts;
  const allowedTop = new Set([
    "ls",
    "pwd",
    "cat",
    "sed",
    "head",
    "tail",
    "wc",
    "find",
    "rg",
    "git",
    "pnpm",
    "npm",
    "node",
    "echo",
    "which",
    "stat",
  ]);
  if (!allowedTop.has(head)) return false;
  if (head === "git") {
    return sub === "status" || sub === "show" || sub === "log" || sub === "diff" || sub === "ls-files";
  }
  if (head === "pnpm" || head === "npm") {
    return sub === "list";
  }
  if (head === "node") {
    return false;
  }
  return true;
}

function filterTools(tools: ToolDefinition[], allowed: Set<string> | null) {
  if (!allowed) return tools;
  return tools.filter((tool) => allowed.has(tool.name));
}

function appendPendingTeamWaitAggregate(
  message: string,
  input: { totalWaitCycles: number; totalWaitedMs: number },
): string {
  const trimmed = String(message || "").trim();
  const aggregate = [
    `<agents-team-runtime-wait-aggregate totalWaitCycles="${input.totalWaitCycles}" totalWaitedMs="${input.totalWaitedMs}" />`,
  ].join("\n");
  return trimmed ? `${trimmed}\n${aggregate}` : aggregate;
}

function summarizeToolUsageForMemory(toolCalls: ToolCallTrace[]): string[] {
  return toolCalls
    .filter((toolCall) => toolCall.status === "succeeded")
    .slice(-8)
    .map((toolCall) => `${toolCall.name}:${toolCall.outputHead || toolCall.outputTail || "ok"}`)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasFailedPendingTeamRuntimeWait(toolCalls: ToolCallTrace[]): boolean {
  return toolCalls.some(
    (toolCall) =>
      String(toolCall.name || "").trim().toLowerCase() === "agents_team_runtime_wait" &&
      toolCall.status === "failed",
  );
}

function isSuccessfulTeamCoordinationToolCall(toolCall: ToolCallTrace): boolean {
  if (toolCall.status !== "succeeded") return false;
  const normalizedName = String(toolCall.name || "").trim().toLowerCase();
  return Boolean(
    normalizedName &&
    normalizedName !== "agents_team_runtime_wait" &&
    STRICT_TEAM_FAILURE_TOOL_NAMES.has(normalizedName),
  );
}

function isStoppedPendingTeamRuntimeWaitToolCall(toolCall: ToolCallTrace): boolean {
  const normalizedName = String(toolCall.name || "").trim().toLowerCase();
  if (normalizedName !== "agents_team_runtime_wait") return false;
  const parsed = tryParsePendingTeamRuntimeWaitPayload(toolCall.output);
  return parsed?.stopped === true;
}

function hasStoppedPendingTeamRuntimeWaitSinceLatestTeamTool(toolCalls: ToolCallTrace[]): boolean {
  let latestTeamToolIndex = -1;
  let latestStopIndex = -1;
  for (let index = 0; index < toolCalls.length; index += 1) {
    const toolCall = toolCalls[index];
    if (isSuccessfulTeamCoordinationToolCall(toolCall)) {
      latestTeamToolIndex = index;
    }
    if (isStoppedPendingTeamRuntimeWaitToolCall(toolCall)) {
      latestStopIndex = index;
    }
  }
  return latestStopIndex > latestTeamToolIndex;
}

function buildPendingTeamWaitExhaustedDecision(input: {
  decision: Exclude<PendingTeamAgentsWaitDecision, { kind: "none" }>;
  waitCycle: number;
  diagnosticAfterCycles: number;
  maxWaitCycles: number;
  maxTotalWaitMs: number;
  totalWaitedMs: number;
}): Exclude<PendingTeamAgentsWaitDecision, { kind: "none" }> | null {
  if (input.decision.completed) return null;
  const parsed = tryParsePendingTeamRuntimeWaitPayload(input.decision.trace.output);
  const overBudgetSubmissions = Array.isArray(parsed?.overBudgetSubmissions)
    ? parsed.overBudgetSubmissions
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
    : [];
  const reachedMaxCycles = input.waitCycle >= input.maxWaitCycles;
  const reachedMaxTotalWait = input.totalWaitedMs >= input.maxTotalWaitMs;
  const stuckOverBudget =
    input.waitCycle >= input.diagnosticAfterCycles && overBudgetSubmissions.length > 0;
  if (!reachedMaxCycles && !reachedMaxTotalWait && !stuckOverBudget) {
    return null;
  }

  const reason = reachedMaxTotalWait
    ? `runtime 自动等待总时长已达到上限 ${input.maxTotalWaitMs}ms`
    : reachedMaxCycles
      ? `等待 team 子代理已达到最大轮次 ${input.maxWaitCycles}`
      : "检测到 team 子代理已超预算且持续未终态";
  const message = appendPendingTeamWaitAggregate(
    [
      input.decision.message,
      "",
      "【runtime 停止自动等待】",
      `- ${reason}`,
      reachedMaxTotalWait
        ? "- 这条上限独立于 child 自身 soft budget；runtime 不会继续陪同等待到子代理自己的运行 budget 结束。"
        : "- 当前停止条件不是普通短时未完成，而是已命中 runtime 的明确收口阈值。",
      "- runtime 已停止继续自动等待这些子代理，避免无限轮询。",
      "- 必须把这些未终态子代理视为阻塞/失败事实来处理：要么显式报告失败，要么只基于已确认事实继续，不得再把本轮写成“等待中”。",
      "- 若需要继续协作，必须先解释阻塞点；禁止再次调用无限等待同一批 pending 子代理。",
    ].join("\n"),
    {
      totalWaitCycles: input.waitCycle,
      totalWaitedMs: input.totalWaitedMs,
    },
  );
  const payload = {
    ...(tryParsePendingTeamRuntimeWaitPayload(input.decision.trace.output) ?? {}),
    completed: false,
    timedOut: input.decision.timedOut,
    finalRecheckPerformed: false,
    finalRecheckRecovered: false,
    stopped: true,
    stopReason: reason,
    maxTotalWaitMs: input.maxTotalWaitMs,
    totalWaitCycles: input.waitCycle,
    totalWaitedMs: input.totalWaitedMs,
  };
  return {
    kind: "retry",
    completed: false,
    timedOut: input.decision.timedOut,
    waitedMs: input.decision.waitedMs,
    message,
    trace: {
      ...input.decision.trace,
      output: JSON.stringify(payload),
      status: "succeeded",
    },
  };
}

function tryParsePendingTeamRuntimeWaitPayload(text: string): Record<string, unknown> | null {
  const trimmed = String(text || "").trim();
  if (!trimmed || !trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

type ExecutionBatch = {
  parallel: boolean;
  calls: PreparedToolCall[];
};

function buildSkillToolDescription(skills: SkillLoader, requiredSkills: string[] = []) {
  return [
    "加载技能以获得领域知识。在任务与某个 skill 的描述匹配时，必须先加载对应 `SKILL.md` 再继续执行。",
    "",
    skills.renderSkillsSection({ requiredSkills }),
    "",
    "加载后只遵循与当前任务相关的部分，不要把无关 skill 正文带入当前回合。",
  ].join("\n");
}
