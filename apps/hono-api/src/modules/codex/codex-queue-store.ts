import { randomUUID } from "node:crypto";
import type IORedis from "ioredis";
import {
	isCodexTerminalTaskState,
	type CodexBridgeHeartbeat,
	type CodexBridgeSummary,
	type CodexCanvasContextSnapshot,
	type CodexDeliveryEvidence,
	type CodexExpectedDelivery,
	type CodexTask,
	type CodexTaskEvent,
	type CodexTaskMessage,
	type CodexTaskState,
	type CreateCodexTaskMessageRequest,
	type CreateCodexTaskRequest,
} from "@tapcanvas/codex-task-protocol";
import {
	CodexBridgeHeartbeatSchema,
	CodexBridgeSummarySchema,
	CodexCanvasContextSnapshotSchema,
	CodexTaskEventSchema,
	CodexTaskSchema,
} from "./codex.schemas";
import { getSharedRedis } from "../../platform/redis-shared";
import { verifyCodexDelivery } from "./codex-delivery-verifier";
import {
	assertCodexTaskTransition,
	canTransitionCodexTask,
} from "./codex-state-machine";
import {
	resolveCodexQueueConfig,
	type CodexQueueConfig,
} from "./codex-queue-config";

import { codexRedisKeyToken } from "./codex-redis-key";
import {
	CodexTaskMessageStore,
	type EnqueueCodexTaskMessageResult,
} from "./codex-task-message-store";
import {
	CodexTaskEnqueueStore,
	type EnqueueCodexTaskResult,
} from "./codex-task-enqueue-store";

export type { EnqueueCodexTaskMessageResult } from "./codex-task-message-store";
export type { EnqueueCodexTaskResult } from "./codex-task-enqueue-store";

type StoredBridge = CodexBridgeHeartbeat & {
	lastSeenAt: string;
};

export type ClaimedCodexTask = {
	task: CodexTask;
	contextSnapshot: CodexCanvasContextSnapshot;
	leaseId: string;
	leaseExpiresAt: string;
};

export class CodexQueueUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CodexQueueUnavailableError";
	}
}

export class CodexLeaseConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CodexLeaseConflictError";
	}
}

const CLAIM_SCRIPT = `
local active = redis.call("GET", KEYS[1])
if active then
  return { "busy" }
end

local max_scan = tonumber(ARGV[1])
for index = 1, max_scan do
  local task_id = redis.call("LPOP", KEYS[3])
  if not task_id then
    return { "empty" }
  end
  local task_key = ARGV[2] .. task_id
  local raw = redis.call("GET", task_key)
  if raw then
    local task = cjson.decode(raw)
    if task.state == "queued" then
      local workspace_lock_key = ARGV[3] .. task.workspaceId
      local lock_ok = redis.call("SET", workspace_lock_key, ARGV[4], "NX", "PX", ARGV[5])
      if lock_ok then
        local lease = cjson.encode({
          taskId = task_id,
          leaseId = ARGV[4],
          workerInstanceId = ARGV[6]
        })
        redis.call("SET", KEYS[1], lease, "PX", ARGV[5])
        redis.call("SET", KEYS[2], task_id, "EX", ARGV[7])
        return { "claimed", raw }
      end
      redis.call("RPUSH", KEYS[3], task_id)
    end
  end
end
return { "blocked" }
`;

const FINALIZE_CLAIM_SCRIPT = `
local active_raw = redis.call("GET", KEYS[1])
if not active_raw then
  return { "lease_missing" }
end
local active = cjson.decode(active_raw)
if active.taskId ~= ARGV[1] or active.leaseId ~= ARGV[2] or active.workerInstanceId ~= ARGV[3] then
  return { "lease_mismatch" }
end
local current_raw = redis.call("GET", KEYS[2])
if not current_raw then
  return { "task_missing" }
end
if current_raw ~= ARGV[4] then
  return { "task_changed" }
end
redis.call("SET", KEYS[2], ARGV[5], "EX", ARGV[6])
redis.call("RPUSH", KEYS[3], ARGV[7])
redis.call("LTRIM", KEYS[3], -500, -1)
redis.call("EXPIRE", KEYS[3], ARGV[6])
return { "updated" }
`;

