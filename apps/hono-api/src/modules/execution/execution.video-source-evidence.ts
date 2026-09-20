import { workflowSourceSetIdentity } from "./execution.source-lineage";
import { sha256Hex } from "../asset/book-content-hash";

type SourceEvidenceFailureReason =
	| "source_receipt_invalid"
	| "authoritative_sources_unavailable"
	| "source_identity_not_found"
	| "source_fingerprint_mismatch"
	| "source_content_fingerprint_mismatch"
	| "source_identity_ambiguous"
	| "source_content_unavailable";

type SourceEvidenceIdentity = Readonly<{
	protocolVersion: "tapcanvas.source-evidence/v1";
	origin: "delivery-contract.canvasFacts.authoritativeSources";
	sourceId: string | null;
	sourceFingerprint: string | null;
}>;

export type WorkflowVideoSourceEvidence = SourceEvidenceIdentity & (
	| Readonly<{
		status: "matched";
		sources: readonly Readonly<{ sourceId: string; sourceFingerprint: string; content: string }>[];
	}>
	| Readonly<{
		status: "unavailable";
		diagnostic: Readonly<{ reason: SourceEvidenceFailureReason; blocking: false }>;
	}>
);

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function identityString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Bind only frozen source identity; never treat an Agent's summary as source text. */
export function bindWorkflowVideoSourceEvidence(input: Readonly<{
	deliveryContract: unknown;
	sourceReceipt: unknown;
}>): WorkflowVideoSourceEvidence {
	const receipt = isRecord(input.sourceReceipt) ? input.sourceReceipt : null;
	const sourceId = identityString(receipt?.sourceId);
	const sourceFingerprint = identityString(receipt?.sourceFingerprint);
	const identity: SourceEvidenceIdentity = {
		protocolVersion: "tapcanvas.source-evidence/v1",
		origin: "delivery-contract.canvasFacts.authoritativeSources",
		sourceId,
		sourceFingerprint,
	};
	const unavailable = (reason: SourceEvidenceFailureReason): WorkflowVideoSourceEvidence => ({
		...identity,
		status: "unavailable",
		diagnostic: { reason, blocking: false },
	});
	if (!sourceId || !sourceFingerprint) return unavailable("source_receipt_invalid");
	const contract = isRecord(input.deliveryContract) ? input.deliveryContract : null;
	const canvasFacts = isRecord(contract?.canvasFacts) ? contract.canvasFacts : null;
	const sources = canvasFacts?.authoritativeSources;
	if (!Array.isArray(sources) || sources.length === 0) {
		return unavailable("authoritative_sources_unavailable");
	}
	const sourceRecords = sources.filter(isRecord);
	const sameIdentity = sourceRecords.filter((source) => source.sourceId === sourceId);
	const identities = sourceRecords.map((source) => ({
		sourceId: identityString(source.sourceId), sourceFingerprint: identityString(source.sourceFingerprint),
	}));
	const completeIdentities = identities.filter((identity): identity is { sourceId: string; sourceFingerprint: string } => (
		identity.sourceId !== null && identity.sourceFingerprint !== null
	));
	const setIdentity = sources.length > 1 && completeIdentities.length === sources.length
		? workflowSourceSetIdentity(completeIdentities)
		: null;
	const matchedSet = setIdentity?.sourceId === sourceId && setIdentity.sourceFingerprint === sourceFingerprint;
	if (sameIdentity.length === 0 && !matchedSet) return unavailable("source_identity_not_found");
	const matches = matchedSet ? sourceRecords : sameIdentity.filter((source) => source.sourceFingerprint === sourceFingerprint);
	if (matches.length === 0) return unavailable("source_fingerprint_mismatch");
	if ((!matchedSet && matches.length !== 1) || new Set(matches.map((source) => source.sourceId)).size !== matches.length) {
		return unavailable("source_identity_ambiguous");
	}
	const matchedSources = matches.flatMap((source) => (
		typeof source.content === "string" && source.content.trim().length > 0
			&& typeof source.sourceId === "string" && typeof source.sourceFingerprint === "string"
			? [{ sourceId: source.sourceId, sourceFingerprint: source.sourceFingerprint, content: source.content }]
			: []
	));
	if (matchedSources.length !== matches.length) {
		return unavailable("source_content_unavailable");
	}
	if (matchedSources.some((source) => sha256Hex(source.content.trim()) !== source.sourceFingerprint)) {
		return unavailable("source_content_fingerprint_mismatch");
	}
	// Keep whitespace and complete wording exactly as frozen, independently of beat scope/summary.
	return { ...identity, status: "matched", sources: matchedSources };
}
