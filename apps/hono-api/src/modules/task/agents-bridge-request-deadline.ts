export type AgentsBridgeRequestDeadlineController = Readonly<{
	signal: AbortSignal;
	confirmAdmission: () => void;
	cleanup: () => void;
}>;

function abortError(code: string, message: string): Error {
	return Object.assign(new Error(message), { code });
}

function externalAbortError(signal?: AbortSignal): Error {
	const reason = signal?.reason;
	if (reason instanceof Error) return reason;
	const text = typeof reason === "string" ? reason.trim() : "";
	return abortError("agents_bridge_request_aborted", text || "agents_bridge_request_aborted");
}

/**
 * Owns both bridge inactivity and the immutable Workflow physical-attempt wall clock.
 * Runtime progress may re-arm the inactivity timer, but it can never extend the
 * absolute attempt deadline accepted by the Workflow state machine.
 */
export function createAgentsBridgeRequestDeadlineController(input: Readonly<{
	idleTimeoutMs: number;
	admissionTimeoutMs: number;
	absoluteDeadlineAt?: string;
	externalSignal?: AbortSignal;
	nowMs?: () => number;
}>): AgentsBridgeRequestDeadlineController {
	const controller = new AbortController();
	const nowMs = input.nowMs ?? Date.now;
	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	let absoluteTimer: ReturnType<typeof setTimeout> | null = null;

	const armIdle = (delayMs: number, code: string) => {
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			if (controller.signal.aborted) return;
			controller.abort(abortError(code, code));
		}, Math.max(1, Math.trunc(delayMs)));
	};

	const absoluteDeadlineMs = input.absoluteDeadlineAt
		? Date.parse(input.absoluteDeadlineAt)
		: Number.NaN;
	if (Number.isFinite(absoluteDeadlineMs)) {
		absoluteTimer = setTimeout(() => {
			if (controller.signal.aborted) return;
			controller.abort(abortError(
				"workflow_agent_role_timeout",
				"workflow_agent_role_timeout",
			));
		}, Math.max(1, absoluteDeadlineMs - nowMs()));
	}

	const onExternalAbort = () => {
		if (controller.signal.aborted) return;
		controller.abort(externalAbortError(input.externalSignal));
	};
	if (input.externalSignal?.aborted) {
		onExternalAbort();
	} else {
		input.externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
	}

	armIdle(input.admissionTimeoutMs, "agents_bridge_admission_timeout");

	return {
		signal: controller.signal,
		confirmAdmission() {
			if (controller.signal.aborted) return;
			armIdle(input.idleTimeoutMs, "agents_bridge_timeout");
		},
		cleanup() {
			if (idleTimer) clearTimeout(idleTimer);
			if (absoluteTimer) clearTimeout(absoluteTimer);
			input.externalSignal?.removeEventListener("abort", onExternalAbort);
		},
	};
}