const UPDATE_WITH_LEASE_SCRIPT = `
local active_raw = redis.call("GET", KEYS[1])
if not active_raw then
  return { "lease_missing" }
end
local active = cjson.decode(active_raw)
if active.taskId ~= ARGV[1] or active.leaseId ~= ARGV[2] or active.workerInstanceId ~= ARGV[3] then
  return { "lease_mismatch" }
end
local current_raw = redis.call("GET", KEYS[2])
if not current_raw then
  return { "task_missing" }
end
local current = cjson.decode(current_raw)
if current.state ~= ARGV[4] then
  return { "state_mismatch", current.state }
end
redis.call("SET", KEYS[2], ARGV[5], "EX", ARGV[6])
redis.call("RPUSH", KEYS[3], ARGV[7])
redis.call("LTRIM", KEYS[3], -500, -1)
redis.call("EXPIRE", KEYS[3], ARGV[6])
if ARGV[8] == "1" then
  redis.call("DEL", KEYS[1])
  redis.call("DEL", KEYS[4])
  redis.call("DEL", KEYS[5])
  redis.call("ZREM", KEYS[6], ARGV[1])
  redis.call("ZREM", KEYS[7], ARGV[1])
end
return { "updated" }
`;

const HEARTBEAT_LEASE_SCRIPT = `
local active_raw = redis.call("GET", KEYS[1])
if not active_raw then
  return { "lease_missing" }
end
local active = cjson.decode(active_raw)
if active.taskId ~= ARGV[1] or active.leaseId ~= ARGV[2] or active.workerInstanceId ~= ARGV[3] then
  return { "lease_mismatch" }
end
local task_raw = redis.call("GET", KEYS[2])
if not task_raw then
  return { "task_missing" }
end
redis.call("PEXPIRE", KEYS[1], ARGV[4])
redis.call("PEXPIRE", KEYS[3], ARGV[4])
redis.call("EXPIRE", KEYS[4], ARGV[5])
redis.call("SET", KEYS[2], ARGV[6], "EX", ARGV[5])
return { "extended" }
`;

const CONTROL_TRANSITION_SCRIPT = `
local current_raw = redis.call("GET", KEYS[1])
if not current_raw then
  return { "task_missing" }
end
local current = cjson.decode(current_raw)
if current.state ~= ARGV[1] then
  return { "state_mismatch", current.state }
end
redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[3])
redis.call("RPUSH", KEYS[2], ARGV[4])
redis.call("LTRIM", KEYS[2], -500, -1)
redis.call("EXPIRE", KEYS[2], ARGV[3])
if ARGV[5] == "1" then
  redis.call("DEL", KEYS[3])
  redis.call("DEL", KEYS[4])
  redis.call("DEL", KEYS[5])
  redis.call("ZREM", KEYS[6], ARGV[6])
  redis.call("ZREM", KEYS[7], ARGV[6])
end
return { "updated" }
`;

function parseEvalArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		throw new Error("Redis queue script returned a non-array response");
	}
	return value.map((item) => String(item));
}

function parseStoredBridge(raw: string): StoredBridge {
	const parsed = JSON.parse(raw) as unknown;
	const record = parsed as { lastSeenAt?: unknown };
	const heartbeat = CodexBridgeHeartbeatSchema.parse(parsed);
	if (typeof record.lastSeenAt !== "string") {
		throw new Error("Stored Codex bridge is missing lastSeenAt");
	}
	return { ...heartbeat, lastSeenAt: record.lastSeenAt };
}

