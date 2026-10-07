import { workflowAuthorRepairAttempt, workflowAuthorDeliveryHash } from "./execution.author-repair";
import { workflowConsumerReplaySelectionAttempt } from "./execution.consumer-replay-selection";
import { boundedReplayFixture } from "./execution.bounded-replay-fixture";
import { createWorkflowProjectContext } from "./execution.project-context";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
	VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
	VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
} from "@tapcanvas/video-orchestrator-protocol";
import type { WorkerEnv } from "../../types";
import type { FlowRow } from "../flow/flow.repo";
import type { WorkflowExecutionSupport } from "./execution.node-runtime";

type CreateExecutionParams = Readonly<{
	id: string;
	flowVersionId: string;
}> & Readonly<Record<string, unknown>>;

type CreateFlowVersionParams = Readonly<{
	id: string;
	flowId: string;
	name: string;
	data: string;
	userId: string;
	nowIso: string;
}>;

const savedFlowVersions = vi.hoisted(() => new Map<string, string>());

const mocks = vi.hoisted(() => ({
	getFlowVersion: vi.fn(async (_db: unknown, id: string, _flowId: string): Promise<{ data: string } | null> => {
		const data = savedFlowVersions.get(id);
		return data === undefined ? null : { data };
	}),
	createFlowVersion: vi.fn(async (_db: unknown, params: CreateFlowVersionParams) => { savedFlowVersions.set(params.id, params.data); }),
	createExecution: vi.fn(async (_db: unknown, _params: CreateExecutionParams) => undefined),
	getExecutionById: vi.fn(async (db: unknown, id: string) => ({
		id,
		flow_id: "flow-1",
		flow_version_id: "version-1",
		owner_id: "admin-1",
		project_id: "project-1",
		canvas_id: "canvas-1",
		status: "queued",
		concurrency: 1,
		trigger: "manual",
		error_message: null,
		execution_family_id: id,
		created_at: "2026-08-11T09:00:00.000Z",
		started_at: null,
		finished_at: null,
	})),
	updateExecutionStatus: vi.fn(async () => undefined),
	scopeWorkflowFlowData: vi.fn((_raw: unknown, _triggerNodeId: string, _stopAfterNodeId?: string, _startFromNodeId?: string): Record<string, unknown> => ({ nodes: [], edges: [] })),
	prepareWorkflowOutputReuse: vi.fn(async (input: { flowData: Record<string, unknown> }) => input.flowData),
	createWorkflowOutputReuseRepository: vi.fn(() => ({})),
	inspectWorkflowExecutionSupport: vi.fn((): WorkflowExecutionSupport => ({
		hasWorkflowOutput: true,
		nodes: [],
		unsupportedNodes: [],
	})),
	freezeWorkflowExecutionSemanticsSnapshot: vi.fn((value: Record<string, unknown>) => ({
		...value,
		workflowExecutionSemantics: { protocolVersion: "workflow.execution-semantics/v2", nodes: {} },
	})),
	listNewApiModels: vi.fn(async () => [{
		id: 1,
		modelName: "minimax-h3-test",
		requestModelKey: "minimax-h3-test",
		routingAliases: [],
		displayLabel: "MiniMax H3 test",
		description: null,
		icon: null,
		tags: [],
		vendorId: null,
		endpoints: ["task.video"],
		runtimeEndpoints: ["task.video"],
		kind: "video" as const,
		enabled: true,
		syncOfficial: true,
		nameRule: 1,
		createdTime: 1,
		updatedTime: 1,
		meta: null,
		pricing: { cost: 1, enabled: true, specCosts: [] },
	}]),
}));

vi.mock("../flow/flow.repo", () => ({ createFlowVersion: mocks.createFlowVersion, getFlowVersion: mocks.getFlowVersion }));
vi.mock("./execution.repo", () => ({
	createExecution: mocks.createExecution,
	getExecutionById: mocks.getExecutionById,
	mapExecutionRow: (row: Readonly<Record<string, unknown>>) => ({
		id: row.id,
		executionFamilyId: row.execution_family_id,
		flowId: row.flow_id,
		flowVersionId: row.flow_version_id,
		ownerId: row.owner_id,
		projectId: row.project_id,
		canvasId: row.canvas_id,
		status: row.status,
		concurrency: row.concurrency,
		trigger: row.trigger,
		createdAt: row.created_at,
	}),
	updateExecutionStatus: mocks.updateExecutionStatus,
}));
vi.mock("./execution.flow-scope", async () => ({ ...await vi.importActual<typeof import("./execution.flow-scope")>("./execution.flow-scope"), scopeWorkflowFlowData: mocks.scopeWorkflowFlowData }));
vi.mock("./execution.output-reuse", () => ({
	createWorkflowOutputReuseRepository: mocks.createWorkflowOutputReuseRepository,
	prepareWorkflowOutputReuse: mocks.prepareWorkflowOutputReuse,
}));
vi.mock("./execution.node-runtime", async () => ({ ...await vi.importActual<typeof import("./execution.node-runtime")>("./execution.node-runtime"), inspectWorkflowExecutionSupport: mocks.inspectWorkflowExecutionSupport }));
vi.mock("./execution.semantics-snapshot", () => ({
	freezeWorkflowExecutionSemanticsSnapshot: mocks.freezeWorkflowExecutionSemanticsSnapshot,
	workflowRequiresPluginSemantics: () => false,
}));
vi.mock("../new-api-models/new-api-models.service", () => ({
	isSelectableNewApiModel: (item: { enabled: boolean; runtimeEndpoints: string[]; pricing?: { enabled: boolean; cost: number } }) => (
		item.enabled && item.runtimeEndpoints.length > 0 && item.pricing?.enabled !== false && (item.pricing?.cost ?? 0) > 0
	),
	listNewApiModels: mocks.listNewApiModels,
	matchesNewApiRuntimeModelIdentity: (item: { modelName: string; requestModelKey: string }, identity: string) => (
		item.modelName === identity || item.requestModelKey === identity
	),
}));

import {
	findExistingWorkflowExecutionForIdempotency,
	resolveExclusiveDeliveryScope,
	findExistingWorkflowConsumerReplay,
	startWorkflowExecution,
	startDurableExecution,
} from "./execution.start-service";

const flow: FlowRow = {
	id: "flow-1",
	name: "Workflow",
	data: JSON.stringify({ nodes: [], edges: [] }),
	owner_id: "admin-1",
	project_id: "project-1",
	created_at: "2026-08-11T08:00:00.000Z",
	updated_at: "2026-08-11T08:30:00.000Z",
};

function runtime(response: Response = new Response(null, { status: 202 })): WorkerEnv {
	return {
		DB: {},
		JWT_SECRET: "test",
		WORKFLOW_NODE_QUEUE: { send: vi.fn() },
		EXECUTION_DO: {
			idFromName: vi.fn((name: string) => name),
			get: vi.fn(() => ({ fetch: vi.fn(async () => response) })),
		},
	} as unknown as WorkerEnv;
}

