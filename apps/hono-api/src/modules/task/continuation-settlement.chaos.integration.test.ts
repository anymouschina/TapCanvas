import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
	createContinuationSettlementRecord,
	findTerminalContinuationSettlementForPublicTurn,
	parseContinuationSettlementRecord,
} from "./agents-continuation-settlement";
import {
	ASYNC_AGENT_CONTINUATION_PROVIDER,
	type AsyncAgentContinuation,
} from "./async-agent-continuation";
import {
	buildAsyncAgentContinuationQueueJobId,
	type AsyncAgentContinuationQueueJob,
} from "./async-agent-continuation.queue";
import { makeQueueConnection, QUEUE_NAMES } from "./queues";
import type { AppContext } from "../../types";

const execFileAsync = promisify(execFile);
const databaseUrl = String(process.env.CONTINUATION_CHAOS_DATABASE_URL ?? "").trim();
const redisUrl = String(process.env.CONTINUATION_CHAOS_REDIS_URL ?? "").trim();
const isolatedChaos = describe.skipIf(!databaseUrl || !redisUrl);

function assertIsolatedDatabase(url: string): void {
	const name = new URL(url).pathname.replace(/^\/+/, "");
	if (!/(?:chaos|test)/i.test(name)) {
		throw new Error("CONTINUATION_CHAOS_DATABASE_URL must name an isolated chaos/test database");
	}
}

function assertIsolatedRedis(url: string): void {
	const parsed = new URL(url);
	const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
	if (!local || parsed.port === "6379") {
		throw new Error("CONTINUATION_CHAOS_REDIS_URL must use an isolated loopback Redis on a non-default port");
	}
}

