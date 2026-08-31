export const CONTINUATION_SETTLEMENT_RECOVERY_FAILURE_CODES = [
	"continuation_settlement_contract_invalid",
	"continuation_settlement_contract_reuses_claim_token",
	"continuation_settlement_registration_rejected",
	"continuation_settlement_registration_identity_drift",
	"continuation_settlement_queue_publication_incomplete",
	"continuation_settlement_queue_publication_cardinality_invalid",
] as const;

export type ContinuationSettlementRecoveryFailureCode =
	(typeof CONTINUATION_SETTLEMENT_RECOVERY_FAILURE_CODES)[number];

const RECOVERY_FAILURE_CODE_SET = new Set<string>(CONTINUATION_SETTLEMENT_RECOVERY_FAILURE_CODES);

export function isContinuationSettlementRecoveryFailureCode(
	value: unknown,
): value is ContinuationSettlementRecoveryFailureCode {
	return typeof value === "string" && RECOVERY_FAILURE_CODE_SET.has(value);
}

export class ContinuationSettlementRecoveryError extends Error {
	readonly code: ContinuationSettlementRecoveryFailureCode;
	readonly retryable: boolean;

	constructor(input: {
		code: ContinuationSettlementRecoveryFailureCode;
		retryable: boolean;
		detail?: string;
	}) {
		super(input.detail ? `${input.code}:${input.detail}` : input.code);
		this.name = "ContinuationSettlementRecoveryError";
		this.code = input.code;
		this.retryable = input.retryable;
	}
}

export function isTerminalContinuationSettlementRecoveryError(
	error: unknown,
): error is ContinuationSettlementRecoveryError {
	return error instanceof ContinuationSettlementRecoveryError && !error.retryable;
}
