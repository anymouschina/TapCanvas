import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentsChatRequest, JsonObject } from "./contracts.js";
import { BridgeRequestError, isJsonObject } from "./contracts.js";
import type { HarnessBridgeResult } from "./harness-runtime.js";

type LogicalTaskStatus = "active" | "succeeded" | "failed" | "cancelled";
type PhysicalRunStatus = "running" | "completed" | "interrupted";
type DeliveryStatus = "pending" | "satisfied" | "unsatisfied";

type ChatTurnSnapshot = JsonObject & {
  sessionId: string;
  durable: true;
  activeTurn: boolean;
  turn: JsonObject | null;
};

type ActiveTurn = Readonly<{
  controller: AbortController;
  snapshot: ChatTurnSnapshot;
}>;

export type ChatTurnLease = Readonly<{
  signal: AbortSignal;
  sessionId: string;
  turnId: string;
}>;

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredIdentity(request: AgentsChatRequest): { sessionId: string; turnId: string } {
  const sessionId = nonEmptyString(request.sessionId);
  const turnId = nonEmptyString(request.turnContext.logicalTaskId)
    ?? nonEmptyString(request.turnContext.publicTurnId);
  if (!sessionId) {
    throw new BridgeRequestError(
      "DeepSeek Harness chat lifecycle requires sessionId",
      "deepseek_harness_session_id_required",
    );
  }
  if (!turnId) {
    throw new BridgeRequestError(
      "DeepSeek Harness chat lifecycle requires logicalTaskId/publicTurnId",
      "deepseek_harness_logical_task_id_required",
    );
  }
  return { sessionId, turnId };
}

function logicalTaskState(input: {
  turnId: string;
  status: LogicalTaskStatus;
  reasonCode: string;
  physicalRunStatus: PhysicalRunStatus;
  deliveryStatus: DeliveryStatus;
  updatedAt: string;
  taskRevision?: number;
}): JsonObject {
  return {
    version: 1,
    logicalTaskId: input.turnId,
    status: input.status,
    reasonCode: input.reasonCode,
    physicalRunStatus: input.physicalRunStatus,
    deliveryStatus: input.deliveryStatus,
    taskNodeId: "root",
    taskRevision: input.taskRevision ?? 0,
    updatedAt: input.updatedAt,
    continuationTicket: null,
  };
}

function requestDisplayText(request: AgentsChatRequest): string {
  return nonEmptyString(request.raw.turnDisplayText) ?? request.prompt;
}

function userIntentContract(request: AgentsChatRequest): JsonObject | null {
  return isJsonObject(request.turnContext.userIntentContract)
    ? request.turnContext.userIntentContract
    : null;
}

function runningSnapshot(request: AgentsChatRequest, internalTurnId: string): ChatTurnSnapshot {
  const { sessionId, turnId } = requiredIdentity(request);
  const now = new Date().toISOString();
  return {
    sessionId,
    durable: true,
    activeTurn: true,
    turn: {
      turnId,
      internalTurnId,
      state: "running",
      logicalTaskState: logicalTaskState({
        turnId,
        status: "active",
        reasonCode: "initial_execution",
        physicalRunStatus: "running",
        deliveryStatus: "pending",
        updatedAt: now,
      }),
      phase: "agent_running",
      startedAt: now,
      updatedAt: now,
      lastConfirmedAt: now,
      requestText: requestDisplayText(request),
      terminalAuthority: request.turnContext.executeForcedAgentDirectly === true
        ? "workflow_action"
        : "user_delivery",
      reasonCode: "initial_execution",
      userIntentContract: userIntentContract(request),
      suspension: null,
      recoveryCheckpoint: null,
      lastConfirmedSummary: "DeepSeek Harness 正在执行当前回合",
      finalResponse: null,
      terminalDelivery: null,
      pendingUserInput: null,
      pendingQueueCount: 0,
      recentEvents: [{
        type: "turn.started",
        at: now,
        toolName: null,
        toolStatus: null,
      }],
    },
  };
}

function responseTrace(result: HarnessBridgeResult): {
  runtime: JsonObject;
  runOutcome: JsonObject;
} {
  const trace = isJsonObject(result.response.trace) ? result.response.trace : {};
  return {
    runtime: isJsonObject(trace.runtime) ? trace.runtime : {},
    runOutcome: isJsonObject(trace.runOutcome) ? trace.runOutcome : {},
  };
}

