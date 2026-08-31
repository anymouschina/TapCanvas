import { describe, expect, it } from "vitest";
import {
	workflowAgentPublicTurnId,
	workflowAgentSessionKey,
} from "./execution.agent-identity";

describe("workflow Agent public turn identity", () => {
	it("uses only the physical transport retry as a new runtime identity", () => {
		expect(workflowAgentPublicTurnId({
			executionId: "execution-1",
			nodeId: "agent-1",
			physicalRetryOrdinal: 2,
		})).toBe("workflow:execution-1:agent-1:physical-retry:2");
	});

	it("keeps a first submission on the logical node identity", () => {
		expect(workflowAgentPublicTurnId({
			executionId: "execution-1",
			nodeId: "agent-1",
			physicalRetryOrdinal: null,
		})).toBe("workflow:execution-1:agent-1");
	});

	it("keeps long collection item identities distinct after physical retries", () => {
		const sharedNodePrefix = `video-workflow-${"a".repeat(80)}:clip-writer-agent::item::`;
		const clip07 = workflowAgentPublicTurnId({
			executionId: `execution-${"b".repeat(64)}`,
			nodeId: `${sharedNodePrefix}clip-07`,
			physicalRetryOrdinal: 3,
		});
		const clip08 = workflowAgentPublicTurnId({
			executionId: `execution-${"b".repeat(64)}`,
			nodeId: `${sharedNodePrefix}clip-08`,
			physicalRetryOrdinal: 3,
		});

		expect(clip07).toHaveLength(160);
		expect(clip08).toHaveLength(160);
		expect(clip07).not.toBe(clip08);
		expect(clip07).toMatch(/:[a-f0-9]{32}:physical-retry:3$/u);
		expect(clip08).toMatch(/:[a-f0-9]{32}:physical-retry:3$/u);
		expect(workflowAgentPublicTurnId({
			executionId: `execution-${"b".repeat(64)}`,
			nodeId: `${sharedNodePrefix}clip-07`,
			physicalRetryOrdinal: 3,
		})).toBe(clip07);
	});
});

describe("workflow Agent durable session identity", () => {
	it("uses only the physical transport retry as a new durable session", () => {
		expect(workflowAgentSessionKey({
			executionId: "execution-1",
			nodeId: "agent-1",
			physicalRetryOrdinal: 2,
		})).toBe("workflow:execution-1:agent-1:physical-retry:2");
	});

	it("bounds long collection retry sessions without collapsing item identity", () => {
		const sharedNodePrefix = `video-workflow-${"a".repeat(120)}:clip-writer-agent::item::`;
		const clip07 = workflowAgentSessionKey({
			executionId: `execution-${"b".repeat(64)}`,
			nodeId: `${sharedNodePrefix}clip-07`,
			physicalRetryOrdinal: 3,
		});
		const clip08 = workflowAgentSessionKey({
			executionId: `execution-${"b".repeat(64)}`,
			nodeId: `${sharedNodePrefix}clip-08`,
			physicalRetryOrdinal: 3,
		});

		expect(clip07).toHaveLength(240);
		expect(clip08).toHaveLength(240);
		expect(clip07).not.toBe(clip08);
		expect(clip07).toMatch(/:[a-f0-9]{32}:physical-retry:3$/u);
		expect(clip08).toMatch(/:[a-f0-9]{32}:physical-retry:3$/u);
		expect(workflowAgentSessionKey({
			executionId: `execution-${"b".repeat(64)}`,
			nodeId: `${sharedNodePrefix}clip-07`,
			physicalRetryOrdinal: 3,
		})).toBe(clip07);
	});
});