function makeTaskEvent(input: {
	taskId: string;
	state: CodexTaskState;
	code: string;
	message: string;
	at: string;
}): CodexTaskEvent {
	return CodexTaskEventSchema.parse({
		id: randomUUID(),
		...input,
	});
}

export class CodexQueueStore {
	private readonly taskEnqueueStore: CodexTaskEnqueueStore;
	private readonly taskMessageStore: CodexTaskMessageStore;

	constructor(
		private readonly redis: IORedis,
		private readonly config: CodexQueueConfig = resolveCodexQueueConfig(),
	) {
		this.taskEnqueueStore = new CodexTaskEnqueueStore(redis, config, {
			getTask: (userId, taskId) => this.getTask(userId, taskId),
		});
		this.taskMessageStore = new CodexTaskMessageStore(redis, config, {
			getTask: (userId, taskId) => this.getTask(userId, taskId),
			activeLeaseKey: (userId, bridgeId) =>
				this.bridgeActiveKey(userId, bridgeId),
			leaseConflict: (message) => new CodexLeaseConflictError(message),
		});
	}

	private userToken(userId: string): string {
		return codexRedisKeyToken(userId);
	}

	private bridgeToken(bridgeId: string): string {
		return codexRedisKeyToken(bridgeId);
	}

	private taskKey(taskId: string): string {
		return `tapcanvas:codex:task:${taskId}`;
	}

	private taskEventKey(taskId: string): string {
		return `tapcanvas:codex:events:${taskId}`;
	}

	private contextSnapshotKey(snapshotId: string): string {
		return `tapcanvas:codex:context:${snapshotId}`;
	}

	private bridgeMetaKey(userId: string, bridgeId: string): string {
		return `tapcanvas:codex:bridge:meta:${this.userToken(userId)}:${this.bridgeToken(bridgeId)}`;
	}

	private bridgeOnlineKey(userId: string, bridgeId: string): string {
		return `tapcanvas:codex:bridge:online:${this.userToken(userId)}:${this.bridgeToken(bridgeId)}`;
	}

	private bridgeSetKey(userId: string): string {
		return `tapcanvas:codex:bridges:${this.userToken(userId)}`;
	}

	private bridgeQueueKey(userId: string, bridgeId: string): string {
		return `tapcanvas:codex:queue:${this.userToken(userId)}:${this.bridgeToken(bridgeId)}`;
	}

	private bridgeActiveKey(userId: string, bridgeId: string): string {
		return `tapcanvas:codex:active:${this.userToken(userId)}:${this.bridgeToken(bridgeId)}`;
	}

	private bridgeInflightKey(userId: string, bridgeId: string): string {
		return `tapcanvas:codex:inflight:${this.userToken(userId)}:${this.bridgeToken(bridgeId)}`;
	}

	private workspaceLockPrefix(userId: string): string {
		return `tapcanvas:codex:workspace-lock:${this.userToken(userId)}:`;
	}

	private userActiveKey(userId: string): string {
		return `tapcanvas:codex:user-active:${this.userToken(userId)}`;
	}

	private userRecentKey(userId: string): string {
		return `tapcanvas:codex:user-recent:${this.userToken(userId)}`;
	}

	private globalActiveKey(): string {
		return "tapcanvas:codex:global-active";
	}

	private previewTaskKey(userId: string, previewId: string): string {
		return `tapcanvas:codex:preview:${this.userToken(userId)}:${codexRedisKeyToken(previewId)}`;
	}