function terminalSnapshot(
  prior: ChatTurnSnapshot,
  result: HarnessBridgeResult,
): ChatTurnSnapshot {
  const priorTurn = isJsonObject(prior.turn) ? prior.turn : null;
  if (!priorTurn) throw new Error("DeepSeek Harness lifecycle lost its active turn");
  const now = new Date().toISOString();
  const { runtime, runOutcome } = responseTrace(result);
  const succeeded = runOutcome.status === "succeeded";
  const reasonCode = nonEmptyString(runOutcome.reason)
    ?? (succeeded ? "delivery_verified" : "deepseek_harness_turn_failed");
  const terminalDelivery = isJsonObject(runtime.terminalDelivery)
    ? runtime.terminalDelivery
    : null;
  const turnId = nonEmptyString(priorTurn.turnId);
  if (!turnId) throw new Error("DeepSeek Harness lifecycle turnId is missing");
  return {
    sessionId: prior.sessionId,
    durable: true,
    activeTurn: false,
    turn: {
      ...priorTurn,
      state: succeeded ? "succeeded" : "failed",
      logicalTaskState: logicalTaskState({
        turnId,
        status: succeeded ? "succeeded" : "failed",
        reasonCode,
        physicalRunStatus: "completed",
        deliveryStatus: succeeded ? "satisfied" : "unsatisfied",
        updatedAt: now,
      }),
      phase: succeeded ? "succeeded" : "failed",
      updatedAt: now,
      lastConfirmedAt: now,
      reasonCode: succeeded ? null : reasonCode,
      terminalAuthority: runtime.terminalAuthority === "workflow_action"
        ? "workflow_action"
        : "user_delivery",
      userIntentContract: isJsonObject(runtime.userIntentContract)
        ? runtime.userIntentContract
        : priorTurn.userIntentContract ?? null,
      lastConfirmedSummary: succeeded
        ? "DeepSeek Harness 已完成并验证当前回合交付"
        : `DeepSeek Harness 当前回合失败：${reasonCode}`,
      finalResponse: succeeded && result.text.trim() ? result.text.trim() : null,
      terminalDelivery,
      recentEvents: [
        ...(Array.isArray(priorTurn.recentEvents) ? priorTurn.recentEvents : []),
        {
          type: succeeded ? "turn.completed" : "turn.failed",
          at: now,
          toolName: null,
          toolStatus: succeeded ? "succeeded" : "failed",
        },
      ].slice(-20),
    },
  };
}

function failedSnapshot(prior: ChatTurnSnapshot, error: unknown): ChatTurnSnapshot {
  const priorTurn = isJsonObject(prior.turn) ? prior.turn : null;
  if (!priorTurn) return prior;
  const priorLogicalTaskState = isJsonObject(priorTurn.logicalTaskState)
    ? priorTurn.logicalTaskState
    : null;
  if (priorLogicalTaskState?.status === "cancelled") return prior;
  const now = new Date().toISOString();
  const turnId = nonEmptyString(priorTurn.turnId);
  if (!turnId) return prior;
  const reasonCode = nonEmptyString(
    isJsonObject(error) ? error.code : null,
  ) ?? "deepseek_harness_bridge_failed";
  return {
    sessionId: prior.sessionId,
    durable: true,
    activeTurn: false,
    turn: {
      ...priorTurn,
      state: "failed",
      logicalTaskState: logicalTaskState({
        turnId,
        status: "failed",
        reasonCode,
        physicalRunStatus: "interrupted",
        deliveryStatus: "unsatisfied",
        updatedAt: now,
      }),
      phase: "failed",
      updatedAt: now,
      lastConfirmedAt: now,
      reasonCode,
      lastConfirmedSummary: `DeepSeek Harness 当前回合异常终止：${reasonCode}`,
      finalResponse: null,
      terminalDelivery: null,
      recentEvents: [
        ...(Array.isArray(priorTurn.recentEvents) ? priorTurn.recentEvents : []),
        { type: "turn.failed", at: now, toolName: null, toolStatus: "failed" },
      ].slice(-20),
    },
  };
}

function cancelledSnapshot(prior: ChatTurnSnapshot, reasonCode: string): ChatTurnSnapshot {
  const priorTurn = isJsonObject(prior.turn) ? prior.turn : null;
  if (!priorTurn) return prior;
  const now = new Date().toISOString();
  const turnId = nonEmptyString(priorTurn.turnId);
  if (!turnId) return prior;
  return {
    sessionId: prior.sessionId,
    durable: true,
    activeTurn: false,
    turn: {
      ...priorTurn,
      state: "cancelled",
      logicalTaskState: logicalTaskState({
        turnId,
        status: "cancelled",
        reasonCode,
        physicalRunStatus: "interrupted",
        deliveryStatus: "unsatisfied",
        updatedAt: now,
      }),
      phase: "failed",
      updatedAt: now,
      lastConfirmedAt: now,
      reasonCode,
      lastConfirmedSummary: "DeepSeek Harness 当前回合已按用户请求中断",
      finalResponse: null,
      terminalDelivery: null,
      recentEvents: [
        ...(Array.isArray(priorTurn.recentEvents) ? priorTurn.recentEvents : []),
        { type: "turn.interrupted", at: now, toolName: null, toolStatus: "cancelled" },
      ].slice(-20),
    },
  };
}

