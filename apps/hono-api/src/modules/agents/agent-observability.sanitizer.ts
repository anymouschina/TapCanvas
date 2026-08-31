import { createHash } from "node:crypto";

const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 128;
const MAX_OBJECT_KEYS = 192;
const SAFE_STRING_KEY_PATTERN = /^(?:id|traceId|spanId|threadId|turnId|requestId|toolCallId|taskId|runId|nodeId|projectId|bookId|chapterId|flowId|artifactId|kind|type|toolName|status|state|mode|phase|source|service|code|reasonCode|evaluatorKey|evaluatorVersion|deliveryState|assetType|label|workflowKey|modelKey)$/;
const SECRET_KEY_PATTERN = /(?:authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|cookie|credential)/i;
const URL_KEY_PATTERN = /(?:url|uri)$/i;

type UnknownRecord = Record<string, unknown>;

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function sanitizeString(value: string, key: string | null): unknown {
	if (key && SAFE_STRING_KEY_PATTERN.test(key) && value.length <= 240) return value;
	if (key && URL_KEY_PATTERN.test(key)) {
		try {
			const parsed = new URL(value);
			return {
				present: true,
				origin: parsed.origin,
				valueHash: digest(value),
			};
		} catch {
			return { present: Boolean(value), valueHash: digest(value) };
		}
	}
	return {
		type: "string",
		chars: value.length,
		sha256: digest(value),
	};
}

function sanitize(value: unknown, depth: number, key: string | null): unknown {
	if (key && SECRET_KEY_PATTERN.test(key)) return "[REDACTED]";
	if (value === null || typeof value === "boolean" || typeof value === "number") return value;
	if (typeof value === "string") return sanitizeString(value, key);
	if (typeof value === "undefined") return "[undefined]";
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "symbol" || typeof value === "function") return `[${typeof value}]`;
	if (depth >= MAX_DEPTH) return { truncated: true, reasonCode: "max_depth" };
	if (Array.isArray(value)) {
		const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitize(item, depth + 1, null));
		return value.length > MAX_ARRAY_ITEMS
			? [...items, { truncated: true, omittedItems: value.length - MAX_ARRAY_ITEMS }]
			: items;
	}
	const entries = Object.entries(value as UnknownRecord);
	const output: UnknownRecord = {};
	for (const [entryKey, entryValue] of entries.slice(0, MAX_OBJECT_KEYS)) {
		output[entryKey] = sanitize(entryValue, depth + 1, entryKey);
	}
	if (entries.length > MAX_OBJECT_KEYS) {
		output.__traceTruncation = {
			truncated: true,
			omittedKeys: entries.length - MAX_OBJECT_KEYS,
		};
	}
	return output;
}

export function sanitizeAgentObservabilityValue(value: unknown): unknown {
	return sanitize(value, 0, null);
}

export function sanitizeAgentObservabilityRecord(value: unknown): Record<string, unknown> {
	const sanitized = sanitizeAgentObservabilityValue(value);
	return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
		? sanitized as Record<string, unknown>
		: { value: sanitized };
}