	async registerBridge(
		userId: string,
		heartbeat: CodexBridgeHeartbeat,
		nowIso: string,
	): Promise<CodexBridgeSummary> {
		const parsed = CodexBridgeHeartbeatSchema.parse(heartbeat);
		const stored: StoredBridge = { ...parsed, lastSeenAt: nowIso };
		const multi = this.redis.multi();
		multi.set(
			this.bridgeMetaKey(userId, parsed.bridgeId),
			JSON.stringify(stored),
			"EX",
			this.config.taskTtlSeconds,
		);
		multi.set(
			this.bridgeOnlineKey(userId, parsed.bridgeId),
			parsed.workerInstanceId,
			"EX",
			this.config.bridgeOnlineTtlSeconds,
		);
		multi.sadd(this.bridgeSetKey(userId), parsed.bridgeId);
		multi.expire(this.bridgeSetKey(userId), this.config.taskTtlSeconds);
		await multi.exec();
		const activeTaskId =
			(await this.redis.get(
				this.bridgeInflightKey(userId, parsed.bridgeId),
			)) || null;
		return CodexBridgeSummarySchema.parse({
			...stored,
			status: "online",
			activeTaskId,
		});
	}

	async listBridges(userId: string): Promise<CodexBridgeSummary[]> {
		const bridgeIds = await this.redis.smembers(this.bridgeSetKey(userId));
		if (bridgeIds.length === 0) return [];
		const metaKeys = bridgeIds.map((bridgeId) =>
			this.bridgeMetaKey(userId, bridgeId),
		);
		const onlineKeys = bridgeIds.map((bridgeId) =>
			this.bridgeOnlineKey(userId, bridgeId),
		);
		const inflightKeys = bridgeIds.map((bridgeId) =>
			this.bridgeInflightKey(userId, bridgeId),
		);
		const [metas, onlineValues, inflightValues] = await Promise.all([
			this.redis.mget(...metaKeys),
			this.redis.mget(...onlineKeys),
			this.redis.mget(...inflightKeys),
		]);
		const items: CodexBridgeSummary[] = [];
		for (let index = 0; index < bridgeIds.length; index += 1) {
			const raw = metas[index];
			if (!raw) continue;
			const stored = parseStoredBridge(raw);
			items.push(
				CodexBridgeSummarySchema.parse({
					...stored,
					status: onlineValues[index] ? "online" : "offline",
					activeTaskId: inflightValues[index] || null,
				}),
			);
		}
		return items.sort((left, right) =>
			right.lastSeenAt.localeCompare(left.lastSeenAt),
		);
	}

	async getOnlineBridge(
		userId: string,
		bridgeId: string,
	): Promise<StoredBridge | null> {
		const [metaRaw, online] = await Promise.all([
			this.redis.get(this.bridgeMetaKey(userId, bridgeId)),
			this.redis.get(this.bridgeOnlineKey(userId, bridgeId)),
		]);
		if (!metaRaw || !online) return null;
		return parseStoredBridge(metaRaw);
	}

	async getBridgeActiveTaskId(
		userId: string,
		bridgeId: string,
	): Promise<string | null> {
		return (
			(await this.redis.get(
				this.bridgeInflightKey(userId, bridgeId),
			)) || null
		);
	}

	async enqueueTask(input: {
		userId: string;
		request: CreateCodexTaskRequest;
		sessionId: string;
		parentTaskId: string | null;
		turnSequence: number;
		resumeThreadId: string | null;
		contextSnapshot: CodexCanvasContextSnapshot;
		workspaceConfigFingerprint: string;
		nowIso: string;
		nowMs: number;
	}): Promise<EnqueueCodexTaskResult> {
		return this.taskEnqueueStore.enqueue(input);
	}

	async getTask(userId: string, taskId: string): Promise<CodexTask | null> {
		const raw = await this.redis.get(this.taskKey(taskId));
		if (!raw) return null;
		const task = CodexTaskSchema.parse(JSON.parse(raw) as unknown);
		return task.userId === userId ? task : null;
	}

	async listRecentTasks(
		userId: string,
		limit: number,
	): Promise<CodexTask[]> {
		const boundedLimit = Math.min(
			Math.max(1, Math.trunc(limit)),
			this.config.recentTaskLimit,
		);
		const ids = await this.redis.zrevrange(
			this.userRecentKey(userId),
			0,
			boundedLimit - 1,
		);
		if (ids.length === 0) return [];
		const raws = await this.redis.mget(...ids.map((id) => this.taskKey(id)));
		const items: CodexTask[] = [];
		for (const raw of raws) {
			if (!raw) continue;
			const task = CodexTaskSchema.parse(JSON.parse(raw) as unknown);
			if (task.userId === userId) items.push(task);
		}
		return items;
	}

