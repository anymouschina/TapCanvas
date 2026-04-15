export const PUBLIC_FLOW_ANCHOR_BINDING_KINDS = [
	"character",
	"scene",
	"prop",
	"shot",
	"story",
	"asset",
	"context",
	"authority_base_frame",
] as const;

export const PUBLIC_FLOW_ANCHOR_REFERENCE_VIEWS = [
	"three_view",
	"role_card",
] as const;

export type PublicFlowAnchorBindingKind =
	(typeof PUBLIC_FLOW_ANCHOR_BINDING_KINDS)[number];

export type PublicFlowAnchorReferenceView =
	(typeof PUBLIC_FLOW_ANCHOR_REFERENCE_VIEWS)[number];

export type PublicFlowAnchorBinding = {
	kind: PublicFlowAnchorBindingKind;
	refId?: string | null;
	entityId?: string | null;
	label?: string | null;
	sourceBookId?: string | null;
	sourceNodeId?: string | null;
	assetId?: string | null;
	assetRefId?: string | null;
	imageUrl?: string | null;
	referenceView?: PublicFlowAnchorReferenceView | null;
	category?: string | null;
	note?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function readTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readRemoteUrl(value: unknown): string {
	const trimmed = readTrimmedString(value);
	return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

function normalizeAnchorBindingKind(
	value: unknown,
): PublicFlowAnchorBindingKind | null {
	const normalized = readTrimmedString(value).toLowerCase();
	for (const candidate of PUBLIC_FLOW_ANCHOR_BINDING_KINDS) {
		if (candidate === normalized) return candidate;
	}
	return null;
}

function normalizeAnchorReferenceView(
	value: unknown,
): PublicFlowAnchorReferenceView | null {
	const normalized = readTrimmedString(value).toLowerCase();
	for (const candidate of PUBLIC_FLOW_ANCHOR_REFERENCE_VIEWS) {
		if (candidate === normalized) return candidate;
	}
	return null;
}

function buildAnchorBindingKey(binding: PublicFlowAnchorBinding): string {
	return [
		binding.kind,
		readTrimmedString(binding.refId).toLowerCase(),
		readTrimmedString(binding.entityId).toLowerCase(),
		readTrimmedString(binding.label).toLowerCase(),
		readTrimmedString(binding.assetId).toLowerCase(),
		readTrimmedString(binding.assetRefId).toLowerCase(),
		readRemoteUrl(binding.imageUrl),
		readTrimmedString(binding.sourceNodeId).toLowerCase(),
		readTrimmedString(binding.referenceView).toLowerCase(),
		readTrimmedString(binding.category).toLowerCase(),
		readTrimmedString(binding.note).toLowerCase(),
	].join("\u0001");
}

export function normalizePublicFlowAnchorBinding(
	value: unknown,
): PublicFlowAnchorBinding | null {
	const record = asRecord(value);
	if (!record) return null;
	const kind = normalizeAnchorBindingKind(record.kind);
	if (!kind) return null;

	const refId = readTrimmedString(record.refId);
	const entityId = readTrimmedString(record.entityId);
	const label = readTrimmedString(record.label);
	const sourceBookId = readTrimmedString(record.sourceBookId);
	const sourceNodeId = readTrimmedString(record.sourceNodeId);
	const assetId = readTrimmedString(record.assetId);
	const assetRefId = readTrimmedString(record.assetRefId);
	const imageUrl = readRemoteUrl(record.imageUrl);
	const referenceView = normalizeAnchorReferenceView(record.referenceView);
	const category = readTrimmedString(record.category);
	const note = readTrimmedString(record.note);

	const hasIdentity =
		Boolean(refId) ||
		Boolean(entityId) ||
		Boolean(label) ||
		Boolean(sourceNodeId) ||
		Boolean(assetId) ||
		Boolean(assetRefId) ||
		Boolean(imageUrl);
	if (!hasIdentity) return null;

	return {
		kind,
		...(refId ? { refId } : null),
		...(entityId ? { entityId } : null),
		...(label ? { label } : null),
		...(sourceBookId ? { sourceBookId } : null),
		...(sourceNodeId ? { sourceNodeId } : null),
		...(assetId ? { assetId } : null),
		...(assetRefId ? { assetRefId } : null),
		...(imageUrl ? { imageUrl } : null),
		...(referenceView ? { referenceView } : null),
		...(category ? { category } : null),
		...(note ? { note } : null),
	};
}

export function normalizePublicFlowAnchorBindings(
	value: unknown,
): PublicFlowAnchorBinding[] {
	if (!Array.isArray(value)) return [];
	const bindings: PublicFlowAnchorBinding[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		const normalized = normalizePublicFlowAnchorBinding(item);
		if (!normalized) continue;
		const key = buildAnchorBindingKey(normalized);
		if (seen.has(key)) continue;
		seen.add(key);
		bindings.push(normalized);
	}
	return bindings;
}

export function mergePublicFlowAnchorBindings(
	...parts: unknown[]
): PublicFlowAnchorBinding[] {
	const merged: PublicFlowAnchorBinding[] = [];
	const seen = new Set<string>();
	for (const part of parts) {
		for (const binding of normalizePublicFlowAnchorBindings(part)) {
			const key = buildAnchorBindingKey(binding);
			if (seen.has(key)) continue;
			seen.add(key);
			merged.push(binding);
		}
	}
	return merged;
}

export function collectPublicFlowAnchorBindingImageUrls(
	value: unknown,
	limit = 8,
): string[] {
	const maxItems = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0;
	if (maxItems === 0) return [];
	const urls: string[] = [];
	const seen = new Set<string>();
	for (const binding of normalizePublicFlowAnchorBindings(value)) {
		const imageUrl = readRemoteUrl(binding.imageUrl);
		if (!imageUrl || seen.has(imageUrl)) continue;
		seen.add(imageUrl);
		urls.push(imageUrl);
		if (urls.length >= maxItems) break;
	}
	return urls;
}