describe("workflow start service", () => {
	beforeEach(() => {
		savedFlowVersions.clear();
		for (const mock of Object.values(mocks)) mock.mockClear();
		mocks.inspectWorkflowExecutionSupport.mockReturnValue({
			hasWorkflowOutput: true,
			nodes: [],
			unsupportedNodes: [],
		});
	});

	it("returns the frozen receipt for the same idempotency identity without rebuilding its source", async () => {
		const env = runtime();
		const frozenExecution = {
			id: "existing-idempotent-execution",
			flow_id: "flow-1",
			flow_version_id: "frozen-version",
			owner_id: "admin-1",
			project_id: "project-1",
			canvas_id: "canvas-1",
			status: "failed",
			concurrency: 1,
			trigger: "agent",
			error_message: null,
			execution_family_id: "family-1",
			created_at: "2026-08-11T09:00:00.000Z",
			started_at: null,
			finished_at: null,
		};
		mocks.getExecutionById.mockImplementationOnce(async (_db, id) => ({ ...frozenExecution, id }));

		const existing = await findExistingWorkflowExecutionForIdempotency(env, {
			flowId: "flow-1",
			triggerNodeId: "trigger-1",
			ownerId: "admin-1",
			projectContext: { projectId: "project-1", canvasId: "canvas-1" },
			idempotencyKey: "capability:attachment-1:public-turn:turn-1",
		});

		expect(existing).toMatchObject({
			id: expect.stringMatching(/^workflow-execution-/),
			flowVersionId: "frozen-version",
			status: "failed",
		});
		expect(mocks.getExecutionById).toHaveBeenCalledTimes(1);
		expect(mocks.getExecutionById.mock.calls[0]?.[1]).toMatch(/^workflow-execution-/);
		expect(mocks.createFlowVersion).not.toHaveBeenCalled();
		expect(mocks.createExecution).not.toHaveBeenCalled();
		expect(env.EXECUTION_DO?.get).not.toHaveBeenCalled();
	});

	it("resolves an admin receipt with the original no-project-context identity", async () => {
		const env = runtime();
		const frozenExecution = {
			id: "existing-admin-execution",
			flow_id: "flow-1",
			flow_version_id: "frozen-admin-version",
			owner_id: "admin-1",
			project_id: "project-1",
			canvas_id: "flow-1",
			status: "failed",
			concurrency: 1,
			trigger: "agent",
			error_message: null,
			execution_family_id: "admin-family",
			created_at: "2026-08-11T09:00:00.000Z",
			started_at: null,
			finished_at: null,
		};
		mocks.getExecutionById.mockImplementationOnce(async (_db, id) => ({ ...frozenExecution, id }));

		const existing = await findExistingWorkflowExecutionForIdempotency(env, {
			flowId: "flow-1",
			triggerNodeId: "trigger-1",
			ownerId: "admin-1",
			idempotencyKey: "admin-request-1",
		});

		expect(existing).toMatchObject({ flowVersionId: "frozen-admin-version", status: "failed" });
		expect(mocks.getExecutionById).toHaveBeenCalledTimes(1);
		expect(mocks.createFlowVersion).not.toHaveBeenCalled();
		expect(mocks.createExecution).not.toHaveBeenCalled();
		expect(env.EXECUTION_DO?.get).not.toHaveBeenCalled();
	});

	it("resumes the original durable dispatch for a same-identity queued receipt", async () => {
		const env = runtime();
		const frozenExecution = {
			id: "existing-idempotent-execution",
			flow_id: "flow-1",
			flow_version_id: "frozen-version",
			owner_id: "admin-1",
			project_id: "project-1",
			canvas_id: "canvas-1",
			status: "queued",
			concurrency: 1,
			trigger: "agent",
			error_message: null,
			execution_family_id: "family-1",
			created_at: "2026-08-11T09:00:00.000Z",
			started_at: null,
			finished_at: null,
		};
		mocks.getExecutionById
			.mockImplementationOnce(async (_db, id) => ({ ...frozenExecution, id }))
			.mockImplementationOnce(async (_db, id) => ({ ...frozenExecution, id, status: "running" }));

		const existing = await findExistingWorkflowExecutionForIdempotency(env, {
			flowId: "flow-1",
			triggerNodeId: "trigger-1",
			ownerId: "admin-1",
			projectContext: { projectId: "project-1", canvasId: "canvas-1" },
			idempotencyKey: "capability:attachment-1:public-turn:turn-1",
		});

		expect(existing).toMatchObject({ status: "running", flowVersionId: "frozen-version" });
		expect(env.EXECUTION_DO?.get).toHaveBeenCalledTimes(1);
		expect(mocks.createFlowVersion).not.toHaveBeenCalled();
		expect(mocks.createExecution).not.toHaveBeenCalled();
	});

	it.each([
		{ owner_id: "another-owner", flow_id: "flow-1", project_id: "project-1", canvas_id: "canvas-1" },
		{ owner_id: "admin-1", flow_id: "another-flow", project_id: "project-1", canvas_id: "canvas-1" },
		{ owner_id: "admin-1", flow_id: "flow-1", project_id: "another-project", canvas_id: "canvas-1" },
		{ owner_id: "admin-1", flow_id: "flow-1", project_id: "project-1", canvas_id: "another-canvas" },
	])("does not reuse an idempotent receipt outside owner/workflow/caller scope: $owner_id/$flow_id/$project_id/$canvas_id", async (scope) => {
		const env = runtime();
		mocks.getExecutionById.mockImplementationOnce(async (_db, id) => ({
			id,
			flow_id: scope.flow_id,
			flow_version_id: "frozen-version",
			owner_id: scope.owner_id,
			project_id: scope.project_id,
			canvas_id: scope.canvas_id,
			status: "running",
			concurrency: 1,
			trigger: "agent",
			error_message: null,
			execution_family_id: "family-1",
			created_at: "2026-08-11T09:00:00.000Z",
			started_at: null,
			finished_at: null,
		}));

		const existing = await findExistingWorkflowExecutionForIdempotency(env, {
			flowId: "flow-1",
			triggerNodeId: "trigger-1",
			ownerId: "admin-1",
			projectContext: { projectId: "project-1", canvasId: "canvas-1" },
			idempotencyKey: "capability:attachment-1:public-turn:turn-1",
		});

		expect(existing).toBeNull();
		expect(env.EXECUTION_DO?.get).not.toHaveBeenCalled();
	});

	it("freezes a scoped version and starts the same durable scheduler for manual runs", async () => {
		const env = runtime();
		const result = await startWorkflowExecution(env, {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "manual",
			now: new Date("2026-08-11T09:00:00.000Z"),
		});
		expect(result.created).toBe(true);
		expect(mocks.createFlowVersion).toHaveBeenCalledTimes(1);
		expect(mocks.createExecution).toHaveBeenCalledTimes(1);
		expect(env.EXECUTION_DO?.get).toHaveBeenCalledTimes(1);
	});

	it("does not let a retired trigger flag veto evidence-based recovery", async () => {
		mocks.scopeWorkflowFlowData.mockReturnValueOnce({
			nodes: [{
				id: "trigger-1",
				data: {
					kind: "workflowTrigger",
					workflowExecutionRecoveryPolicy: "fresh_only",
				},
			}],
			edges: [],
		});
		const freshOnlyFlow: FlowRow = {
			...flow,
			data: JSON.stringify({
				nodes: [{
					id: "trigger-1",
					data: {
						kind: "workflowTrigger",
						workflowExecutionRecoveryPolicy: "fresh_only",
					},
				}],
				edges: [],
			}),
		};
		await expect(startWorkflowExecution(runtime(), {
			flow: freshOnlyFlow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "agent",
			recoveryOfExecutionId: "execution-source",
		})).resolves.toMatchObject({ created: true });
		expect(mocks.createExecution).toHaveBeenCalledTimes(1);
	});

	it("executes the saved graph even when template fingerprint differs", async () => {
		const staleFlow: FlowRow = {
			...flow,
			data: JSON.stringify({
				nodes: [{
					id: "stage",
					data: {
						kind: "workflowStage",
						workflowKey: "one-click-production/v1",
						workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
						workflowCanvasDefinitionFingerprint: "sha256:stale-runtime-contract",
					},
				}],
				edges: [],
			}),
		};

		await expect(startWorkflowExecution(runtime(), {
			flow: staleFlow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "agent",
		})).resolves.toBeDefined();
		expect(mocks.createFlowVersion).toHaveBeenCalledOnce();
		expect(mocks.createExecution).toHaveBeenCalledOnce();
	});

	it("does not stamp a saved workflow with authority from an internal template", async () => {
		const currentFlow: FlowRow = {
			...flow,
			data: JSON.stringify({
				nodes: [{
					id: "stage",
					data: {
						kind: "workflowStage",
						workflowKey: "one-click-production/v1",
						workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
						workflowCanvasDefinitionFingerprint: VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
					},
				}],
				edges: [],
			}),
		};

		await startWorkflowExecution(runtime(), {
			flow: currentFlow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "agent",
		});

		const version = mocks.createFlowVersion.mock.calls[0]?.[1];
		expect(JSON.parse(version?.data ?? "{}")).not.toHaveProperty("workflowDefinitionAuthority");
	});

	it("uses the trigger-authored DAG concurrency when the caller does not own scheduling", async () => {
		mocks.scopeWorkflowFlowData.mockReturnValueOnce({
			nodes: [{
				id: "trigger-1",
				data: { kind: "workflowTrigger", workflowExecutionConcurrency: 16 },
			}],
			edges: [],
		});
		await startWorkflowExecution(runtime(), {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "agent",
		});

		expect(mocks.createExecution).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			concurrency: 16,
		}));
	});

	it("rejects an invalid trigger-authored DAG concurrency", async () => {
		mocks.scopeWorkflowFlowData.mockReturnValueOnce({
			nodes: [{
				id: "trigger-1",
				data: { kind: "workflowTrigger", workflowExecutionConcurrency: 17 },
			}],
			edges: [],
		});

		await expect(startWorkflowExecution(runtime(), {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "agent",
		})).rejects.toMatchObject({
			code: "workflow_flow_invalid",
			status: 400,
		});
	});

	it("freezes external trigger payload and subworkflow ancestry into the immutable execution version", async () => {
		mocks.scopeWorkflowFlowData.mockReturnValueOnce({
			nodes: [{ id: "trigger-1", data: { kind: "workflowTrigger" } }],
			edges: [],
		});
		await startWorkflowExecution(runtime(), {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "event:asset.ready",
			triggerPayload: { version: 1, eventId: "event-1", payload: { assetId: "asset-1" } },
			workflowAncestry: ["root-version", "root-version", "child-version"],
		});
		const createVersionInput = mocks.createFlowVersion.mock.calls[0]?.[1] as Readonly<Record<string, unknown>> | undefined;
		if (!createVersionInput || typeof createVersionInput.data !== "string") throw new Error("Expected a frozen flow version payload");
		const frozen = JSON.parse(createVersionInput.data) as Record<string, unknown>;
		expect(frozen.workflowExecutionAncestry).toEqual(["root-version", "child-version"]);
		expect(frozen.nodes).toEqual([expect.objectContaining({
			id: "trigger-1",
			data: expect.objectContaining({
				workflowTriggerPayload: { version: 1, eventId: "event-1", payload: { assetId: "asset-1" } },
			}),
		})]);
	});

	it("freezes the per-run ProjectContext and persists its asset snapshot in history", async () => {
		mocks.scopeWorkflowFlowData.mockReturnValueOnce({ nodes: [], edges: [] });
		const projectContext = {
			version: 3 as const,
			projectId: "project-1",
			canvasId: "canvas-1",
			sourceNodeId: null,
			selectedAssetIds: ["asset-1"],
			projectAssetIds: ["asset-1"],
			timeline: { clips: [] },
			selection: { nodeIds: ["node-1"], assetIds: ["asset-1"], activeNodeId: "node-1", groupId: null },
			permissions: { principalId: "admin-1", projectRead: true as const, canvasRead: true as const, assetRead: true as const, assetWrite: true },
			assetSnapshot: [{
				assetId: "asset-1",
				assetVersion: 1,
				assetVersionId: "asset-version-1",
				contentFingerprint: "fingerprint-1",
				projectId: "project-1",
				name: "hero",
				canonicalName: "hero",
				kind: "character",
				referenceType: null,
				approvalStatus: null,
				origin: "project_node" as const,
				flowId: "canvas-1",
				nodeId: "node-1",
				mediaKind: "image" as const,
				state: "ready" as const,
				assetUsage: "production" as const,
				assetPurpose: null,
				productionEligible: true,
				productionExclusionReason: null,
				styleFingerprint: null,
				sourceFacts: { referenceType: null, roleName: null, physicalIdentityKey: null,
					characterAssetRole: null, characterProfileVersion: null, identityAnchors: [], prohibitedDrift: [],
					sourceNodeId: null, workflowExecutionId: null, taskId: null, prompt: null },
				updatedAt: "2026-08-17T00:00:00.000Z",
			}],
			capturedAt: "2026-08-17T00:00:00.000Z",
		};
		await startWorkflowExecution(runtime(), {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "agent",
			triggerPayload: { source: "make a film" },
			projectContext,
			callerCanvasSnapshot: {
				nodes: [{ id: "node-1", position: { x: 320, y: 640 }, data: { kind: "image" } }],
				edges: [],
				viewport: { x: 12, y: 24, zoom: 0.75 },
			},
		});
		const frozenVersion = mocks.createFlowVersion.mock.calls[0]?.[1];
		expect(JSON.parse(frozenVersion?.data ?? "{}")).toMatchObject({
			workflowProjectContext: projectContext,
			workflowCallerCanvasSnapshot: {
				nodes: [{ id: "node-1", position: { x: 320, y: 640 }, data: { kind: "image" } }],
				edges: [],
				viewport: { x: 12, y: 24, zoom: 0.75 },
			},
		});
		expect(mocks.createExecution).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			projectId: "project-1",
			canvasId: "canvas-1",
			userInput: "make a film",
			assetSnapshot: projectContext.assetSnapshot,
			usesProjectAssets: true,
		}));
	});

	it("records project-asset usage when the equipped workflow selects caller assets in its trigger payload", async () => {
		await startWorkflowExecution(runtime(), {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "agent",
			triggerPayload: { selectedAssetIds: ["caller-project-asset-1"] },
		});

		expect(mocks.createExecution).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			usesProjectAssets: true,
		}));
	});

	it("freezes the cross-project delivery scope into the immutable execution version", async () => {
		mocks.scopeWorkflowFlowData.mockReturnValueOnce({
			nodes: [{ id: "trigger-1", data: { kind: "workflowTrigger" } }],
			edges: [],
		});
		await startWorkflowExecution(runtime(), {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "agent",
			delivery: { flowId: "caller-flow-1", projectId: "caller-project-1" },
		});
		const createVersionInput = mocks.createFlowVersion.mock.calls[0]?.[1] as Readonly<Record<string, unknown>> | undefined;
		if (!createVersionInput || typeof createVersionInput.data !== "string") throw new Error("Expected a frozen flow version payload");
		const frozen = JSON.parse(createVersionInput.data) as Record<string, unknown>;
		expect(frozen.workflowDeliveryScope).toEqual({ flowId: "caller-flow-1", projectId: "caller-project-1" });
	});

	it("freezes a chapter delivery scope for chapter-canvas media projection", async () => {
		mocks.scopeWorkflowFlowData.mockReturnValueOnce({
			nodes: [{ id: "trigger-1", data: { kind: "workflowTrigger" } }],
			edges: [],
		});
		await startWorkflowExecution(runtime(), {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "agent",
			delivery: {
				flowId: "chapter-1",
				projectId: "caller-project-1",
				chapterId: "chapter-1",
			},
		});
		const createVersionInput = mocks.createFlowVersion.mock.calls[0]?.[1] as Readonly<Record<string, unknown>> | undefined;
		if (!createVersionInput || typeof createVersionInput.data !== "string") throw new Error("Expected a frozen flow version payload");
		const frozen = JSON.parse(createVersionInput.data) as Record<string, unknown>;
		expect(frozen.workflowDeliveryScope).toEqual({
			flowId: "chapter-1",
			projectId: "caller-project-1",
			chapterId: "chapter-1",
		});
	});

	it("omits the delivery scope when the caller is executing inside the workflow's own flow", async () => {
		mocks.scopeWorkflowFlowData.mockReturnValueOnce({
			nodes: [{ id: "trigger-1", data: { kind: "workflowTrigger" } }],
			edges: [],
		});
		await startWorkflowExecution(runtime(), {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "agent",
			delivery: { flowId: flow.id, projectId: null },
		});
		const createVersionInput = mocks.createFlowVersion.mock.calls[0]?.[1] as Readonly<Record<string, unknown>> | undefined;
		if (!createVersionInput || typeof createVersionInput.data !== "string") throw new Error("Expected a frozen flow version payload");
		const frozen = JSON.parse(createVersionInput.data) as Record<string, unknown>;
		expect(frozen.workflowDeliveryScope).toBeUndefined();
	});

	it("allows a dependency-prefix run without a terminal workflow output", async () => {
		mocks.inspectWorkflowExecutionSupport.mockReturnValue({
			hasWorkflowOutput: false,
			nodes: [],
			unsupportedNodes: [],
		});
		const result = await startWorkflowExecution(runtime(), {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			stopAfterNodeId: "planner-1",
			trigger: "manual",
		});

		expect(result.created).toBe(true);
		expect(mocks.scopeWorkflowFlowData).toHaveBeenCalledWith(flow.data, "trigger-1", "planner-1", undefined);
	});

	it("reports an unavailable replay model identity before admitting a new Agent execution", async () => {
		mocks.scopeWorkflowFlowData.mockReturnValueOnce({ nodes: [{ id: "consumer", data: {
			workflowAtomicSpec: { executorRef: "agents.logical-task/v2" } } }], edges: [] });
		await expect(startWorkflowExecution(runtime(), { flow, ownerId: "admin-1", triggerNodeId: "trigger-1", stopAfterNodeId: "consumer",
			trigger: "manual", replay: { sourceExecutionId: "old", startFromNodeId: "consumer" }, replayInvocationFacts: {} })).rejects.toMatchObject({ code: "workflow_agent_execution_invalid", status: 400 });
		expect(mocks.createExecution).not.toHaveBeenCalled();
	});

	it("preserves server-resolved frozen source and caller facts across live graph scoping", async () => {
		const facts = { workflowSourceSnapshots: [{ nodeId: "source", text: "frozen canonical" }],
			workflowDirectAgentModelSelection: { model: "frozen-model", source: "user_preference" },
			workflowDeliveryScope: { projectId: "caller-project", flowId: "caller-canvas" },
			workflowReplayInvocation: { version: 1, sourceExecutionId: "old" } };
		await startWorkflowExecution(runtime(), { flow, ownerId: "admin-1", triggerNodeId: "trigger-1", stopAfterNodeId: "consumer",
			trigger: "manual", replay: { sourceExecutionId: "old", startFromNodeId: "consumer" }, replayInvocationFacts: facts });
		const saved = JSON.parse(mocks.createFlowVersion.mock.calls[0][1].data) as Record<string, unknown>;
		for (const [key, value] of Object.entries(facts)) expect(saved[key]).toEqual(value);
	});

	it("passes a nested checkpoint replay boundary through scope and output reuse", async () => {
		await startWorkflowExecution(runtime(), {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			stopAfterNodeId: "pipeline-1::step::materialize",
			replay: { sourceExecutionId: "source-execution-1", startFromNodeId: "pipeline-1" },
			trigger: "manual",
		});

		expect(mocks.scopeWorkflowFlowData).toHaveBeenCalledWith(flow.data, "trigger-1", "pipeline-1::step::materialize", "pipeline-1");
		expect(mocks.prepareWorkflowOutputReuse).toHaveBeenCalledWith(expect.objectContaining({
			replay: { sourceExecutionId: "source-execution-1", startFromNodeId: "pipeline-1" },
		}));
	});

	it("admits a four-node source across a DAG release with frozen media into nested writer materialization using real scope and reuse protocols", async () => {
		const fixture = boundedReplayFixture();
		for (const node of fixture.source.nodes) Object.assign(node.data, { workflowCanvasDefinitionVersion: 124, workflowCanvasDefinitionFingerprint: "previous-publication" });
		for (const node of fixture.live.nodes) Object.assign(node.data, { workflowCanvasDefinitionVersion: 125, workflowCanvasDefinitionFingerprint: "current-publication" });
		fixture.source.nodes.find(node => node.id === "contract")!.data.workflowVideoModelKey = "dola-seedance-2.5";
		fixture.live.nodes.find(node => node.id === "contract")!.data.workflowVideoModelKey = "seedance20";
		const sourceBefore = structuredClone(fixture.source);
		const scope = await vi.importActual<typeof import("./execution.flow-scope")>("./execution.flow-scope");
		const reuse = await vi.importActual<typeof import("./execution.output-reuse")>("./execution.output-reuse");
		mocks.scopeWorkflowFlowData.mockImplementationOnce(scope.scopeWorkflowFlowData);
		mocks.prepareWorkflowOutputReuse.mockImplementationOnce(async input => reuse.prepareWorkflowOutputReuse({ flowData: input.flowData, flowId: "flow-1", ownerId: "admin-1",
			replay: { sourceExecutionId: "bounded-author", startFromNodeId: "project", requireSuccessfulAncestors: true }, repository: fixture.repository }));
		mocks.getExecutionById.mockResolvedValueOnce(null as never);
		await startWorkflowExecution(runtime(), { flow: { ...flow, data: JSON.stringify(fixture.live) }, ownerId: "admin-1", triggerNodeId: "trigger", stopAfterNodeId: "pipeline::step::clip-production-nodes-materialize", trigger: "manual",
			replay: { sourceExecutionId: "bounded-author", startFromNodeId: "project", requireSuccessfulAncestors: true }, replayInvocationFacts: { workflowDirectAgentModelSelection: { model: "frozen-model", source: "user_preference" } },
			replayAttempt: { version: 1, idempotencyKey: "bounded-consumer", requestHash: "sha256:bounded" },
			triggerPayload: { onlyVideoNodes: false, videoModelKey: "dola-seedance-2.5" } });
		const accepted = JSON.parse(mocks.createFlowVersion.mock.calls.at(-1)![1].data) as { nodes: Array<{ id: string; data: Record<string, unknown> }> };
		expect(reuse.readResolvedWorkflowOutputReuses(accepted).map(r => r.nodeId).sort()).toEqual(["author", "contract", "source", "trigger"]);
		const pipeline = accepted.nodes.find(n => n.id === "pipeline")!.data.workflowPipeline as { steps: Array<{ stepId: string }> };
		expect(pipeline.steps.map(step => step.stepId)).toEqual(["clip-production-agent", "clip-production-collect", "clip-production-nodes-materialize"]);
		expect(accepted.nodes.map(n => n.id).sort()).toEqual(["trigger", "source", "contract", "author", "project", "assets", "pipeline"].sort());
		expect(accepted.nodes.find(node => node.id === "contract")!.data.workflowVideoModelKey).toBe("dola-seedance-2.5");
		expect(accepted.nodes.find(node => node.id === "trigger")!.data.workflowCanvasDefinitionVersion).toBe(125);
		expect(fixture.source).toEqual(sourceBefore);
	});
	it("reuses an accepted consumer replay before rebuilding source or refreshing assets", async () => {
		const attempt = { version: 1 as const, idempotencyKey: "consumer-key", requestHash: "sha256:request" };
		mocks.getFlowVersion.mockResolvedValueOnce({ data: JSON.stringify({ workflowReplayAttempt: attempt }) });
		mocks.getExecutionById.mockImplementationOnce(async (_db, id) => ({ id, flow_id: "flow-1", flow_version_id: "accepted-version", owner_id: "admin-1", project_id: "project-1", canvas_id: "canvas-1", status: "success", concurrency: 1, trigger: "manual", error_message: null, execution_family_id: id, created_at: "2026-08-11", started_at: null, finished_at: null }));
		const result = await startWorkflowExecution(runtime(), { flow, ownerId: "admin-1", triggerNodeId: "trigger", stopAfterNodeId: "stop", trigger: "manual",
			replay: { sourceExecutionId: "source", startFromNodeId: "consumer" }, replayInvocationFacts: {}, replayAttempt: attempt });
		expect(result).toMatchObject({ created: false, execution: { flowVersionId: "accepted-version" } });
		expect(mocks.scopeWorkflowFlowData).not.toHaveBeenCalled();
		expect(mocks.createFlowVersion).not.toHaveBeenCalled();
		expect(mocks.createExecution).not.toHaveBeenCalled();
	});
	it("same consumer key with different scope fingerprint conflicts rather than creating another execution", async () => {
		const attempt = { version: 1 as const, idempotencyKey: "consumer-key", requestHash: "sha256:original" };
		mocks.getFlowVersion.mockResolvedValueOnce({ data: JSON.stringify({ workflowReplayAttempt: attempt }) });
		await expect(findExistingWorkflowConsumerReplay(runtime(), { flowId: "flow-1", ownerId: "admin-1", attempt: { ...attempt, requestHash: "sha256:changed-scope" } })).rejects.toMatchObject({ status: 409, details: { reason: "workflow_replay_idempotency_conflict" } });
		expect(mocks.createExecution).not.toHaveBeenCalled();
	});
	it("checks a raced consumer version claim before execution admission", async () => {
		const attempt = { version: 1 as const, idempotencyKey: "consumer-race", requestHash: "sha256:request" };
		mocks.getExecutionById.mockResolvedValueOnce(null as never);
		mocks.createFlowVersion.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("claimed", { code: "P2002", clientVersion: "test" }));
		mocks.getFlowVersion.mockResolvedValueOnce({ data: JSON.stringify({ workflowReplayAttempt: { ...attempt, requestHash: "sha256:different" } }) });
		await expect(startWorkflowExecution(runtime(), { flow, ownerId: "admin-1", triggerNodeId: "trigger", stopAfterNodeId: "stop", trigger: "manual",
			replay: { sourceExecutionId: "source", startFromNodeId: "consumer" }, replayInvocationFacts: {}, replayAttempt: attempt })).rejects.toMatchObject({ status: 409, details: { reason: "workflow_replay_idempotency_conflict" } });
		expect(mocks.createExecution).not.toHaveBeenCalled();
	});
	it("uses the winning immutable project and asset view after an identical consumer version race", async () => {
		const attempt = { version: 1 as const, idempotencyKey: "same-race", requestHash: "sha256:same-request" };
		const winning = createWorkflowProjectContext({ projectId: "project-1", canvasId: "chapter-original", principalId: "admin-1", canvasData: { nodes: [], edges: [] }, assets: [], now: new Date("2026-09-01T00:00:00.000Z") });
		const refreshed = { ...winning, capturedAt: "2026-09-30T00:00:00.000Z" };
		mocks.getExecutionById.mockResolvedValueOnce(null as never);
		mocks.createFlowVersion.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("version claimed", { code: "P2002", clientVersion: "test" }));
		mocks.getFlowVersion.mockResolvedValueOnce({ data: JSON.stringify({ nodes: [], edges: [], workflowReplayAttempt: attempt, workflowProjectContext: winning }) });
		await startWorkflowExecution(runtime(), { flow, ownerId: "admin-1", triggerNodeId: "trigger", stopAfterNodeId: "stop", trigger: "manual", projectContext: refreshed,
			replay: { sourceExecutionId: "source", startFromNodeId: "consumer" }, replayInvocationFacts: { workflowProjectContext: refreshed }, replayAttempt: attempt });
		expect(mocks.createExecution.mock.calls.at(-1)?.[1]).toMatchObject({ canvasId: "chapter-original", projectContext: winning, assetSnapshot: winning.assetSnapshot });
	});
	it("creates independent consumer attempts for explicit new keys and reclaims duplicate execution races", async () => {
		const ids: string[] = [];
		for (const idempotencyKey of ["consumer-one", "consumer-two"]) {
			mocks.getExecutionById.mockResolvedValueOnce(null as never);
			const attempt = { version: 1 as const, idempotencyKey, requestHash: "sha256:request" };
			await startWorkflowExecution(runtime(), { flow, ownerId: "admin-1", triggerNodeId: "trigger", stopAfterNodeId: "stop", trigger: "manual", replay: { sourceExecutionId: "source", startFromNodeId: "consumer" }, replayInvocationFacts: {}, replayAttempt: attempt });
			ids.push(String(mocks.createExecution.mock.calls.at(-1)?.[1].id));
		}
		expect(ids[0]).not.toBe(ids[1]);
		const attempt = { version: 1 as const, idempotencyKey: "consumer-race", requestHash: "sha256:request" };
		mocks.getExecutionById.mockResolvedValueOnce(null as never);
		mocks.createExecution.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("claimed", { code: "P2002", clientVersion: "test" }));
		mocks.getFlowVersion.mockResolvedValueOnce({ data: JSON.stringify({ workflowReplayAttempt: attempt }) });
		expect(await startWorkflowExecution(runtime(), { flow, ownerId: "admin-1", triggerNodeId: "trigger", stopAfterNodeId: "stop", trigger: "manual", replay: { sourceExecutionId: "source", startFromNodeId: "consumer" }, replayInvocationFacts: {}, replayAttempt: attempt })).toMatchObject({ created: false });
	});
	it("reuses an accepted author revision without another admission and rejects changed diagnostic under its key", async () => {
		const repair = { version: 1 as const, sourceKind: "delivery_artifact" as const, sourceNodeRunId: "old-author",
			deliveryHash: workflowAuthorDeliveryHash("compiled delivery"), diagnostic: "actual obligation", idempotencyKey: "attempt-1" };
		const attempt = workflowAuthorRepairAttempt(repair, "source", "author");
		mocks.getFlowVersion.mockResolvedValueOnce({ data: JSON.stringify({ workflowAuthorRepairAttempt: attempt }) });
		mocks.getExecutionById.mockImplementationOnce(async (_db, id) => ({ id, flow_id: "flow-1", flow_version_id: "old-frozen",
			owner_id: "admin-1", project_id: "project-1", canvas_id: "canvas-1", status: "success", concurrency: 1,
			trigger: "manual", error_message: null, execution_family_id: id, created_at: "2026-08-11T09:00:00.000Z", started_at: null, finished_at: null }));
		const input = { flow, ownerId: "admin-1", triggerNodeId: "trigger-1", stopAfterNodeId: "author", trigger: "manual",
			replay: { sourceExecutionId: "source", startFromNodeId: "author", authorRepair: repair } };
		const env = runtime();
		expect(await startWorkflowExecution(env, input)).toMatchObject({ created: false, execution: { flowVersionId: "old-frozen", status: "success" } });
		expect(mocks.createExecution).not.toHaveBeenCalled();
		expect(mocks.createFlowVersion).not.toHaveBeenCalled();
		expect(env.EXECUTION_DO?.get).not.toHaveBeenCalled();
		mocks.getFlowVersion.mockResolvedValueOnce({ data: JSON.stringify({ workflowAuthorRepairAttempt: attempt }) });
		await expect(startWorkflowExecution(runtime(), { ...input, replay: { ...input.replay, authorRepair: { ...repair, diagnostic: "changed" } } })).rejects.toMatchObject({ status: 409, details: { reason: "workflow_author_repair_idempotency_conflict" } });
		mocks.getFlowVersion.mockResolvedValueOnce({ data: JSON.stringify({ workflowAuthorRepairAttempt: attempt }) });
		await expect(startWorkflowExecution(runtime(), { ...input, replay: { ...input.replay, authorRepair: { ...repair, editablePaths: ["/title"] } } })).rejects.toMatchObject({ status: 409, details: { reason: "workflow_author_repair_idempotency_conflict" } });
		expect(mocks.createExecution).not.toHaveBeenCalled();
	});
	it("checks the immutable attempt identity after a concurrent version claim before creating an execution", async () => {
		const repair = { version: 1 as const, sourceKind: "delivery_artifact" as const, sourceNodeRunId: "old-author",
			deliveryHash: workflowAuthorDeliveryHash("compiled delivery"), diagnostic: "current", idempotencyKey: "attempt-race" };
		mocks.getExecutionById.mockResolvedValueOnce(null as never);
		mocks.createFlowVersion.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("version claimed", { code: "P2002", clientVersion: "test" }));
		mocks.getFlowVersion.mockResolvedValueOnce({ data: JSON.stringify({ workflowAuthorRepairAttempt: workflowAuthorRepairAttempt({ ...repair, diagnostic: "other" }, "source", "author") }) });
		await expect(startWorkflowExecution(runtime(), { flow, ownerId: "admin-1", triggerNodeId: "trigger-1", stopAfterNodeId: "author", trigger: "manual",
			replay: { sourceExecutionId: "source", startFromNodeId: "author", authorRepair: repair } })).rejects.toMatchObject({ status: 409, details: { reason: "workflow_author_repair_idempotency_conflict" } });
		expect(mocks.createExecution).not.toHaveBeenCalled();
	});
	it("permits a fresh explicit author revision key and preserves independent execution identity", async () => {
		const repair = { version: 1 as const, sourceKind: "delivery_artifact" as const, sourceNodeRunId: "old-author", deliveryHash: workflowAuthorDeliveryHash("compiled"), diagnostic: "actual obligation", idempotencyKey: "attempt-1" };
		const ids: string[] = [];
		for (const key of ["attempt-1", "attempt-2"]) {
			mocks.getExecutionById.mockResolvedValueOnce(null as never);
			await startWorkflowExecution(runtime(), { flow, ownerId: "admin-1", triggerNodeId: "trigger-1", stopAfterNodeId: "author", trigger: "manual",
				replay: { sourceExecutionId: "source", startFromNodeId: "author", authorRepair: { ...repair, idempotencyKey: key } } });
			ids.push(String(mocks.createExecution.mock.calls.at(-1)?.[1].id));
		}
		expect(ids[0]).not.toBe(ids[1]);
	});
	it("reuses a selected consumer attempt and refuses another range under the same accepted key", async () => {
		const consumerReplay = { version: 1 as const, sourceNodeRunId: "old-root", deliveryHash: workflowAuthorDeliveryHash("new author"),
			idempotencyKey: "one-consumer", targetPath: [{ kind: "step" as const, stepId: "author" }, { kind: "item" as const, itemId: "exact-item" }],
			startStepId: "collect", stopStepId: "materialize" };
		const attempt = workflowConsumerReplaySelectionAttempt(consumerReplay, "source", "pipeline");
		const input = { flow, ownerId: "admin-1", triggerNodeId: "trigger-1", stopAfterNodeId: "pipeline", trigger: "manual",
			replay: { sourceExecutionId: "source", startFromNodeId: "pipeline", consumerReplay } };
		mocks.getFlowVersion.mockResolvedValueOnce({ data: JSON.stringify({ workflowConsumerReplayAttempt: attempt }) });
		expect(await startWorkflowExecution(runtime(), input)).toMatchObject({ created: false });
		expect(mocks.createExecution).not.toHaveBeenCalled(); expect(mocks.createFlowVersion).not.toHaveBeenCalled();
		mocks.getFlowVersion.mockResolvedValueOnce({ data: JSON.stringify({ workflowConsumerReplayAttempt: attempt }) });
		await expect(startWorkflowExecution(runtime(), { ...input, replay: { ...input.replay, consumerReplay: { ...consumerReplay, stopStepId: "other" } } })).rejects.toMatchObject({ status: 409 });
		expect(mocks.createExecution).not.toHaveBeenCalled();
	});
	it("derives stable execution and flow-version identities for an occurrence", async () => {
		const env = runtime();
		await startWorkflowExecution(env, {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "schedule",
			idempotencyKey: "occurrence-1",
		});
		await startWorkflowExecution(env, {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "schedule",
			idempotencyKey: "occurrence-1",
		});
		const firstExecution = mocks.createExecution.mock.calls[0]?.[1];
		const secondExecution = mocks.createExecution.mock.calls[1]?.[1];
		if (!firstExecution || !secondExecution) throw new Error("Expected two persisted workflow execution attempts");
		expect(secondExecution.id).toBe(firstExecution.id);
		expect(secondExecution.flowVersionId).toBe(firstExecution.flowVersionId);
	});

	it("reclaims a queued occurrence after a concurrent scanner or process crash", async () => {
		mocks.createExecution.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
			"duplicate execution",
			{ code: "P2002", clientVersion: "test" },
		));
		const env = runtime();
		const result = await startWorkflowExecution(env, {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "schedule",
			idempotencyKey: "occurrence-after-crash",
		});
		expect(result.created).toBe(false);
		expect(env.EXECUTION_DO?.get).toHaveBeenCalledTimes(1);
	});

	it("rejects unsupported nodes before creating persistent execution state", async () => {
		mocks.inspectWorkflowExecutionSupport.mockReturnValue({
			hasWorkflowOutput: true,
			nodes: [],
			unsupportedNodes: [{ nodeId: "missing", kind: "task", reason: "executor_not_registered" }],
		});
		await expect(startWorkflowExecution(runtime(), {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "manual",
		})).rejects.toMatchObject({
			code: "workflow_node_executor_missing",
			status: 501,
		});
		expect(mocks.createFlowVersion).not.toHaveBeenCalled();
		expect(mocks.createExecution).not.toHaveBeenCalled();
	});

	it("freezes all initiating execution preferences into the durable version", async () => {
  mocks.scopeWorkflowFlowData.mockReturnValueOnce({ nodes: [], edges: [], workflowExecutionScope: { workflowKey: "generic/v1" } });
  const initiatingAgentExecution = { model: "gpt-5.6-luna", apiStyle: "responses" as const, reasoningEffort: "xhigh" as const, serviceTier: "priority" as const };
  await startWorkflowExecution(runtime(), { flow, ownerId: "admin-1", triggerNodeId: "video-trigger", trigger: "agent", initiatingAgentExecution });
  expect(mocks.createFlowVersion).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
   data: expect.any(String),
  }));
  const saved = mocks.createFlowVersion.mock.calls[0]?.[1] as { data: string };
  expect(JSON.parse(saved.data).workflowInitiatingAgentExecution).toEqual(initiatingAgentExecution);
 });

	it("starts one-click production through the same durable workflow runtime used by canvas and agents", async () => {
		mocks.scopeWorkflowFlowData.mockReturnValueOnce({
			nodes: [],
			edges: [],
			workflowExecutionScope: { workflowKey: "one-click-production/v1" },
		});
		const env = runtime();
		const result = await startWorkflowExecution(env, {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "video-trigger",
			trigger: "manual",
		});
		expect(result.created).toBe(true);
		expect(mocks.createFlowVersion).toHaveBeenCalledTimes(1);
		expect(mocks.createExecution).toHaveBeenCalledTimes(1);
		expect(env.EXECUTION_DO?.get).toHaveBeenCalledTimes(1);
	});

	it("materializes the accepted execution before dispatching the durable scheduler", async () => {
		const env = runtime();
		const materializeAcceptedExecution = vi.fn(async () => {
			expect(env.EXECUTION_DO?.get).not.toHaveBeenCalled();
		});

		await startWorkflowExecution(env, {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "agent",
			materializeAcceptedExecution,
		});

		expect(materializeAcceptedExecution).toHaveBeenCalledWith(expect.objectContaining({
			id: expect.any(String),
			status: "queued",
		}));
		expect(env.EXECUTION_DO?.get).toHaveBeenCalledTimes(1);
	});

	it("keeps a newly accepted execution queued when its caller-canvas node cannot be persisted", async () => {
		const env = runtime();
		await expect(startWorkflowExecution(env, {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "agent",
			materializeAcceptedExecution: async () => {
				throw new Error("canvas write failed");
			},
		})).rejects.toMatchObject({
			code: "workflow_execution_projection_failed",
			status: 503,
			details: expect.objectContaining({ cause: "canvas write failed" }),
		});

		expect(mocks.createExecution).toHaveBeenCalledTimes(1);
		expect(env.EXECUTION_DO?.get).not.toHaveBeenCalled();
	});

	it("backfills the projection before reclaiming an idempotent queued execution", async () => {
		mocks.createExecution.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
			"duplicate execution",
			{ code: "P2002", clientVersion: "test" },
		));
		const env = runtime();
		const materializeAcceptedExecution = vi.fn(async () => {
			expect(env.EXECUTION_DO?.get).not.toHaveBeenCalled();
		});

		const result = await startWorkflowExecution(env, {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "agent",
			idempotencyKey: "projection-backfill",
			materializeAcceptedExecution,
		});

		expect(result.created).toBe(false);
		expect(materializeAcceptedExecution).toHaveBeenCalledTimes(1);
		expect(env.EXECUTION_DO?.get).toHaveBeenCalledTimes(1);
	});

	it.each([503, 429, 408])("keeps a durable queued start after scheduler HTTP %s", async (status) => {
		const result = await startWorkflowExecution(runtime(new Response("unavailable", { status })), {
			flow, ownerId: "admin-1", triggerNodeId: "trigger-1", trigger: "manual",
		});
		expect(result.execution.status).toBe("queued");
		expect(mocks.updateExecutionStatus).not.toHaveBeenCalled();
	});

	it("does not overwrite a running job when its start acknowledgement is lost", async () => {
		const env = runtime();
		vi.mocked(env.EXECUTION_DO!.get).mockReturnValue({
			fetch: vi.fn(async () => { throw new TypeError("fetch failed"); }),
		} as unknown as ReturnType<NonNullable<WorkerEnv["EXECUTION_DO"]>["get"]>);
		await expect(startDurableExecution(env, "ack-lost")).resolves.toBeUndefined();
		expect(mocks.updateExecutionStatus).not.toHaveBeenCalled();
	});

	it("persists a terminal failure for a deterministic scheduler rejection", async () => {
		await expect(startWorkflowExecution(runtime(new Response("scheduler unauthorized", { status: 403 })), {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "manual",
		})).rejects.toMatchObject({ code: "workflow_start_failed" });
		expect(mocks.updateExecutionStatus).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			status: "failed",
			errorMessage: expect.stringContaining("scheduler unauthorized"),
		}));
	});
});