	async listTaskEvents(
		userId: string,
		taskId: string,
	): Promise<CodexTaskEvent[]> {
		const task = await this.getTask(userId, taskId);
		if (!task) return [];
		const raws = await this.redis.lrange(this.taskEventKey(taskId), 0, -1);
		return raws.map((raw) =>
			CodexTaskEventSchema.parse(JSON.parse(raw) as unknown),
		);
	}

	async enqueueTaskMessage(input: {
		userId: string;
		taskId: string;
		request: CreateCodexTaskMessageRequest;
		nowIso: string;
	}): Promise<EnqueueCodexTaskMessageResult | null> {
		return this.taskMessageStore.enqueue(input);
	}

	async listTaskMessages(
		userId: string,
		taskId: string,
	): Promise<CodexTaskMessage[] | null> {
		return this.taskMessageStore.list(userId, taskId);
	}

	async claimTaskMessages(input: {
		userId: string;
		taskId: string;
		bridgeId: string;
		workerInstanceId: string;
		leaseId: string;
		limit: number;
	}): Promise<CodexTaskMessage[]> {
		return this.taskMessageStore.claim(input);
	}

	async acknowledgeTaskMessage(input: {
		userId: string;
		taskId: string;
		bridgeId: string;
		workerInstanceId: string;
		leaseId: string;
		messageId: string;
		state: "delivered" | "rejected" | "unknown";
		detail: string;
		nowIso: string;
	}): Promise<CodexTaskMessage | null> {
		return this.taskMessageStore.acknowledge(input);
	}

	private async rejectQueuedTaskMessages(
		taskId: string,
		nowIso: string,
		detail: string,
	): Promise<void> {
		await this.taskMessageStore.rejectQueued(taskId, nowIso, detail);
	}

	private async terminalizeExpiredLease(
		userId: string,
		bridgeId: string,
		nowIso: string,
	): Promise<void> {
		const activeKey = this.bridgeActiveKey(userId, bridgeId);
		const inflightKey = this.bridgeInflightKey(userId, bridgeId);
		const [activeRaw, inflightTaskId] = await Promise.all([
			this.redis.get(activeKey),
			this.redis.get(inflightKey),
		]);
		if (activeRaw || !inflightTaskId) return;
		const task = await this.getTask(userId, inflightTaskId);
		if (!task || isCodexTerminalTaskState(task.state)) {
			await this.redis.del(inflightKey);
			return;
		}
		const nextTask: CodexTask = {
			...task,
			state: "unknown",
			updatedAt: nowIso,
			terminalAt: nowIso,
			lastMessage:
				"宿主机 Worker 租约已失效，无法确认 Codex 或远程 Sandbox 的最终状态；任务未自动重试。",
			deliveryVerification: {
				status: "failed",
				checkedAt: nowIso,
				missingCriteria: task.expectedDelivery.requiredEvidence,
				rationale: "执行租约丢失，真实终态未知，禁止自动重试。",
			},
		};
		const event = makeTaskEvent({
			taskId: task.id,
			state: "unknown",
			code: "lease_expired_status_unknown",
			message: nextTask.lastMessage,
			at: nowIso,
		});
		const multi = this.redis.multi();
		multi.set(
			this.taskKey(task.id),
			JSON.stringify(nextTask),
			"EX",
			this.config.taskTtlSeconds,
		);
		multi.rpush(this.taskEventKey(task.id), JSON.stringify(event));
		multi.ltrim(this.taskEventKey(task.id), -500, -1);
		multi.expire(this.taskEventKey(task.id), this.config.taskTtlSeconds);
		multi.del(inflightKey);
		multi.del(
			`${this.workspaceLockPrefix(userId)}${task.workspaceId}`,
		);
		multi.zrem(this.userActiveKey(userId), task.id);
		multi.zrem(this.globalActiveKey(), task.id);
		await multi.exec();
		await this.rejectQueuedTaskMessages(
			task.id,
			nowIso,
			"宿主机 Worker 租约已失效，补充消息未送达 Codex",
		);
	}

