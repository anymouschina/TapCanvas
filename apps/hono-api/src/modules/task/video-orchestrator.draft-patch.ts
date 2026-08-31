export class BeatSheetDraftPatchError extends Error {}

function cloneValue(value: unknown): unknown {
	return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeRecordDeep(
	current: Record<string, unknown>,
	patch: Record<string, unknown>,
): Record<string, unknown> {
	const next = cloneValue(current) as Record<string, unknown>;
	for (const [key, value] of Object.entries(patch)) {
		const currentValue = next[key];
		next[key] = isRecord(currentValue) && isRecord(value)
			? mergeRecordDeep(currentValue, value)
			: cloneValue(value);
	}
	return next;
}

/**
 * Materialize an explicitly inherited continuity entry from the durable
 * previous beat. This performs no semantic inference: the agent-owned boolean
 * `inheritsPreviousExit=true` is the complete decision, and the runtime only
 * copies its exact structural consequence.
 */
export function projectInheritedContinuityEntry(input: {
	current: Record<string, unknown>;
	previous: Record<string, unknown>;
}): Record<string, unknown> {
	const currentLedger = input.current.continuityLedger;
	if (!isRecord(currentLedger) || currentLedger.inheritsPreviousExit !== true) {
		throw new BeatSheetDraftPatchError(
			"continuity repair 要求当前 beat 显式声明 inheritsPreviousExit=true。",
		);
	}
	const previousLedger = input.previous.continuityLedger;
	const previousExit = isRecord(previousLedger) ? previousLedger.exit : null;
	if (!isRecord(previousExit)) {
		throw new BeatSheetDraftPatchError("continuity repair 要求上一 beat 存在完整 exit。");
	}
	return {
		...(cloneValue(input.current) as Record<string, unknown>),
		continuityLedger: {
			...(cloneValue(currentLedger) as Record<string, unknown>),
			entry: cloneValue(previousExit),
		},
	};
}

const readContinuityBoundary = (
	value: unknown,
): { stateScope: string; facts: Map<string, string> } | null => {
	if (!isRecord(value) || typeof value.stateScope !== "string" || !Array.isArray(value.facts)) {
		return null;
	}
	const facts = new Map<string, string>();
	for (const item of value.facts) {
		if (!isRecord(item) || typeof item.key !== "string" || typeof item.value !== "string") {
			return null;
		}
		facts.set(item.key, item.value);
	}
	return { stateScope: value.stateScope, facts };
};

const continuityBoundariesEqual = (
	left: { stateScope: string; facts: Map<string, string> },
	right: { stateScope: string; facts: Map<string, string> },
): boolean => {
	if (left.stateScope !== right.stateScope || left.facts.size !== right.facts.size) return false;
	for (const [key, value] of left.facts) {
		if (right.facts.get(key) !== value) return false;
	}
	return true;
};

/**
 * Find only deterministic boundary mismatches repairable by copying the
 * durable previous exit. `inheritsPreviousExit=true` is the complete
 * agent-authored authorization; this never interprets prose or chooses
 * whether two scenes should be continuous.
 */
export function findInheritedContinuityRepairClipIndexes(
	beats: readonly Record<string, unknown>[],
): number[] {
	const indexes: number[] = [];
	for (let index = 1; index < beats.length; index += 1) {
		const currentLedger = beats[index]?.continuityLedger;
		if (!isRecord(currentLedger) || currentLedger.inheritsPreviousExit !== true) continue;
		const previousLedger = beats[index - 1]?.continuityLedger;
		const previousExit = isRecord(previousLedger)
			? readContinuityBoundary(previousLedger.exit)
			: null;
		const currentEntry = readContinuityBoundary(currentLedger.entry);
		if (!previousExit || !currentEntry) continue;
		if (!continuityBoundariesEqual(previousExit, currentEntry)) indexes.push(index);
	}
	return indexes;
}

/**
 * Apply an agent-authored, revision-fenced node patch.
 *
 * This is deliberately structural: it never derives creative values, never
 * interprets text, and never bypasses the existing full-node validator. The
 * caller must validate and persist the merged node through the normal draft
 * write path. Deep merge is opt-in per top-level record key; arrays and scalar
 * leaves are always replaced atomically.
 */
export function applyBeatSheetDraftNodePatch(input: {
	current: Record<string, unknown>;
	patch: Record<string, unknown>;
	immutableKeys: readonly string[];
	allowedNewKeys?: readonly string[];
	mergeRecordKeys?: readonly string[];
	deepMergeRecordKeys?: readonly string[];
}): Record<string, unknown> {
	const patchEntries = Object.entries(input.patch);
	if (patchEntries.length === 0) {
		throw new BeatSheetDraftPatchError("patch 必须至少包含一个顶层字段。");
	}
	const immutableKeys = new Set(input.immutableKeys);
	const allowedNewKeys = new Set(input.allowedNewKeys ?? []);
	const mergeRecordKeys = new Set(input.mergeRecordKeys ?? []);
	const deepMergeRecordKeys = new Set(input.deepMergeRecordKeys ?? []);
	const currentKeys = new Set(Object.keys(input.current));
	for (const [key] of patchEntries) {
		if (immutableKeys.has(key)) {
			throw new BeatSheetDraftPatchError(`patch 不得修改不可变字段 ${key}。`);
		}
		if (!currentKeys.has(key) && !allowedNewKeys.has(key)) {
			throw new BeatSheetDraftPatchError(`patch 字段 ${key} 不属于当前持久节点。`);
		}
	}
	const next = cloneValue(input.current) as Record<string, unknown>;
	for (const [key, value] of patchEntries) {
		const currentValue = next[key];
		const shouldDeepMerge = deepMergeRecordKeys.has(key) &&
			isRecord(currentValue) && isRecord(value);
		const shouldMerge = mergeRecordKeys.has(key) &&
			isRecord(currentValue) && isRecord(value);
		next[key] = shouldDeepMerge
			? mergeRecordDeep(currentValue, value)
			: shouldMerge
			? {
				...(cloneValue(currentValue) as Record<string, unknown>),
				...(cloneValue(value) as Record<string, unknown>),
			}
			: cloneValue(value);
	}
	return next;
}
