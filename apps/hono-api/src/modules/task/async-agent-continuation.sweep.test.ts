import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";

const mocks = vi.hoisted(() => ({
	listTaskStatusesByProvider: vi.fn(),
	listWaitingTaskStatusesForFairSweep: vi.fn(),
	touchWaitingTaskStatuses: vi.fn(),
	failWaitingTaskStatus: vi.fn(),
	requeueStaleClaimedTaskStatuses: vi.fn(),
	tryClaimFailedTaskStatusForExplicitResume: vi.fn(),
	tryReclaimClaimedTaskStatusForExplicitResume: vi.fn(),
	tryClaimTaskStatus: vi.fn(),
	tryCancelActiveTaskStatus: vi.fn(),
	transitionClaimedTaskStatus: vi.fn(),
	upsertTaskStatus: vi.fn(),
	createTaskStatusIfAbsent: vi.fn(),
	getTaskStatusByIdentity: vi.fn(),
	getFlowByIdUnsafe: vi.fn(),
	loadChapterCanvasAsFlowRow: vi.fn(),
	getVideoRun: vi.fn(),
	getWorkflowExecutionFamilyPageForOwner: vi.fn(),
	listNodeRunsForExecutionOwner: vi.fn(),
	getTaskResultByTaskId: vi.fn(),
	settleClaimedAssetRepairContinuation: vi.fn(),
	interruptAgentsChatTurn: vi.fn(),
}));

vi.mock("./task-status.repo", () => ({
	listTaskStatusesByProvider: mocks.listTaskStatusesByProvider,
	listWaitingTaskStatusesForFairSweep: mocks.listWaitingTaskStatusesForFairSweep,
	touchWaitingTaskStatuses: mocks.touchWaitingTaskStatuses,
	failWaitingTaskStatus: mocks.failWaitingTaskStatus,
	requeueStaleClaimedTaskStatuses: mocks.requeueStaleClaimedTaskStatuses,
	tryClaimFailedTaskStatusForExplicitResume: mocks.tryClaimFailedTaskStatusForExplicitResume,
	tryReclaimClaimedTaskStatusForExplicitResume: mocks.tryReclaimClaimedTaskStatusForExplicitResume,
	tryClaimTaskStatus: mocks.tryClaimTaskStatus,
	tryCancelActiveTaskStatus: mocks.tryCancelActiveTaskStatus,
	transitionClaimedTaskStatus: mocks.transitionClaimedTaskStatus,
	upsertTaskStatus: mocks.upsertTaskStatus,
	createTaskStatusIfAbsent: mocks.createTaskStatusIfAbsent,
	getTaskStatusByIdentity: mocks.getTaskStatusByIdentity,
}));

vi.mock("../flow/flow.repo", () => ({
	getFlowByIdUnsafe: mocks.getFlowByIdUnsafe,
	mapFlowRowToDto: (row: { data: string }) => {
		const data: unknown = JSON.parse(row.data);
		return { data };
	},
}));

vi.mock("./agents-tool-bridge.chapter-canvas-write", () => ({
	loadChapterCanvasAsFlowRow: mocks.loadChapterCanvasAsFlowRow,
}));

vi.mock("./video-run.repo", () => ({
	getVideoRun: mocks.getVideoRun,
}));

vi.mock("../execution/execution.family-store", () => ({
	getWorkflowExecutionFamilyPageForOwner: mocks.getWorkflowExecutionFamilyPageForOwner,
}));

vi.mock("../execution/execution.repo", () => ({
	listNodeRunsForExecutionOwner: mocks.listNodeRunsForExecutionOwner,
}));

vi.mock("./task-result.repo", () => ({
	getTaskResultByTaskId: mocks.getTaskResultByTaskId,
}));

vi.mock("./video-orchestrator.authoring.repo", () => ({
	settleClaimedAssetRepairContinuation: mocks.settleClaimedAssetRepairContinuation,
}));

vi.mock("./task.agents-chat-runtime", () => ({
	interruptAgentsChatTurn: mocks.interruptAgentsChatTurn,
}));

import {
	claimReadyAsyncAgentContinuations,
	claimReadyAsyncAgentContinuationsAcrossFlows,
	claimSessionOrphanedPhysicalBudgetContinuation,
	claimSessionPhysicalBudgetContinuation,
	cancelActiveSessionAgentContinuations,
	deferOrFailAsyncAgentContinuation,
	ensureAsyncAgentContinuationRegistered,
	registerAsyncAgentContinuation,
	type AsyncAgentContinuation,
} from "./async-agent-continuation";

function createChapterContinuation(): AsyncAgentContinuation {
	return {
		id: "async-continuation:chapter-stage",
		stage: 1,
		resumeTrigger: "dependency",
		parentContinuationId: null,
		userId: "user-1",
		projectId: "project-1",
		flowId: "project-flow-1",
		chapterId: "chapter-1",
		bookId: "book-1",
		canvasNodeId: "chapter-source-1",
		executionToolPolicy: null,
		sessionKey: "session-1",
		modelKey: "model-1",
		modelAlias: null,
		requiredSkills: [],
		artifactDependencies: [{
			version: 2,
			artifactId: "image:node:chapter-image-1",
			nodeId: "chapter-image-1",
			taskId: "task-1",
			runId: null,
		}],
		dependencyNodeIds: ["chapter-image-1"],
		dependencyTaskIds: ["task-1"],
		dependencyRunIds: [],
		handledArtifactIds: ["image:node:chapter-image-1"],
		progressFingerprint: "progress-1",
		expectedDelivery: { active: true, type: "video" },
		userIntentContract: {
			version: 1,
			contractHash: "intent-contract-1",
			must: [{ id: "m1", statement: "完整讲述本章", source: "user", evidence: ["用户原话"] }],
			forbid: [],
			prefer: [],
			confirmedFacts: [],
			unresolved: [],
			precedence: [],
		},
		createdAt: "2026-08-01T00:00:00.000Z",
		attempt: 0,
		nextAttemptAt: null,
		lastFailure: null,
	};
}