	async claimTask(input: {
		userId: string;
		bridgeId: string;
		workerInstanceId: string;
		nowIso: string;
		nowMs: number;
	}): Promise<ClaimedCodexTask | null> {
		await this.terminalizeExpiredLease(
			input.userId,
			input.bridgeId,
			input.nowIso,
		);
		const leaseId = `${randomUUID()}${randomUUID()}`.replaceAll("-", "");
		const leaseExpiresAt = new Date(
			input.nowMs + this.config.leaseTtlMs,
		).toISOString();
		const result = parseEvalArray(
			await this.redis.eval(
				CLAIM_SCRIPT,
				3,
				this.bridgeActiveKey(input.userId, input.bridgeId),
				this.bridgeInflightKey(input.userId, input.bridgeId),
				this.bridgeQueueKey(input.userId, input.bridgeId),
				"100",
				"tapcanvas:codex:task:",
				this.workspaceLockPrefix(input.userId),
				leaseId,
				String(this.config.leaseTtlMs),
				input.workerInstanceId,
				String(this.config.taskTtlSeconds),
			),
		);
		if (result[0] !== "claimed") return null;
		const rawTask = result[1] || "{}";
		const current = CodexTaskSchema.parse(
			JSON.parse(rawTask) as unknown,
		);
		const task = CodexTaskSchema.parse({
			...current,
			state: "claimed",
			updatedAt: input.nowIso,
			lastMessage: "宿主机 Codex Worker 已领取任务",
		});
		const event = makeTaskEvent({
			taskId: task.id,
			state: "claimed",
			code: "task_claimed",
			message: task.lastMessage,
			at: input.nowIso,
		});
		const finalized = parseEvalArray(
			await this.redis.eval(
				FINALIZE_CLAIM_SCRIPT,
				3,
				this.bridgeActiveKey(input.userId, input.bridgeId),
				this.taskKey(task.id),
				this.taskEventKey(task.id),
				task.id,
				leaseId,
				input.workerInstanceId,
				rawTask,
				JSON.stringify(task),
				String(this.config.taskTtlSeconds),
				JSON.stringify(event),
			),
		);
		if (finalized[0] !== "updated") {
			throw new CodexLeaseConflictError(
				`Codex claim finalization rejected: ${finalized.join(",")}`,
			);
		}
		const contextRaw = await this.redis.get(
			this.contextSnapshotKey(task.context.snapshotId),
		);
		if (!contextRaw) {
			throw new CodexLeaseConflictError(
				"Codex context snapshot is missing after task claim",
			);
		}
		const contextSnapshot = CodexCanvasContextSnapshotSchema.parse(
			JSON.parse(contextRaw) as unknown,
		);
		if (contextSnapshot.sha256 !== task.context.sha256) {
			throw new CodexLeaseConflictError(
				"Codex context snapshot fingerprint does not match the claimed task",
			);
		}
		return { task, contextSnapshot, leaseId, leaseExpiresAt };
	}

