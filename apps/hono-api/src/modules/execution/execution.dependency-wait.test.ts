import { describe, expect, it, vi } from "vitest";
import { ExternalDependencyError } from "../../platform/external-dependency-error";
import { readWithImmediateDependencyRepair, waitForReadOnlyDependency } from "./execution.dependency-wait";
import type { WorkflowNodeOutputV1 } from "./execution.node-runtime";

const output: WorkflowNodeOutputV1 = {
	protocolVersion: "1", nodeId: "read-contract", executorRef: "test.read/v1", executionMode: "once",
	ports: {}, artifacts: [], evidence: {}, itemRuns: [],
};
const error = new ExternalDependencyError({ kind: "model_catalog", identity: "model-a", field: "referenceLimit", code: "contract_missing", observed: null });

describe("read-only external dependency recovery", () => {
	it("repairs a stale contract immediately once and continues without scheduling a wait", async () => {
		const read = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce({ maximum: 8 });
		expect(await readWithImmediateDependencyRepair({ read, previousEvidence: null })).toEqual({
			value: { maximum: 8 }, repairEvidence: { dependencyRepair: {
				version: 1, action: "refresh_authoritative_read", attemptCount: 1, initialFailure: error.dependency,
			} },
		});
		expect(read).toHaveBeenCalledTimes(2);
	});
	it("does not retry unknown errors and does not repeat the immediate repair after restart", async () => {
		const unknownRead = vi.fn().mockRejectedValue(new Error("unknown side-effect boundary"));
		await expect(readWithImmediateDependencyRepair({ read: unknownRead, previousEvidence: null })).rejects.toThrow("unknown side-effect boundary");
		expect(unknownRead).toHaveBeenCalledTimes(1);
		const waiting = waitForReadOnlyDependency({ error, output, previousEvidence: null });
		const read = vi.fn().mockRejectedValue(error);
		await expect(readWithImmediateDependencyRepair({ read, previousEvidence: waiting.outputRefs?.evidence ?? null })).rejects.toThrow(error.message);
		expect(read).toHaveBeenCalledTimes(1);
	});
	it("persists the exact missing fact and a scheduled wait, not a terminal failure", () => {
		const result = waitForReadOnlyDependency({ error, output, previousEvidence: null, nowMs: 0 });
		expect(result).toMatchObject({ ok: false, waitingExternal: true,
			externalCheck: { version: 1, mode: "poll", notBeforeAt: "1970-01-01T00:00:30.000Z" },
			outputRefs: { evidence: { executorCompleted: false, sideEffect: "none", dependencyObservation: {
				checkCount: 1, dependency: error.dependency, firstObservedAt: "1970-01-01T00:00:00.000Z",
			} } },
		});
	});
	it("restores its cursor after serialization and caps frequency without ending the task", () => {
		let evidence: Record<string, unknown> | null = null;
		for (let index = 0; index < 30; index += 1) {
			const result = waitForReadOnlyDependency({ error, output, previousEvidence: evidence, nowMs: index * 900_000 });
			if (result.ok || !result.waitingExternal) throw new Error("Expected durable external wait");
			evidence = JSON.parse(JSON.stringify(result.outputRefs.evidence)) as Record<string, unknown>;
			expect(evidence.dependencyObservation).toMatchObject({ checkCount: index + 1, firstObservedAt: "1970-01-01T00:00:00.000Z" });
			if (index >= 5) expect(result.externalCheck).toEqual({ version: 1, mode: "poll", notBeforeAt: new Date((index + 1) * 900_000).toISOString() });
		}
	});
	it("preserves existing artifacts and refuses corrupted recovery evidence", () => {
		const artifact = { type: "test.artifact/v1", identity: "already-produced" };
		const result = waitForReadOnlyDependency({ error, output: { ...output, artifacts: [artifact] }, previousEvidence: null });
		expect(result.outputRefs?.artifacts).toEqual([artifact]);
		expect(() => waitForReadOnlyDependency({ error, output, previousEvidence: { dependencyObservation: { version: 1 } } })).toThrow("workflow_dependency_observation_invalid");
	});
});
