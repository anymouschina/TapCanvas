import { randomUUID } from "node:crypto";
import type IORedis from "ioredis";
import {
	CODEX_TASK_PROTOCOL_VERSION,
	type CodexCanvasContextSnapshot,
	type CodexTask,
	type CreateCodexTaskRequest,
} from "@tapcanvas/codex-task-protocol";
import {
	CodexTaskEventSchema,
	CodexTaskSchema,
} from "./codex.schemas";
import type { CodexQueueConfig } from "./codex-queue-config";
import { codexRedisKeyToken } from "./codex-redis-key";

export type EnqueueCodexTaskResult =
	| {
			kind: "created";
			task: CodexTask;
			queuePosition: number;
	  }
	| {
			kind: "deduplicated";
			task: CodexTask;
	  }
	| {
			kind: "rate_limited";
			retryAfterSeconds: number;
	  }
	| { kind: "user_queue_full" }
	| { kind: "global_queue_full" }
	| {
			kind: "session_conflict";
			latestTaskId: string | null;
	  };

type CodexTaskEnqueueStoreDependencies = {
	getTask: (userId: string, taskId: string) => Promise<CodexTask | null>;
};

const ENQUEUE_SCRIPT = `
local existing_id = redis.call("GET", KEYS[1])
if existing_id then
  return { "deduplicated", existing_id }
end

local expected_parent = ARGV[11]
local current_latest = redis.call("GET", KEYS[11])
if expected_parent == "" then
  if current_latest then
    return { "session_conflict", current_latest }
  end
elseif not current_latest or current_latest ~= expected_parent then
  return { "session_conflict", current_latest or "" }
end

local rate = redis.call("INCR", KEYS[2])
if rate == 1 then
  redis.call("EXPIRE", KEYS[2], 2)
end
if rate > tonumber(ARGV[1]) then
  return { "rate_limited" }
end

redis.call("ZREMRANGEBYSCORE", KEYS[3], "-inf", ARGV[2])
redis.call("ZREMRANGEBYSCORE", KEYS[4], "-inf", ARGV[2])
if redis.call("ZCARD", KEYS[3]) >= tonumber(ARGV[3]) then
  return { "user_queue_full" }
end
if redis.call("ZCARD", KEYS[4]) >= tonumber(ARGV[4]) then
  return { "global_queue_full" }
end

redis.call("SET", KEYS[5], ARGV[5], "EX", ARGV[6])
redis.call("SET", KEYS[10], ARGV[12], "EX", ARGV[6])
redis.call("SET", KEYS[11], ARGV[7], "EX", ARGV[6])
redis.call("SET", KEYS[1], ARGV[7], "EX", ARGV[6], "NX")
redis.call("SET", KEYS[9], ARGV[7], "EX", ARGV[6])
redis.call("ZADD", KEYS[3], ARGV[8], ARGV[7])
redis.call("EXPIRE", KEYS[3], ARGV[6])
redis.call("ZADD", KEYS[4], ARGV[8], ARGV[7])
redis.call("EXPIRE", KEYS[4], ARGV[6])
redis.call("ZADD", KEYS[6], ARGV[8], ARGV[7])
redis.call("EXPIRE", KEYS[6], ARGV[6])
redis.call("ZREMRANGEBYRANK", KEYS[6], 0, -tonumber(ARGV[9]) - 1)
local queue_position = redis.call("RPUSH", KEYS[7], ARGV[7])
redis.call("EXPIRE", KEYS[7], ARGV[6])
redis.call("RPUSH", KEYS[8], ARGV[10])
redis.call("EXPIRE", KEYS[8], ARGV[6])
return { "created", tostring(queue_position) }
`;

function parseEvalArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		throw new Error("Redis task-enqueue script returned a non-array response");
	}
	return value.map((item) => String(item));
}

export class CodexTaskEnqueueStore {
	constructor(
		private readonly redis: IORedis,
		private readonly config: CodexQueueConfig,
		private readonly dependencies: CodexTaskEnqueueStoreDependencies,
	) {}

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