	async heartbeatLease(input: {
		userId: string;
		taskId: string;
		bridgeId: string;
		workerInstanceId: string;
		leaseId: string;
		nowIso: string;
	}): Promise<void> {
		const task = await this.getTask(input.userId, input.taskId);
		if (!task || task.bridgeId !== input.bridgeId) {
			throw new CodexLeaseConflictError("Codex task or bridge not found");
		}
		const updatedTask = CodexTaskSchema.parse({
			...task,
			updatedAt: input.nowIso,
		});
		const result = parseEvalArray(
			await this.redis.eval(
				HEARTBEAT_LEASE_SCRIPT,
				4,
				this.bridgeActiveKey(input.userId, input.bridgeId),
				this.taskKey(input.taskId),
				`${this.workspaceLockPrefix(input.userId)}${task.workspaceId}`,
				this.bridgeInflightKey(input.userId, input.bridgeId),
				input.taskId,
				input.leaseId,
				input.workerInstanceId,
				String(this.config.leaseTtlMs),
				String(this.config.taskTtlSeconds),
				JSON.stringify(updatedTask),
			),
		);
		if (result[0] !== "extended") {
			throw new CodexLeaseConflictError(
				`Codex lease heartbeat rejected: ${result.join(",")}`,
			);
		}
	}

	async updateTaskFromWorker(input: {
		userId: string;
		taskId: string;
		bridgeId: string;
		workerInstanceId: string;
		leaseId: string;
		state: CodexTaskState;
		code: string;
		message: string;
		expectedDelivery?: CodexExpectedDelivery;
		deliveryEvidence?: CodexDeliveryEvidence;
		nowIso: string;
	}): Promise<CodexTask> {
		const current = await this.getTask(input.userId, input.taskId);
		if (!current || current.bridgeId !== input.bridgeId) {
			throw new CodexLeaseConflictError("Codex task or bridge not found");
		}
		assertCodexTaskTransition(current.state, input.state);
		let nextState = input.state;
		const evidence = input.deliveryEvidence ?? current.deliveryEvidence;
		const expectedDelivery =
			input.expectedDelivery ?? current.expectedDelivery;
		let verification = current.deliveryVerification;
		let terminalAt: string | null = isCodexTerminalTaskState(nextState)
			? input.nowIso
			: null;
		let message = input.message;
		if (nextState === "succeeded" || nextState === "awaiting_user_input") {
			verification = verifyCodexDelivery({
				expectedDelivery,
				deliveryEvidence: evidence,
				nowIso: input.nowIso,
			});
			if (verification.status !== "satisfied") {
				nextState = "failed";
				terminalAt = input.nowIso;
				message = `交付验收失败：${verification.rationale}`;
				if (!canTransitionCodexTask(current.state, nextState)) {
					throw new Error(
						`Delivery verifier cannot close ${current.state} as failed`,
					);
				}
			}
		} else if (isCodexTerminalTaskState(nextState)) {
			verification = {
				status: "failed",
				checkedAt: input.nowIso,
				missingCriteria: expectedDelivery.requiredEvidence.filter(
					(criterion) => {
						if (criterion === "codex_turn") {
							return evidence.codex?.status !== "completed";
						}
						if (criterion === "tests") {
							return !evidence.build?.commands.some(
								(command) =>
									command.name === "test" && command.exitCode === 0,
							);
						}
						if (criterion === "build") {
							return !evidence.build?.commands.some(
								(command) =>
									command.name === "build" && command.exitCode === 0,
							);
						}
						return !evidence.preview;
					},
				),
				rationale: `任务以 ${nextState} 结束：${message}`,
			};
		}
		const nextTask = CodexTaskSchema.parse({
			...current,
			state: nextState,
			updatedAt: input.nowIso,
			terminalAt,
			lastMessage: message,
			expectedDelivery,
			deliveryEvidence: evidence,
			deliveryVerification: verification,
		});
		const event = makeTaskEvent({
			taskId: current.id,
			state: nextState,
			code: input.code,
			message,
			at: input.nowIso,
		});
		const terminal = isCodexTerminalTaskState(nextState);
		const result = parseEvalArray(
			await this.redis.eval(
				UPDATE_WITH_LEASE_SCRIPT,
				7,
				this.bridgeActiveKey(input.userId, input.bridgeId),
				this.taskKey(input.taskId),
				this.taskEventKey(input.taskId),
				this.bridgeInflightKey(input.userId, input.bridgeId),
				`${this.workspaceLockPrefix(input.userId)}${current.workspaceId}`,
				this.userActiveKey(input.userId),
				this.globalActiveKey(),
				input.taskId,
				input.leaseId,
				input.workerInstanceId,
				current.state,
				JSON.stringify(nextTask),
				String(this.config.taskTtlSeconds),
				JSON.stringify(event),
				terminal ? "1" : "0",
			),
		);
		if (result[0] !== "updated") {
			throw new CodexLeaseConflictError(
				`Codex worker update rejected: ${result.join(",")}`,
			);
		}
		if (current.state === "codex_running" && nextState !== "codex_running") {
			await this.rejectQueuedTaskMessages(
				current.id,
				input.nowIso,
				"Codex 当前回合已结束，本条补充未进入该回合；请作为同一会话的下一轮发送",
			);
		}
		return nextTask;
	}