describe("workflow trigger media overrides", () => {
	beforeEach(() => {
		savedFlowVersions.clear();
		for (const mock of Object.values(mocks)) mock.mockClear();
		// 清空上一个 describe 可能残留的 once 队列，恢复默认实现。
		mocks.scopeWorkflowFlowData.mockReset();
		mocks.scopeWorkflowFlowData.mockReturnValue({ nodes: [], edges: [] });
		mocks.inspectWorkflowExecutionSupport.mockReturnValue({
			hasWorkflowOutput: true,
			nodes: [],
			unsupportedNodes: [],
		});
	});

	it("freezes per-call video and image model contracts into the media executor nodes", async () => {
		mocks.scopeWorkflowFlowData.mockReturnValueOnce({
			nodes: [
				{ id: "trigger-1", data: { kind: "workflowTrigger" } },
				{ id: "delivery", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "agents.delivery.contract/v2" } } },
				{ id: "estimate", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "video.estimate/v1" } } },
				{ id: "prepare", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "tapcanvas.video.prepare/v1" } } },
				{ id: "video", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "tapcanvas.video.generate/v1" } } },
				{ id: "image", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "tapcanvas.image.generate/v1" } } },
				{ id: "text", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "workflow.input.text/v1" } } },
			],
			edges: [],
		});
		await startWorkflowExecution(runtime(), {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "agent",
			triggerPayload: {
				source: "竖版 40s 高燃打斗",
				targetDurationSeconds: 40,
				videoModelKey: "minimax-h3-test",
				imageModelKey: "gpt-image-2",
				imageQuality: "high",
				imageSize: "2K",
				videoResolution: "768p",
				videoSize: "9:16",
				videoAspectRatio: "9:16",
				imageAspectRatio: "9:16",
			},
		});
		const createVersionInput = mocks.createFlowVersion.mock.calls[0]?.[1] as Readonly<Record<string, unknown>> | undefined;
		if (!createVersionInput || typeof createVersionInput.data !== "string") throw new Error("Expected a frozen flow version payload");
		const frozen = JSON.parse(createVersionInput.data) as Record<string, unknown>;
		const nodeIds = (frozen.nodes as Array<Record<string, unknown>>).map((node) => node.id);
		console.log("frozen node ids:", JSON.stringify(nodeIds));
		const byId = new Map((frozen.nodes as Array<Record<string, unknown>>).map((node) => [node.id, node.data as Record<string, unknown>]));
		expect((byId.get("delivery") as Record<string, unknown>).workflowVideoModelKey).toBe("minimax-h3-test");
		const estimate = byId.get("estimate") as Record<string, unknown>;
		expect(estimate.workflowVideoModelKey).toBe("minimax-h3-test");
		expect(estimate.workflowVideoResolution).toBe("768p");
		expect(estimate.workflowVideoSize).toBe("9:16");
		expect(estimate.workflowVideoAspectRatio).toBe("9:16");
		const prepare = byId.get("prepare") as Record<string, unknown>;
		expect(prepare.workflowVideoSize).toBe("9:16");
		const video = byId.get("video") as Record<string, unknown>;
		expect(video.workflowVideoResolution).toBe("768p");
		expect(video.workflowVideoSize).toBe("9:16");
		expect(video.workflowVideoAspectRatio).toBe("9:16");
		const image = byId.get("image") as Record<string, unknown>;
		expect(image.workflowImageModelKey).toBe("gpt-image-2");
		expect(image.workflowImageQuality).toBe("high");
		expect(image.workflowImageAspectRatio).toBe("9:16");
		expect(image.workflowImageSize).toBe("2K");
		// 非媒体节点不受影响。
		expect((byId.get("text") as Record<string, unknown>).workflowVideoAspectRatio).toBeUndefined();
	});

	it("rejects an incomplete video estimate snapshot before creating an execution", async () => {
		mocks.scopeWorkflowFlowData.mockReturnValueOnce({
			nodes: [
				{ id: "trigger-1", data: { kind: "workflowTrigger" } },
				{
					id: "estimate",
					data: {
						kind: "workflowStage",
						workflowAtomicSpec: { executorRef: "video.estimate/v1" },
					},
				},
			],
			edges: [],
		});

		await expect(startWorkflowExecution(runtime(), {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "agent",
			triggerPayload: {
				videoModelKey: "doubao-seedance-2.0",
				videoAspectRatio: "16:9",
			},
		})).rejects.toMatchObject({
			code: "workflow_flow_invalid",
			status: 400,
			details: {
				nodeId: "estimate",
				missingTriggerPayloadFields: ["videoResolution"],
			},
		});
		expect(mocks.createFlowVersion).not.toHaveBeenCalled();
		expect(mocks.createExecution).not.toHaveBeenCalled();
	});

	it("rejects a stale direct video-submit model before creating an execution", async () => {
		mocks.scopeWorkflowFlowData.mockReturnValueOnce({
			nodes: [
				{ id: "trigger-1", data: { kind: "workflowTrigger" } },
				{
					id: "estimate",
					data: {
						kind: "workflowStage",
						workflowAtomicSpec: { executorRef: "video.estimate/v1" },
						workflowVideoModelKey: "live-video",
						workflowVideoResolution: "720p",
						workflowVideoAspectRatio: "16:9",
					},
				},
				{
					id: "video",
					data: {
						kind: "workflowStage",
						workflowAtomicSpec: { executorRef: "tapcanvas.video.generate/v1" },
						workflowVideoModelKey: "retired-video",
					},
				},
			],
			edges: [],
		});
		mocks.listNewApiModels.mockResolvedValueOnce([{
			id: 1,
			modelName: "live-video",
			requestModelKey: "live-video",
			routingAliases: [],
			displayLabel: "Live video",
			description: null,
			icon: null,
			tags: [],
			vendorId: null,
			endpoints: ["task.video"],
			runtimeEndpoints: ["task.video"],
			kind: "video",
			enabled: true,
			syncOfficial: true,
			nameRule: 1,
			createdTime: 1,
			updatedTime: 1,
			meta: null,
			pricing: { cost: 1, enabled: true, specCosts: [] },
		}]);

		await expect(startWorkflowExecution(runtime(), {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "agent",
		})).rejects.toMatchObject({
			code: "workflow_flow_invalid",
			status: 409,
			details: {
				unavailableVideoModels: [{
					nodeId: "video",
					modelKey: "retired-video",
					executorRef: "tapcanvas.video.generate/v1",
				}],
			},
		});
		expect(mocks.createFlowVersion).not.toHaveBeenCalled();
		expect(mocks.createExecution).not.toHaveBeenCalled();
	});
});

