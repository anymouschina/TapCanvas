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

const buildSuccessfulPhysicalRunExit = (): JsonRecord => ({
	version: 1,
	kind: "logical_terminal",
	logicalTaskId: "test-logical-task",
	taskNodeId: "test-node",
	taskRevision: 0,
	taskStatus: "satisfied",
	reasonCode: "validated_result",
	exitedAt: "2026-08-01T00:00:00.000Z",
	continuationTicket: null,
});

const buildSuccessfulTerminalDelivery = (logicalTaskId: string): JsonRecord => ({
	version: 1,
	requestTerminal: {
		version: 1,
		terminal: true,
		status: "succeeded",
		reason: "validated_result",
	},
	expectedDelivery: {
		version: 2,
		contractHash: "fixture-contract",
		delivery: {
			mode: "response",
			mediaType: null,
			promptMediaType: null,
			kind: "answer",
			output: "fixture response",
		},
	},
	deliveryEvidence: [{
		evidenceId: `runtime-final-response-${logicalTaskId}`,
		kind: "final_response",
		sourceRef: "final_response",
		requirementIds: ["fixture-delivery"],
		attributes: {},
	}],
	deliveryVerification: {
		version: 2,
		contractHash: "fixture-contract",
		status: "satisfied",
		criteria: [{
			requirementId: "fixture-delivery",
			status: "satisfied",
			evidenceIds: [`runtime-final-response-${logicalTaskId}`],
			reason: "fixture delivery verified",
		}],
		verifiedAt: "2026-08-01T00:00:00.000Z",
	},
});

let canonicalFixtureLogicalTaskId = "test-logical-task";

export function setCanonicalAgentsBridgeFixtureLogicalTaskId(logicalTaskId: string): void {
	const normalized = logicalTaskId.trim();
	canonicalFixtureLogicalTaskId = normalized || "test-logical-task";
}

type CanonicalAgentsBridgeSuccessOptions = Readonly<{
	logicalTaskId?: string;
	terminalAuthority?: "user_delivery" | "workflow_action";
}>;

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
export function stringifyCanonicalAgentsBridgeSuccess(
	payload: JsonRecord,
	options: CanonicalAgentsBridgeSuccessOptions = {},
): string {
	const trace = payload.trace;
	if (!isJsonRecord(trace)) {
		throw new Error("agents bridge success fixture requires a trace object");
	}
	const runtime = isJsonRecord(trace.runtime) ? trace.runtime : {};
	const physicalRunExit = isJsonRecord(runtime.physicalRunExit)
		? runtime.physicalRunExit
		: {
			...buildSuccessfulPhysicalRunExit(),
			logicalTaskId: options.logicalTaskId?.trim() || canonicalFixtureLogicalTaskId,
		};
	const logicalTaskId = typeof physicalRunExit.logicalTaskId === "string" && physicalRunExit.logicalTaskId.trim()
		? physicalRunExit.logicalTaskId.trim()
		: options.logicalTaskId?.trim() || canonicalFixtureLogicalTaskId;
	const completion = isJsonRecord(trace.completion) ? trace.completion : null;
	const runOutcome = isJsonRecord(trace.runOutcome) ? trace.runOutcome : null;
	const completionIsSuccess = completion === null || completion.terminal === undefined || completion.terminal === "success";
	const runOutcomeIsSuccess = runOutcome === null || runOutcome.status === undefined || runOutcome.status === "succeeded";
	const effectivePhysicalRunExit = !completionIsSuccess
		? {
			...physicalRunExit,
			taskStatus: "failed",
			reasonCode: typeof completion?.failureReason === "string" && completion.failureReason.trim()
				? completion.failureReason.trim()
				: "runtime_failure",
		}
		: physicalRunExit;
	return JSON.stringify({
		...payload,
		trace: {
			...trace,
			completion: trace.completion ?? buildSuccessfulCompletion(),
			runOutcome: trace.runOutcome ?? buildSuccessfulRunOutcome(),
			runtime: {
				...runtime,
				profile: runtime.profile ?? "general",
				terminalAuthority: runtime.terminalAuthority ?? options.terminalAuthority ?? "user_delivery",
				physicalRunExit: effectivePhysicalRunExit,
				...(runtime.terminalDelivery !== undefined
					? { terminalDelivery: runtime.terminalDelivery }
					: completionIsSuccess && runOutcomeIsSuccess
						? { terminalDelivery: buildSuccessfulTerminalDelivery(logicalTaskId) }
						: {}),
			},
		},
	});
}