	async decideFallback(input: {
		userId: string;
		taskId: string;
		decision: "approve" | "decline";
		nowIso: string;
	}): Promise<CodexTask | null> {
		const current = await this.getTask(input.userId, input.taskId);
		if (!current) return null;
		const nextState: CodexTaskState =
			input.decision === "approve" ? "local_fallback_approved" : "failed";
		assertCodexTaskTransition(current.state, nextState);
		const message =
			input.decision === "approve"
				? "用户已明确允许本次任务使用宿主机隔离 Docker 构建。"
				: "用户拒绝本机 Docker fallback，任务已停止。";
		const nextTask = CodexTaskSchema.parse({
			...current,
			state: nextState,
			updatedAt: input.nowIso,
			terminalAt: nextState === "failed" ? input.nowIso : null,
			lastMessage: message,
			...(nextState === "failed"
				? {
						deliveryVerification: {
							status: "failed",
							checkedAt: input.nowIso,
							missingCriteria:
								current.expectedDelivery.requiredEvidence,
							rationale: message,
						},
				  }
				: {}),
		});
		const event = makeTaskEvent({
			taskId: current.id,
			state: nextState,
			code:
				input.decision === "approve"
					? "local_fallback_approved"
					: "local_fallback_declined",
			message,
			at: input.nowIso,
		});
		const result = parseEvalArray(
			await this.redis.eval(
				CONTROL_TRANSITION_SCRIPT,
				7,
				this.taskKey(input.taskId),
				this.taskEventKey(input.taskId),
				this.bridgeActiveKey(input.userId, current.bridgeId),
				this.bridgeInflightKey(input.userId, current.bridgeId),
				`${this.workspaceLockPrefix(input.userId)}${current.workspaceId}`,
				this.userActiveKey(input.userId),
				this.globalActiveKey(),
				current.state,
				JSON.stringify(nextTask),
				String(this.config.taskTtlSeconds),
				JSON.stringify(event),
				nextState === "failed" ? "1" : "0",
				current.id,
			),
		);
		if (result[0] !== "updated") {
			throw new Error(
				`Codex fallback decision rejected: ${result.join(",")}`,
			);
		}
		return nextTask;
	}

	async getTaskByPreviewId(
		userId: string,
		previewId: string,
	): Promise<CodexTask | null> {
		const taskId = await this.redis.get(
			this.previewTaskKey(userId, previewId),
		);
		if (!taskId) return null;
		const task = await this.getTask(userId, taskId);
		return task?.previewId === previewId ? task : null;
	}
}

let storeOverride: CodexQueueStore | null = null;

export function setCodexQueueStoreForTests(
	store: CodexQueueStore | null,
): void {
	storeOverride = store;
}

export function requireCodexQueueStore(): CodexQueueStore {
	if (storeOverride) return storeOverride;
	const redis = getSharedRedis();
	if (!redis) {
		throw new CodexQueueUnavailableError(
			"Codex durable queue is unavailable because REDIS_URL is not configured",
		);
	}
	return new CodexQueueStore(redis);
}
