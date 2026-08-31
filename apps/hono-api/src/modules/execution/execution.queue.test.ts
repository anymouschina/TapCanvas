import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerEnv } from "../../types";

const {
	createTrustedWorkflowPluginOwnerAdapters,
	loadPersistedWorkflowPluginRuntimeRegistry,
	runWorkflowAgentNode,
	updateNodeRun,
} = vi.hoisted(() => ({
	createTrustedWorkflowPluginOwnerAdapters: vi.fn(() => []),
	loadPersistedWorkflowPluginRuntimeRegistry: vi.fn(),
	runWorkflowAgentNode: vi.fn(),
	updateNodeRun: vi.fn(async () => undefined),
}));

vi.mock("./execution.agent-runner", () => ({ runWorkflowAgentNode }));
vi.mock("./execution.plugin-adapters", () => ({ createTrustedWorkflowPluginOwnerAdapters }));
vi.mock("./execution.plugin-catalog", () => ({ loadPersistedWorkflowPluginRuntimeRegistry }));
vi.mock("./execution.repo", () => ({ updateNodeRun }));

import { handleWorkflowNodeJob } from "./execution.queue";
import type { WorkflowNodeJob, WorkflowNodeJobPhase } from "./execution.node-attempt";

function workflowJob(
	executionId: string,
	nodeId: string,
	phase?: WorkflowNodeJobPhase,
): WorkflowNodeJob {
	return {
		executionId,
		nodeId,
		nodeRunId: "node-run-1",
		attempt: 1,
		...(phase ? { phase } : {}),
	};
}

type CompletionPayload = {
	nodeId?: unknown;
	ok?: unknown;
	errorCode?: unknown;
	errorMessage?: unknown;
	outputRefs?: unknown;
};

function createEnvironment(input: {
	node: Record<string, unknown>;
	additionalNodes?: readonly Record<string, unknown>[];
	edges?: readonly Record<string, unknown>[];
	upstreamRuns?: readonly Readonly<{ id?: string; node_id: string; status: string; output_refs: unknown }>[];
	startedResponse?: Response;
	externalStartedResponse?: Response;
	currentOutput?: unknown;
	recoveryOfExecutionId?: string | null;
}) {
	const requests: Array<{ path: string; payload: CompletionPayload }> = [];
	const durableFetch = vi.fn(
		async (requestInput: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(String(requestInput));
			const rawBody = typeof init?.body === "string" ? init.body : "{}";
			const payload = JSON.parse(rawBody) as CompletionPayload;
			requests.push({ path: url.pathname, payload });
			if (url.pathname === "/nodeStarted" && input.startedResponse) {
				return input.startedResponse;
			}
			if (url.pathname === "/nodeExternalCheckStarted" && input.externalStartedResponse) {
				return input.externalStartedResponse;
			}
			const accepted = url.pathname === "/nodeStarted"
				|| url.pathname === "/nodeExternalCheckStarted"
				|| url.pathname === "/nodeRecoveryStarted";
			return new Response(
				accepted ? "accepted" : "ok",
				{ status: accepted ? 202 : 200 },
			);
		},
	);
	const findExecution = vi.fn(async () => ({
		flow_version_id: "version-1",
		flow_id: "flow-1",
		owner_id: "user-1",
		execution_family_id: "family-1",
		recovery_of_execution_id: input.recoveryOfExecutionId ?? null,
	}));
	const queueSend = vi.fn(async () => undefined);
	const env = {
		DB: {
			workflow_executions: { findUnique: findExecution },
			flow_versions: {
				findUnique: vi.fn(async () => ({
					data: JSON.stringify({ nodes: [input.node, ...(input.additionalNodes ?? [])], edges: input.edges ?? [] }),
				})),
			},
			flows: { findUnique: vi.fn(async () => ({ project_id: "project-1" })) },
			workflow_node_runs: {
				findMany: vi.fn(async () => (input.upstreamRuns ?? []).map((run, index) => ({
					id: run.id ?? `upstream-run-${index + 1}`,
					...run,
				}))),
				findUnique: vi.fn(async () => ({ id: "node-run-1", attempt: 1, output_refs: input.currentOutput ?? null })),
			},
		},
		EXECUTION_DO: {
			idFromName: (value: string) => ({ toString: () => value }),
			get: () => ({ fetch: durableFetch }),
		},
		WORKFLOW_NODE_QUEUE: { send: queueSend },
	} as unknown as WorkerEnv;
	return { env, requests, findExecution, queueSend };
}