	private sessionLatestTaskKey(userId: string, sessionId: string): string {
		return `tapcanvas:codex:session-latest:${this.userToken(userId)}:${codexRedisKeyToken(sessionId)}`;
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

	private bridgeQueueKey(userId: string, bridgeId: string): string {
		return `tapcanvas:codex:queue:${this.userToken(userId)}:${this.bridgeToken(bridgeId)}`;
	}

	private previewTaskKey(userId: string, previewId: string): string {
		return `tapcanvas:codex:preview:${this.userToken(userId)}:${codexRedisKeyToken(previewId)}`;
	}

	async enqueue(input: {
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
		const taskId = randomUUID();
		const previewId = `${randomUUID()}${randomUUID()}`.replaceAll("-", "");
		const {
			graph: _graph,
			selectedNodes: _selectedNodes,
			...context
		} = input.contextSnapshot;
		const task: CodexTask = CodexTaskSchema.parse({
			protocolVersion: CODEX_TASK_PROTOCOL_VERSION,
			id: taskId,
			sessionId: input.sessionId,
			parentTaskId: input.parentTaskId,
			turnSequence: input.turnSequence,
			resumeThreadId: input.resumeThreadId,
			userId: input.userId,
			bridgeId: input.request.bridgeId,
			workspaceId: input.request.workspaceId,
			workspaceConfigFingerprint: input.workspaceConfigFingerprint,
			goal: input.request.goal,
			context,
			fallbackPolicy: input.request.fallbackPolicy,
			state: "queued",
			previewId,
			idempotencyKey: input.request.idempotencyKey,
			createdAt: input.nowIso,
			updatedAt: input.nowIso,
			terminalAt: null,
			lastMessage: "任务已进入持久队列",
			expectedDelivery: {
				kind: "workspace_change_with_verified_preview",
				workspaceId: input.request.workspaceId,
				requiredEvidence: ["codex_turn", "tests", "build", "preview"],
			},
			deliveryEvidence: {
				source: null,
				codex: null,
				build: null,
				preview: null,
			},
			deliveryVerification: {
				status: "pending",
				checkedAt: null,
				missingCriteria: ["codex_turn", "tests", "build", "preview"],
				rationale: "等待宿主机 Codex 与隔离构建执行证据。",
			},
		});
		const event = CodexTaskEventSchema.parse({
			id: randomUUID(),
			taskId,
			state: "queued",
			code: "task_queued",
			message: task.lastMessage,
			at: input.nowIso,
		});
		const userToken = this.userToken(input.userId);
		const rateWindow = Math.floor(input.nowMs / 1_000);
		const pruneBeforeMs = input.nowMs - this.config.taskTtlSeconds * 1_000;
		const result = parseEvalArray(
			await this.redis.eval(
				ENQUEUE_SCRIPT,
				11,
				`tapcanvas:codex:idempotency:${userToken}:${codexRedisKeyToken(input.request.idempotencyKey)}`,
				`tapcanvas:codex:rate:${userToken}:${rateWindow}`,
				this.userActiveKey(input.userId),
				this.globalActiveKey(),
				this.taskKey(taskId),
				this.userRecentKey(input.userId),
				this.bridgeQueueKey(input.userId, input.request.bridgeId),
				this.taskEventKey(taskId),
				this.previewTaskKey(input.userId, previewId),
				this.contextSnapshotKey(input.contextSnapshot.snapshotId),
				this.sessionLatestTaskKey(input.userId, input.sessionId),
				String(this.config.enqueueQps),
				String(pruneBeforeMs),
				String(this.config.maxQueueDepthPerUser),
				String(this.config.maxQueueDepthGlobal),
				JSON.stringify(task),
				String(this.config.taskTtlSeconds),
				taskId,
				String(input.nowMs),
				String(this.config.recentTaskLimit),
				JSON.stringify(event),
				input.parentTaskId ?? "",
				JSON.stringify(input.contextSnapshot),
			),
		);
		switch (result[0]) {
			case "created":
				return {
					kind: "created",
					task,
					queuePosition: Number(result[1] || "1"),
				};
			case "deduplicated": {
				const existing = await this.dependencies.getTask(
					input.userId,
					result[1] || "",
				);
				if (!existing) {
					throw new Error(
						"Codex idempotency record exists but the task record is missing",
					);
				}
				return { kind: "deduplicated", task: existing };
			}
			case "rate_limited":
				return { kind: "rate_limited", retryAfterSeconds: 1 };
			case "user_queue_full":
				return { kind: "user_queue_full" };
			case "global_queue_full":
				return { kind: "global_queue_full" };
			case "session_conflict":
				return {
					kind: "session_conflict",
					latestTaskId: result[1] || null,
				};
			default:
				throw new Error(
					`Unknown Codex enqueue result: ${result.join(",")}`,
				);
		}
	}
}
