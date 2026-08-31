const NORMALIZED_STOP_REASONS = new Set([
	"stop",
	"tool_calls",
	"length",
	"content_filter",
	"aborted",
	"error",
	"unknown",
]);

export type AgentsBridgeLlmTerminationSummary = {
	turnCount: number;
	lastStopReason: string | null;
	lastProviderStopReason: string | null;
	lengthTerminatedTurnCount: number;
	unreportedStopReasonTurnCount: number;
};

function readNormalizedStopReason(turn: Record<string, unknown>): string | null {
	const value = typeof turn.stopReason === "string" ? turn.stopReason.trim() : "";
	return NORMALIZED_STOP_REASONS.has(value) ? value : null;
}

function readProviderStopReason(turn: Record<string, unknown>): string | null {
	const value =
		typeof turn.providerStopReason === "string"
			? turn.providerStopReason.trim()
			: "";
	return value || null;
}

export function summarizeAgentsBridgeLlmTermination(
	turns: Array<Record<string, unknown>>,
): AgentsBridgeLlmTerminationSummary {
	let lastStopReason: string | null = null;
	let lastProviderStopReason: string | null = null;
	let lengthTerminatedTurnCount = 0;
	let unreportedStopReasonTurnCount = 0;

	for (const turn of turns) {
		const stopReason = readNormalizedStopReason(turn);
		const providerStopReason = readProviderStopReason(turn);
		if (stopReason) lastStopReason = stopReason;
		else unreportedStopReasonTurnCount += 1;
		if (providerStopReason) lastProviderStopReason = providerStopReason;
		if (stopReason === "length") lengthTerminatedTurnCount += 1;
	}

	return {
		turnCount: turns.length,
		lastStopReason,
		lastProviderStopReason,
		lengthTerminatedTurnCount,
		unreportedStopReasonTurnCount,
	};
}