describe("workflow node queue handler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("reports a text executor success with typed output and factual evidence", async () => {
		const fixture = createEnvironment({
			node: { id: "text-1", type: "taskNode", data: { kind: "workflowStage", prompt: "hello", workflowAtomicSpec: { version: 1, category: "source", operation: "text_input", executorRef: "workflow.input.text/v1", executionMode: "once", inputPorts: [], outputPorts: ["text"] } } },
		});

		await handleWorkflowNodeJob(fixture.env, workflowJob("execution-1", "text-1"));

		expect(fixture.requests.map((request) => request.path)).toEqual([
			"/nodeStarted",
			"/nodeComplete",
		]);
		expect(fixture.requests[1]?.payload).toMatchObject({
			nodeId: "text-1",
			ok: true,
			outputRefs: {
				protocolVersion: "1",
				executorRef: "workflow.input.text/v1",
				nodeId: "text-1",
				executionMode: "once",
				ports: { text: "hello" },
				artifacts: [{ type: "tapcanvas.text/v1", identity: null, value: "hello" }],
				evidence: {
					executorCompleted: true,
					workflowProvenance: {
						protocolVersion: "workflow.node-provenance/v1",
						executionId: "execution-1",
						nodeRunId: "node-run-1",
						attempt: 1,
						flowId: "flow-1",
						flowVersionId: "version-1",
						nodeId: "text-1",
						executorRef: "workflow.input.text/v1",
						createdAt: expect.any(String),
						inputBindings: [],
					},
				},
				itemRuns: [],
			},
		});
		expect(loadPersistedWorkflowPluginRuntimeRegistry).not.toHaveBeenCalled();
	});

	it("loads the durable plugin catalog only for an explicitly pinned plugin executor", async () => {
		const pluginExecute = vi.fn(async () => ({
			status: "settled" as const,
			executorRef: {
				protocolVersion: "workflow.plugin-executor/v1" as const,
				pluginId: "studio.queue-test",
				pluginVersion: "1.0.0",
				nodeType: "utility.echo",
				nodeVersion: 1,
				capabilityId: "utility.echo",
				capabilityVersion: 1,
			},
			idempotencyKey: null,
			providerReceipt: null,
			evidence: {},
			output: { result: "plugin-result" },
		}));
		loadPersistedWorkflowPluginRuntimeRegistry.mockResolvedValueOnce({ execute: pluginExecute });
		const fixture = createEnvironment({
			node: {
				id: "plugin-1",
				type: "taskNode",
				data: {
					kind: "workflowStage",
					workflowPluginConfig: {},
					workflowAtomicSpec: {
						version: 1,
						category: "tool",
						operation: "plugin",
						executorRef: "workflow.plugin-executor/v1/studio.queue-test/1.0.0/utility.echo/1/utility.echo/1",
						executionMode: "once",
						inputPorts: [],
						outputPorts: ["result"],
					},
				},
			},
		});

		await handleWorkflowNodeJob(fixture.env, workflowJob("execution-plugin", "plugin-1"));

		expect(createTrustedWorkflowPluginOwnerAdapters).toHaveBeenCalledWith(fixture.env);
		expect(loadPersistedWorkflowPluginRuntimeRegistry).toHaveBeenCalledWith(fixture.env.DB, []);
		expect(pluginExecute).toHaveBeenCalledWith(expect.objectContaining({
			executionId: "execution-plugin",
			nodeId: "plugin-1",
		}));
		expect(fixture.requests[1]?.payload).toMatchObject({
			ok: true,
			outputRefs: { ports: { result: "plugin-result" } },
		});
	});

	it("ignores an inactive branch input while loading an active join", async () => {
		const activeOutput = {
			protocolVersion: "1",
			executorRef: "workflow.input.text/v1",
			nodeId: "active",
			executionMode: "once",
			ports: { result: "active-value" },
			artifacts: [],
			evidence: { executorCompleted: true },
			itemRuns: [],
		};
		const joinNode = {
			id: "join",
			type: "taskNode",
			data: { kind: "workflowStage", workflowAtomicSpec: { version: 1, category: "control", operation: "join", executorRef: "workflow.control.join/v1", executionMode: "collect", inputPorts: ["branches"], outputPorts: ["joined"] } },
		};
		const fixture = createEnvironment({
			node: joinNode,
			additionalNodes: [{ id: "active", type: "taskNode", data: {} }, { id: "inactive", type: "taskNode", data: {} }],
			edges: [
				{ source: "active", target: "join", sourceHandle: "out-workflow:result", targetHandle: "in-workflow:branches" },
				{ source: "inactive", target: "join", sourceHandle: "out-workflow:result", targetHandle: "in-workflow:branches" },
			],
			upstreamRuns: [
				{ node_id: "active", status: "success", output_refs: JSON.stringify(activeOutput) },
				{ node_id: "inactive", status: "not_selected", output_refs: null },
			],
		});
		await handleWorkflowNodeJob(fixture.env, workflowJob("execution-1", "join"));
		expect(fixture.requests[1]?.payload).toMatchObject({
			ok: true,
			outputRefs: { ports: { joined: "active-value" } },
		});
	});

	it("marks an unregistered media executor as failed instead of simulating success", async () => {
		const fixture = createEnvironment({
			node: { id: "image-1", type: "taskNode", data: { kind: "workflowStage", workflowAtomicSpec: { version: 1, category: "media", operation: "image_generate", executorRef: "tapcanvas.unregistered.media/v1", executionMode: "once", inputPorts: [], outputPorts: ["image"] } } },
		});

		await handleWorkflowNodeJob(fixture.env, workflowJob("execution-1", "image-1"));

		expect(fixture.requests[1]?.payload).toMatchObject({
			nodeId: "image-1",
			ok: false,
			errorCode: "workflow_node_executor_missing",
		});
		expect(String(fixture.requests[1]?.payload.errorMessage)).toContain(
			"no registered server executor",
		);
	});

	it("turns immutable snapshot lookup failures into node failure facts", async () => {
		const fixture = createEnvironment({
			node: { id: "other-node", type: "taskNode", data: { kind: "text" } },
		});

		await handleWorkflowNodeJob(fixture.env, workflowJob("execution-1", "missing-node"));

		expect(fixture.requests[1]?.payload).toMatchObject({
			nodeId: "missing-node",
			ok: false,
			errorCode: "workflow_node_runtime_failed",
		});
		expect(String(fixture.requests[1]?.payload.errorMessage)).toContain(
			"does not exist in the immutable flow version",
		);
	});

	it("aborts the active execution job set after durable terminal failure is recorded", async () => {
		let observedSignal: AbortSignal | undefined;
		runWorkflowAgentNode.mockImplementationOnce(async (_env, request) => {
			observedSignal = request.abortSignal;
			throw new Error("deterministic agent failure");
		});
		const fixture = createEnvironment({
			node: {
				id: "agent-failure",
				type: "taskNode",
				data: {
					kind: "workflowStage",
					workflowInstruction: "执行原子转换",
					workflowAgentOutputArtifactType: "tapcanvas.text/v1",
					workflowAgentOutputEncoding: "plain_text",
					workflowAgentDeliveryRequirement: "交付完整文本",
					workflowAgentDefinitionId: "workflow-transformer",
					workflowAgentModelKey: "model-1",
					workflowAgentMaxOutputTokens: 4096,
					workflowAtomicSpec: {
						version: 1,
						category: "agent",
						operation: "agent_task",
						executorRef: "agents.logical-task/v2",
						executionMode: "once",
						inputPorts: [],
						outputPorts: ["result"],
					},
				},
			},
		});

		await handleWorkflowNodeJob(fixture.env, workflowJob("execution-terminal-failure", "agent-failure"));

		expect(fixture.requests[1]?.payload).toMatchObject({
			nodeId: "agent-failure",
			ok: false,
			errorCode: "workflow_node_runtime_failed",
		});
		expect(observedSignal?.aborted).toBe(true);
		expect((observedSignal?.reason as Error | undefined)?.message).toBe(
			"workflow_execution_failed_at_node:agent-failure",
		);
	});

	it("stops before DB work when the scheduler rejects nodeStarted", async () => {
		const fixture = createEnvironment({
			node: { id: "text-1", type: "taskNode", data: { kind: "text" } },
			startedResponse: new Response("execution already failed", { status: 409 }),
		});

		await expect(
			handleWorkflowNodeJob(fixture.env, workflowJob("execution-1", "text-1")),
		).rejects.toThrow(/execution already failed/u);
		expect(fixture.findExecution).not.toHaveBeenCalled();
		expect(fixture.requests).toHaveLength(1);
	});

	it("acknowledges an already-started delivery without executing the node twice", async () => {
		const fixture = createEnvironment({
			node: { id: "text-1", type: "taskNode", data: { kind: "text" } },
			startedResponse: new Response("already success", { status: 208 }),
		});

		await handleWorkflowNodeJob(fixture.env, workflowJob("execution-1", "text-1"));
		expect(fixture.findExecution).not.toHaveBeenCalled();
		expect(fixture.requests).toHaveLength(1);
	});

	it("resumes a persisted external wait without re-executing the paid node", async () => {
		const fixture = createEnvironment({
			node: { id: "video-1", type: "taskNode", data: { kind: "workflowStage" } },
			startedResponse: new Response("resume external wait", { status: 209 }),
		});
		await handleWorkflowNodeJob(fixture.env, workflowJob("execution-1", "video-1"));
		expect(fixture.findExecution).not.toHaveBeenCalled();
		expect(fixture.queueSend).toHaveBeenCalledWith(
			workflowJob("execution-1", "video-1", "await_external"),
		);
	});

	it("fails an external check with no persisted receipt instead of submitting again", async () => {
		const fixture = createEnvironment({
			node: {
				id: "video-1",
				type: "taskNode",
				data: {
					kind: "workflowStage",
					workflowAtomicSpec: {
						version: 1,
						category: "media",
						operation: "video_generate",
						executorRef: "tapcanvas.video.generate/v1",
						executionMode: "once",
						inputPorts: ["prompt"],
						outputPorts: ["video"],
					},
				},
			},
		});

		await handleWorkflowNodeJob(fixture.env, workflowJob("execution-1", "video-1", "await_external"));

		expect(fixture.requests.map((request) => request.path)).toEqual([
			"/nodeExternalCheckStarted",
			"/nodeComplete",
		]);
		expect(fixture.requests[1]?.payload).toMatchObject({
			nodeId: "video-1",
			ok: false,
			errorCode: "workflow_node_runtime_failed",
			errorMessage: expect.stringContaining("without a valid persisted output receipt"),
		});
		expect(fixture.queueSend).not.toHaveBeenCalled();
	});

	it("resumes a durable Agent task after runtime restart without requiring a local output receipt", async () => {
		runWorkflowAgentNode.mockResolvedValueOnce({
			taskId: "workflow:execution-1:agent-1",
			text: "恢复后的完整产物",
			assets: [],
			expectedDelivery: { kind: "text" },
			deliveryEvidence: { finalResponse: true },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded", reason: "delivery_satisfied" },
		});
		const fixture = createEnvironment({
			node: {
				id: "agent-1",
				type: "taskNode",
				data: {
					kind: "workflowStage",
					workflowInstruction: "恢复同一逻辑任务",
					workflowAgentOutputArtifactType: "tapcanvas.text/v1",
					workflowAgentOutputEncoding: "plain_text",
					workflowAgentDeliveryRequirement: "交付完整文本",
					workflowAgentDefinitionId: "writer",
					workflowAgentModelKey: "model-1",
					workflowAgentMaxOutputTokens: 4096,
					workflowAtomicSpec: {
						version: 1,
						category: "agent",
						operation: "agent_task",
						executorRef: "agents.logical-task/v2",
						executionMode: "once",
						inputPorts: [],
						outputPorts: ["result"],
					},
				},
			},
		});

		await handleWorkflowNodeJob(fixture.env, workflowJob("execution-1", "agent-1", "recover"));

		expect(runWorkflowAgentNode).toHaveBeenCalledWith(
			fixture.env,
			expect.objectContaining({
				executionId: "execution-1",
				nodeId: "agent-1",
				resumeOnly: true,
				previousEvidence: null,
			}),
		);
		expect(fixture.requests.map((request) => request.path)).toEqual([
			"/nodeRecoveryStarted",
			"/nodeComplete",
		]);
		expect(fixture.requests[1]?.payload).toMatchObject({
			nodeId: "agent-1",
			ok: true,
		});
	});

	it("starts a failed Agent fresh in a new physical recovery execution when no own receipt exists", async () => {
		runWorkflowAgentNode.mockResolvedValueOnce({
			taskId: "workflow:execution-recovery:agent-1",
			text: "新物理执行产生的完整产物",
			assets: [],
			expectedDelivery: { kind: "text" },
			deliveryEvidence: { finalResponse: true },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded", reason: "delivery_satisfied" },
		});
		const fixture = createEnvironment({
			recoveryOfExecutionId: "execution-failed",
			node: {
				id: "agent-1",
				type: "taskNode",
				data: {
					kind: "workflowStage",
					workflowInstruction: "在新物理执行中重新完成失败节点",
					workflowAgentOutputArtifactType: "tapcanvas.text/v1",
					workflowAgentOutputEncoding: "plain_text",
					workflowAgentDeliveryRequirement: "交付完整文本",
					workflowAgentDefinitionId: "writer",
					workflowAgentModelKey: "model-1",
					workflowAgentMaxOutputTokens: 4096,
					workflowAtomicSpec: {
						version: 1,
						category: "agent",
						operation: "agent_task",
						executorRef: "agents.logical-task/v2",
						executionMode: "once",
						inputPorts: [],
						outputPorts: ["result"],
					},
				},
			},
		});

		await handleWorkflowNodeJob(
			fixture.env,
			workflowJob("execution-recovery", "agent-1", "recover"),
		);

		expect(runWorkflowAgentNode).toHaveBeenCalledWith(
			fixture.env,
			expect.objectContaining({
				executionId: "execution-recovery",
				nodeId: "agent-1",
				resumeOnly: false,
				previousEvidence: null,
			}),
		);
		expect(fixture.requests.map((request) => request.path)).toEqual([
			"/nodeRecoveryStarted",
			"/nodeComplete",
		]);
	});

	it("resumes an Agent execute job whenever persisted item progress proves an interrupted run", async () => {
		runWorkflowAgentNode.mockResolvedValueOnce({
			taskId: "workflow:execution-1:agent-1",
			text: "恢复后的完整产物",
			assets: [],
			expectedDelivery: { kind: "text" },
			deliveryEvidence: { finalResponse: true },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded", reason: "delivery_satisfied" },
		});
		const currentOutput = {
			protocolVersion: "1",
			executorRef: "agents.logical-task/v2",
			nodeId: "agent-1",
			executionMode: "once",
			ports: {},
			artifacts: [],
			evidence: { taskId: "workflow:execution-1:agent-1", executorCompleted: false },
			itemRuns: [],
		};
		const fixture = createEnvironment({
			currentOutput,
			node: {
				id: "agent-1",
				type: "taskNode",
				data: {
					kind: "workflowStage",
					workflowInstruction: "恢复同一逻辑任务",
					workflowAgentOutputArtifactType: "tapcanvas.text/v1",
					workflowAgentOutputEncoding: "plain_text",
					workflowAgentDeliveryRequirement: "交付完整文本",
					workflowAgentDefinitionId: "writer",
					workflowAgentModelKey: "model-1",
					workflowAgentMaxOutputTokens: 4096,
					workflowAtomicSpec: {
						version: 1,
						category: "agent",
						operation: "agent_task",
						executorRef: "agents.logical-task/v2",
						executionMode: "once",
						inputPorts: [],
						outputPorts: ["result"],
					},
				},
			},
		});

		await handleWorkflowNodeJob(fixture.env, workflowJob("execution-1", "agent-1"));

		expect(runWorkflowAgentNode).toHaveBeenCalledWith(
			fixture.env,
			expect.objectContaining({
				resumeOnly: true,
				previousEvidence: currentOutput.evidence,
			}),
		);
	});

	it("persists a recoverable Agent transport interruption and requeues the same node", async () => {
		runWorkflowAgentNode.mockResolvedValueOnce({
			taskId: "workflow:execution-1:agent-waiting",
			text: "",
			assets: [],
			expectedDelivery: null,
			deliveryEvidence: {
				transportInterrupted: true,
				errorCode: "agents_bridge_stream_interrupted",
			},
			deliveryVerification: null,
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_transport_recovery_pending",
			},
		});
		const fixture = createEnvironment({
			node: {
				id: "agent-waiting",
				type: "taskNode",
				data: {
					kind: "workflowStage",
					workflowInstruction: "生成完整产物",
					workflowAgentOutputArtifactType: "tapcanvas.text/v1",
					workflowAgentOutputEncoding: "plain_text",
					workflowAgentDeliveryRequirement: "交付完整文本",
					workflowAgentDefinitionId: "writer",
					workflowAgentModelKey: "model-1",
					workflowAgentMaxOutputTokens: 4096,
					workflowAtomicSpec: {
						version: 1,
						category: "agent",
						operation: "agent_task",
						executorRef: "agents.logical-task/v2",
						executionMode: "once",
						inputPorts: [],
						outputPorts: ["result"],
					},
				},
			},
		});

		await handleWorkflowNodeJob(fixture.env, workflowJob("execution-1", "agent-waiting"));

		expect(fixture.requests.map((request) => request.path)).toEqual([
			"/nodeStarted",
			"/nodeWaiting",
		]);
		expect(fixture.requests[1]?.payload).toMatchObject({
			nodeId: "agent-waiting",
			outputRefs: {
				ports: {},
				artifacts: [],
				externalCheck: {
					version: 1,
					mode: "poll",
					notBeforeAt: expect.any(String),
				},
				evidence: {
					executorCompleted: false,
					continuationReason: "workflow_agent_transport_recovery_pending",
				},
			},
		});
		expect(fixture.queueSend).toHaveBeenCalledWith(
			workflowJob("execution-1", "agent-waiting", "await_external"),
			{ delaySeconds: 5 },
		);
	});

	it("persists provider-balance wait as a low-frequency timer without replaying the Agent", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-23T00:00:00.000Z"));
		try {
			runWorkflowAgentNode.mockResolvedValueOnce({
				taskId: "workflow:execution-1:agent-balance",
				text: "",
				assets: [],
				expectedDelivery: null,
				deliveryEvidence: {
					state: "suspended",
					recoveryCheckpoint: { reasonCode: "provider_balance_required" },
				},
				deliveryVerification: null,
				requestTerminal: { status: "suspended", reason: "provider_balance_required" },
			});
			const fixture = createEnvironment({
				node: {
					id: "agent-balance",
					type: "taskNode",
					data: {
						kind: "workflowStage",
						workflowInstruction: "生成完整产物",
						workflowAgentOutputArtifactType: "tapcanvas.text/v1",
						workflowAgentOutputEncoding: "plain_text",
						workflowAgentDeliveryRequirement: "交付完整文本",
						workflowAgentDefinitionId: "writer",
						workflowAgentModelKey: "model-1",
						workflowAgentMaxOutputTokens: 4096,
						workflowAtomicSpec: {
							version: 1,
							category: "agent",
							operation: "agent_task",
							executorRef: "agents.logical-task/v2",
							executionMode: "once",
							inputPorts: [],
							outputPorts: ["result"],
						},
					},
				},
			});

			await handleWorkflowNodeJob(fixture.env, workflowJob("execution-1", "agent-balance"));

			expect(fixture.requests[1]?.payload).toMatchObject({
				outputRefs: {
					externalCheck: {
						version: 1,
						mode: "poll",
						notBeforeAt: "2026-08-23T00:01:00.000Z",
					},
				},
			});
			expect(fixture.queueSend).toHaveBeenCalledWith(
				workflowJob("execution-1", "agent-balance", "await_external"),
				{ delaySeconds: 60 },
			);
			expect(runWorkflowAgentNode).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("rejects malformed queue jobs instead of silently dropping them", async () => {
		const fixture = createEnvironment({
			node: { id: "text-1", type: "taskNode", data: { kind: "text" } },
		});

		await expect(
			handleWorkflowNodeJob(fixture.env, {
				executionId: "",
				nodeId: "text-1",
				nodeRunId: "node-run-1",
				attempt: 1,
			}),
		).rejects.toThrow(/executionId must be a non-empty string/u);
		expect(fixture.requests).toEqual([]);
	});
});
