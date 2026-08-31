import IORedis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	CODEX_TASK_PROTOCOL_VERSION,
	type CodexCanvasContextSnapshot,
} from "@tapcanvas/codex-task-protocol";
import { CodexPairingStore } from "./codex-pairing-store";
import { CodexQueueStore } from "./codex-queue-store";
import type { CodexQueueConfig } from "./codex-queue-config";

const redisUrl = String(process.env.CODEX_REDIS_TEST_URL || "").trim();
const isolatedRedis = describe.skipIf(!redisUrl);

isolatedRedis("Codex Redis queue and pairing integration", () => {
	let redis: IORedis;
	let queue: CodexQueueStore;

	const config: CodexQueueConfig = {
		enqueueQps: 1,
		maxQueueDepthPerUser: 10,
		maxQueueDepthGlobal: 100,
		bridgeOnlineTtlSeconds: 60,
		taskTtlSeconds: 60,
		leaseTtlMs: 10_000,
		recentTaskLimit: 20,
	};
	const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	const userId = `redis-user-${suffix}`;
	const bridgeId = `bridge-${suffix}`;
	const workerInstanceId = `worker-${suffix}`;
	const workspaceId = `workspace-${suffix}`.slice(0, 80);
	const now = new Date();

	function contextSnapshot(
		sessionToken: string,
	): CodexCanvasContextSnapshot {
		return {
			snapshotId: `snapshot-${sessionToken}`,
			projectId: `project-${suffix}`,
			flowId: null,
			chapterId: null,
			canvasRevision: null,
			selectedNodeIds: [],
			selectedNodeKinds: [],
			projectName: "Redis integration project",
			flowName: null,
			nodeCount: 0,
			edgeCount: 0,
			sha256: "c".repeat(64),
			createdAt: now.toISOString(),
			graph: { nodes: [], edges: [], viewport: null },
			selectedNodes: [],
		};
	}

	beforeAll(() => {
		redis = new IORedis(redisUrl, {
			maxRetriesPerRequest: 1,
			enableReadyCheck: true,
		});
		queue = new CodexQueueStore(redis, config);
	});

	afterAll(async () => {
		await redis.quit();
	});

	it("consumes a pairing code exactly once", async () => {
		const pairing = new CodexPairingStore(redis);
		const created = await pairing.create(userId, now);
		const consumed = await pairing.consume(created.pairingCode);

		expect(consumed?.userId).toBe(userId);
		expect(await pairing.consume(created.pairingCode)).toBeNull();
	});

	it("deduplicates before QPS, leases one task, and releases on terminal state", async () => {
		await queue.registerBridge(
			userId,
			{
				protocolVersion: CODEX_TASK_PROTOCOL_VERSION,
				bridgeId,
				workerInstanceId,
				name: "Redis integration bridge",
				workerVersion: "0.3.0",
				codexVersion: "codex-test",
				workspaces: [
					{
						id: workspaceId,
						label: "Redis integration workspace",
						configFingerprint: "f".repeat(64),
						remoteBuildConfigured: true,
						localDockerConfigured: false,
					},
				],
			},
			now.toISOString(),
		);
		const request = {
			bridgeId,
			workspaceId,
			sessionId: null,
			parentTaskId: null,
			goal: "Implement the production request",
			context: {
				projectId: `project-${suffix}`,
				flowId: null,
				chapterId: null,
				canvasRevision: null,
				selectedNodeIds: [],
			},
			fallbackPolicy: "disabled" as const,
			idempotencyKey: `idem-${suffix}`,
		};
		const firstSessionId = `session-first-${suffix}`;
		const firstContextSnapshot = contextSnapshot(firstSessionId);
		const created = await queue.enqueueTask({
			userId,
			request,
			sessionId: firstSessionId,
			parentTaskId: null,
			turnSequence: 1,
			resumeThreadId: null,
			contextSnapshot: firstContextSnapshot,
			workspaceConfigFingerprint: "f".repeat(64),
			nowIso: now.toISOString(),
			nowMs: now.getTime(),
		});
		expect(created.kind).toBe("created");
		if (created.kind !== "created") throw new Error("task was not created");

		const duplicate = await queue.enqueueTask({
			userId,
			request,
			sessionId: firstSessionId,
			parentTaskId: null,
			turnSequence: 1,
			resumeThreadId: null,
			contextSnapshot: firstContextSnapshot,
			workspaceConfigFingerprint: "f".repeat(64),
			nowIso: now.toISOString(),
			nowMs: now.getTime(),
		});
		expect(duplicate.kind).toBe("deduplicated");
		if (duplicate.kind !== "deduplicated") {
			throw new Error("task was not deduplicated");
		}
		expect(duplicate.task.id).toBe(created.task.id);

		const secondSessionId = `session-second-${suffix}`;
		const rateLimited = await queue.enqueueTask({
			userId,
			request: {
				...request,
				idempotencyKey: `idem-second-${suffix}`,
			},
			sessionId: secondSessionId,
			parentTaskId: null,
			turnSequence: 1,
			resumeThreadId: null,
			contextSnapshot: contextSnapshot(secondSessionId),
			workspaceConfigFingerprint: "f".repeat(64),
			nowIso: now.toISOString(),
			nowMs: now.getTime(),
		});
		expect(rateLimited.kind).toBe("rate_limited");

		const claimed = await queue.claimTask({
			userId,
			bridgeId,
			workerInstanceId,
			nowIso: new Date(now.getTime() + 10).toISOString(),
			nowMs: now.getTime() + 10,
		});
		expect(claimed?.task.id).toBe(created.task.id);
		if (!claimed) throw new Error("task was not claimed");
		expect(claimed.contextSnapshot).toEqual(firstContextSnapshot);
		expect(
			await queue.claimTask({
				userId,
				bridgeId,
				workerInstanceId,
				nowIso: new Date(now.getTime() + 20).toISOString(),
				nowMs: now.getTime() + 20,
			}),
		).toBeNull();

		await queue.heartbeatLease({
			userId,
			taskId: claimed.task.id,
			bridgeId,
			workerInstanceId,
			leaseId: claimed.leaseId,
			nowIso: new Date(now.getTime() + 30).toISOString(),
		});
		await queue.updateTaskFromWorker({
			userId,
			taskId: claimed.task.id,
			bridgeId,
			workerInstanceId,
			leaseId: claimed.leaseId,
			state: "codex_running",
			code: "codex_started",
			message: "Codex started",
			nowIso: new Date(now.getTime() + 40).toISOString(),
		});
		expect(await queue.getBridgeActiveTaskId(userId, bridgeId)).toBe(
			claimed.task.id,
		);
		const steering = await queue.enqueueTaskMessage({
			userId,
			taskId: claimed.task.id,
			request: {
				text: "Use the compact layout.",
				idempotencyKey: `steer-${suffix}`,
			},
			nowIso: new Date(now.getTime() + 45).toISOString(),
		});
		expect(steering?.deduplicated).toBe(false);
		if (!steering) throw new Error("steering message was not created");
		const duplicateSteering = await queue.enqueueTaskMessage({
			userId,
			taskId: claimed.task.id,
			request: {
				text: "Use the compact layout.",
				idempotencyKey: `steer-${suffix}`,
			},
			nowIso: new Date(now.getTime() + 46).toISOString(),
		});
		expect(duplicateSteering?.message.id).toBe(steering.message.id);
		expect(duplicateSteering?.deduplicated).toBe(true);
		const claimedMessages = await queue.claimTaskMessages({
			userId,
			taskId: claimed.task.id,
			bridgeId,
			workerInstanceId,
			leaseId: claimed.leaseId,
			limit: 10,
		});
		expect(claimedMessages.map((message) => message.id)).toEqual([
			steering.message.id,
		]);
		const delivered = await queue.acknowledgeTaskMessage({
			userId,
			taskId: claimed.task.id,
			bridgeId,
			workerInstanceId,
			leaseId: claimed.leaseId,
			messageId: steering.message.id,
			state: "delivered",
			detail: "App Server accepted turn/steer",
			nowIso: new Date(now.getTime() + 48).toISOString(),
		});
		expect(delivered?.state).toBe("delivered");
		expect(await queue.listTaskMessages(userId, claimed.task.id)).toEqual([
			delivered,
		]);
		await queue.updateTaskFromWorker({
			userId,
			taskId: claimed.task.id,
			bridgeId,
			workerInstanceId,
			leaseId: claimed.leaseId,
			state: "codex_failed",
			code: "codex_failed",
			message: "Explicit test failure",
			nowIso: new Date(now.getTime() + 50).toISOString(),
		});
		expect(await queue.getBridgeActiveTaskId(userId, bridgeId)).toBeNull();
		expect(
			(await queue.listTaskEvents(userId, claimed.task.id)).map(
				(event) => event.state,
			),
		).toEqual(["queued", "claimed", "codex_running", "codex_failed"]);
	});
});
