function readTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readErrorValue(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (!value || typeof value !== "object" || Array.isArray(value)) return "";
	const error = value as Record<string, unknown>;
	const message = readTrimmedString(error.message);
	const code = readTrimmedString(error.code);
	if (message && code) return `${message} (${code})`;
	return message || code;
}

function readFailureFromRecord(value: unknown): string[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	const nested = value as Record<string, unknown>;
	return [
		readTrimmedString(nested.message),
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
