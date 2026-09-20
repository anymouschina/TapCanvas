import { describe, expect, it, vi } from "vitest";
import { executeWithImmediateOutputRepair } from "./execution.immediate-output-repair";
import type { WorkflowNodeExecutionContext, WorkflowNodeExecutorDependencies } from "./execution.node-executors";
import { workflowNodeWaiting, type WorkflowNodeOutputV1 } from "./execution.node-runtime";
import { workflowExternalPollAfter } from "./execution.external-check";

const output: WorkflowNodeOutputV1 = {
	protocolVersion: "1", executorRef: "agents.logical-task/v2", nodeId: "author", executionMode: "once",
	ports: {}, artifacts: [], itemRuns: [], evidence: {
		continuationReason: "structured_output_repair_required",
		outputRepair: { version: 1, sourceTurnId: "turn-1", candidate: '{"identity":"original"}', error: "Required field missing" },
	},
};
const waiting = workflowNodeWaiting(output, workflowExternalPollAfter(5_000));
const dependencies: WorkflowNodeExecutorDependencies = { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: vi.fn() };
function context(): WorkflowNodeExecutionContext {
	return { executionId: "execution-1", executionFamilyId: "family-1", ownerId: "owner", flowId: "flow", projectId: "project",
		workflowKey: "workflow", node: { id: "author", type: "taskNode", kind: "workflowStage", data: {} }, inputs: {}, checkpointOutputRefs: vi.fn() };
}

describe("immediate author correction", () => {
	it("checkpoints first and passes the original candidate and exact failure back to the same node", async () => {
		const ctx = context();
		const execute = vi.fn().mockResolvedValueOnce(waiting).mockImplementationOnce(async (next: WorkflowNodeExecutionContext) => {
			expect(ctx.checkpointOutputRefs).toHaveBeenCalledWith({ ...output, externalCheck: waiting.externalCheck });
			expect(next).toMatchObject({ executionId: ctx.executionId, executionFamilyId: ctx.executionFamilyId, resumeOnly: true, resumeOutputRefs: output });
			return { ok: true as const, outputRefs: { ...output, evidence: { executorCompleted: true }, ports: { result: "corrected" } } };
		});
		const result = await executeWithImmediateOutputRepair(ctx, dependencies, execute);
		expect(execute).toHaveBeenCalledTimes(2);
		expect(result).toMatchObject({ ok: true, outputRefs: { ports: { result: "corrected" }, evidence: {
			immediateOutputRepair: { sourceTurnId: "turn-1", attemptCount: 1, outcome: "accepted" },
		} } });
	});
	it("dispatches the allocated repair generation before unrelated siblings settle", async () => {
		const ctx = context();
		const pending = workflowNodeWaiting({ ...output, evidence: { ...output.evidence,
			continuationReason: "workflow_agent_physical_retry_pending",
			deliveryEvidence: { retryablePhysicalFailure: true, physicalFailureReason: "structured_output_invalid", physicalRetryOrdinal: 1 },
		} }, workflowExternalPollAfter(5_000));
		const execute = vi.fn().mockResolvedValueOnce(waiting).mockResolvedValueOnce(pending)
			.mockImplementationOnce(async (next: WorkflowNodeExecutionContext) => {
				expect(ctx.checkpointOutputRefs).toHaveBeenCalledTimes(2);
				expect(next.resumeOutputRefs).toEqual(pending.outputRefs);
				return { ok: true as const, outputRefs: { ...output, evidence: {}, ports: { result: "repaired" } } };
			});
		const result = await executeWithImmediateOutputRepair(ctx, dependencies, execute);
		expect(execute).toHaveBeenCalledTimes(3);
		expect(result).toMatchObject({ ok: true, outputRefs: { ports: { result: "repaired" } } });
	});

	it("honors a persisted retry delay instead of dispatching ahead of it", async () => {
		const pending = workflowNodeWaiting({ ...output, evidence: { ...output.evidence,
			deliveryEvidence: { retryablePhysicalFailure: true, physicalFailureReason: "structured_output_invalid", physicalRetryOrdinal: 1,
				retryNotBeforeAt: new Date(Date.now() + 60_000).toISOString() },
		} }, workflowExternalPollAfter(60_000));
		const execute = vi.fn().mockResolvedValueOnce(waiting).mockResolvedValueOnce(pending);
		await executeWithImmediateOutputRepair(context(), dependencies, execute);
		expect(execute).toHaveBeenCalledTimes(2);
	});
	it("does not dispatch the allocated generation if its durable checkpoint fails", async () => {
		const pending = workflowNodeWaiting({ ...output, evidence: { ...output.evidence,
			deliveryEvidence: { retryablePhysicalFailure: true, physicalFailureReason: "structured_output_invalid", physicalRetryOrdinal: 1 },
		} }, workflowExternalPollAfter(5_000));
		const execute = vi.fn().mockResolvedValueOnce(waiting).mockResolvedValueOnce(pending);
		const checkpoint = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("checkpoint unavailable"));
		await expect(executeWithImmediateOutputRepair({ ...context(), checkpointOutputRefs: checkpoint }, dependencies, execute)).rejects.toThrow("checkpoint unavailable");
		expect(execute).toHaveBeenCalledTimes(2);
	});

	it("gives only one immediate correction and leaves further repair to the durable chain", async () => {
		const execute = vi.fn().mockResolvedValue(waiting);
		const first = await executeWithImmediateOutputRepair(context(), dependencies, execute);
		expect(execute).toHaveBeenCalledTimes(2);
		expect(first).toMatchObject({ ok: false, waitingExternal: true });
		await executeWithImmediateOutputRepair({ ...context(), resumeOutputRefs: output, resumeOnly: true }, dependencies, execute);
		expect(execute).toHaveBeenCalledTimes(3);
	});
	it("never starts correction after cancellation or a failed checkpoint", async () => {
		const execute = vi.fn().mockResolvedValue(waiting);
		const controller = new AbortController();
		await expect(executeWithImmediateOutputRepair({ ...context(), abortSignal: controller.signal,
			checkpointOutputRefs: vi.fn(async () => { controller.abort(new Error("user canceled")); }),
		}, dependencies, execute)).rejects.toThrow("user canceled");
		expect(execute).toHaveBeenCalledTimes(1);
		execute.mockClear();
		await expect(executeWithImmediateOutputRepair({ ...context(), checkpointOutputRefs: vi.fn().mockRejectedValue(new Error("storage unavailable")) }, dependencies, execute)).rejects.toThrow("storage unavailable");
		expect(execute).toHaveBeenCalledTimes(1);
	});
});
