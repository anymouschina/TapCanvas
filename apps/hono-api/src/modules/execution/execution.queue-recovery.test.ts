import { describe, expect, it, vi } from "vitest";
import type { WorkerEnv } from "../../types";
import {
	reconcileLocallyAbandonedWorkflowExecutions,
	recoverInterruptedWorkflowExecutions,
	resumeQueuedWorkflowNodes,
	resumeWaitingWorkflowNodes,
} from "./execution.queue";
import { freezeWorkflowExecutionSemanticsSnapshot } from "./execution.semantics-snapshot";

describe("workflow queue restart recovery", () => {
	it("starts persisted queued executions that crashed before Durable Object initialization", async () => {
		const durableFetch = vi.fn(async () => new Response("ok", { status: 200 }));
		const env = {
			DB: {
				workflow_executions: {
					findMany: vi.fn(async () => [{ id: "execution-queued", flow_version_id: "version-1", status: "queued" }]),
				},
			},
			EXECUTION_DO: {
				idFromName: (value: string) => ({ toString: () => value }),
				get: () => ({ fetch: durableFetch }),
			},
		} as unknown as WorkerEnv;

		await expect(recoverInterruptedWorkflowExecutions(env)).resolves.toEqual({
			executions: 1,
			recoverableNodes: 0,
			unsafeNodes: 0,
		});
		expect(durableFetch).toHaveBeenCalledWith("https://do/start", { method: "POST" });
	});

	it("replays structural nodes and reconciles both persisted Agent turns and claimed video effects", async () => {
		const durableFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ recovered: 3, failedExplicitly: 0 }));
		const flowData = JSON.stringify(freezeWorkflowExecutionSemanticsSnapshot({
			nodes: [
				{ id: "text", type: "taskNode", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "workflow.input.text/v1" } } },
				{ id: "agent", type: "taskNode", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "agents.logical-task/v2" } } },
				{ id: "video", type: "taskNode", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "tapcanvas.video.generate/v1" } } },
				{ id: "waiting-video", type: "taskNode", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "tapcanvas.video.generate/v1" } } },
			],
			edges: [],
		}));
		const env = {
			DB: {
				workflow_executions: {
					findMany: vi.fn(async () => [{ id: "execution-1", flow_version_id: "version-1", status: "running" }]),
				},
				workflow_node_runs: {
					findMany: vi.fn(async () => [
						{ node_id: "text", status: "running" },
						{ node_id: "agent", status: "running" },
						{ node_id: "video", status: "running" },
						{ node_id: "waiting-video", status: "waiting_external" },
					]),
				},
				flow_versions: { findUnique: vi.fn(async () => ({ data: flowData })) },
			},
			EXECUTION_DO: {
				idFromName: (value: string) => ({ toString: () => value }),
				get: () => ({ fetch: durableFetch }),
			},
		} as unknown as WorkerEnv;

		await expect(recoverInterruptedWorkflowExecutions(env)).resolves.toEqual({
			executions: 1,
			recoverableNodes: 3,
			unsafeNodes: 0,
		});
		expect(durableFetch).toHaveBeenCalledTimes(1);
		const init = durableFetch.mock.calls[0]?.[1];
		expect(JSON.parse(String(init?.body))).toEqual({
			recoverableNodeIds: ["text", "agent", "video"],
			unsafeNodeIds: [],
			recoveryReason: "process_startup",
		});
	});

	it("continues polling accepted external work even after another branch failed", async () => {
		const queueSend = vi.fn(async () => undefined);
		const findMany = vi.fn(async () => [{ id: "node-run-video", execution_id: "execution-1", node_id: "video", attempt: 3 }]);
		const env = {
			DB: { workflow_node_runs: { findMany } },
			WORKFLOW_NODE_QUEUE: { send: queueSend },
		} as unknown as WorkerEnv;

		await expect(resumeWaitingWorkflowNodes(env)).resolves.toBe(1);
		expect(findMany).toHaveBeenCalledWith({
			where: {
				status: "waiting_external",
				workflow_executions: { status: { in: ["running", "failed"] } },
			},
			select: { id: true, execution_id: true, node_id: true, attempt: true, output_refs: true },
		});
		expect(queueSend).toHaveBeenCalledWith({
			executionId: "execution-1",
			nodeId: "video",
			nodeRunId: "node-run-video",
			attempt: 3,
			phase: "await_external",
		});
	});

	it("restores a persisted timer wait at its exact not-before boundary", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-23T00:00:00.000Z"));
		try {
			const queueSend = vi.fn(async () => undefined);
			const outputRefs = JSON.stringify({
				protocolVersion: "1",
				executorRef: "agents.logical-task/v2",
				nodeId: "agent",
				executionMode: "once",
				ports: {},
				artifacts: [],
				evidence: { executorCompleted: false },
				itemRuns: [],
				externalCheck: {
					version: 1,
					mode: "poll",
					notBeforeAt: "2026-08-23T00:01:00.000Z",
				},
			});
			const env = {
				DB: {
					workflow_node_runs: {
						findMany: vi.fn(async () => [{
							id: "node-run-agent",
							execution_id: "execution-1",
							node_id: "agent",
							attempt: 2,
							output_refs: outputRefs,
						}]),
					},
				},
				WORKFLOW_NODE_QUEUE: { send: queueSend },
			} as unknown as WorkerEnv;

			await expect(resumeWaitingWorkflowNodes(env)).resolves.toBe(1);
			expect(queueSend).toHaveBeenCalledWith({
				executionId: "execution-1",
				nodeId: "agent",
				nodeRunId: "node-run-agent",
				attempt: 2,
				phase: "await_external",
			}, { delaySeconds: 60 });
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not poll a persisted signal-only wait", async () => {
		const queueSend = vi.fn(async () => undefined);
		const outputRefs = JSON.stringify({
			protocolVersion: "1",
			executorRef: "workflow.human.approval/v1",
			nodeId: "approval",
			executionMode: "once",
			ports: {},
			artifacts: [],
			evidence: { executorCompleted: false },
			itemRuns: [],
			externalCheck: { version: 1, mode: "signal_only" },
		});
		const env = {
			DB: {
				workflow_node_runs: {
					findMany: vi.fn(async () => [{
						id: "node-run-approval",
						execution_id: "execution-1",
						node_id: "approval",
						attempt: 1,
						output_refs: outputRefs,
					}]),
				},
			},
			WORKFLOW_NODE_QUEUE: { send: queueSend },
		} as unknown as WorkerEnv;

		await expect(resumeWaitingWorkflowNodes(env)).resolves.toBe(0);
		expect(queueSend).not.toHaveBeenCalled();
	});

	it("redelivers only durable queued intents with the exact persisted attempt identity", async () => {
		const queueSend = vi.fn(async () => undefined);
		const findMany = vi.fn(async () => [{
			id: "node-run-queued",
			execution_id: "execution-1",
			node_id: "writer",
			attempt: 2,
		}]);
		const env = {
			DB: { workflow_node_runs: { findMany } },
			WORKFLOW_NODE_QUEUE: { send: queueSend },
		} as unknown as WorkerEnv;

		await expect(resumeQueuedWorkflowNodes(env)).resolves.toBe(1);
		expect(findMany).toHaveBeenCalledWith({
			where: {
				status: "queued",
				workflow_executions: { status: "running" },
			},
			select: { id: true, execution_id: true, node_id: true, attempt: true },
		});
		expect(queueSend).toHaveBeenCalledWith({
			executionId: "execution-1",
			nodeId: "writer",
			nodeRunId: "node-run-queued",
			attempt: 2,
			phase: "recover",
		});
	});

	it("recovers a running execution whose local queue driver disappeared", async () => {
		const durableFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
			Response.json({ recovered: 1, failedExplicitly: 0 })
		));
		const flowData = JSON.stringify(freezeWorkflowExecutionSemanticsSnapshot({
			nodes: [
				{ id: "agent", type: "taskNode", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "agents.logical-task/v2" } } },
			],
			edges: [],
		}));
		const env = {
			DB: {
				workflow_executions: {
					findMany: vi.fn(async () => [{ id: "execution-orphan", flow_version_id: "version-1", status: "running" }]),
				},
				workflow_node_runs: {
					findMany: vi.fn(async () => [{ node_id: "agent", status: "running" }]),
				},
				workflow_execution_events: { findFirst: vi.fn(async () => null) },
				flow_versions: { findUnique: vi.fn(async () => ({ data: flowData })) },
			},
			EXECUTION_DO: {
				idFromName: (value: string) => ({ toString: () => value }),
				get: () => ({ fetch: durableFetch }),
			},
		} as unknown as WorkerEnv;

		await expect(reconcileLocallyAbandonedWorkflowExecutions(env, new Set())).resolves.toEqual({
			executions: 1,
			recoverableNodes: 1,
			unsafeNodes: 0,
		});
		expect(durableFetch).toHaveBeenCalledTimes(1);
		expect(JSON.parse(String(durableFetch.mock.calls[0]?.[1]?.body))).toEqual({
			recoverableNodeIds: ["agent"],
			unsafeNodeIds: [],
			recoveryReason: "local_abandonment",
			ownershipStaleBefore: expect.any(String),
		});
	});

	it("does not recover a running execution while its local queue driver is alive", async () => {
		const durableFetch = vi.fn(async () => Response.json({ recovered: 1, failedExplicitly: 0 }));
		const findNodeRuns = vi.fn(async () => [{ node_id: "agent", status: "running" }]);
		const env = {
			DB: {
				workflow_executions: {
					findMany: vi.fn(async () => [{ id: "execution-active", flow_version_id: "version-1", status: "running" }]),
				},
				workflow_node_runs: { findMany: findNodeRuns },
			},
			EXECUTION_DO: {
				idFromName: (value: string) => ({ toString: () => value }),
				get: () => ({ fetch: durableFetch }),
			},
		} as unknown as WorkerEnv;

		await expect(reconcileLocallyAbandonedWorkflowExecutions(
			env,
			new Set(["execution-active"]),
		)).resolves.toEqual({ executions: 0, recoverableNodes: 0, unsafeNodes: 0 });
		expect(findNodeRuns).not.toHaveBeenCalled();
		expect(durableFetch).not.toHaveBeenCalled();
	});

	it("rechecks live executor ownership after a long database scan instead of using an entry snapshot", async () => {
		const activeExecutionIds = new Set<string>();
		const durableFetch = vi.fn(async () => Response.json({ recovered: 1, failedExplicitly: 0 }));
		const findNodeRuns = vi.fn(async ({ where }: { where: { execution_id: string } }) => {
			if (where.execution_id === "execution-scan-first") {
				activeExecutionIds.add("execution-became-active");
				return [];
			}
			return [{ node_id: "agent", status: "running" }];
		});
		const env = {
			DB: {
				workflow_executions: {
					findMany: vi.fn(async () => [
						{ id: "execution-scan-first", flow_version_id: "version-1", status: "running" },
						{ id: "execution-became-active", flow_version_id: "version-1", status: "running" },
					]),
				},
				workflow_node_runs: { findMany: findNodeRuns },
			},
			EXECUTION_DO: {
				idFromName: (value: string) => ({ toString: () => value }),
				get: () => ({ fetch: durableFetch }),
			},
		} as unknown as WorkerEnv;

		await expect(reconcileLocallyAbandonedWorkflowExecutions(
			env,
			(executionId) => activeExecutionIds.has(executionId),
		)).resolves.toEqual({ executions: 0, recoverableNodes: 0, unsafeNodes: 0 });
		expect(findNodeRuns).toHaveBeenCalledTimes(1);
		expect(durableFetch).not.toHaveBeenCalled();
	});

	it("does not recover a node whose durable ownership was acquired during the status scan", async () => {
		const nowMs = Date.parse("2026-08-22T19:31:30.000Z");
		const durableFetch = vi.fn(async () => Response.json({ recovered: 1, failedExplicitly: 0 }));
		const findOwnershipEvent = vi.fn(async () => ({
			created_at: "2026-08-22T19:31:29.900Z",
		}));
		const env = {
			DB: {
				workflow_executions: {
					findMany: vi.fn(async () => [{ id: "execution-raced", flow_version_id: "version-1", status: "running" }]),
				},
				workflow_node_runs: {
					findMany: vi.fn(async () => [{ node_id: "agent", status: "running" }]),
				},
				workflow_execution_events: { findFirst: findOwnershipEvent },
			},
			EXECUTION_DO: {
				idFromName: (value: string) => ({ toString: () => value }),
				get: () => ({ fetch: durableFetch }),
			},
		} as unknown as WorkerEnv;

		await expect(reconcileLocallyAbandonedWorkflowExecutions(
			env,
			new Set(),
			{ nowMs, abandonmentGraceMs: 60_000 },
		)).resolves.toEqual({ executions: 0, recoverableNodes: 0, unsafeNodes: 0 });
		expect(findOwnershipEvent).toHaveBeenCalledWith({
			where: {
				execution_id: "execution-raced",
				node_id: { in: ["agent"] },
				event_type: {
					in: ["node_started", "node_recovery_started", "node_external_check_started", "node_heartbeat"],
				},
			},
			select: { created_at: true },
			orderBy: [{ created_at: "desc" }, { seq: "desc" }],
		});
		expect(durableFetch).not.toHaveBeenCalled();
	});

	it("recovers only after the durable ownership grace period expires", async () => {
		const durableFetch = vi.fn(async () => Response.json({ recovered: 1, failedExplicitly: 0 }));
		const flowData = JSON.stringify(freezeWorkflowExecutionSemanticsSnapshot({
			nodes: [
				{ id: "agent", type: "taskNode", data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "agents.logical-task/v2" } } },
			],
			edges: [],
		}));
		const env = {
			DB: {
				workflow_executions: {
					findMany: vi.fn(async () => [{ id: "execution-expired", flow_version_id: "version-1", status: "running" }]),
				},
				workflow_node_runs: {
					findMany: vi.fn(async () => [{ node_id: "agent", status: "running" }]),
				},
				workflow_execution_events: {
					findFirst: vi.fn(async () => ({ created_at: "2026-08-22T19:29:00.000Z" })),
				},
				flow_versions: { findUnique: vi.fn(async () => ({ data: flowData })) },
			},
			EXECUTION_DO: {
				idFromName: (value: string) => ({ toString: () => value }),
				get: () => ({ fetch: durableFetch }),
			},
		} as unknown as WorkerEnv;

		await expect(reconcileLocallyAbandonedWorkflowExecutions(
			env,
			new Set(),
			{ nowMs: Date.parse("2026-08-22T19:31:30.000Z"), abandonmentGraceMs: 60_000 },
		)).resolves.toEqual({ executions: 1, recoverableNodes: 1, unsafeNodes: 0 });
		expect(durableFetch).toHaveBeenCalledTimes(1);
	});
});
