import { describe, expect, it } from "vitest";
import { summarizeAgentsBridgeLlmTermination } from "./agents-bridge-llm-termination";

describe("summarizeAgentsBridgeLlmTermination", () => {
	it("preserves provider stop facts and counts length terminations", () => {
		expect(
			summarizeAgentsBridgeLlmTermination([
				{ turn: 1, stopReason: "length", providerStopReason: "max_output_tokens" },
				{ turn: 2, stopReason: "stop" },
			]),
		).toEqual({
			turnCount: 2,
			lastStopReason: "stop",
			lastProviderStopReason: "max_output_tokens",
			lengthTerminatedTurnCount: 1,
			unreportedStopReasonTurnCount: 0,
		});
	});

	it("reports missing or invalid normalized stop reasons without inventing a default", () => {
		expect(
			summarizeAgentsBridgeLlmTermination([
				{ turn: 1 },
				{ turn: 2, stopReason: "provider-specific-value" },
			]),
		).toEqual({
			turnCount: 2,
			lastStopReason: null,
			lastProviderStopReason: null,
			lengthTerminatedTurnCount: 0,
			unreportedStopReasonTurnCount: 2,
		});
	});
});
