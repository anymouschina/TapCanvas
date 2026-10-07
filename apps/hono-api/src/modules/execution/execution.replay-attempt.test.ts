import { describe, expect, it } from "vitest";
import { workflowReplayAttempt } from "./execution.replay-attempt";

const request = { idempotencyKey: "attempt", flowId: "flow", ownerId: "owner", sourceExecutionId: "source", sourceFlowVersionId: "version",
	sourceSnapshot: { workflowDirectAgentModelSelection: { model: "original" }, workflowDeliveryScope: { flowId: "chapter" } },
	liveFlowData: { nodes: [{ id: "consumer" }], edges: [] }, triggerNodeId: "trigger", startFromNodeId: "consumer", stopAfterNodeId: "stop", trigger: "manual", refreshAssetIds: ["b", "a"] };

describe("consumer replay attempt fingerprint", () => {
	it("canonicalizes object serialization and explicitly named asset sets", () => {
		expect(workflowReplayAttempt({ ...request, liveFlowData: JSON.stringify({ edges: [], nodes: [{ id: "consumer" }] }), refreshAssetIds: ["a", "b", "a"] })).toEqual(workflowReplayAttempt(request));
	});
	it("binds source, scope, directory selection, live graph and frozen invocation values", () => {
		const original = workflowReplayAttempt(request).requestHash;
		for (const change of [ { sourceExecutionId: "different" }, { sourceFlowVersionId: "new-version" }, { stopAfterNodeId: "other-stop" },
			{ refreshAssetIds: ["a"] }, { concurrency: 2 }, { liveFlowData: { nodes: [{ id: "changed" }], edges: [] } },
			{ sourceSnapshot: { workflowDirectAgentModelSelection: { model: "different" } } } ]) {
			expect(workflowReplayAttempt({ ...request, ...change }).requestHash).not.toBe(original);
		}
	});
	it("new explicit keys create new attempts while retaining the same request fingerprint", () => {
		expect(workflowReplayAttempt({ ...request, idempotencyKey: "new-attempt" })).toEqual({ ...workflowReplayAttempt(request), idempotencyKey: "new-attempt" });
		expect(() => workflowReplayAttempt({ ...request, idempotencyKey: " " })).toThrow("key_missing");
	});
});