describe("async agent continuation durable sweep", () => {
	beforeEach(() => {
		mocks.listTaskStatusesByProvider.mockReset();
		mocks.listWaitingTaskStatusesForFairSweep.mockReset();
		mocks.listWaitingTaskStatusesForFairSweep.mockImplementation((db, input) =>
			mocks.listTaskStatusesByProvider(db, { ...input, status: "waiting" }));
		mocks.touchWaitingTaskStatuses.mockReset();
		mocks.touchWaitingTaskStatuses.mockResolvedValue(0);
		mocks.failWaitingTaskStatus.mockReset();
		mocks.failWaitingTaskStatus.mockResolvedValue(true);
		mocks.getWorkflowExecutionFamilyPageForOwner.mockReset();
		mocks.listNodeRunsForExecutionOwner.mockReset();
		mocks.listNodeRunsForExecutionOwner.mockResolvedValue([]);
		mocks.requeueStaleClaimedTaskStatuses.mockReset();
		mocks.requeueStaleClaimedTaskStatuses.mockResolvedValue(0);
		mocks.tryClaimTaskStatus.mockReset();
		mocks.tryCancelActiveTaskStatus.mockReset();
		mocks.transitionClaimedTaskStatus.mockReset();
		mocks.transitionClaimedTaskStatus.mockResolvedValue(true);
		mocks.tryClaimFailedTaskStatusForExplicitResume.mockReset();
		mocks.tryReclaimClaimedTaskStatusForExplicitResume.mockReset();
		mocks.upsertTaskStatus.mockReset();
		mocks.createTaskStatusIfAbsent.mockReset();
		mocks.createTaskStatusIfAbsent.mockResolvedValue(true);
		mocks.getTaskStatusByIdentity.mockReset();
		mocks.getTaskStatusByIdentity.mockResolvedValue(null);
		mocks.getFlowByIdUnsafe.mockReset();
		mocks.loadChapterCanvasAsFlowRow.mockReset();
		mocks.getVideoRun.mockReset();
		mocks.getTaskResultByTaskId.mockReset();
		mocks.settleClaimedAssetRepairContinuation.mockReset();
		mocks.settleClaimedAssetRepairContinuation.mockResolvedValue({
			terminalized: true,
			settledRunIds: [],
		});
		mocks.interruptAgentsChatTurn.mockReset();
		mocks.interruptAgentsChatTurn.mockResolvedValue({
			ok: true,
			interrupted: true,
			sessionId: "session-1",
			turnId: "public-chat-turn:root-1",
			status: null,
		});
	});

	it("terminalizes malformed durable contracts instead of scanning them forever", async () => {
		mocks.listTaskStatusesByProvider.mockResolvedValue([
			{
				task_id: "async-continuation:malformed",
				provider: "agents_async_continuation",
				user_id: "user-1",
				status: "waiting",
				data: "{invalid",
			},
		]);
		const c = { env: { DB: {} } } as unknown as AppContext;

		const result = await claimReadyAsyncAgentContinuationsAcrossFlows({ c });

		expect(result).toEqual({
			scanned: 1,
			recoveredClaims: 0,
			ready: 0,
			claimed: 0,
			failed: 1,
			continuations: [],
			errors: [
				{
					continuationId: "async-continuation:malformed",
					message: "persisted async continuation contract is malformed",
				},
			],
		});
		expect(mocks.failWaitingTaskStatus).toHaveBeenCalledWith(c.env.DB, {
			taskId: "async-continuation:malformed",
			provider: "agents_async_continuation",
			nowIso: expect.any(String),
		});
	});

	it("loads chapter canvas dependencies and claims them only after a real URL exists", async () => {
		const continuation = createChapterContinuation();
		mocks.listTaskStatusesByProvider.mockResolvedValue([
			{ data: JSON.stringify(continuation) },
		]);
		mocks.loadChapterCanvasAsFlowRow.mockResolvedValue({
			id: "chapter-1",
			name: "chapter-canvas",
			data: JSON.stringify({
				nodes: [
					{
						id: "chapter-image-1",
						data: {
							status: "success",
							imageUrl: "https://cdn.example/chapter-image.png",
						},
					},
				],
			}),
			owner_id: "user-1",
			project_id: "project-1",
			created_at: "2026-08-01T00:00:00.000Z",
			updated_at: "2026-08-01T00:01:00.000Z",
		});
		mocks.tryClaimTaskStatus.mockResolvedValue(true);
		const c = {
			env: {
				DB: {
					chapters: {
						findFirst: vi.fn().mockResolvedValue({ id: "chapter-1" }),
					},
				},
			},
		} as unknown as AppContext;

		const result = await claimReadyAsyncAgentContinuationsAcrossFlows({ c });

		expect(result).toEqual({
			scanned: 1,
			recoveredClaims: 0,
			ready: 0,
			claimed: 1,
			failed: 0,
			continuations: [{ ...continuation, claimToken: expect.any(String) }],
			errors: [],
		});
		expect(mocks.loadChapterCanvasAsFlowRow).toHaveBeenCalledWith(
			c,
			"user-1",
			"chapter-1",
			"project-1",
		);
	});

	it("terminalizes a dependency whose canvas node and persisted task receipt are both gone", async () => {
		const continuation: AsyncAgentContinuation = {
			...createChapterContinuation(),
			rootRequestId: "public-chat-turn:root-1",
			chapterId: null,
			flowId: "flow-1",
		};
		mocks.listTaskStatusesByProvider.mockResolvedValue([{ data: JSON.stringify(continuation) }]);
		mocks.getTaskResultByTaskId.mockResolvedValue(null);
		mocks.tryClaimTaskStatus.mockResolvedValue(true);
		const c = { env: { DB: {} } } as unknown as AppContext;

		const result = await claimReadyAsyncAgentContinuations({
			c,
			flowId: "flow-1",
			projectId: "project-1",
			nodeStates: new Map(),
		});

		expect(result).toEqual([]);
		expect(mocks.tryClaimTaskStatus).toHaveBeenCalledOnce();
		expect(mocks.interruptAgentsChatTurn).toHaveBeenCalledWith(
			c,
			"user-1",
			{
				sessionId: "session-1",
				turnId: "public-chat-turn:root-1",
				reasonCode: "async_dependency_terminal",
			},
			{ timeoutMs: 10_000 },
		);
		expect(mocks.settleClaimedAssetRepairContinuation).toHaveBeenCalledWith(
			expect.objectContaining({ continuationId: continuation.id, runs: [] }),
		);
	});

	it("releases the claim for a bounded retry when root terminal projection is temporarily unavailable", async () => {
		const continuation: AsyncAgentContinuation = {
			...createChapterContinuation(),
			rootRequestId: "public-chat-turn:root-1",
			chapterId: null,
			flowId: "flow-1",
		};
		mocks.listTaskStatusesByProvider.mockResolvedValue([{ data: JSON.stringify(continuation) }]);
		mocks.getTaskResultByTaskId.mockResolvedValue(null);
		mocks.tryClaimTaskStatus.mockResolvedValue(true);
		mocks.interruptAgentsChatTurn.mockRejectedValue(new Error("agents bridge starting"));
		const c = { env: { DB: {} } } as unknown as AppContext;

		const result = await claimReadyAsyncAgentContinuations({
			c,
			flowId: "flow-1",
			projectId: "project-1",
			nodeStates: new Map(),
		});

		expect(result).toEqual([]);
		expect(mocks.transitionClaimedTaskStatus).toHaveBeenCalledWith(
			c.env.DB,
			expect.objectContaining({
				taskId: continuation.id,
				status: "waiting",
				claimToken: expect.any(String),
				data: expect.objectContaining({
					lastFailure: expect.objectContaining({
						code: "root_terminal_projection_deferred",
						retryable: true,
					}),
				}),
			}),
		);
		const releasedData = mocks.transitionClaimedTaskStatus.mock.calls.at(-1)?.[1]?.data;
		expect(releasedData).not.toHaveProperty("claimToken");
		expect(mocks.settleClaimedAssetRepairContinuation).not.toHaveBeenCalled();
	});

	it("keeps waiting when the canvas node is gone but its accepted task is still running", async () => {
		const continuation: AsyncAgentContinuation = {
			...createChapterContinuation(),
			chapterId: null,
			flowId: "flow-1",
		};
		mocks.listTaskStatusesByProvider.mockResolvedValue([{ data: JSON.stringify(continuation) }]);
		mocks.getTaskResultByTaskId.mockResolvedValue({ status: "running" });
		const c = { env: { DB: {} } } as unknown as AppContext;

		const result = await claimReadyAsyncAgentContinuations({
			c,
			flowId: "flow-1",
			projectId: "project-1",
			nodeStates: new Map(),
		});

		expect(result).toEqual([]);
		expect(mocks.upsertTaskStatus).not.toHaveBeenCalled();
		expect(mocks.tryClaimTaskStatus).not.toHaveBeenCalled();
	});

	it("terminalizes the old continuation when a succeeded task lost its exact canvas target", async () => {
		const continuation: AsyncAgentContinuation = {
			...createChapterContinuation(),
			chapterId: null,
			flowId: "flow-1",
		};
		mocks.listTaskStatusesByProvider.mockResolvedValue([{ data: JSON.stringify(continuation) }]);
		mocks.getTaskResultByTaskId.mockResolvedValue({
			status: "succeeded",
			result: JSON.stringify({
				id: "task-1",
				kind: "text_to_image",
				status: "succeeded",
				assets: [{ type: "image", url: "https://assets.example/chapter-image-1.png" }],
				raw: null,
			}),
			node_id: "chapter-image-1",
			completed_at: "2026-08-01T00:02:00.000Z",
			updated_at: "2026-08-01T00:02:00.000Z",
		});
		mocks.tryClaimTaskStatus.mockResolvedValue(true);
		const c = { env: { DB: {} } } as unknown as AppContext;

		const result = await claimReadyAsyncAgentContinuations({
			c,
			flowId: "flow-1",
			projectId: "project-1",
			nodeStates: new Map(),
		});

		expect(result).toEqual([]);
		expect(mocks.tryClaimTaskStatus).toHaveBeenCalledOnce();
		expect(mocks.settleClaimedAssetRepairContinuation).toHaveBeenCalledWith(
			expect.objectContaining({ continuationId: continuation.id, runs: [] }),
		);
	});

	it("claims one reconciliation pass when the succeeded task still has its exact pending target", async () => {
		const continuation: AsyncAgentContinuation = {
			...createChapterContinuation(),
			chapterId: null,
			flowId: "flow-1",
		};
		mocks.listTaskStatusesByProvider.mockResolvedValue([{ data: JSON.stringify(continuation) }]);
		mocks.getTaskResultByTaskId.mockResolvedValue({
			status: "succeeded",
			result: JSON.stringify({
				id: "task-1",
				kind: "text_to_image",
				status: "succeeded",
				assets: [{ type: "image", url: "https://assets.example/chapter-image-1.png" }],
				raw: null,
			}),
			node_id: "chapter-image-1",
			completed_at: "2026-08-01T00:02:00.000Z",
			updated_at: "2026-08-01T00:02:00.000Z",
		});
		mocks.tryClaimTaskStatus.mockResolvedValue(true);
		const c = { env: { DB: {} } } as unknown as AppContext;

		const result = await claimReadyAsyncAgentContinuations({
			c,
			flowId: "flow-1",
			projectId: "project-1",
			nodeStates: new Map([["chapter-image-1", "pending"]]),
		});

		expect(result).toEqual([expect.objectContaining({
			...continuation,
			claimToken: expect.any(String),
			materializedArtifacts: [expect.objectContaining({
				artifactId: "image:node:chapter-image-1",
				taskId: "task-1",
				assetUrl: "https://assets.example/chapter-image-1.png",
			})],
		})]);
		expect(mocks.tryClaimTaskStatus).toHaveBeenCalledOnce();
		expect(mocks.upsertTaskStatus).not.toHaveBeenCalled();
	});

	it("resolves each node and task as one artifact tuple without cross-pairing parallel arrays", async () => {
		const continuation: AsyncAgentContinuation = {
			...createChapterContinuation(),
			chapterId: null,
			flowId: "flow-1",
			artifactDependencies: [{
				version: 2,
				artifactId: "image:node:node-a",
				nodeId: "node-a",
				taskId: "task-a",
				runId: null,
			}, {
				version: 2,
				artifactId: "image:node:node-b",
				nodeId: "node-b",
				taskId: "task-b",
				runId: null,
			}],
			dependencyNodeIds: ["node-a", "node-b"],
			dependencyTaskIds: ["task-a", "task-b"],
			handledArtifactIds: ["image:node:node-a", "image:node:node-b"],
		};
		mocks.listTaskStatusesByProvider.mockResolvedValue([{ data: JSON.stringify(continuation) }]);
		mocks.getTaskResultByTaskId.mockImplementation(
			async (_db: unknown, _userId: string, taskId: string) => taskId === "task-a"
				? { status: "failed" }
				: {
					status: "succeeded",
					result: JSON.stringify({
						id: "task-b",
						kind: "text_to_image",
						status: "succeeded",
						assets: [{ type: "image", url: "https://assets.example/node-b.png" }],
						raw: null,
					}),
					node_id: "node-b",
					completed_at: "2026-08-01T00:02:00.000Z",
					updated_at: "2026-08-01T00:02:00.000Z",
				},
		);
		mocks.tryClaimTaskStatus.mockResolvedValue(true);
		const c = { env: { DB: {} } } as unknown as AppContext;

		const result = await claimReadyAsyncAgentContinuations({
			c,
			flowId: "flow-1",
			projectId: "project-1",
			nodeStates: new Map([
				["node-a", "ready"],
				["node-b", "failed"],
			]),
		});

		expect(result).toEqual([expect.objectContaining({
			...continuation,
			claimToken: expect.any(String),
			materializedArtifacts: [expect.objectContaining({
				artifactId: "image:node:node-b",
				taskId: "task-b",
				assetUrl: "https://assets.example/node-b.png",
			})],
		})]);
		expect(mocks.tryClaimTaskStatus).toHaveBeenCalledOnce();
		expect(mocks.settleClaimedAssetRepairContinuation).not.toHaveBeenCalled();
	});

	it("registers a stage without resetting an existing continuation lifecycle", async () => {
		const continuation = createChapterContinuation();
		const c = { env: { DB: {} } } as unknown as AppContext;

		const registered = await registerAsyncAgentContinuation(c, continuation);

		expect(registered).toBe(true);
		expect(mocks.createTaskStatusIfAbsent).toHaveBeenCalledWith(c.env.DB, {
			taskId: continuation.id,
			provider: "agents_async_continuation",
			userId: continuation.userId,
			status: "waiting",
			data: continuation,
			nowIso: continuation.createdAt,
		});
		expect(mocks.upsertTaskStatus).not.toHaveBeenCalled();
	});

	it("recovers a partially written continuation registration and requests the missing queue publication", async () => {
		const continuation = createChapterContinuation();
		mocks.createTaskStatusIfAbsent.mockResolvedValue(false);
		mocks.getTaskStatusByIdentity.mockResolvedValue({
			task_id: continuation.id,
			provider: "agents_async_continuation",
			user_id: continuation.userId,
			status: "waiting",
			data: JSON.stringify(continuation),
		});
		const c = { env: { DB: {} } } as unknown as AppContext;

		await expect(ensureAsyncAgentContinuationRegistered(c, continuation)).resolves.toEqual({
			status: "existing",
			queueRequired: true,
			existingStatus: "waiting",
		});
	});

	it("does not republish work for a continuation that already has an active durable claim", async () => {
		const continuation = createChapterContinuation();
		mocks.createTaskStatusIfAbsent.mockResolvedValue(false);
		mocks.getTaskStatusByIdentity.mockResolvedValue({
			task_id: continuation.id,
			provider: "agents_async_continuation",
			user_id: continuation.userId,
			status: "claimed",
			data: JSON.stringify({ ...continuation, claimToken: "claim-1" }),
		});
		const c = { env: { DB: {} } } as unknown as AppContext;

		await expect(ensureAsyncAgentContinuationRegistered(c, continuation)).resolves.toEqual({
			status: "existing",
			queueRequired: false,
			existingStatus: "claimed",
		});
	});

	it("rejects a duplicate continuation row whose stable logical identity drifted", async () => {
		const continuation = createChapterContinuation();
		mocks.createTaskStatusIfAbsent.mockResolvedValue(false);
		mocks.getTaskStatusByIdentity.mockResolvedValue({
			task_id: continuation.id,
			provider: "agents_async_continuation",
			user_id: continuation.userId,
			status: "waiting",
			data: JSON.stringify({ ...continuation, sessionKey: "different-session" }),
		});
		const c = { env: { DB: {} } } as unknown as AppContext;

		await expect(ensureAsyncAgentContinuationRegistered(c, continuation))
			.rejects.toThrow("continuation_settlement_registration_identity_drift");
	});

	it("claims a root physical-budget continuation without loading a canvas graph", async () => {
		const continuation: AsyncAgentContinuation = {
			...createChapterContinuation(),
			id: "async-continuation:physical-budget-stage",
			resumeTrigger: "physical_budget",
			projectId: "",
			flowId: "",
			chapterId: null,
			dependencyNodeIds: [],
			dependencyTaskIds: [],
			dependencyRunIds: ["video-run-already-accepted"],
			handledArtifactIds: ["root_physical_run:physical-run-1:4"],
			progressFingerprint: "physical-progress-1",
			expectedDelivery: { active: false },
		};
		mocks.listTaskStatusesByProvider.mockResolvedValue([
			{ data: JSON.stringify(continuation) },
		]);
		mocks.tryClaimTaskStatus.mockResolvedValue(true);
		const c = { env: { DB: {} } } as unknown as AppContext;

		const result = await claimReadyAsyncAgentContinuationsAcrossFlows({ c });

		expect(result.claimed).toBe(1);
		expect(result.continuations).toEqual([{ ...continuation, claimToken: expect.any(String) }]);
		expect(mocks.getFlowByIdUnsafe).not.toHaveBeenCalled();
		expect(mocks.loadChapterCanvasAsFlowRow).not.toHaveBeenCalled();
	});

	it("claims only the persisted physical continuation for the exact user session", async () => {
		const physical: AsyncAgentContinuation = {
			...createChapterContinuation(),
			id: "async-continuation:physical-session",
			stage: 2,
			resumeTrigger: "physical_budget",
			dependencyNodeIds: [],
			dependencyTaskIds: [],
			dependencyRunIds: ["video-run-1"],
			handledArtifactIds: ["root_physical_run:physical-run-2:8"],
		};
		const otherSession = { ...physical, id: "async-continuation:other", sessionKey: "session-2" };
		mocks.listTaskStatusesByProvider.mockResolvedValue([
			{ data: "{invalid" },
			{ data: JSON.stringify(otherSession) },
			{ data: JSON.stringify(physical) },
		]);
		mocks.tryClaimTaskStatus.mockResolvedValue(true);
		const c = { env: { DB: {} } } as unknown as AppContext;

		const result = await claimSessionPhysicalBudgetContinuation({
			c,
			userId: "user-1",
			sessionKey: "session-1",
		});

		expect(result).toEqual({
			status: "claimed",
			continuation: { ...physical, claimToken: expect.any(String) },
			waitingCount: 3,
			invalidCount: 1,
		});
		expect(mocks.tryClaimTaskStatus).toHaveBeenCalledTimes(1);
		expect(mocks.tryClaimTaskStatus).toHaveBeenCalledWith(c.env.DB, expect.objectContaining({
			taskId: physical.id,
			provider: "agents_async_continuation",
		}));
	});

	it("chat interruption cancels only physical continuations owned by the exact durable turn", async () => {
		const owned: AsyncAgentContinuation = {
			...createChapterContinuation(),
			id: "async-continuation:cancel-owned",
			rootRequestId: "public-turn-1",
			resumeTrigger: "physical_budget",
		};
		const anotherTurn = {
			...owned,
			id: "async-continuation:cancel-other",
			rootRequestId: "public-turn-2",
		};
		const acceptedDependency: AsyncAgentContinuation = {
			...owned,
			id: "async-continuation:accepted-dependency",
			resumeTrigger: "dependency",
			dependencyRunIds: ["workflow-execution-accepted"],
		};
		mocks.listTaskStatusesByProvider
			.mockResolvedValueOnce([
				{ data: JSON.stringify(anotherTurn) },
				{ data: JSON.stringify(acceptedDependency) },
			])
			.mockResolvedValueOnce([{ data: JSON.stringify(owned) }]);
		mocks.tryCancelActiveTaskStatus.mockResolvedValue(true);
		const c = { env: { DB: {} } } as unknown as AppContext;

		const cancelled = await cancelActiveSessionAgentContinuations({
			c,
			userId: "user-1",
			sessionKey: "session-1",
			rootRequestId: "public-turn-1",
			scope: "physical_only",
		});

		expect(cancelled).toBe(1);
		expect(mocks.listTaskStatusesByProvider).toHaveBeenNthCalledWith(1, c.env.DB, expect.objectContaining({ status: "waiting" }));
		expect(mocks.listTaskStatusesByProvider).toHaveBeenNthCalledWith(2, c.env.DB, expect.objectContaining({ status: "claimed" }));
		expect(mocks.tryCancelActiveTaskStatus).toHaveBeenCalledTimes(1);
		expect(mocks.tryCancelActiveTaskStatus).toHaveBeenCalledWith(c.env.DB, expect.objectContaining({
			taskId: owned.id,
			provider: "agents_async_continuation",
		}));
	});

	it("workflow cancellation terminates dependency continuations for the exact durable turn", async () => {
		const dependency: AsyncAgentContinuation = {
			...createChapterContinuation(),
			id: "async-continuation:cancel-dependency",
			rootRequestId: "public-turn-1",
			resumeTrigger: "dependency",
			dependencyRunIds: ["workflow-execution-accepted"],
		};
		mocks.listTaskStatusesByProvider
			.mockResolvedValueOnce([{ data: JSON.stringify(dependency) }])
			.mockResolvedValueOnce([]);
		mocks.tryCancelActiveTaskStatus.mockResolvedValue(true);
		const c = { env: { DB: {} } } as unknown as AppContext;

		const cancelled = await cancelActiveSessionAgentContinuations({
			c,
			userId: "user-1",
			sessionKey: "session-1",
			rootRequestId: "public-turn-1",
			scope: "all",
		});

		expect(cancelled).toBe(1);
		expect(mocks.tryCancelActiveTaskStatus).toHaveBeenCalledWith(c.env.DB, expect.objectContaining({
			taskId: dependency.id,
			provider: "agents_async_continuation",
		}));
	});

	it("does not reinterpret a dependency or legacy row as a physical resume", async () => {
		const dependency = createChapterContinuation();
		const legacy = { ...dependency } as Record<string, unknown>;
		delete legacy.resumeTrigger;
		mocks.listTaskStatusesByProvider.mockResolvedValue([
			{ data: JSON.stringify(dependency) },
			{ data: JSON.stringify(legacy) },
		]);
		const c = { env: { DB: {} } } as unknown as AppContext;

		const result = await claimSessionPhysicalBudgetContinuation({
			c,
			userId: "user-1",
			sessionKey: "session-1",
		});

		expect(result).toEqual({ status: "not_ready", waitingCount: 2, invalidCount: 1 });
		expect(mocks.tryClaimTaskStatus).not.toHaveBeenCalled();
	});

	it("explicitly reclaims only the exact failed physical continuation for an orphaned session", async () => {
		const orphaned: AsyncAgentContinuation = {
			...createChapterContinuation(),
			id: "async-continuation:orphaned-physical-session",
			stage: 3,
			resumeTrigger: "physical_budget",
			dependencyNodeIds: [],
			dependencyTaskIds: [],
			dependencyRunIds: ["video-run-1"],
			handledArtifactIds: ["root_physical_run:physical-run-3:12"],
			attempt: 1,
			lastFailure: {
				occurredAt: "2026-08-10T00:00:00.000Z",
				code: "unknown_error",
				status: null,
				upstreamStatus: null,
				message: "terminated",
				retryable: false,
			},
		};
		mocks.listTaskStatusesByProvider.mockImplementation((
			_db: unknown,
			input: { status: string },
		) => Promise.resolve(input.status === "failed"
			? [
				{ data: JSON.stringify({ ...orphaned, id: "other", sessionKey: "session-2" }) },
				{ data: JSON.stringify(orphaned) },
			]
			: []));
		mocks.tryClaimFailedTaskStatusForExplicitResume.mockResolvedValue(true);
		const c = { env: { DB: {} } } as unknown as AppContext;

		const result = await claimSessionOrphanedPhysicalBudgetContinuation({
			c,
			userId: "user-1",
			sessionKey: "session-1",
		});

		expect(result).toEqual({
			status: "claimed",
			continuation: { ...orphaned, claimToken: expect.any(String) },
			waitingCount: 2,
			invalidCount: 0,
		});
		expect(mocks.tryClaimFailedTaskStatusForExplicitResume).toHaveBeenCalledWith(
			c.env.DB,
			expect.objectContaining({
				taskId: orphaned.id,
				provider: "agents_async_continuation",
			}),
		);
		expect(mocks.tryClaimTaskStatus).not.toHaveBeenCalled();
	});

	it("prefers the newest recovery branch over an older continuation with a larger stage", async () => {
		const olderHighStage: AsyncAgentContinuation = {
			...createChapterContinuation(),
			id: "async-continuation:older-high-stage",
			stage: 5,
			createdAt: "2026-08-10T00:00:00.000Z",
			resumeTrigger: "physical_budget",
			attempt: 1,
			lastFailure: {
				occurredAt: "2026-08-10T00:01:00.000Z",
				code: "agents_bridge_stream_interrupted",
				status: 502,
				upstreamStatus: null,
				message: "older physical branch interrupted",
				retryable: true,
			},
		};
		const newerRecovery: AsyncAgentContinuation = {
			...olderHighStage,
			id: "async-continuation:newer-recovery",
			stage: 1,
			createdAt: "2026-08-10T00:02:00.000Z",
			lastFailure: {
				...olderHighStage.lastFailure!,
				occurredAt: "2026-08-10T00:02:00.000Z",
				code: "semantic_dependency_changed",
				message: "new recovery checkpoint",
			},
		};
		mocks.listTaskStatusesByProvider.mockImplementation((
			_db: unknown,
			input: { status: string },
		) => Promise.resolve(input.status === "failed"
			? [
				{ data: JSON.stringify(olderHighStage) },
				{ data: JSON.stringify(newerRecovery) },
			]
			: []));
		mocks.tryClaimFailedTaskStatusForExplicitResume.mockResolvedValue(true);
		const c = { env: { DB: {} } } as unknown as AppContext;

		const result = await claimSessionOrphanedPhysicalBudgetContinuation({
			c,
			userId: "user-1",
			sessionKey: "session-1",
		});

		expect(result.status).toBe("claimed");
		if (result.status !== "claimed") throw new Error("expected a claimed recovery continuation");
		expect(result.continuation.id).toBe(newerRecovery.id);
		expect(mocks.tryClaimFailedTaskStatusForExplicitResume).toHaveBeenCalledTimes(1);
		expect(mocks.tryClaimFailedTaskStatusForExplicitResume).toHaveBeenCalledWith(
			c.env.DB,
			expect.objectContaining({ taskId: newerRecovery.id }),
		);
	});

	it("CAS-reclaims an exact claimed continuation when the public turn is proven orphaned", async () => {
		const orphaned: AsyncAgentContinuation = {
			...createChapterContinuation(),
			id: "async-continuation:orphaned-claimed-session",
			stage: 4,
			resumeTrigger: "physical_budget",
			dependencyNodeIds: [],
			dependencyTaskIds: [],
			dependencyRunIds: ["video-run-1"],
			handledArtifactIds: ["root_physical_run:physical-run-4:13"],
			attempt: 1,
			lastFailure: null,
		};
		mocks.listTaskStatusesByProvider.mockImplementation((
			_db: unknown,
			input: { status: string },
		) => Promise.resolve(input.status === "claimed"
			? [{ data: JSON.stringify(orphaned), updated_at: "2026-08-10T00:01:00.000Z" }]
			: []));
		mocks.tryReclaimClaimedTaskStatusForExplicitResume.mockResolvedValue(true);
		const c = { env: { DB: {} } } as unknown as AppContext;

		const result = await claimSessionOrphanedPhysicalBudgetContinuation({
			c,
			userId: "user-1",
			sessionKey: "session-1",
		});

		expect(result).toEqual({
			status: "claimed",
			continuation: { ...orphaned, claimToken: expect.any(String) },
			waitingCount: 1,
			invalidCount: 0,
		});
		expect(mocks.tryReclaimClaimedTaskStatusForExplicitResume).toHaveBeenCalledWith(
			c.env.DB,
			expect.objectContaining({
				taskId: orphaned.id,
				provider: "agents_async_continuation",
				expectedUpdatedAtIso: "2026-08-10T00:01:00.000Z",
			}),
		);
		expect(mocks.tryClaimFailedTaskStatusForExplicitResume).not.toHaveBeenCalled();
	});

	it("does not let a project-flow reconcile claim a chapter-scoped contract", async () => {
		const continuation = createChapterContinuation();
		mocks.listTaskStatusesByProvider.mockResolvedValue([
			{ data: JSON.stringify(continuation) },
		]);
		const c = { env: { DB: {} } } as unknown as AppContext;

		const result = await claimReadyAsyncAgentContinuations({
			c,
			flowId: "project-flow-1",
			projectId: "project-1",
			nodeStates: new Map([["chapter-image-1", "ready" as const]]),
		});

		expect(result).toEqual([]);
		expect(mocks.tryClaimTaskStatus).not.toHaveBeenCalled();
	});

	it("recovers expired worker claims before scanning waiting contracts", async () => {
		mocks.requeueStaleClaimedTaskStatuses.mockResolvedValueOnce(2);
		mocks.listTaskStatusesByProvider.mockResolvedValueOnce([]);
		const c = { env: { DB: {} } } as unknown as AppContext;

		const result = await claimReadyAsyncAgentContinuationsAcrossFlows({ c });

		expect(result).toEqual({
			scanned: 0,
			recoveredClaims: 2,
			ready: 0,
			claimed: 0,
			failed: 0,
			continuations: [],
			errors: [],
		});
		expect(mocks.requeueStaleClaimedTaskStatuses).toHaveBeenCalledWith(
			c.env.DB,
			expect.objectContaining({
				provider: "agents_async_continuation",
				staleBeforeIso: expect.any(String),
				nowIso: expect.any(String),
			}),
		);
	});

	it("does not claim a retry before its persisted deadline", async () => {
		const continuation = {
			...createChapterContinuation(),
			chapterId: null,
			flowId: "flow-1",
			nextAttemptAt: "2999-01-01T00:00:00.000Z",
		};
		mocks.listTaskStatusesByProvider.mockResolvedValue([
			{ data: JSON.stringify(continuation) },
		]);
		const c = { env: { DB: {} } } as unknown as AppContext;

		const result = await claimReadyAsyncAgentContinuations({
			c,
			flowId: "flow-1",
			projectId: "project-1",
			nodeStates: new Map([["chapter-image-1", "ready" as const]]),
		});

		expect(result).toEqual([]);
		expect(mocks.tryClaimTaskStatus).not.toHaveBeenCalled();
	});

	it("claims a run-only continuation when durable video state requires agent action", async () => {
		const continuation: AsyncAgentContinuation = {
			...createChapterContinuation(),
			chapterId: null,
			flowId: "flow-1",
			artifactDependencies: [{
				version: 2,
				artifactId: "video:run:video-run-1",
				nodeId: null,
				taskId: null,
				runId: "video-run-1",
			}],
			dependencyNodeIds: [],
			dependencyTaskIds: [],
			dependencyRunIds: ["video-run-1"],
			handledArtifactIds: ["video:run:video-run-1"],
		};
		mocks.listTaskStatusesByProvider.mockResolvedValue([{ data: JSON.stringify(continuation) }]);
		mocks.getVideoRun.mockResolvedValue({
			id: "video-run-1",
			owner_id: "user-1",
			project_id: "project-1",
			flow_id: "flow-1",
			chapter_id: null,
			state: "collecting",
			authoring_state: "asset_repair_required",
		});
		mocks.tryClaimTaskStatus.mockResolvedValue(true);
		const c = { env: { DB: {} } } as unknown as AppContext;

		const result = await claimReadyAsyncAgentContinuations({
			c,
			flowId: "flow-1",
			projectId: "project-1",
			nodeStates: new Map(),
		});

		expect(result).toEqual([{ ...continuation, claimToken: expect.any(String) }]);
		expect(mocks.tryClaimTaskStatus).toHaveBeenCalledTimes(1);
	});

	it("terminalizes the root without a correction continuation when the latest workflow member fails", async () => {
		const continuation: AsyncAgentContinuation = {
			...createChapterContinuation(),
			rootRequestId: "public-chat-turn:root-1",
			chapterId: null,
			flowId: "canvas-1",
			artifactDependencies: [{
				version: 2,
				artifactId: "video:run:workflow-execution-root",
				nodeId: null,
				taskId: null,
				runId: "workflow-execution-root",
				runProtocol: "workflow_execution_family",
			}],
			dependencyNodeIds: [],
			dependencyTaskIds: [],
			dependencyRunIds: ["workflow-execution-root"],
			handledArtifactIds: ["video:run:workflow-execution-root"],
		};
		mocks.listTaskStatusesByProvider.mockResolvedValue([{ data: JSON.stringify(continuation) }]);
		mocks.getWorkflowExecutionFamilyPageForOwner
			.mockResolvedValueOnce({
				executionFamilyId: "workflow-execution-root",
				latestExecutionId: "workflow-execution-root",
				latestExecutionStatus: "running",
				activeExecutionCount: 1,
				executions: [{
					id: "workflow-execution-root",
					status: "running",
					projectId: "project-1",
					canvasId: "canvas-1",
				}],
			})
			.mockResolvedValueOnce({
				executionFamilyId: "workflow-execution-root",
				latestExecutionId: "workflow-execution-root",
				latestExecutionStatus: "failed",
				activeExecutionCount: 0,
				executions: [{
					id: "workflow-execution-root",
					status: "failed",
					projectId: "project-1",
					canvasId: "canvas-1",
				}],
			});
		mocks.tryClaimTaskStatus.mockResolvedValue(true);
		const c = { env: { DB: {} } } as unknown as AppContext;

		const pending = await claimReadyAsyncAgentContinuations({
			c,
			flowId: "canvas-1",
			projectId: "project-1",
			nodeStates: new Map(),
		});
		const terminal = await claimReadyAsyncAgentContinuations({
			c,
			flowId: "canvas-1",
			projectId: "project-1",
			nodeStates: new Map(),
		});

		expect(pending).toEqual([]);
		expect(terminal).toEqual([]);
		expect(mocks.interruptAgentsChatTurn).toHaveBeenCalledWith(
			c,
			"user-1",
			{
				sessionId: "session-1",
				turnId: "public-chat-turn:root-1",
				reasonCode: "async_dependency_terminal",
			},
			{ timeoutMs: 10_000 },
		);
		expect(mocks.settleClaimedAssetRepairContinuation).toHaveBeenCalledOnce();
		expect(mocks.listNodeRunsForExecutionOwner).not.toHaveBeenCalled();
		expect(mocks.getVideoRun).not.toHaveBeenCalledWith("workflow-execution-root");
	});

	it("matches a chapter-scoped workflow family against its canonical chapter canvas id", async () => {
		const continuation: AsyncAgentContinuation = {
			...createChapterContinuation(),
			flowId: "",
			artifactDependencies: [{
				version: 2,
				artifactId: "video:run:workflow-execution-root",
				nodeId: null,
				taskId: null,
				runId: "workflow-execution-root",
				runProtocol: "workflow_execution_family",
			}],
			dependencyNodeIds: [],
			dependencyTaskIds: [],
			dependencyRunIds: ["workflow-execution-root"],
			handledArtifactIds: ["video:run:workflow-execution-root"],
		};
		mocks.listTaskStatusesByProvider.mockResolvedValue([{ data: JSON.stringify(continuation) }]);
		mocks.loadChapterCanvasAsFlowRow.mockResolvedValue({
			id: "chapter-1",
			name: "chapter-canvas",
			data: JSON.stringify({ nodes: [] }),
			owner_id: "user-1",
			project_id: "project-1",
			created_at: "2026-08-01T00:00:00.000Z",
			updated_at: "2026-08-01T00:01:00.000Z",
		});
		mocks.getWorkflowExecutionFamilyPageForOwner.mockResolvedValue({
			executionFamilyId: "workflow-execution-root",
			latestExecutionId: "workflow-execution-root",
			latestExecutionStatus: "success",
			activeExecutionCount: 0,
			executions: [{
				id: "workflow-execution-root",
				status: "success",
				projectId: "project-1",
				canvasId: "chapter:chapter-1",
			}],
		});
		mocks.listNodeRunsForExecutionOwner.mockResolvedValue([{
			execution_id: "workflow-execution-root",
			node_id: "delivery-verify",
			status: "success",
			finished_at: "2026-08-28T13:07:15.415Z",
			output_refs: JSON.stringify({
				artifacts: [{
					type: "tapcanvas.master-video/v1",
					value: "https://assets.example/chapter-1.mp4",
				}],
				evidence: {
					executorCompleted: true,
					verifiedItems: 1,
					expectedArtifactType: "tapcanvas.master-video/v1",
				},
			}),
		}]);
		mocks.tryClaimTaskStatus.mockResolvedValue(true);
		const c = {
			env: {
				DB: {
					chapters: {
						findFirst: vi.fn().mockResolvedValue({ id: "chapter-1" }),
					},
				},
			},
		} as unknown as AppContext;

		const result = await claimReadyAsyncAgentContinuationsAcrossFlows({ c });

		expect(result.claimed).toBe(1);
		expect(result.failed).toBe(0);
		expect(result.continuations).toEqual([
			expect.objectContaining({
				id: continuation.id,
				claimToken: expect.any(String),
			}),
		]);
	});

	it("binds a successful workflow family's verified master asset into the continuation", async () => {
		const continuation: AsyncAgentContinuation = {
			...createChapterContinuation(),
			flowId: "",
			artifactDependencies: [{
				version: 2,
				artifactId: "video:run:workflow-execution-root",
				nodeId: null,
				taskId: null,
				runId: "workflow-execution-root",
				runProtocol: "workflow_execution_family",
			}],
			dependencyNodeIds: [],
			dependencyTaskIds: [],
			dependencyRunIds: ["workflow-execution-root"],
			handledArtifactIds: ["video:run:workflow-execution-root"],
		};
		mocks.listTaskStatusesByProvider.mockResolvedValue([{ data: JSON.stringify(continuation) }]);
		mocks.loadChapterCanvasAsFlowRow.mockResolvedValue({
			id: "chapter-1",
			name: "chapter-canvas",
			data: JSON.stringify({ nodes: [] }),
			owner_id: "user-1",
			project_id: "project-1",
			created_at: "2026-08-01T00:00:00.000Z",
			updated_at: "2026-08-01T00:01:00.000Z",
		});
		mocks.getWorkflowExecutionFamilyPageForOwner.mockResolvedValue({
			executionFamilyId: "workflow-execution-root",
			latestExecutionId: "workflow-execution-success",
			latestExecutionStatus: "success",
			activeExecutionCount: 0,
			executions: [{
				id: "workflow-execution-success",
				status: "success",
				projectId: "project-1",
				canvasId: "chapter:chapter-1",
			}],
		});
		mocks.listNodeRunsForExecutionOwner.mockResolvedValue([{
			execution_id: "workflow-execution-success",
			node_id: "delivery-verify",
			status: "success",
			finished_at: "2026-08-28T13:07:15.415Z",
			output_refs: JSON.stringify({
				artifacts: [{
					type: "tapcanvas.master-video/v1",
					value: "https://assets.example/chapter-1.mp4",
				}],
				evidence: {
					executorCompleted: true,
					verifiedItems: 1,
					expectedArtifactType: "tapcanvas.master-video/v1",
				},
			}),
		}]);
		mocks.tryClaimTaskStatus.mockResolvedValue(true);
		const c = {
			env: {
				DB: {
					chapters: { findFirst: vi.fn().mockResolvedValue({ id: "chapter-1" }) },
				},
			},
		} as unknown as AppContext;

		const result = await claimReadyAsyncAgentContinuationsAcrossFlows({ c });

		expect(result.claimed).toBe(1);
		expect(result.continuations).toEqual([
			expect.objectContaining({
				materializedArtifacts: [expect.objectContaining({
					assetUrl: "https://assets.example/chapter-1.mp4",
					source: "workflow_execution",
					sourceExecutionId: "workflow-execution-success",
				})],
			}),
		]);
	});

	it("waits for a chapter-scoped durable video run and claims it after concatenation", async () => {
		const continuation: AsyncAgentContinuation = {
			...createChapterContinuation(),
			flowId: "",
			artifactDependencies: [{
				version: 2,
				artifactId: "video:run:video-run-1",
				nodeId: null,
				taskId: null,
				runId: "video-run-1",
			}],
			dependencyNodeIds: [],
			dependencyTaskIds: [],
			dependencyRunIds: ["video-run-1"],
			handledArtifactIds: ["root_physical_run:physical-run-1:7"],
		};
		mocks.listTaskStatusesByProvider.mockResolvedValue([{ data: JSON.stringify(continuation) }]);
		mocks.loadChapterCanvasAsFlowRow.mockResolvedValue({
			id: "chapter-1",
			name: "chapter-canvas",
			data: JSON.stringify({ nodes: [] }),
			owner_id: "user-1",
			project_id: "project-1",
			created_at: "2026-08-01T00:00:00.000Z",
			updated_at: "2026-08-01T00:01:00.000Z",
		});
		mocks.getVideoRun.mockResolvedValue({
			id: "video-run-1",
			owner_id: "user-1",
			project_id: "project-1",
			flow_id: null,
			chapter_id: "chapter-1",
			state: "concatenated",
			authoring_state: "authoring_done",
		});
		mocks.tryClaimTaskStatus.mockResolvedValue(true);
		const c = {
			env: {
				DB: {
					chapters: {
						findFirst: vi.fn().mockResolvedValue({ id: "chapter-1" }),
					},
				},
			},
		} as unknown as AppContext;

		const result = await claimReadyAsyncAgentContinuationsAcrossFlows({ c });

		expect(result.claimed).toBe(1);
		expect(result.continuations).toEqual([{ ...continuation, claimToken: expect.any(String) }]);
		expect(mocks.getVideoRun).toHaveBeenCalledWith("video-run-1");
	});

	it("claims a prompt-only run after its authoring delivery reaches its real terminal", async () => {
		const continuation: AsyncAgentContinuation = {
			...createChapterContinuation(),
			flowId: "",
			artifactDependencies: [{
				version: 2,
				artifactId: "video:run:prompt-run-1",
				nodeId: null,
				taskId: null,
				runId: "prompt-run-1",
			}],
			dependencyNodeIds: [],
			dependencyTaskIds: [],
			dependencyRunIds: ["prompt-run-1"],
			handledArtifactIds: ["video:run:prompt-run-1"],
		};
		mocks.listTaskStatusesByProvider.mockResolvedValue([{ data: JSON.stringify(continuation) }]);
		mocks.loadChapterCanvasAsFlowRow.mockResolvedValue({
			id: "chapter-1",
			name: "chapter-canvas",
			data: JSON.stringify({ nodes: [] }),
			owner_id: "user-1",
			project_id: "project-1",
			created_at: "2026-08-01T00:00:00.000Z",
			updated_at: "2026-08-01T00:01:00.000Z",
		});
		mocks.getVideoRun.mockResolvedValue({
			id: "prompt-run-1",
			owner_id: "user-1",
			project_id: "project-1",
			flow_id: null,
			chapter_id: "chapter-1",
			state: "collecting",
			authoring_state: "authoring_done",
			beat_sheet: JSON.stringify({ meta: { executionScope: "prompt_only" } }),
		});
		mocks.tryClaimTaskStatus.mockResolvedValue(true);
		const c = {
			env: {
				DB: {
					chapters: {
						findFirst: vi.fn().mockResolvedValue({ id: "chapter-1" }),
					},
				},
			},
		} as unknown as AppContext;

		const result = await claimReadyAsyncAgentContinuationsAcrossFlows({ c });

		expect(result.claimed).toBe(1);
		expect(result.continuations).toEqual([{ ...continuation, claimToken: expect.any(String) }]);
		expect(mocks.tryClaimTaskStatus).toHaveBeenCalledTimes(1);
	});

	it("closes an ownerless asset-repair wait when its continuation exhausts non-retryable execution", async () => {
		const continuation: AsyncAgentContinuation = {
			...createChapterContinuation(),
			chapterId: null,
			flowId: "flow-1",
			artifactDependencies: [{
				version: 2,
				artifactId: "video:run:video-run-1",
				nodeId: null,
				taskId: null,
				runId: "video-run-1",
			}],
			dependencyNodeIds: [],
			dependencyTaskIds: [],
			dependencyRunIds: ["video-run-1"],
			handledArtifactIds: ["video:run:video-run-1"],
			ownedRepairRuns: [{
				version: 1,
				runId: "video-run-1",
				repairGeneration: "repair-generation-1",
			}],
			claimToken: "claim-ownerless-repair",
		};
		mocks.settleClaimedAssetRepairContinuation.mockResolvedValue({
			terminalized: true,
			settledRunIds: ["video-run-1"],
		});
		const c = { env: { DB: {} } } as unknown as AppContext;

		const plan = await deferOrFailAsyncAgentContinuation({
			c,
			continuation,
			error: { code: "llm_http_402", status: 402, message: "insufficient balance" },
		});

		expect(plan.shouldRetry).toBe(false);
		expect(mocks.settleClaimedAssetRepairContinuation).toHaveBeenCalledWith(
			expect.objectContaining({
				continuationId: continuation.id,
				errorMessage: expect.stringContaining("asset_repair_executor_terminal"),
				runs: [expect.objectContaining({ runId: "video-run-1" })],
			}),
		);
	});

	it("preserves asset-repair waiting while a real accepted task is still active", async () => {
		const continuation: AsyncAgentContinuation = {
			...createChapterContinuation(),
			chapterId: null,
			flowId: "flow-1",
			artifactDependencies: [{
				version: 2,
				artifactId: "image:node:chapter-image-1",
				nodeId: "chapter-image-1",
				taskId: "image-task-1",
				runId: null,
			}, {
				version: 2,
				artifactId: "video:run:video-run-1",
				nodeId: null,
				taskId: null,
				runId: "video-run-1",
			}],
			dependencyNodeIds: [],
			dependencyTaskIds: ["image-task-1"],
			dependencyRunIds: ["video-run-1"],
			handledArtifactIds: ["video:run:video-run-1"],
		};
		mocks.getTaskResultByTaskId.mockResolvedValue({ status: "running" });
		const c = { env: { DB: {} } } as unknown as AppContext;

		const plan = await deferOrFailAsyncAgentContinuation({
			c,
			continuation,
			error: { code: "llm_http_402", status: 402, message: "insufficient balance" },
		});

		expect(plan.shouldRetry).toBe(true);
		expect(mocks.transitionClaimedTaskStatus).toHaveBeenCalledWith(c.env.DB, expect.objectContaining({
			taskId: continuation.id,
			status: "waiting",
		}));
		expect(mocks.settleClaimedAssetRepairContinuation).not.toHaveBeenCalled();
	});
});