function idleSnapshot(sessionId: string): ChatTurnSnapshot {
  return { sessionId, durable: true, activeTurn: false, turn: null };
}

function storageKey(userId: string, sessionId: string): string {
  return createHash("sha256").update(`${userId}\0${sessionId}`).digest("hex");
}

export class HarnessChatLifecycleStore {
  private readonly active = new Map<string, ActiveTurn>();

  constructor(private readonly root: string) {}

  private key(userId: string, sessionId: string): string {
    return `${userId}\0${sessionId}`;
  }

  private file(userId: string, sessionId: string): string {
    return path.join(this.root, `${storageKey(userId, sessionId)}.json`);
  }

  private async persist(userId: string, snapshot: ChatTurnSnapshot): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const destination = this.file(userId, snapshot.sessionId);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, destination);
  }

  async begin(request: AgentsChatRequest): Promise<ChatTurnLease> {
    const userId = request.userId ?? "anonymous";
    const { sessionId, turnId } = requiredIdentity(request);
    const controller = new AbortController();
    const snapshot = runningSnapshot(request, `harness_turn_${randomUUID()}`);
    this.active.set(this.key(userId, sessionId), { controller, snapshot });
    await this.persist(userId, snapshot);
    return { signal: controller.signal, sessionId, turnId };
  }

  async complete(userId: string, sessionId: string, result: HarnessBridgeResult): Promise<void> {
    const key = this.key(userId, sessionId);
    const entry = this.active.get(key);
    if (!entry) return;
    const snapshot = terminalSnapshot(entry.snapshot, result);
    this.active.delete(key);
    await this.persist(userId, snapshot);
  }

  async fail(userId: string, sessionId: string, error: unknown): Promise<void> {
    const key = this.key(userId, sessionId);
    const entry = this.active.get(key);
    if (!entry) return;
    const snapshot = failedSnapshot(entry.snapshot, error);
    this.active.delete(key);
    await this.persist(userId, snapshot);
  }

  async status(userId: string, sessionId: string): Promise<ChatTurnSnapshot> {
    const inMemory = this.active.get(this.key(userId, sessionId));
    if (inMemory) return inMemory.snapshot;
    try {
      const payload = JSON.parse(await readFile(this.file(userId, sessionId), "utf8")) as unknown;
      if (
        isJsonObject(payload)
        && payload.sessionId === sessionId
        && payload.durable === true
        && typeof payload.activeTurn === "boolean"
        && (payload.turn === null || isJsonObject(payload.turn))
      ) {
        const persisted = payload as ChatTurnSnapshot;
        if (!persisted.activeTurn) return persisted;
        // A running checkpoint without an in-memory owner can only be left by a
        // terminated Bridge process. Never present it as a live Harness run.
        const orphaned = failedSnapshot(persisted, {
          code: "deepseek_harness_process_restarted",
        });
        await this.persist(userId, orphaned);
        return orphaned;
      }
      throw new Error("persisted DeepSeek Harness chat status is invalid");
    } catch (error: unknown) {
      if (isJsonObject(error) && error.code === "ENOENT") return idleSnapshot(sessionId);
      throw error;
    }
  }

  async interrupt(input: {
    userId: string;
    sessionId: string;
    turnId: string;
    reasonCode: string;
  }): Promise<{ interrupted: boolean; snapshot: ChatTurnSnapshot }> {
    const key = this.key(input.userId, input.sessionId);
    const entry = this.active.get(key);
    const activeTurn = isJsonObject(entry?.snapshot.turn) ? entry.snapshot.turn : null;
    if (!entry || activeTurn?.turnId !== input.turnId) {
      return { interrupted: false, snapshot: await this.status(input.userId, input.sessionId) };
    }
    const snapshot = cancelledSnapshot(entry.snapshot, input.reasonCode);
    this.active.set(key, { controller: entry.controller, snapshot });
    entry.controller.abort(Object.assign(new Error(input.reasonCode), { code: input.reasonCode }));
    await this.persist(input.userId, snapshot);
    return { interrupted: true, snapshot };
  }
}
