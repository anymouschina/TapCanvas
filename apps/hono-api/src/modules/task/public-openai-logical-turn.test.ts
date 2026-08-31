import { describe, expect, it } from "vitest";
import type {
	AgentsChatDurableTerminalDelivery,
	AgentsChatTurnStatusSnapshot,
} from "./task.agents-chat-runtime";
import { waitForOpenAiLogicalTurnTerminal } from "./public-openai-logical-turn";

function snapshot(input: Readonly<{
	state: "running" | "suspended" | "succeeded" | "needs_input" | "failed";
	finalResponse?: string | null;
	terminalDelivery?: AgentsChatDurableTerminalDelivery | null;
	reasonCode?: string | null;
}>): AgentsChatTurnStatusSnapshot {
	const phase = input.state === "running"
		? "agent_running" as const
		: input.state === "needs_input"
			? "waiting_for_input" as const
			: input.state;
	return {
		sessionId: "host:user-1",
		durable: true,
		activeTurn: input.state === "running" || input.state === "suspended",
		turn: {
			turnId: "turn-1",
			internalTurnId: "internal-1",
			state: input.state,
			phase,
			startedAt: "2026-08-24T00:00:00.000Z",
			updatedAt: "2026-08-24T00:00:01.000Z",
			lastConfirmedAt: "2026-08-24T00:00:01.000Z",
			requestText: "你好",
			terminalAuthority: "user_delivery",
			reasonCode: input.reasonCode ?? null,
			suspension: null,
			recoveryCheckpoint: null,
			lastConfirmedSummary: "等待中",
			finalResponse: input.finalResponse ?? null,
			terminalDelivery: input.terminalDelivery ?? null,
			pendingQueueCount: 0,
			recentEvents: [],
		},
	};
}

const TERMINAL_DELIVERY = {
	version: 1 as const,
	requestTerminal: {
		version: 1 as const,
		terminal: true as const,
		status: "succeeded" as const,
		reason: "delivery_verified",
	},
	expectedDelivery: { version: 2 as const, contractHash: "sha256:contract" },
	deliveryEvidence: [{
		evidenceId: "evidence-1",
		kind: "final_response" as const,
		sourceRef: "final-response-1",
	}],
	deliveryVerification: {
		version: 2 as const,
		contractHash: "sha256:contract",
		status: "satisfied" as const,
		verifiedAt: "2026-08-24T00:00:02.000Z",
	},
};

describe("OpenAI-compatible logical turn wait", () => {
	it("keeps one external request across physical suspension and returns only the final response", async () => {
		const states = [
			snapshot({ state: "suspended" }),
			snapshot({ state: "running" }),
			snapshot({ state: "succeeded", finalResponse: "最终正文", terminalDelivery: TERMINAL_DELIVERY }),
		];
		let index = 0;
		const result = await waitForOpenAiLogicalTurnTerminal({
			rootRequestId: "turn-1",
			readStatus: async () => states[Math.min(index++, states.length - 1)]!,
			timeoutMs: 1_000,
			pollIntervalMs: 1,
			now: () => index,
			delay: async () => {},
		});

		expect(result.status).toBe("succeeded");
		expect(result.text).toBe("最终正文");
		expect(index).toBe(3);
	});

	it("rejects a succeeded projection without the versioned terminal delivery chain", async () => {
		await expect(waitForOpenAiLogicalTurnTerminal({
			rootRequestId: "turn-1",
			readStatus: async () => snapshot({ state: "succeeded", finalResponse: "缺证据正文" }),
			timeoutMs: 1_000,
		})).rejects.toMatchObject({ code: "terminal_delivery_chain_invalid" });
	});

	it("rejects a satisfied chain that has no final_response evidence", async () => {
		await expect(waitForOpenAiLogicalTurnTerminal({
			rootRequestId: "turn-1",
			readStatus: async () => snapshot({
				state: "succeeded",
				finalResponse: "正文不能替代正文证据",
				terminalDelivery: {
					...TERMINAL_DELIVERY,
					deliveryEvidence: [{
						evidenceId: "artifact-1",
						kind: "artifact",
						sourceRef: "asset:https://example.com/result.png",
					}],
				},
			}),
			timeoutMs: 1_000,
		})).rejects.toMatchObject({ code: "terminal_delivery_chain_invalid" });
	});

	it("surfaces a deterministic failed logical turn instead of waiting or retrying it", async () => {
		await expect(waitForOpenAiLogicalTurnTerminal({
			rootRequestId: "turn-1",
			readStatus: async () => snapshot({
				state: "failed",
				reasonCode: "content_safety_rejected",
			}),
			timeoutMs: 1_000,
		})).rejects.toMatchObject({ code: "content_safety_rejected" });
	});
});
