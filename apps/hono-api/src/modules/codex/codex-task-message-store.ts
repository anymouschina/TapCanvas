import { randomUUID } from "node:crypto";
import type IORedis from "ioredis";
import type {
	CodexTask,
	CodexTaskMessage,
	CreateCodexTaskMessageRequest,
} from "@tapcanvas/codex-task-protocol";
import {
	CodexTaskMessageSchema,
} from "./codex.schemas";
import type { CodexQueueConfig } from "./codex-queue-config";
import { codexRedisKeyToken } from "./codex-redis-key";

export type EnqueueCodexTaskMessageResult = {
	message: CodexTaskMessage;
	deduplicated: boolean;
};

type ActiveLease = {
	taskId: string;
	leaseId: string;
	workerInstanceId: string;
};

type CodexTaskMessageStoreDependencies = {
	getTask: (userId: string, taskId: string) => Promise<CodexTask | null>;
	activeLeaseKey: (userId: string, bridgeId: string) => string;
	leaseConflict: (message: string) => Error;
};

const ENQUEUE_MESSAGE_SCRIPT = `
local existing_id = redis.call("GET", KEYS[1])
if existing_id then
  return { "deduplicated", existing_id }
end
local task_raw = redis.call("GET", KEYS[4])
if not task_raw then
  return { "task_missing" }
end
local task = cjson.decode(task_raw)
if task.state ~= "queued" and task.state ~= "claimed" and task.state ~= "codex_running" then
  return { "state_conflict", task.state }
end
redis.call("SET", KEYS[2], ARGV[1], "EX", ARGV[2])
redis.call("SET", KEYS[1], ARGV[3], "EX", ARGV[2])
redis.call("RPUSH", KEYS[3], ARGV[3])
redis.call("LTRIM", KEYS[3], -100, -1)
redis.call("EXPIRE", KEYS[3], ARGV[2])
return { "created", ARGV[3] }
`;

const ACK_MESSAGE_SCRIPT = `
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
  return { "message_missing" }
end
local current = cjson.decode(current_raw)
if current.taskId ~= ARGV[1] then
  return { "message_scope_mismatch" }
end
if current.state ~= "queued" then
  return { "already_final", current_raw }
end
local claim_owner = redis.call("GET", KEYS[3])
if not claim_owner or claim_owner ~= ARGV[3] then
  return { "claim_mismatch" }
end
redis.call("SET", KEYS[2], ARGV[4], "EX", ARGV[5])
redis.call("DEL", KEYS[3])
return { "updated" }
`;

function parseEvalArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		throw new Error("Redis task-message script returned a non-array response");
	}
	return value.map((item) => String(item));
}

function parseActiveLease(raw: string | null): ActiveLease | null {
	if (!raw) return null;
	const parsed = JSON.parse(raw) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
	const record = parsed as Record<string, unknown>;
	const taskId = typeof record.taskId === "string" ? record.taskId : "";
	const leaseId = typeof record.leaseId === "string" ? record.leaseId : "";
	const workerInstanceId =
		typeof record.workerInstanceId === "string"
			? record.workerInstanceId
			: "";
	if (!taskId || !leaseId || !workerInstanceId) return null;
	return { taskId, leaseId, workerInstanceId };
}

export class CodexTaskMessageStore {
	constructor(
		private readonly redis: IORedis,
		private readonly config: Pick<
			CodexQueueConfig,
			"taskTtlSeconds" | "leaseTtlMs"
		>,
		private readonly dependencies: CodexTaskMessageStoreDependencies,
	) {}

	private taskKey(taskId: string): string {
		return `tapcanvas:codex:task:${taskId}`;
	}

	private messageKey(messageId: string): string {
		return `tapcanvas:codex:message:${messageId}`;
	}

	private messageListKey(taskId: string): string {
		return `tapcanvas:codex:messages:${taskId}`;
	}

	private messageIdempotencyKey(
		userId: string,
		taskId: string,
		idempotencyKey: string,
	): string {
		return `tapcanvas:codex:message-idempotency:${codexRedisKeyToken(userId)}:${codexRedisKeyToken(taskId)}:${codexRedisKeyToken(idempotencyKey)}`;
	}

	private messageClaimKey(messageId: string): string {
		return `tapcanvas:codex:message-claim:${messageId}`;
	}

	async enqueue(input: {
		userId: string;
		taskId: string;
		request: CreateCodexTaskMessageRequest;
		nowIso: string;
	}): Promise<EnqueueCodexTaskMessageResult | null> {
		const task = await this.dependencies.getTask(input.userId, input.taskId);
		if (!task) return null;
		if (
			task.state !== "queued" &&
			task.state !== "claimed" &&
			task.state !== "codex_running"
		) {
			throw this.dependencies.leaseConflict(
				`Codex task ${task.id} is no longer accepting steering messages`,
			);
		}
		const messageId = randomUUID();
		const message = CodexTaskMessageSchema.parse({
			id: messageId,
			taskId: task.id,
			sessionId: task.sessionId,
			text: input.request.text,
			state: "queued",
			idempotencyKey: input.request.idempotencyKey,
			createdAt: input.nowIso,
			deliveredAt: null,
			detail: "等待本机 Codex 确认接收",
		});
		const result = parseEvalArray(
			await this.redis.eval(
				ENQUEUE_MESSAGE_SCRIPT,
				4,
				this.messageIdempotencyKey(
					input.userId,
					input.taskId,
					input.request.idempotencyKey,
				),
				this.messageKey(messageId),
				this.messageListKey(input.taskId),
				this.taskKey(input.taskId),
				JSON.stringify(message),
				String(this.config.taskTtlSeconds),
				messageId,
			),
		);
		if (result[0] === "created") {
			return { message, deduplicated: false };
		}
		if (result[0] === "task_missing") return null;
		if (result[0] === "state_conflict") {
			throw this.dependencies.leaseConflict(
				`Codex task ${task.id} stopped accepting steering messages in state ${result[1] || "unknown"}`,
			);
		}
		if (result[0] !== "deduplicated") {
			throw new Error(
				`Unknown Codex steering enqueue result: ${result.join(",")}`,
			);
		}
		const existingRaw = await this.redis.get(
			this.messageKey(result[1] || ""),
		);
		if (!existingRaw) {
			throw new Error(
				"Codex steering idempotency record exists but its message is missing",
			);
		}
		return {
			message: CodexTaskMessageSchema.parse(
				JSON.parse(existingRaw) as unknown,
			),
			deduplicated: true,
		};
	}

