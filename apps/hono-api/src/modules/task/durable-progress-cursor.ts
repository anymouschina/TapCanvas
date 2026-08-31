export type DurableProgressCursorV1 = {
	version: 1;
	graph: string;
	/** Optional at producer boundaries; the parser always normalizes it to null when omitted. */
	scopeId?: string | null;
	phase: string;
	revision: string | null;
	/** Optional opaque execution lease generation; independent from monotonic progress revision. */
	executionGeneration?: string | null;
	completedUnitIds: string[];
	pendingUnitIds: string[];
	allowedNextActions: string[];
	requiredReadActions: string[];
	/** Optional at producer boundaries; the parser always normalizes it to an empty list when omitted. */
	allowedSupportingTools?: string[];
};

export type NormalizedDurableProgressCursorV1 = DurableProgressCursorV1 & {
	scopeId: string | null;
	executionGeneration: string | null;
	allowedSupportingTools: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(value: unknown, maxLength: number): string | null {
	if (typeof value !== "string") return null;
	const text = value.trim();
	return text && text.length <= maxLength ? text : null;
}

function readOptionalString(value: unknown, maxLength: number): string | null | undefined {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") return undefined;
	const text = value.trim();
	if (!text) return null;
	return text.length <= maxLength ? text : undefined;
}

function readUniqueStringList(value: unknown): string[] | null {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value) || value.length > 128) return null;
	const values = new Set<string>();
	for (const item of value) {
		if (typeof item !== "string") return null;
		const text = item.trim();
		if (!text || text.length > 256) return null;
		values.add(text);
	}
	return [...values];
}

/**
 * Validates the graph-neutral continuation cursor shared by every durable task.
 * Domain schedulers may choose their own graph, phase, unit and action names;
 * the continuation runtime only preserves the structural progress contract.
 */
export function parseDurableProgressCursor(value: unknown): NormalizedDurableProgressCursorV1 | null {
	if (!isRecord(value) || value.version !== 1) return null;
	const graph = readRequiredString(value.graph, 160);
	const phase = readRequiredString(value.phase, 160);
	const scopeId = readOptionalString(value.scopeId, 256);
	const revision = readOptionalString(value.revision, 256);
	const executionGeneration = readOptionalString(value.executionGeneration, 256);
	const completedUnitIds = readUniqueStringList(value.completedUnitIds);
	const pendingUnitIds = readUniqueStringList(value.pendingUnitIds);
	const allowedNextActions = readUniqueStringList(value.allowedNextActions);
	const requiredReadActions = readUniqueStringList(value.requiredReadActions);
	const allowedSupportingTools = readUniqueStringList(value.allowedSupportingTools);
	if (
		!graph || !phase || scopeId === undefined || revision === undefined ||
		executionGeneration === undefined || completedUnitIds === null ||
		pendingUnitIds === null || allowedNextActions === null ||
		requiredReadActions === null || allowedSupportingTools === null
	) return null;
	return {
		version: 1,
		graph,
		scopeId,
		phase,
		revision,
		executionGeneration,
		completedUnitIds,
		pendingUnitIds,
		allowedNextActions,
		requiredReadActions,
		allowedSupportingTools,
	};
}
