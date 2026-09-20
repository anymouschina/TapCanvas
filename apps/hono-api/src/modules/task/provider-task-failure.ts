function readTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readErrorValue(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (!value || typeof value !== "object" || Array.isArray(value)) return "";
	const error = value as Record<string, unknown>;
	const message = readTrimmedString(error.message);
	const code = readTrimmedString(error.code) || readTrimmedString(error.type);
	if (message && code) return `${message} (${code})`;
	return message || code;
}

/** Read provider protocol identifiers without classifying the message text. */
export function readProviderTaskFailureCode(result: unknown): string | null {
	if (!result || typeof result !== "object" || Array.isArray(result)) return null;
	const record = result as Record<string, unknown>;
	const raw = record.raw;
	const rawRecord = raw && typeof raw === "object" && !Array.isArray(raw)
		? raw as Record<string, unknown> : null;
	for (const candidate of [record, rawRecord, rawRecord?.response]) {
		if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
		const candidateRecord = candidate as Record<string, unknown>;
		const directCode = readTrimmedString(candidateRecord.code);
		if (directCode) return directCode;
		const error = candidateRecord.error;
		if (!error || typeof error !== "object" || Array.isArray(error)) continue;
		const details = error as Record<string, unknown>;
		const code = readTrimmedString(details.code) || readTrimmedString(details.type);
		if (code) return code;
	}
	return null;
}

function readFailureFromRecord(value: unknown): string[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	const nested = value as Record<string, unknown>;
	return [
		readTrimmedString(nested.message),
		readTrimmedString(nested.failureReason),
		readErrorValue(nested.error),
	].filter(Boolean);
}

/**
 * Extract a bounded provider failure without exposing the complete raw payload.
 * Image and video reconciliation use this same protocol so a terminal task
 * never collapses into a reasonless `failed` node.
 */
export function buildProviderTaskFailureMessage(result: unknown): string {
	if (!result || typeof result !== "object" || Array.isArray(result)) return "";
	const record = result as Record<string, unknown>;
	const raw = record.raw;
	const rawRecord = raw && typeof raw === "object" && !Array.isArray(raw)
		? raw as Record<string, unknown>
		: null;
	const providerResponse = rawRecord?.response;
	const parts = [
		readTrimmedString(record.message),
		readErrorValue(record.error),
		...readFailureFromRecord(raw),
		...readFailureFromRecord(providerResponse),
	].filter(Boolean);
	return Array.from(new Set(parts)).join(" | ");
}
