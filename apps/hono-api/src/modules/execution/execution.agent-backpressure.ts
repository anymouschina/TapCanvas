const WORKFLOW_AGENT_RATE_LIMIT_FAILURE_CODE = "llm_http_429";
const WORKFLOW_AGENT_RATE_LIMIT_BASE_DELAY_MS = 65_000;
const WORKFLOW_AGENT_RATE_LIMIT_MAX_DELAY_MS = 300_000;
const WORKFLOW_AGENT_RATE_LIMIT_MAX_JITTER_MS = 15_000;

export type WorkflowAgentPhysicalFailureEvidence = Readonly<{
	retryOrdinal: number;
	reason: string;
	retryNotBeforeAt: string | null;
	rateLimitDeferralCount: number | null;
	evidence: Readonly<Record<string, unknown>>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value >= 0
		? value
		: null;
}

function stableUnsignedHash(value: string): number {
	let hash = 2_166_136_261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16_777_619);
	}
	return hash >>> 0;
}

function deliveryEvidence(
	previousEvidence: Record<string, unknown> | null,
): Record<string, unknown> | null {
	if (!previousEvidence) return null;
	let current = previousEvidence;
	// Waiting receipts may be projected through more than one durable transport
	// envelope (node output -> Agent delivery -> recovery delivery).  Lifecycle
	// facts belong to the innermost evidence object.  Unwrap the protocol field
	// structurally and with a fixed bound; never infer state from messages.
	for (let depth = 0; depth < 8; depth += 1) {
		if (current.retryablePhysicalFailure === true) return current;
		const nested = current.deliveryEvidence;
		if (!isRecord(nested) || nested === current) return current;
		current = nested;
	}
	return current;
}

/**
 * Rate-limit classification is intentionally structural. The workflow layer
 * consumes the exact error code emitted by agents-cli; it never interprets the
 * provider message, prompt text, model name, or user intent.
 */
export function isWorkflowAgentRateLimitError(error: unknown): boolean {
	return isRecord(error) && isWorkflowAgentRateLimitFailureCode(error.code);
}

export function isWorkflowAgentRateLimitFailureCode(value: unknown): value is string {
	return value === WORKFLOW_AGENT_RATE_LIMIT_FAILURE_CODE;
}

export function parseWorkflowAgentPhysicalFailureEvidence(
	previousEvidence: Record<string, unknown> | null,
): WorkflowAgentPhysicalFailureEvidence | null {
	const evidence = deliveryEvidence(previousEvidence);
	if (evidence?.retryablePhysicalFailure !== true) return null;
	const retryOrdinal = nonNegativeInteger(evidence.physicalRetryOrdinal);
	const reason = typeof evidence.physicalFailureReason === "string"
		? evidence.physicalFailureReason.trim()
		: "";
	if (retryOrdinal === null || retryOrdinal <= 0 || !reason) return null;
	const retryNotBeforeAt = typeof evidence.retryNotBeforeAt === "string"
		&& Number.isFinite(Date.parse(evidence.retryNotBeforeAt))
		? evidence.retryNotBeforeAt
		: null;
	return {
		retryOrdinal,
		reason,
		retryNotBeforeAt,
		rateLimitDeferralCount: nonNegativeInteger(evidence.rateLimitDeferralCount),
		evidence,
	};
}

/**
 * Build a restart-safe scheduler checkpoint for a rejected LLM request. A 429
 * means the provider did not accept the generation, so a later same-model
 * attempt is safe. Backoff is persisted as an absolute timestamp so frequent
 * workflow reconciliation performs no model calls while the window is quiet.
 */
export function createWorkflowAgentRateLimitBackpressureEvidence(
	previousEvidence: Record<string, unknown> | null,
	nowMs = Date.now(),
	jitterIdentity = "",
): Readonly<Record<string, unknown>> {
	const previous = deliveryEvidence(previousEvidence);
	const previousRetryOrdinal = nonNegativeInteger(previous?.physicalRetryOrdinal) ?? 0;
	const previousDeferralCount = nonNegativeInteger(previous?.rateLimitDeferralCount) ?? 0;
	const rateLimitDeferralCount = previousDeferralCount + 1;
	const exponentialDelayMs = WORKFLOW_AGENT_RATE_LIMIT_BASE_DELAY_MS
		* (2 ** Math.min(previousDeferralCount, 20));
	const retryBaseDelayMs = Math.min(
		exponentialDelayMs,
		WORKFLOW_AGENT_RATE_LIMIT_MAX_DELAY_MS - WORKFLOW_AGENT_RATE_LIMIT_MAX_JITTER_MS,
	);
	const jitterRangeMs = Math.min(
		WORKFLOW_AGENT_RATE_LIMIT_MAX_JITTER_MS,
		Math.floor(retryBaseDelayMs / 4),
	);
	const retryJitterMs = jitterIdentity
		? stableUnsignedHash(`${jitterIdentity}:${rateLimitDeferralCount}`) % (jitterRangeMs + 1)
		: 0;
	const retryAfterMs = retryBaseDelayMs + retryJitterMs;
	return {
		...(previous ?? {}),
		version: 1,
		source: "workflow_agent_rate_limit_backpressure",
		retryablePhysicalFailure: true,
		physicalFailureReason: WORKFLOW_AGENT_RATE_LIMIT_FAILURE_CODE,
		physicalRetryOrdinal: previousRetryOrdinal + 1,
		rateLimitDeferralCount,
		retryBaseDelayMs,
		retryJitterMs,
		retryAfterMs,
		retryNotBeforeAt: new Date(nowMs + retryAfterMs).toISOString(),
	};
}

export function remainingWorkflowAgentRateLimitDelayMs(
	evidence: WorkflowAgentPhysicalFailureEvidence,
	nowMs = Date.now(),
): number {
	if (
		evidence.reason !== WORKFLOW_AGENT_RATE_LIMIT_FAILURE_CODE
		|| evidence.retryNotBeforeAt === null
	) return 0;
	return Math.max(0, Date.parse(evidence.retryNotBeforeAt) - nowMs);
}

/**
 * Any physical retry may carry a persisted quiet window. Rate limits are one
 * producer, while exhausted no-progress generations use the same scheduler
 * contract to avoid a tight retry loop. Classification stays structural: the
 * caller decides why a retry is deferred and this helper only reads the
 * already-persisted absolute timestamp.
 */
export function remainingWorkflowAgentPhysicalRetryDelayMs(
	evidence: WorkflowAgentPhysicalFailureEvidence,
	nowMs = Date.now(),
): number {
	if (evidence.retryNotBeforeAt === null) return 0;
	return Math.max(0, Date.parse(evidence.retryNotBeforeAt) - nowMs);
}
