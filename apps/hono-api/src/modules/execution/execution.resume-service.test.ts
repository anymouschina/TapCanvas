import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext, WorkerEnv } from "../../types";
import {
	createWorkflowArtifactContract,
	createWorkflowInputContractRejection,
	WorkflowInputContractError,
} from "./execution.input-contract";

const BALANCE_OUTPUT_REFS = JSON.stringify({
	protocolVersion: "1",
	executorRef: "agents.chat/v2",
	nodeId: "agent-beat-sheet",
	executionMode: "once",
	ports: {},
	artifacts: [],
	evidence: {
		requestTerminal: {
			status: "suspended",
			reason: "provider_balance_required",
		},
	},
	itemRuns: [],
});

const frozenRoot = {
	nodes: [
		{
			id: "trigger",
			data: {
				workflowTriggerPayload: { source: "create a video" },
			},
		},
		{
			id: "agent-beat-sheet",
			data: {
				workflowInitiatingAgentExecution: {
					modelKey: "gpt-5.6-luna",
					apiStyle: "responses",
				},
			},
		},
	],
	edges: [],
	workflowExecutionScope: { triggerNodeId: "trigger" },
};

const sourceExecution = {
	id: "execution-source",
	flow_id: "flow-1",
	flow_version_id: "version-1",
	owner_id: "owner-1",
	status: "running",
	concurrency: 1,
	trigger: "agent",
	error_message: null,
	project_id: "project-1",
	execution_family_id: "execution-family-1",
	created_at: "2026-08-23T00:00:00.000Z",
	started_at: "2026-08-23T00:00:01.000Z",
	finished_at: null,
};

const nodeRuns = [{
	id: "node-run-1",
	execution_id: sourceExecution.id,
	node_id: "agent-beat-sheet",
	status: "waiting_external",
	attempt: 2,
	error_message: null,
	output_refs: BALANCE_OUTPUT_REFS,
	created_at: "2026-08-23T00:00:02.000Z",
	started_at: "2026-08-23T00:00:02.000Z",
	finished_at: null,
}];

const mocks = vi.hoisted(() => ({
	getFlowForOwner: vi.fn(),
	getExecutionForOwner: vi.fn(),
	getExecutionSnapshotForOwner: vi.fn(),
	listNodeRunsForExecutionOwner: vi.fn(),
	getWorkflowExecutionFamilyPageForOwner: vi.fn(),
	getLatestFailedWorkflowExecutionIdForOwner: vi.fn(),
	listWorkflowExecutionFamilyMemberIdsForOwner: vi.fn(),
	listWorkflowNodeAttemptsPageForExecutionOwner: vi.fn(),
	collectWorkflowAgentTurnIdentities: vi.fn(() => []),
	listActiveWorkflowAgentTurnIdentities: vi.fn(async () => []),
	mergeWorkflowAgentTurnIdentities: vi.fn(() => []),
	cancelWorkflowAgentTurns: vi.fn(async () => []),
	applyWorkflowAgentModelCutover: vi.fn((root: unknown) => root),
	cancelActiveWorkflowNodeJobs: vi.fn(),
	startWorkflowExecution: vi.fn(),
}));

vi.mock("../flow/flow.repo", () => ({
	getFlowForOwner: mocks.getFlowForOwner,
}));

vi.mock("./execution.repo", () => ({
	getExecutionForOwner: mocks.getExecutionForOwner,
	getExecutionSnapshotForOwner: mocks.getExecutionSnapshotForOwner,
	listNodeRunsForExecutionOwner: mocks.listNodeRunsForExecutionOwner,
	mapExecutionSnapshotRow: (row: Readonly<{
		id: string;
		flow_id: string;
		flow_version_id: string;
		flow_versions: Readonly<{ name: string; data: string; created_at: string }>;
	}>) => ({
		executionId: row.id,
		flowId: row.flow_id,
		flowVersionId: row.flow_version_id,
		name: row.flow_versions.name,
		createdAt: row.flow_versions.created_at,
		data: JSON.parse(row.flow_versions.data) as unknown,
	}),
}));

vi.mock("./execution.family-store", () => ({
	getWorkflowExecutionFamilyPageForOwner: mocks.getWorkflowExecutionFamilyPageForOwner,
	getLatestFailedWorkflowExecutionIdForOwner: mocks.getLatestFailedWorkflowExecutionIdForOwner,
	listWorkflowExecutionFamilyMemberIdsForOwner: mocks.listWorkflowExecutionFamilyMemberIdsForOwner,
	listWorkflowNodeAttemptsPageForExecutionOwner: mocks.listWorkflowNodeAttemptsPageForExecutionOwner,
}));

vi.mock("./execution.agent-cancellation", () => ({
	collectWorkflowAgentTurnIdentities: mocks.collectWorkflowAgentTurnIdentities,
	listActiveWorkflowAgentTurnIdentities: mocks.listActiveWorkflowAgentTurnIdentities,
	mergeWorkflowAgentTurnIdentities: mocks.mergeWorkflowAgentTurnIdentities,
	cancelWorkflowAgentTurns: mocks.cancelWorkflowAgentTurns,
}));