describe("exclusive caller-canvas delivery", () => {
	it("fences a full chapter delivery run and surfaces a busy canvas as an actionable conflict", async () => {
		mocks.scopeWorkflowFlowData.mockReturnValueOnce({
			nodes: [{ id: "trigger-1", data: { kind: "workflowTrigger" } }],
			edges: [],
		});
		const busy = Object.assign(new Error("busy"), {
			name: "WorkflowDeliveryScopeBusyError",
			activeExecutionId: "execution-already-running",
		});
		mocks.createExecution.mockRejectedValueOnce(busy);

		await expect(startWorkflowExecution(runtime(), {
			flow,
			ownerId: "admin-1",
			triggerNodeId: "trigger-1",
			trigger: "agent",
			delivery: { flowId: "chapter-1", projectId: "caller-project-1", chapterId: "chapter-1" },
		})).rejects.toMatchObject({
			name: "WorkflowStartError",
			code: "workflow_delivery_scope_busy",
			status: 409,
			details: { activeExecutionId: "execution-already-running" },
		});
		expect(mocks.createExecution).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			exclusiveDeliveryScope: { projectId: "caller-project-1", canvasId: "chapter-1" },
		}));
	});
});

describe("resolveExclusiveDeliveryScope", () => {
	it("fences only full runs that deliver into a caller canvas", () => {
		const base = { deliversIntoCallerCanvas: true, fullRun: true, projectId: "p", canvasId: "chapter:c1" };
		expect(resolveExclusiveDeliveryScope(base)).toEqual({ projectId: "p", canvasId: "chapter:c1" });
		expect(resolveExclusiveDeliveryScope({ ...base, fullRun: false })).toBeNull();
		expect(resolveExclusiveDeliveryScope({ ...base, deliversIntoCallerCanvas: false })).toBeNull();
		expect(resolveExclusiveDeliveryScope({ ...base, projectId: null })).toBeNull();
		expect(resolveExclusiveDeliveryScope({ ...base, canvasId: "  " })).toBeNull();
	});
});
