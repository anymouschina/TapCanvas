const FLOW_GRAPH_STORAGE_KEYS = new Set(["nodes", "edges", "viewport"]);

export type FlowOwnerType = "project" | "chapter" | "shot";

export type FlowOwnerMeta = {
	ownerType: FlowOwnerType | null;
	ownerId: string | null;
};

export class FlowStorageEnvelopeError extends Error {
	constructor(
		public readonly source: string,
		public readonly reason: "invalid_json" | "not_object",
	) {
		super(`Flow storage ${source} is ${reason === "invalid_json" ? "not valid JSON" : "not an object"}`);
		this.name = "FlowStorageEnvelopeError";
	}
}

export function parseFlowStorageRecord(raw: string, source: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new FlowStorageEnvelopeError(source, "invalid_json");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new FlowStorageEnvelopeError(source, "not_object");
	}
	return parsed as Record<string, unknown>;
}

export function readFlowOwnerMeta(value: unknown): FlowOwnerMeta {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { ownerType: null, ownerId: null };
	}
	const meta = (value as Record<string, unknown>).__tapcanvasFlowOwner;
	if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
		return { ownerType: null, ownerId: null };
	}
	const ownerRecord = meta as Record<string, unknown>;
	const ownerType =
		ownerRecord.ownerType === "project" || ownerRecord.ownerType === "chapter" || ownerRecord.ownerType === "shot"
			? ownerRecord.ownerType
			: null;
	const ownerId =
		typeof ownerRecord.ownerId === "string" && ownerRecord.ownerId.trim()
			? ownerRecord.ownerId.trim()
			: null;
	return { ownerType, ownerId };
}

/**
 * Flow graph writers own only nodes/edges/viewport. Storage-level metadata is
 * an independent envelope and must survive a graph-only replacement. A caller
 * can still update a metadata key explicitly by including that key in nextData.
 */
export function mergeFlowStorageEnvelope(currentData: string, nextData: string): string {
	const current = parseFlowStorageRecord(currentData, "current data");
	const next = parseFlowStorageRecord(nextData, "next data");
	const merged: Record<string, unknown> = { ...next };

	for (const [key, value] of Object.entries(current)) {
		if (FLOW_GRAPH_STORAGE_KEYS.has(key)) continue;
		if (Object.prototype.hasOwnProperty.call(next, key)) continue;
		merged[key] = value;
	}

	return JSON.stringify(merged);
}
