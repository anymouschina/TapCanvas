import type { TaskRequestDto } from "./task.schemas";

const BILLING_SPEC_KEY_PATTERN = /^[a-z0-9:_-]+$/i;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBillingSpecKey(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	if (!normalized) return null;
	if (!BILLING_SPEC_KEY_PATTERN.test(normalized)) return null;
	return normalized;
}

export function extractBillingSpecKeyFromExtras(
	extras: Record<string, unknown> | null | undefined,
): string | null {
	if (!extras) return null;
	const candidates = [extras.specKey, extras.billingSpecKey, extras.videoSpecKey];
	for (const candidate of candidates) {
		const normalized = normalizeBillingSpecKey(candidate);
		if (normalized) return normalized;
	}
	return null;
}

export function extractBillingSpecKeyFromTaskRequest(
	req: TaskRequestDto,
): string | null {
	const extras = isRecord(req.extras) ? req.extras : null;
	return extractBillingSpecKeyFromExtras(extras);
}

export function extractBillingSpecKeyFromTaskRaw(raw: unknown): string | null {
	if (!isRecord(raw)) return null;
	const direct = extractBillingSpecKeyFromExtras(raw);
	if (direct) return direct;
	const nestedCandidates = [raw.request, raw.response, raw.payload];
	for (const candidate of nestedCandidates) {
		if (!isRecord(candidate)) continue;
		const nested = extractBillingSpecKeyFromExtras(candidate);
		if (nested) return nested;
	}
	return null;
}

export function extractBillingSpecKeyFromLedgerNote(
	note: string | null | undefined,
): string | null {
	const raw = typeof note === "string" ? note : "";
	if (!raw) return null;
	const match = raw.match(/(?:^|\s)spec:([a-z0-9:_-]+)/i);
	return normalizeBillingSpecKey(match?.[1]);
}

export function attachBillingSpecKeyToRaw(
	raw: unknown,
	specKey: string | null | undefined,
): unknown {
	const normalizedSpecKey = normalizeBillingSpecKey(specKey);
	if (!normalizedSpecKey) return raw;
	if (isRecord(raw)) {
		return {
			...raw,
			specKey: normalizedSpecKey,
			billingSpecKey: normalizedSpecKey,
		};
	}
	return {
		specKey: normalizedSpecKey,
		billingSpecKey: normalizedSpecKey,
		raw,
	};
}
