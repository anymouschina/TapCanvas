const SECRET_KEY_PATTERN = /(?:authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|cookie|credential)/i;
const MAX_DEPTH = 10;
const MAX_ARRAY_ITEMS = 256;
const MAX_OBJECT_KEYS = 256;
const MAX_STRING_CHARS = 64_000;

type SanitizationState = { truncated: boolean };

function sanitize(value: unknown, depth: number, key: string | null, state: SanitizationState): unknown {
	if (key && SECRET_KEY_PATTERN.test(key)) return "[REDACTED]";
	if (value === null || typeof value === "boolean" || typeof value === "number") return value;
	if (typeof value === "string") {
		if (value.length > MAX_STRING_CHARS) state.truncated = true;
		return value.length <= MAX_STRING_CHARS
			? value
			: `${value.slice(0, MAX_STRING_CHARS)}\n[TRUNCATED:${value.length - MAX_STRING_CHARS}]`;
	}
	if (typeof value === "undefined") return "[undefined]";
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "symbol" || typeof value === "function") return `[${typeof value}]`;
	if (depth >= MAX_DEPTH) {
		state.truncated = true;
		return { truncated: true, reasonCode: "max_depth" };
	}
	if (Array.isArray(value)) {
		if (value.length > MAX_ARRAY_ITEMS) state.truncated = true;
		const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitize(item, depth + 1, null, state));
		return value.length > MAX_ARRAY_ITEMS
			? [...items, { truncated: true, omittedItems: value.length - MAX_ARRAY_ITEMS }]
			: items;
	}
	const entries = Object.entries(value as Record<string, unknown>);
	if (entries.length > MAX_OBJECT_KEYS) state.truncated = true;
	const output: Record<string, unknown> = {};
	for (const [entryKey, entryValue] of entries.slice(0, MAX_OBJECT_KEYS)) {
		output[entryKey] = sanitize(entryValue, depth + 1, entryKey, state);
	}
	if (entries.length > MAX_OBJECT_KEYS) {
		output.__traceTruncation = {
			truncated: true,
			omittedKeys: entries.length - MAX_OBJECT_KEYS,
		};
	}
	return output;
}

export function sanitizeExecutionTraceEventPayload(value: unknown): Record<string, unknown> {
	return sanitizeExecutionTraceEventPayloadWithMeta(value).payload;
}

export function sanitizeExecutionTraceEventPayloadWithMeta(value: unknown): {
	payload: Record<string, unknown>;
	truncated: boolean;
} {
	const state: SanitizationState = { truncated: false };
	const sanitized = sanitize(value, 0, null, state);
	const payload = sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
		? sanitized as Record<string, unknown>
		: { value: sanitized };
	return { payload, truncated: state.truncated };
}
