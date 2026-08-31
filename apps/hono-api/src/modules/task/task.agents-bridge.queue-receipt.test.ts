import { describe, expect, it } from "vitest";
import { parseAgentsBridgeQueuedMessageReceipt } from "./task.agents-bridge";

describe("agents bridge durable queue receipt", () => {
	it("accepts the canonical agents-cli 202 receipt", () => {
		const receipt = parseAgentsBridgeQueuedMessageReceipt(
			{
				accepted: true,
				queueId: "queue-123",
				mode: "steering",
				sessionId: "session-1",
				activeTurn: true,
			},
			{ mode: "steering", sessionId: "session-1" },
		);

		expect(receipt).toEqual({
			accepted: true,
			queueId: "queue-123",
			mode: "steering",
			sessionId: "session-1",
			activeTurn: true,
		});
	});

	it("rejects the obsolete queued=true receipt shape", () => {
		expect(() =>
			parseAgentsBridgeQueuedMessageReceipt(
				{ queued: true, queueId: "queue-123" },
				{ mode: "follow_up", sessionId: "session-1" },
			),
		).toThrow("missing an accepted durable queueId");
	});
});
