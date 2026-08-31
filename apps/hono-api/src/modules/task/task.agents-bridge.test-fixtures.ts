type JsonRecord = Record<string, unknown>;

export type CanonicalAgentsBridgeFailure = {
	completion: {
		version: 1;
		source: "runtime";
		terminal: "failure";
		allowFinish: false;
		failureReason: string;
		rationale: string;
		successCriteria: string[];
		missingCriteria: string[];
		requiredActions: string[];
	};
	runOutcome: {
		version: 1;
		terminal: true;
		status: "failed";
		reason: string;
	};
};

const isJsonRecord = (value: unknown): value is JsonRecord =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const buildSuccessfulCompletion = (): JsonRecord => ({
	version: 1,
	source: "runtime",
	terminal: "success",
	allowFinish: true,
	failureReason: null,
	rationale: "request completed",
	successCriteria: [],
	missingCriteria: [],
	requiredActions: [],
});

const buildSuccessfulRunOutcome = (): JsonRecord => ({
	version: 1,
	terminal: true,
	status: "succeeded",
	reason: "validated_result",
});

export function buildCanonicalAgentsBridgeFailure(reason: string): CanonicalAgentsBridgeFailure {
	return {
		completion: {
			version: 1,
			source: "runtime",
			terminal: "failure",
			allowFinish: false,
			failureReason: reason,
			rationale: reason,
			successCriteria: [],
			missingCriteria: [reason],
			requiredActions: [],
		},
		runOutcome: {
			version: 1,
			terminal: true,
			status: "failed",
			reason,
		},
	};
}

/**
 * Serializes a successful agents-cli test response with the canonical terminal
 * contract required by the production bridge. Explicit fixture contracts are
 * preserved so failure, needs_input, and suspended cases remain intentional.
 */
export function stringifyCanonicalAgentsBridgeSuccess(payload: JsonRecord): string {
	const trace = payload.trace;
	if (!isJsonRecord(trace)) {
		throw new Error("agents bridge success fixture requires a trace object");
	}

	return JSON.stringify({
		...payload,
		trace: {
			...trace,
			completion: trace.completion ?? buildSuccessfulCompletion(),
			runOutcome: trace.runOutcome ?? buildSuccessfulRunOutcome(),
		},
	});
}