	async list(
		userId: string,
		taskId: string,
	): Promise<CodexTaskMessage[] | null> {
		const task = await this.dependencies.getTask(userId, taskId);
		if (!task) return null;
		const ids = await this.redis.lrange(this.messageListKey(taskId), 0, -1);
		if (ids.length === 0) return [];
		const raws = await this.redis.mget(
			...ids.map((id) => this.messageKey(id)),
		);
		return raws.flatMap((raw) =>
			raw
				? [CodexTaskMessageSchema.parse(JSON.parse(raw) as unknown)]
				: [],
		);
	}

	private async assertActiveLease(input: {
		userId: string;
		taskId: string;
		bridgeId: string;
		workerInstanceId: string;
		leaseId: string;
	}): Promise<void> {
		const active = parseActiveLease(
			await this.redis.get(
				this.dependencies.activeLeaseKey(input.userId, input.bridgeId),
			),
		);
		if (
			!active ||
			active.taskId !== input.taskId ||
			active.leaseId !== input.leaseId ||
			active.workerInstanceId !== input.workerInstanceId
		) {
			throw this.dependencies.leaseConflict(
				"Codex steering message lease is missing or does not match",
			);
		}
	}

	async claim(input: {
		userId: string;
		taskId: string;
		bridgeId: string;
		workerInstanceId: string;
		leaseId: string;
		limit: number;
	}): Promise<CodexTaskMessage[]> {
		await this.assertActiveLease(input);
		const task = await this.dependencies.getTask(input.userId, input.taskId);
		if (!task || task.state !== "codex_running") return [];
		const ids = await this.redis.lrange(
			this.messageListKey(input.taskId),
			0,
			-1,
		);
		const claimed: CodexTaskMessage[] = [];
		for (const id of ids) {
			if (claimed.length >= input.limit) break;
			const raw = await this.redis.get(this.messageKey(id));
			if (!raw) continue;
			const message = CodexTaskMessageSchema.parse(
				JSON.parse(raw) as unknown,
			);
			if (message.state !== "queued") continue;
			const didClaim = await this.redis.set(
				this.messageClaimKey(message.id),
				input.workerInstanceId,
				"PX",
				this.config.leaseTtlMs,
				"NX",
			);
			if (didClaim === "OK") claimed.push(message);
		}
		return claimed;
	}

	async acknowledge(input: {
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
		const raw = await this.redis.get(this.messageKey(input.messageId));
		if (!raw) return null;
		const current = CodexTaskMessageSchema.parse(
			JSON.parse(raw) as unknown,
		);
		if (current.taskId !== input.taskId) return null;
		const next = CodexTaskMessageSchema.parse({
			...current,
			state: input.state,
			deliveredAt: input.nowIso,
			detail: input.detail,
		});
		const result = parseEvalArray(
			await this.redis.eval(
				ACK_MESSAGE_SCRIPT,
				3,
				this.dependencies.activeLeaseKey(input.userId, input.bridgeId),
				this.messageKey(input.messageId),
				this.messageClaimKey(input.messageId),
				input.taskId,
				input.leaseId,
				input.workerInstanceId,
				JSON.stringify(next),
				String(this.config.taskTtlSeconds),
			),
		);
		if (result[0] === "message_missing") return null;
		if (result[0] === "already_final") {
			return CodexTaskMessageSchema.parse(
				JSON.parse(result[1] || "{}") as unknown,
			);
		}
		if (result[0] !== "updated") {
			throw this.dependencies.leaseConflict(
				`Codex steering acknowledgement rejected: ${result.join(",")}`,
			);
		}
		return next;
	}

	async rejectQueued(
		taskId: string,
		nowIso: string,
		detail: string,
	): Promise<void> {
		const ids = await this.redis.lrange(this.messageListKey(taskId), 0, -1);
		if (ids.length === 0) return;
		const raws = await this.redis.mget(
			...ids.map((id) => this.messageKey(id)),
		);
		const multi = this.redis.multi();
		let changed = 0;
		for (const raw of raws) {
			if (!raw) continue;
			const current = CodexTaskMessageSchema.parse(
				JSON.parse(raw) as unknown,
			);
			if (current.state !== "queued") continue;
			const rejected = CodexTaskMessageSchema.parse({
				...current,
				state: "rejected",
				deliveredAt: nowIso,
				detail,
			});
			multi.set(
				this.messageKey(rejected.id),
				JSON.stringify(rejected),
				"EX",
				this.config.taskTtlSeconds,
			);
			multi.del(this.messageClaimKey(rejected.id));
			changed += 1;
		}
		if (changed > 0) await multi.exec();
	}
}