isolatedChaos("continuation settlement cross-process chaos recovery", () => {
	const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	const rootRequestId = `turn-chaos-${suffix}`;
	const continuation: AsyncAgentContinuation = {
		id: `continuation-chaos-${suffix}`,
		rootRequestId,
		stage: 1,
		resumeTrigger: "physical_budget",
		parentContinuationId: null,
		userId: `user-chaos-${suffix}`,
		projectId: `project-chaos-${suffix}`,
		flowId: `flow-chaos-${suffix}`,
		chapterId: null,
		bookId: null,
		canvasNodeId: null,
		executionToolPolicy: null,
		sessionKey: `session-chaos-${suffix}`,
		modelKey: null,
		modelAlias: null,
		requiredSkills: [],
		dependencyNodeIds: [],
		dependencyTaskIds: [],
		dependencyRunIds: [],
		handledArtifactIds: [`root_physical_run:run-chaos-${suffix}:1`],
		progressFingerprint: `fingerprint-chaos-${suffix}`,
		expectedDelivery: { active: true },
		createdAt: new Date().toISOString(),
		attempt: 0,
		nextAttemptAt: null,
		lastFailure: null,
	};
	const effectId = `continuation-registration:${rootRequestId}:${continuation.id}`;
	const driftRootRequestId = `turn-chaos-drift-${suffix}`;
	const driftContinuation: AsyncAgentContinuation = {
		...continuation,
		id: `continuation-chaos-drift-${suffix}`,
		rootRequestId: driftRootRequestId,
		sessionKey: `session-chaos-drift-${suffix}`,
		handledArtifactIds: [`root_physical_run:run-chaos-drift-${suffix}:1`],
		progressFingerprint: `fingerprint-chaos-drift-${suffix}`,
	};
	const driftEffectId = `continuation-registration:${driftRootRequestId}:${driftContinuation.id}`;
	const missingCapsuleTurnId = `turn-chaos-missing-capsule-${suffix}`;
	const missingCapsuleEffectId = `continuation-registration:${missingCapsuleTurnId}:missing-capsule-${suffix}`;
	let db: PrismaClient;
	let queue: Queue<AsyncAgentContinuationQueueJob>;

	beforeAll(async () => {
		assertIsolatedDatabase(databaseUrl);
		assertIsolatedRedis(redisUrl);
		db = new PrismaClient({ datasourceUrl: databaseUrl });
		queue = new Queue<AsyncAgentContinuationQueueJob>(QUEUE_NAMES.asyncAgentContinuation, {
			connection: makeQueueConnection(redisUrl),
		});
		const nowIso = new Date().toISOString();
		await db.users.create({
			data: {
				id: continuation.userId,
				login: `continuation-chaos-${suffix}`,
				name: "Continuation chaos fixture",
				created_at: nowIso,
				updated_at: nowIso,
			},
		});
		const record = createContinuationSettlementRecord({
			effectId,
			userId: continuation.userId,
			logicalTaskId: rootRequestId,
			publicTurnId: rootRequestId,
			nowIso,
			phase: "reconcile_required",
			lastError: "injected registration projection failure",
			recoveryCapsule: { version: 1, continuation },
		});
		await db.task_statuses.create({
			data: {
				id: crypto.randomUUID(),
				task_id: effectId,
				provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
				user_id: continuation.userId,
				status: "waiting",
				data: JSON.stringify(record),
				created_at: nowIso,
				updated_at: nowIso,
				completed_at: null,
			},
		});
	});

	afterAll(async () => {
		await queue?.obliterate({ force: true });
		await queue?.close();
		await db?.task_statuses.deleteMany({
			where: {
				task_id: {
					in: [
						effectId,
						continuation.id,
						driftEffectId,
						driftContinuation.id,
						missingCapsuleEffectId,
					],
				},
			},
		});
		await db?.execution_traces.deleteMany({
			where: { id: { in: [driftRootRequestId, missingCapsuleTurnId] } },
		});
		await db?.users.deleteMany({ where: { id: continuation.userId } });
		await db?.$disconnect();
	});

	async function runWorker(
		mode: "fail_after_registration" | "recover",
		targetEffectId = effectId,
	): Promise<Record<string, unknown>> {
		const vitestPath = path.resolve(process.cwd(), "node_modules/.bin/vitest");
		const fixturePath = path.resolve(
			process.cwd(),
			"src/modules/task/continuation-settlement-chaos-worker.fixture.test.ts",
		);
		const { stdout } = await execFileAsync(vitestPath, [
			"run",
			fixturePath,
			"--reporter=dot",
		], {
			cwd: process.cwd(),
			env: {
				...process.env,
				CONTINUATION_CHAOS_DATABASE_URL: databaseUrl,
				CONTINUATION_CHAOS_REDIS_URL: redisUrl,
				CONTINUATION_CHAOS_EFFECT_ID: targetEffectId,
				CONTINUATION_CHAOS_MODE: mode,
			},
		});
		const marker = "CONTINUATION_CHAOS_RESULT ";
		const line = stdout.trim().split("\n").find((candidate) => candidate.includes(marker));
		if (!line) throw new Error("chaos worker produced no result");
		return JSON.parse(line.slice(line.indexOf(marker) + marker.length)) as Record<string, unknown>;
	}

	it("survives a process boundary after DB success / queue failure and publishes once", async () => {
		const failed = await runWorker("fail_after_registration");
		expect(failed).toMatchObject({ outcome: "reconcile_required", publicationAttempts: 1 });

		const afterFailure = await db.task_statuses.findUnique({
			where: { task_id_provider: { task_id: effectId, provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER } },
		});
		const durableContinuation = await db.task_statuses.findUnique({
			where: { task_id_provider: { task_id: continuation.id, provider: ASYNC_AGENT_CONTINUATION_PROVIDER } },
		});
		expect(afterFailure?.status).toBe("waiting");
		expect(durableContinuation?.status).toBe("waiting");
		expect(await queue.getJob(buildAsyncAgentContinuationQueueJobId(continuation))).toBeUndefined();

		const recovered = await runWorker("recover");
		expect(recovered).toMatchObject({ outcome: "settled", publicationAttempts: 1 });
		const settled = await db.task_statuses.findUnique({
			where: { task_id_provider: { task_id: effectId, provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER } },
		});
		expect(settled?.status).toBe("settled");
		expect(parseContinuationSettlementRecord(JSON.parse(settled?.data ?? "null"))?.phase).toBe("settled");

		const replay = await runWorker("recover");
		expect(replay).toMatchObject({ outcome: "not_claimed" });
		const jobs = await queue.getJobs(["wait", "delayed", "active", "completed", "failed"]);
		expect(jobs.filter((job) => job.id === buildAsyncAgentContinuationQueueJobId(continuation))).toHaveLength(1);
	});

	it("terminalizes deterministic identity drift once without publishing a continuation job", async () => {
		const nowIso = new Date().toISOString();
		const record = createContinuationSettlementRecord({
			effectId: driftEffectId,
			userId: driftContinuation.userId,
			logicalTaskId: driftRootRequestId,
			publicTurnId: driftRootRequestId,
			nowIso,
			phase: "reconcile_required",
			lastError: "injected deterministic identity drift",
			recoveryCapsule: { version: 1, continuation: driftContinuation },
		});
		await db.execution_traces.create({
			data: {
				id: driftRootRequestId,
				user_id: driftContinuation.userId,
				scope_type: "project",
				scope_id: driftContinuation.projectId ?? "project-chaos",
				request_kind: "public_agents_chat",
				input_summary: "continuation settlement deterministic chaos fixture",
				created_at: nowIso,
				status: "waiting_async",
				started_at: nowIso,
				updated_at: nowIso,
			},
		});
		await db.task_statuses.createMany({
			data: [{
				id: crypto.randomUUID(),
				task_id: driftContinuation.id,
				provider: ASYNC_AGENT_CONTINUATION_PROVIDER,
				user_id: driftContinuation.userId,
				status: "waiting",
				data: JSON.stringify({ ...driftContinuation, sessionKey: "drifted-session" }),
				created_at: nowIso,
				updated_at: nowIso,
				completed_at: null,
			}, {
				id: crypto.randomUUID(),
				task_id: driftEffectId,
				provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
				user_id: driftContinuation.userId,
				status: "waiting",
				data: JSON.stringify(record),
				created_at: nowIso,
				updated_at: nowIso,
				completed_at: null,
			}],
		});

		const failed = await runWorker("recover", driftEffectId);
		expect(failed).toMatchObject({ outcome: "failed", publicationAttempts: 0 });
		const settlement = await db.task_statuses.findUnique({
			where: {
				task_id_provider: {
					task_id: driftEffectId,
					provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
				},
			},
		});
		const parsed = parseContinuationSettlementRecord(JSON.parse(settlement?.data ?? "null") as unknown);
		expect(settlement?.status).toBe("failed");
		expect(parsed).toMatchObject({
			phase: "failed",
			terminalBoundary: {
				code: "continuation_settlement_registration_identity_drift",
				safePathsExhausted: true,
			},
		});
		const trace = await db.execution_traces.findUnique({ where: { id: driftRootRequestId } });
		expect(trace).toMatchObject({
			status: "failed",
			error_code: "continuation_settlement_registration_identity_drift",
		});
		await expect(findTerminalContinuationSettlementForPublicTurn({
			c: { env: { DB: db } } as unknown as AppContext,
			userId: driftContinuation.userId,
			publicTurnId: driftRootRequestId,
		})).resolves.toMatchObject({ effectId: driftEffectId, phase: "failed" });
		expect(await queue.getJob(buildAsyncAgentContinuationQueueJobId(driftContinuation))).toBeUndefined();

		const replay = await runWorker("recover", driftEffectId);
		expect(replay).toMatchObject({ outcome: "not_claimed" });
	});

	it("terminalizes a valid settlement that lost its recovery capsule instead of leaving the turn suspended", async () => {
		const nowIso = new Date().toISOString();
		const record = createContinuationSettlementRecord({
			effectId: missingCapsuleEffectId,
			userId: continuation.userId,
			logicalTaskId: missingCapsuleTurnId,
			publicTurnId: missingCapsuleTurnId,
			nowIso,
			phase: "reconcile_required",
			lastError: "injected missing recovery capsule",
		});
		await db.execution_traces.create({
			data: {
				id: missingCapsuleTurnId,
				user_id: continuation.userId,
				scope_type: "project",
				scope_id: continuation.projectId ?? "project-chaos",
				request_kind: "public_agents_chat",
				input_summary: "continuation settlement missing capsule fixture",
				created_at: nowIso,
				status: "waiting_async",
				started_at: nowIso,
				updated_at: nowIso,
			},
		});
		await db.task_statuses.create({
			data: {
				id: crypto.randomUUID(),
				task_id: missingCapsuleEffectId,
				provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
				user_id: continuation.userId,
				status: "waiting",
				data: JSON.stringify(record),
				created_at: nowIso,
				updated_at: nowIso,
				completed_at: null,
			},
		});

		const failed = await runWorker("recover", missingCapsuleEffectId);
		expect(failed).toMatchObject({ outcome: "failed", publicationAttempts: 0 });
		const settlement = await db.task_statuses.findUnique({
			where: {
				task_id_provider: {
					task_id: missingCapsuleEffectId,
					provider: AGENTS_CONTINUATION_SETTLEMENT_PROVIDER,
				},
			},
		});
		const parsed = parseContinuationSettlementRecord(JSON.parse(settlement?.data ?? "null") as unknown);
		expect(settlement?.status).toBe("failed");
		expect(parsed).toMatchObject({
			phase: "failed",
			terminalBoundary: {
				code: "continuation_settlement_contract_invalid",
				safePathsExhausted: true,
			},
		});
		const trace = await db.execution_traces.findUnique({ where: { id: missingCapsuleTurnId } });
		expect(trace).toMatchObject({
			status: "failed",
			error_code: "continuation_settlement_contract_invalid",
		});
		await expect(findTerminalContinuationSettlementForPublicTurn({
			c: { env: { DB: db } } as unknown as AppContext,
			userId: continuation.userId,
			publicTurnId: missingCapsuleTurnId,
		})).resolves.toMatchObject({ effectId: missingCapsuleEffectId, phase: "failed" });
		expect(await runWorker("recover", missingCapsuleEffectId)).toMatchObject({ outcome: "not_claimed" });
	});
});