vi.mock("./execution.agent-model-inheritance", () => ({
	applyWorkflowAgentModelCutover: mocks.applyWorkflowAgentModelCutover,
}));

vi.mock("./execution.queue", () => ({
	cancelActiveWorkflowNodeJobs: mocks.cancelActiveWorkflowNodeJobs,
}));

vi.mock("./execution.start-service", () => ({
	WorkflowStartError: class WorkflowStartError extends Error {},
	startWorkflowExecution: mocks.startWorkflowExecution,
}));

import { resumeWorkflowExecution } from "./execution.resume-service";

function runtime(): Readonly<{
	env: WorkerEnv;
	cancelFetch: ReturnType<typeof vi.fn>;
}> {
	const cancelFetch = vi.fn(async () => new Response(null, { status: 202 }));
	const env = {
		DB: {},
		JWT_SECRET: "test",
		EXECUTION_DO: {
			idFromName: vi.fn((name: string) => name),
			get: vi.fn(() => ({ fetch: cancelFetch })),
		},
	} as unknown as WorkerEnv;
	return { env, cancelFetch };
}

describe("workflow resume service", () => {
	beforeEach(() => {
		for (const mock of Object.values(mocks)) mock.mockReset();
		mocks.listWorkflowNodeAttemptsPageForExecutionOwner.mockResolvedValue({ items: [], nextCursor: null });
		mocks.getExecutionForOwner.mockResolvedValue(sourceExecution);
		mocks.getFlowForOwner.mockResolvedValue(null);
		mocks.getExecutionSnapshotForOwner.mockResolvedValue({
			id: sourceExecution.id,
			flow_id: sourceExecution.flow_id,
			flow_version_id: sourceExecution.flow_version_id,
			flow_versions: {
				name: "Video workflow",
				data: JSON.stringify(frozenRoot),
				created_at: sourceExecution.created_at,
			},
		});
		mocks.listNodeRunsForExecutionOwner.mockResolvedValue(nodeRuns);
		mocks.getWorkflowExecutionFamilyPageForOwner.mockResolvedValue({
			executionFamilyId: sourceExecution.execution_family_id,
			latestExecutionId: sourceExecution.id,
			latestExecutionStatus: "running",
			activeExecutionCount: 1,
			activeExecutionIds: [sourceExecution.id],
		});
		mocks.getLatestFailedWorkflowExecutionIdForOwner.mockResolvedValue(null);
		mocks.listWorkflowExecutionFamilyMemberIdsForOwner.mockResolvedValue([sourceExecution.id]);
		mocks.collectWorkflowAgentTurnIdentities.mockReturnValue([]);
		mocks.listActiveWorkflowAgentTurnIdentities.mockResolvedValue([]);
		mocks.mergeWorkflowAgentTurnIdentities.mockReturnValue([]);
		mocks.cancelWorkflowAgentTurns.mockResolvedValue([]);
		mocks.applyWorkflowAgentModelCutover.mockImplementation((root: unknown) => root);
		mocks.startWorkflowExecution.mockResolvedValue({
			created: true,
			execution: { id: "execution-recovery", status: "queued" },
		});
	});

	it("continues the same frozen provider model from the persisted balance node", async () => {
		const { env, cancelFetch } = runtime();
		const execution = await resumeWorkflowExecution({
			context: {} as AppContext,
			env,
			ownerId: sourceExecution.owner_id,
			sourceExecutionId: sourceExecution.id,
			trigger: "agent",
			providerBalanceRestored: true,
		});

		expect(execution).toEqual({ id: "execution-recovery", status: "queued" });
		expect(cancelFetch).toHaveBeenCalledWith("https://do/cancel", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				reasonCode: "provider_balance_recovery",
				actorType: "workflow_recovery",
				actorId: sourceExecution.owner_id,
			}),
		});
		expect(mocks.cancelActiveWorkflowNodeJobs).toHaveBeenCalledWith(sourceExecution.id);
		expect(mocks.applyWorkflowAgentModelCutover).not.toHaveBeenCalled();
		expect(mocks.startWorkflowExecution).toHaveBeenCalledTimes(1);
		const startInput = mocks.startWorkflowExecution.mock.calls[0]?.[1] as Readonly<Record<string, unknown>>;
		expect(startInput).toMatchObject({
			ownerId: sourceExecution.owner_id,
			triggerNodeId: "trigger",
			replay: {
				sourceExecutionId: sourceExecution.id,
				startFromNodeId: "agent-beat-sheet",
				invalidatedNodeIds: ["agent-beat-sheet"],
				scope: "recovery_snapshot",
			},
			idempotencyKey: `workflow-provider-balance-restored:${sourceExecution.id}`,
			recoveryOfExecutionId: sourceExecution.id,
		});
		const startFlow = startInput.flow as Readonly<Record<string, unknown>>;
		const replayedRoot = JSON.parse(String(startFlow.data)) as typeof frozenRoot;
		expect(replayedRoot.nodes[1]?.data.workflowInitiatingAgentExecution).toEqual({
			modelKey: "gpt-5.6-luna",
			apiStyle: "responses",
		});
	});

	it("refuses an old recoverable snapshot after the current flow switches to fresh-only", async () => {
		mocks.getFlowForOwner.mockResolvedValue({
			id: sourceExecution.flow_id,
			name: "Video workflow",
			data: JSON.stringify({
				nodes: [{
					id: "trigger",
					data: {
						kind: "workflowTrigger",
						workflowExecutionRecoveryPolicy: "fresh_only",
					},
				}],
				edges: [],
			}),
			owner_id: sourceExecution.owner_id,
			project_id: sourceExecution.project_id,
			created_at: sourceExecution.created_at,
			updated_at: sourceExecution.created_at,
		});
		const { env, cancelFetch } = runtime();
		await expect(resumeWorkflowExecution({
			context: {} as AppContext,
			env,
			ownerId: sourceExecution.owner_id,
			sourceExecutionId: sourceExecution.id,
			trigger: "agent",
			providerBalanceRestored: true,
		})).rejects.toMatchObject({
			code: "workflow_resume_fresh_only",
			status: 409,
			details: {
				policyAuthority: "current_flow",
				sourceExecutionId: sourceExecution.id,
			},
		});
		expect(cancelFetch).not.toHaveBeenCalled();
		expect(mocks.startWorkflowExecution).not.toHaveBeenCalled();
	});

	it("invalidates the exact rejected input author and not a parallel launch Agent", async () => {
		const contract = createWorkflowArtifactContract({
			artifactType: "tapcanvas.beat-sheet/v2",
			schemaVersion: "2",
			constraints: { durationOptions: [4, 5, 6, 7, 8, 9, 10] },
		});
		const atomicNode = (id: string, executorRef: string) => ({
			id,
			type: "taskNode",
			kind: "workflowStage",
			data: {
				workflowAtomicSpec: {
					version: 1,
					category: "control",
					operation: id,
					executorRef,
					executionMode: "once",
					inputPorts: [],
					outputPorts: ["result"],
				},
			},
		});
		const root = {
			nodes: [
				{ ...atomicNode("trigger", "workflow.trigger/v1"), data: { ...atomicNode("trigger", "workflow.trigger/v1").data, workflowTriggerPayload: { source: "chapter" } } },
				atomicNode("beat-agent", "agents.logical-task/v2"),
				atomicNode("launch-agent", "agents.logical-task/v2"),
				atomicNode("beat-format", "workflow.collection.take/v1"),
				atomicNode("clip-fan-out", "video.clip-contexts/v1"),
			],
			edges: [],
			workflowExecutionScope: { triggerNodeId: "trigger" },
		};
		const nodeOutput = (nodeId: string, executorRef: string, evidence: Record<string, unknown> = {}) => JSON.stringify({
			protocolVersion: "1",
			executorRef,
			nodeId,
			executionMode: "once",
			ports: { result: {} },
			artifacts: [],
			evidence,
			itemRuns: [],
		});
		const makeRun = (id: string, nodeId: string, executorRef: string, outputRefs: string, status = "success") => ({
			id,
			execution_id: sourceExecution.id,
			node_id: nodeId,
			status,
			attempt: 1,
			error_message: status === "failed" ? "duration mismatch" : null,
			output_refs: outputRefs,
			created_at: sourceExecution.created_at,
			started_at: sourceExecution.started_at,
			finished_at: "2026-08-23T00:00:03.000Z",
			node_type: executorRef,
		});
		const beatRun = makeRun("run-beat", "beat-agent", "agents.logical-task/v2", nodeOutput("beat-agent", "agents.logical-task/v2"));
		const launchRun = makeRun("run-launch", "launch-agent", "agents.logical-task/v2", nodeOutput("launch-agent", "agents.logical-task/v2"));
		const formatRun = makeRun("run-format", "beat-format", "workflow.collection.take/v1", nodeOutput("beat-format", "workflow.collection.take/v1", {
			workflowProvenance: {
				protocolVersion: "workflow.node-provenance/v1",
				executionId: sourceExecution.id,
				nodeRunId: "run-format",
				attempt: 1,
				flowId: sourceExecution.flow_id,
				flowVersionId: sourceExecution.flow_version_id,
				nodeId: "beat-format",
				executorRef: "workflow.collection.take/v1",
				createdAt: "2026-08-23T00:00:02.000Z",
				inputBindings: [{ sourceNodeId: "beat-agent", sourceNodeRunId: "run-beat", sourcePortId: "result", targetPortId: "items", artifacts: [] }],
			},
		}));
		const rejection = createWorkflowInputContractRejection({
			consumerNodeId: "clip-fan-out",
			inputBindings: [{ sourceNodeId: "beat-format", sourceNodeRunId: "run-format", sourcePortId: "result", targetPortId: "beat-sheet", artifacts: [] }],
			error: new WorkflowInputContractError({ targetPortId: "beat-sheet", expectedContract: contract, cause: new Error("duration mismatch") }),
		});
		const failedRun = makeRun("run-failed", "clip-fan-out", "video.clip-contexts/v1", nodeOutput("clip-fan-out", "video.clip-contexts/v1", { inputContractRejection: rejection }), "failed");
		mocks.getExecutionForOwner.mockResolvedValue({ ...sourceExecution, status: "failed", finished_at: "2026-08-23T00:00:03.000Z" });
		mocks.getExecutionSnapshotForOwner.mockResolvedValue({
			id: sourceExecution.id,
			flow_id: sourceExecution.flow_id,
			flow_version_id: sourceExecution.flow_version_id,
			flow_versions: { name: "Video workflow", data: JSON.stringify(root), created_at: sourceExecution.created_at },
		});
		mocks.listNodeRunsForExecutionOwner.mockResolvedValue([beatRun, launchRun, formatRun, failedRun]);
		mocks.getWorkflowExecutionFamilyPageForOwner.mockResolvedValue({
			executionFamilyId: sourceExecution.execution_family_id,
			latestExecutionId: sourceExecution.id,
			latestExecutionStatus: "failed",
			activeExecutionCount: 0,
			activeExecutionIds: [],
		});
		mocks.getLatestFailedWorkflowExecutionIdForOwner.mockResolvedValue(sourceExecution.id);
		const { env } = runtime();

		await resumeWorkflowExecution({
			context: {} as AppContext,
			env,
			ownerId: sourceExecution.owner_id,
			sourceExecutionId: sourceExecution.id,
			trigger: "manual",
		});

		expect(mocks.startWorkflowExecution).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			replay: {
				sourceExecutionId: sourceExecution.id,
				startFromNodeId: "clip-fan-out",
				invalidatedNodeIds: ["beat-agent"],
				scope: "recovery_snapshot",
			},
		}));
		const startInput = mocks.startWorkflowExecution.mock.calls[0]?.[1] as { flow: { data: string } };
		const recoveryRoot = JSON.parse(startInput.flow.data) as { workflowRecoveryFrontier: Record<string, unknown> };
		expect(recoveryRoot.workflowRecoveryFrontier).toMatchObject({
			mode: "input_contract_lineage",
			failedNodeId: "clip-fan-out",
			invalidatedNodeIds: ["beat-agent"],
		});
	});

	it("explicitly cuts over to the current configuration without changing frozen invocation facts", async () => {
		const atomicSpec = {
			executorRef: "video.voice-manifest.materialize/v1",
			executionMode: "once",
			inputPorts: ["input"],
			outputPorts: ["output"],
		};
		const triggerData = {
			kind: "workflowTrigger",
			adminWorkflow: true,
			workflowInstanceId: "workflow-1",
			workflowTriggerPayload: { source: "current template default" },
		};
		const stage = (voiceMode: string) => ({
			id: "voice",
			type: "taskNode",
			data: {
				kind: "workflowStage",
				adminWorkflow: true,
				workflowInstanceId: "workflow-1",
				workflowVoiceMode: voiceMode,
				workflowAtomicSpec: atomicSpec,
			},
		});
		const edge = { source: "trigger", target: "voice" };
		const immutableContext = { version: 3, projectId: "project-1", canvasId: "chapter-1", assetSnapshot: [] };
		mocks.getExecutionForOwner.mockResolvedValue({
			...sourceExecution,
			status: "failed",
			finished_at: "2026-08-28T12:31:32.000Z",
		});
		mocks.getWorkflowExecutionFamilyPageForOwner.mockResolvedValue({
			executionFamilyId: sourceExecution.execution_family_id,
			latestExecutionId: sourceExecution.id,
			latestExecutionStatus: "failed",
			activeExecutionCount: 0,
			activeExecutionIds: [],
		});
		mocks.getLatestFailedWorkflowExecutionIdForOwner.mockResolvedValue(sourceExecution.id);
		mocks.listNodeRunsForExecutionOwner.mockResolvedValue([{
			...nodeRuns[0],
			status: "failed",
			started_at: "2026-08-28T12:31:00.000Z",
			finished_at: "2026-08-28T12:31:32.000Z",
			output_refs: null,
		}]);
		mocks.getExecutionSnapshotForOwner.mockResolvedValue({
			id: sourceExecution.id,
			flow_id: sourceExecution.flow_id,
			flow_version_id: sourceExecution.flow_version_id,
			flow_versions: {
				name: "Video workflow",
				data: JSON.stringify({
					nodes: [{
						id: "trigger",
						type: "taskNode",
						data: { ...triggerData, workflowTriggerPayload: { source: "chapter one" } },
					}, stage("reference_manifest")],
					edges: [edge],
					workflowExecutionScope: { triggerNodeId: "trigger", workflowInstanceId: "workflow-1" },
					workflowProjectContext: immutableContext,
				}),
				created_at: sourceExecution.created_at,
			},
		});
		mocks.getFlowForOwner.mockResolvedValue({
			id: sourceExecution.flow_id,
			name: "Video workflow current",
			owner_id: sourceExecution.owner_id,
			project_id: sourceExecution.project_id,
			created_at: sourceExecution.created_at,
			updated_at: "2026-08-28T12:30:44.068Z",
			data: JSON.stringify({
				nodes: [{ id: "trigger", type: "taskNode", data: triggerData }, stage("provider_native")],
				edges: [edge],
			}),
		});
		const { env } = runtime();

		await resumeWorkflowExecution({
			context: {} as AppContext,
			env,
			ownerId: sourceExecution.owner_id,
			sourceExecutionId: sourceExecution.id,
			trigger: "agent",
			definitionCutover: { mode: "current_flow" },
		});

		expect(mocks.getFlowForOwner).toHaveBeenCalledWith(env.DB, sourceExecution.flow_id, sourceExecution.owner_id);
		const startInput = mocks.startWorkflowExecution.mock.calls[0]?.[1] as Readonly<Record<string, unknown>>;
		expect(startInput).toMatchObject({
			idempotencyKey: `workflow-definition-cutover:${sourceExecution.id}:2026-08-28T12:30:44.068Z`,
			recoveryOfExecutionId: sourceExecution.id,
		});
		const flow = startInput.flow as Readonly<Record<string, unknown>>;
		const root = JSON.parse(String(flow.data)) as Readonly<Record<string, unknown>>;
		const nodes = root.nodes as Array<{ id: string; data: Record<string, unknown> }>;
		expect(nodes.find((node) => node.id === "voice")?.data.workflowVoiceMode).toBe("provider_native");
		expect(nodes.find((node) => node.id === "trigger")?.data.workflowTriggerPayload).toEqual({ source: "chapter one" });
		expect(root.workflowProjectContext).toEqual(immutableContext);
	});

	it("continues the latest canceled member only after explicit cancellation revocation", async () => {
		mocks.getExecutionForOwner.mockResolvedValue({
			...sourceExecution,
			status: "canceled",
			finished_at: "2026-08-23T00:00:05.000Z",
		});
		mocks.getWorkflowExecutionFamilyPageForOwner.mockResolvedValue({
			executionFamilyId: sourceExecution.execution_family_id,
			latestExecutionId: sourceExecution.id,
			latestExecutionStatus: "canceled",
			activeExecutionCount: 0,
			activeExecutionIds: [],
		});
		mocks.listNodeRunsForExecutionOwner.mockResolvedValue([{
			...nodeRuns[0],
			status: "canceled",
			finished_at: "2026-08-23T00:00:05.000Z",
		}]);
		const { env } = runtime();

		const execution = await resumeWorkflowExecution({
			context: {} as AppContext,
			env,
			ownerId: sourceExecution.owner_id,
			sourceExecutionId: sourceExecution.id,
			trigger: "agent",
			cancellationRevoked: true,
		});

		expect(execution).toEqual({ id: "execution-recovery", status: "queued" });
		expect(mocks.startWorkflowExecution).toHaveBeenCalledTimes(1);
		expect(mocks.startWorkflowExecution.mock.calls[0]?.[1]).toMatchObject({
			replay: {
				sourceExecutionId: sourceExecution.id,
				startFromNodeId: "agent-beat-sheet",
				invalidatedNodeIds: ["agent-beat-sheet"],
				scope: "recovery_snapshot",
			},
			idempotencyKey: `workflow-cancellation-revoked:${sourceExecution.id}`,
			recoveryOfExecutionId: sourceExecution.id,
		});
	});

	it("rejects cancellation revocation unless the exact source is canceled", async () => {
		const { env } = runtime();
		await expect(resumeWorkflowExecution({
			context: {} as AppContext,
			env,
			ownerId: sourceExecution.owner_id,
			sourceExecutionId: sourceExecution.id,
			trigger: "agent",
			cancellationRevoked: true,
		})).rejects.toMatchObject({
			code: "workflow_cancellation_revocation_source_not_canceled",
			status: 409,
		});
		expect(mocks.startWorkflowExecution).not.toHaveBeenCalled();
	});

	it("rejects cancellation revocation for a stale canceled family member", async () => {
		mocks.getExecutionForOwner.mockResolvedValue({
			...sourceExecution,
			status: "canceled",
			finished_at: "2026-08-23T00:00:05.000Z",
		});
		mocks.getWorkflowExecutionFamilyPageForOwner.mockResolvedValue({
			executionFamilyId: sourceExecution.execution_family_id,
			latestExecutionId: "execution-later",
			latestExecutionStatus: "failed",
			activeExecutionCount: 0,
			activeExecutionIds: [],
		});
		mocks.getLatestFailedWorkflowExecutionIdForOwner.mockResolvedValue("execution-later");
		mocks.listWorkflowExecutionFamilyMemberIdsForOwner.mockResolvedValue([
			sourceExecution.id,
			"execution-later",
		]);
		mocks.listNodeRunsForExecutionOwner.mockResolvedValue([{
			...nodeRuns[0],
			status: "canceled",
			finished_at: "2026-08-23T00:00:05.000Z",
		}]);
		const { env } = runtime();

		await expect(resumeWorkflowExecution({
			context: {} as AppContext,
			env,
			ownerId: sourceExecution.owner_id,
			sourceExecutionId: sourceExecution.id,
			trigger: "agent",
			cancellationRevoked: true,
		})).rejects.toMatchObject({
			code: "workflow_resume_source_stale",
			status: 409,
		});
		expect(mocks.startWorkflowExecution).not.toHaveBeenCalled();
	});

	it("recovers the latest canceled family member without canceling it a second time", async () => {
		mocks.getExecutionForOwner.mockResolvedValue({ ...sourceExecution, status: "canceled" });
		mocks.getWorkflowExecutionFamilyPageForOwner.mockResolvedValue({
			executionFamilyId: sourceExecution.execution_family_id,
			latestExecutionId: sourceExecution.id,
			latestExecutionStatus: "canceled",
			activeExecutionCount: 0,
			activeExecutionIds: [],
		});
		mocks.getLatestFailedWorkflowExecutionIdForOwner.mockResolvedValue("execution-previous-failure");
		const { env, cancelFetch } = runtime();

		await expect(resumeWorkflowExecution({
			context: {} as AppContext,
			env,
			ownerId: sourceExecution.owner_id,
			sourceExecutionId: sourceExecution.id,
			trigger: "agent",
			providerBalanceRestored: true,
		})).resolves.toEqual({ id: "execution-recovery", status: "queued" });

		expect(cancelFetch).not.toHaveBeenCalled();
		expect(mocks.cancelActiveWorkflowNodeJobs).not.toHaveBeenCalled();
		expect(mocks.startWorkflowExecution).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			replay: {
				sourceExecutionId: sourceExecution.id,
				startFromNodeId: "agent-beat-sheet",
				invalidatedNodeIds: ["agent-beat-sheet"],
				scope: "recovery_snapshot",
			},
			idempotencyKey: `workflow-provider-balance-restored:${sourceExecution.id}`,
		}));
	});

	it("recovers a historical balance checkpoint when every later execution contains only proven output reuse", async () => {
		const laterReplayedAgentNode = {
			...nodeRuns[0],
			id: "node-run-later-replay",
			execution_id: "execution-later-failed",
			node_type: "agents.logical-task/v2",
			status: "failed",
			output_refs: JSON.stringify({
				protocolVersion: "1",
				executorRef: "agents.logical-task/v2",
				nodeId: "agent-beat-sheet",
				executionMode: "once",
				ports: {},
				artifacts: [],
				evidence: {
					outputReuse: {
						version: 1,
						kind: "replay",
						sourceExecutionId: sourceExecution.id,
						sourceNodeRunId: nodeRuns[0]?.id,
					},
				},
				itemRuns: [],
			}),
		};
		mocks.getExecutionForOwner.mockResolvedValue({ ...sourceExecution, status: "canceled" });
		mocks.getWorkflowExecutionFamilyPageForOwner.mockResolvedValue({
			executionFamilyId: sourceExecution.execution_family_id,
			latestExecutionId: "execution-later-failed",
			latestExecutionStatus: "failed",
			activeExecutionCount: 0,
			activeExecutionIds: [],
		});
		mocks.getLatestFailedWorkflowExecutionIdForOwner.mockResolvedValue("execution-later-failed");
		mocks.listWorkflowExecutionFamilyMemberIdsForOwner.mockResolvedValue([
			sourceExecution.id,
			"execution-later-failed",
		]);
		mocks.listNodeRunsForExecutionOwner.mockImplementation(async (_db: unknown, args: Readonly<{ executionId: string }>) =>
			args.executionId === sourceExecution.id ? nodeRuns : [laterReplayedAgentNode]);
		const { env } = runtime();

		await expect(resumeWorkflowExecution({
			context: {} as AppContext,
			env,
			ownerId: sourceExecution.owner_id,
			sourceExecutionId: sourceExecution.id,
			trigger: "agent",
			providerBalanceRestored: true,
		})).resolves.toEqual({ id: "execution-recovery", status: "queued" });
		expect(mocks.startWorkflowExecution).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			replay: {
				sourceExecutionId: sourceExecution.id,
				startFromNodeId: "agent-beat-sheet",
				invalidatedNodeIds: ["agent-beat-sheet"],
				scope: "recovery_snapshot",
			},
			idempotencyKey: `workflow-provider-balance-restored:${sourceExecution.id}`,
		}));
	});

	it("rejects a historical balance checkpoint when a later external mutation has a successful tool receipt", async () => {
		const laterAgentNode = {
			...nodeRuns[0],
			id: "node-run-later-agent",
			execution_id: "execution-later-failed",
			node_type: "agents.logical-task/v2",
			status: "failed",
			output_refs: null,
			tool_calls: JSON.stringify([{ ok: true, name: "external-write" }]),
		};
		mocks.getExecutionForOwner.mockResolvedValue({ ...sourceExecution, status: "canceled" });
		mocks.getWorkflowExecutionFamilyPageForOwner.mockResolvedValue({
			executionFamilyId: sourceExecution.execution_family_id,
			latestExecutionId: "execution-later-failed",
			latestExecutionStatus: "failed",
			activeExecutionCount: 0,
			activeExecutionIds: [],
		});
		mocks.getLatestFailedWorkflowExecutionIdForOwner.mockResolvedValue("execution-later-failed");
		mocks.listWorkflowExecutionFamilyMemberIdsForOwner.mockResolvedValue([
			sourceExecution.id,
			"execution-later-failed",
		]);
		mocks.listNodeRunsForExecutionOwner.mockImplementation(async (_db: unknown, args: Readonly<{ executionId: string }>) =>
			args.executionId === sourceExecution.id ? nodeRuns : [laterAgentNode]);
		const { env } = runtime();

		await expect(resumeWorkflowExecution({
			context: {} as AppContext,
			env,
			ownerId: sourceExecution.owner_id,
			sourceExecutionId: sourceExecution.id,
			trigger: "agent",
			providerBalanceRestored: true,
		})).rejects.toMatchObject({
			code: "workflow_resume_source_stale",
			status: 409,
		});
		expect(mocks.startWorkflowExecution).not.toHaveBeenCalled();
	});

	it("recovers an older checkpoint when later media only reconciles source provider receipts", async () => {
		const failedSourceNode = {
			...nodeRuns[0],
			status: "failed",
			output_refs: null,
			finished_at: "2026-08-23T00:00:03.000Z",
		};
		const laterPureNode = {
			...failedSourceNode,
			id: "node-run-later-pure",
			execution_id: "execution-later-failed",
			node_type: "workflow.collection.split/v1",
		};
		const laterFailedAgentWithoutReceipts = {
			...failedSourceNode,
			id: "node-run-later-agent-without-receipts",
			execution_id: "execution-later-failed",
			node_type: "agents.logical-task/v2",
			tool_calls: null,
		};
		const reusedMediaArtifact = {
			type: "tapcanvas.image/v1",
			identity: "existing-image",
			value: "https://example.com/existing-image.png",
			media: {
				protocolVersion: "workflow.media-asset/v1",
				kind: "image",
				url: "https://example.com/existing-image.png",
				mimeType: "image/png",
			},
		};
		const laterReconciledImageNode = {
			...failedSourceNode,
			id: "node-run-later-reconciled-image",
			execution_id: "execution-later-failed",
			node_id: "image-generation",
			node_type: "tapcanvas.image.generate/v1",
			status: "success",
			output_refs: JSON.stringify({
				protocolVersion: "1",
				executorRef: "tapcanvas.image.generate/v1",
				nodeId: "image-generation",
				executionMode: "each",
				ports: {},
				artifacts: [reusedMediaArtifact],
				evidence: {},
				itemRuns: [{
					itemId: "image-item",
					index: 0,
					status: "success",
					runtimeNodeId: "image-generation::item::image-item",
					lineage: [],
					ports: {},
					artifacts: [reusedMediaArtifact],
					evidence: { taskId: "task-source-image", reused: true },
				}],
			}),
		};
		const laterReconciledAgentNode = {
			...failedSourceNode,
			id: "node-run-later-reconciled-agent",
			execution_id: "execution-later-failed",
			node_id: "agent-items",
			node_type: "agents.logical-task/v2",
			status: "canceled",
			tool_calls: null,
			output_refs: JSON.stringify({
				protocolVersion: "1",
				executorRef: "agents.logical-task/v2",
				nodeId: "agent-items",
				executionMode: "each",
				ports: {},
				artifacts: [],
				evidence: {},
				itemRuns: [{
					itemId: "agent-item",
					index: 0,
					status: "success",
					runtimeNodeId: "agent-items::item::agent-item",
					lineage: [],
					ports: {},
					artifacts: [],
					evidence: { taskId: "task-source-agent" },
				}],
			}),
		};
		const canceledQueuedImageNode = {
			...failedSourceNode,
			id: "node-run-canceled-image",
			execution_id: "execution-latest-canceled",
			node_id: "image-generation",
			node_type: "tapcanvas.image.generate/v1",
			status: "skipped",
			started_at: null,
			output_refs: JSON.stringify({
				protocolVersion: "1",
				executorRef: "tapcanvas.image.generate/v1",
				nodeId: "image-generation",
				executionMode: "once",
				ports: {},
				artifacts: [{
					type: "image",
					identity: "existing-image",
					media: {
						protocolVersion: "workflow.media-asset/v1",
						kind: "image",
						url: "https://example.com/existing-image.png",
						mimeType: "image/png",
					},
				}],
				evidence: {},
				itemRuns: [],
			}),
		};
		mocks.getExecutionForOwner.mockResolvedValue({ ...sourceExecution, status: "failed" });
		mocks.getWorkflowExecutionFamilyPageForOwner.mockResolvedValue({
			executionFamilyId: sourceExecution.execution_family_id,
			latestExecutionId: "execution-latest-canceled",
			latestExecutionStatus: "canceled",
			activeExecutionCount: 0,
			activeExecutionIds: [],
		});
		mocks.getLatestFailedWorkflowExecutionIdForOwner.mockResolvedValue("execution-later-failed");
		mocks.listWorkflowExecutionFamilyMemberIdsForOwner.mockResolvedValue([
			sourceExecution.id,
			"execution-later-failed",
			"execution-latest-canceled",
		]);
		mocks.listWorkflowNodeAttemptsPageForExecutionOwner.mockResolvedValue({
			items: [{ providerReceipts: ["task-source-image", "task-source-agent"] }],
			nextCursor: null,
		});
		mocks.listNodeRunsForExecutionOwner.mockImplementation(async (_db: unknown, input: Readonly<{ executionId: string }>) => {
			if (input.executionId === sourceExecution.id) return [failedSourceNode];
			if (input.executionId === "execution-later-failed") return [laterPureNode, laterFailedAgentWithoutReceipts, laterReconciledImageNode, laterReconciledAgentNode];
			return [canceledQueuedImageNode];
		});
		const { env } = runtime();

		await expect(resumeWorkflowExecution({
			context: {} as AppContext,
			env,
			ownerId: sourceExecution.owner_id,
			sourceExecutionId: sourceExecution.id,
			trigger: "manual",
		})).resolves.toEqual({ id: "execution-recovery", status: "queued" });

		expect(mocks.startWorkflowExecution).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			replay: {
				sourceExecutionId: sourceExecution.id,
				startFromNodeId: failedSourceNode.node_id,
				invalidatedNodeIds: [failedSourceNode.node_id],
				scope: "recovery_snapshot",
			},
			idempotencyKey: `workflow-recovery:${sourceExecution.id}`,
			recoveryOfExecutionId: sourceExecution.id,
		}));
	});

	it("rejects an older failed checkpoint when a later Agent mutation started", async () => {
		const failedSourceNode = {
			...nodeRuns[0],
			status: "failed",
			output_refs: null,
			finished_at: "2026-08-23T00:00:03.000Z",
		};
		const laterAgentNode = {
			...failedSourceNode,
			id: "node-run-later-agent",
			execution_id: "execution-later-failed",
			node_type: "agents.logical-task/v2",
			tool_calls: JSON.stringify([{ toolName: "external-mutation", ok: true }]),
		};
		mocks.getExecutionForOwner.mockResolvedValue({ ...sourceExecution, status: "failed" });
		mocks.getWorkflowExecutionFamilyPageForOwner.mockResolvedValue({
			executionFamilyId: sourceExecution.execution_family_id,
			latestExecutionId: "execution-latest-canceled",
			latestExecutionStatus: "canceled",
			activeExecutionCount: 0,
			activeExecutionIds: [],
		});
		mocks.getLatestFailedWorkflowExecutionIdForOwner.mockResolvedValue("execution-later-failed");
		mocks.listWorkflowExecutionFamilyMemberIdsForOwner.mockResolvedValue([
			sourceExecution.id,
			"execution-later-failed",
			"execution-latest-canceled",
		]);
		mocks.listNodeRunsForExecutionOwner.mockImplementation(async (_db: unknown, input: Readonly<{ executionId: string }>) =>
			input.executionId === "execution-later-failed" ? [laterAgentNode] : [failedSourceNode]);
		const { env } = runtime();

		await expect(resumeWorkflowExecution({
			context: {} as AppContext,
			env,
			ownerId: sourceExecution.owner_id,
			sourceExecutionId: sourceExecution.id,
			trigger: "agent",
		})).rejects.toMatchObject({
			code: "workflow_resume_source_stale",
			status: 409,
		});
		expect(mocks.startWorkflowExecution).not.toHaveBeenCalled();
	});

	it("rejects an older failed checkpoint when a later run started paid generation", async () => {
		const failedSourceNode = {
			...nodeRuns[0],
			status: "failed",
			output_refs: null,
			finished_at: "2026-08-23T00:00:03.000Z",
		};
		const laterPaidNode = {
			...failedSourceNode,
			id: "node-run-later-image",
			execution_id: "execution-later-failed",
			node_id: "image-generation",
			node_type: "tapcanvas.image.generate/v1",
		};
		mocks.getExecutionForOwner.mockResolvedValue({ ...sourceExecution, status: "failed" });
		mocks.getWorkflowExecutionFamilyPageForOwner.mockResolvedValue({
			executionFamilyId: sourceExecution.execution_family_id,
			latestExecutionId: "execution-latest-canceled",
			latestExecutionStatus: "canceled",
			activeExecutionCount: 0,
			activeExecutionIds: [],
		});
		mocks.getLatestFailedWorkflowExecutionIdForOwner.mockResolvedValue("execution-later-failed");
		mocks.listWorkflowExecutionFamilyMemberIdsForOwner.mockResolvedValue([
			sourceExecution.id,
			"execution-later-failed",
			"execution-latest-canceled",
		]);
		mocks.listNodeRunsForExecutionOwner.mockImplementation(async (_db: unknown, input: Readonly<{ executionId: string }>) =>
			input.executionId === "execution-later-failed" ? [laterPaidNode] : [failedSourceNode]);
		const { env } = runtime();

		await expect(resumeWorkflowExecution({
			context: {} as AppContext,
			env,
			ownerId: sourceExecution.owner_id,
			sourceExecutionId: sourceExecution.id,
			trigger: "agent",
		})).rejects.toMatchObject({
			code: "workflow_resume_source_stale",
			status: 409,
		});
		expect(mocks.startWorkflowExecution).not.toHaveBeenCalled();
	});

	it("rejects simultaneous balance restoration and model cutover before creating recovery", async () => {
		const { env } = runtime();
		await expect(resumeWorkflowExecution({
			context: {} as AppContext,
			env,
			ownerId: sourceExecution.owner_id,
			sourceExecutionId: sourceExecution.id,
			trigger: "agent",
			providerBalanceRestored: true,
			agentModelCutover: {
				targetModelKey: "gpt-5.6-sol",
				apiStyle: "responses",
				authorizationSource: "admin",
			},
		})).rejects.toMatchObject({
			code: "workflow_resume_recovery_mode_conflict",
			status: 400,
		});
		expect(mocks.startWorkflowExecution).not.toHaveBeenCalled();
	});
});
