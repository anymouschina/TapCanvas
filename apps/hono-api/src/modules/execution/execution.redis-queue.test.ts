import { describe, expect, it } from "vitest";

import { parseWorkflowNodeJob } from "./execution.node-attempt";
import { workflowNodeDispatchDigest } from "./execution.redis-queue";

describe("redis workflow node queue identity", () => {
	const baseJob = parseWorkflowNodeJob({
		executionId: "execution-1",
		nodeId: "node-1",
		nodeRunId: "node-run-1",
		attempt: 1,
	});

	it("is stable for an exact pending dispatch", () => {
		expect(workflowNodeDispatchDigest(baseJob)).toBe(workflowNodeDispatchDigest({ ...baseJob }));
	});

	it("separates attempt, durable node-run and phase identities", () => {
		const identities = new Set([
			workflowNodeDispatchDigest(baseJob),
			workflowNodeDispatchDigest({ ...baseJob, attempt: 2 }),
			workflowNodeDispatchDigest({ ...baseJob, nodeRunId: "node-run-2" }),
			workflowNodeDispatchDigest({ ...baseJob, phase: "recover" }),
			workflowNodeDispatchDigest({ ...baseJob, phase: "await_external" }),
		]);
		expect(identities.size).toBe(5);
	});
});
