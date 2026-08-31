import { isDeepStrictEqual } from "node:util";
import { AppError } from "../../middleware/error";
import type { BookIndexRecord } from "./book-index-store";

const BOOK_INDEX_ARRAY_IDENTITIES: Readonly<Record<string, string>> = {
	chapters: "chapter",
};

const BOOK_ASSET_ARRAY_IDENTITIES: Readonly<Record<string, string>> = {
	characterBibles: "id",
	roleCards: "cardId",
	semanticAssets: "semanticId",
	storyboardChunks: "chunkId",
	storyboardPlans: "planId",
	visualRefs: "refId",
};

const REVISION_METADATA_FIELDS = new Set(["updatedAt", "updatedBy"]);

function cloneAssets(index: Readonly<BookIndexRecord>): Record<string, unknown> {
	return index.assets && typeof index.assets === "object" && !Array.isArray(index.assets)
		? { ...(index.assets as Record<string, unknown>) }
		: {};
}

function readRecordIdentity(value: unknown, identityKey: string): string {
	if (!value || typeof value !== "object" || Array.isArray(value)) return "";
	const identity = (value as Record<string, unknown>)[identityKey];
	if (typeof identity === "number" && Number.isFinite(identity)) return String(identity);
	return typeof identity === "string" ? identity.trim() : "";
}

function throwMergeConflict(fieldPath: string): never {
	throw new AppError(`Book index has concurrent changes at ${fieldPath}`, {
		status: 409,
		code: "book_index_merge_conflict",
		details: { fieldPath },
	});
}

function applyChangedValue(input: {
	target: Record<string, unknown>;
	base: Readonly<Record<string, unknown>>;
	current: Readonly<Record<string, unknown>>;
	derived: Readonly<Record<string, unknown>>;
	key: string;
	fieldPath: string;
}): void {
	const baseHas = input.key in input.base;
	const currentHas = input.key in input.current;
	const derivedHas = input.key in input.derived;
	const derivedChanged =
		baseHas !== derivedHas || !isDeepStrictEqual(input.base[input.key], input.derived[input.key]);
	if (!derivedChanged) return;
	const currentChanged =
		baseHas !== currentHas || !isDeepStrictEqual(input.base[input.key], input.current[input.key]);
	const changesAgree =
		currentHas === derivedHas &&
		isDeepStrictEqual(input.current[input.key], input.derived[input.key]);
	if (currentChanged && !changesAgree && !REVISION_METADATA_FIELDS.has(input.key)) {
		throwMergeConflict(input.fieldPath);
	}
	if (derivedHas) input.target[input.key] = structuredClone(input.derived[input.key]);
	else delete input.target[input.key];
}

function mergeChangedRecord(
	base: Readonly<Record<string, unknown>>,
	current: Readonly<Record<string, unknown>>,
	derived: Readonly<Record<string, unknown>>,
	fieldPath: string,
): Record<string, unknown> {
	const merged = { ...current };
	for (const key of new Set([...Object.keys(base), ...Object.keys(derived)])) {
		applyChangedValue({
			target: merged,
			base,
			current,
			derived,
			key,
			fieldPath: `${fieldPath}.${key}`,
		});
	}
	return merged;
}

function readManagedArray(value: unknown, fieldPath: string): unknown[] {
	if (value === undefined) return [];
	if (Array.isArray(value)) return value;
	throw new AppError(`Book index array ${fieldPath} must be an array`, {
		status: 500,
		code: "book_index_array_invalid",
		details: { fieldPath },
	});
}

function mergeChangedRecordArray(input: {
	base: unknown[];
	current: unknown[];
	derived: unknown[];
	identityKey: string;
	fieldPath: string;
}): unknown[] {
	const toMap = (items: unknown[]): Map<string, Record<string, unknown>> => {
		const mapped = new Map<string, Record<string, unknown>>();
		for (const item of items) {
			const identity = readRecordIdentity(item, input.identityKey);
			if (!identity || !item || typeof item !== "object" || Array.isArray(item)) {
				throw new AppError(`Book index array ${input.fieldPath} has an entry without ${input.identityKey}`, {
					status: 500,
					code: "book_index_array_identity_missing",
					details: { fieldPath: input.fieldPath, identityKey: input.identityKey },
				});
			}
			if (mapped.has(identity)) {
				throw new AppError(`Book index array ${input.fieldPath} has duplicate ${input.identityKey}`, {
					status: 500,
					code: "book_index_array_identity_duplicate",
					details: { fieldPath: input.fieldPath, identityKey: input.identityKey, identity },
				});
			}
			mapped.set(identity, item as Record<string, unknown>);
		}
		return mapped;
	};
	const baseMap = toMap(input.base);
	const currentMap = toMap(input.current);
	const derivedMap = toMap(input.derived);
	for (const [identity, baseItem] of baseMap) {
		if (derivedMap.has(identity)) continue;
		const currentItem = currentMap.get(identity);
		if (currentItem && !isDeepStrictEqual(currentItem, baseItem)) {
			throwMergeConflict(`${input.fieldPath}[${identity}]`);
		}
		currentMap.delete(identity);
	}
	for (const [identity, derivedItem] of derivedMap) {
		const baseItem = baseMap.get(identity);
		const currentItem = currentMap.get(identity);
		if (!baseItem) {
			if (currentItem && !isDeepStrictEqual(currentItem, derivedItem)) {
				throwMergeConflict(`${input.fieldPath}[${identity}]`);
			}
			currentMap.set(identity, structuredClone(derivedItem));
			continue;
		}
		if (!currentItem) {
			if (!isDeepStrictEqual(baseItem, derivedItem)) {
				throwMergeConflict(`${input.fieldPath}[${identity}]`);
			}
			continue;
		}
		if (!isDeepStrictEqual(baseItem, derivedItem)) {
			currentMap.set(
				identity,
				mergeChangedRecord(baseItem, currentItem, derivedItem, `${input.fieldPath}[${identity}]`),
			);
		}
	}
	return Array.from(currentMap.values());
}

export function mergeDerivedBookIndex(
	base: Readonly<BookIndexRecord>,
	current: Readonly<BookIndexRecord>,
	derived: Readonly<BookIndexRecord>,
): BookIndexRecord {
	const next: BookIndexRecord = { ...current };
	for (const [key, derivedValue] of Object.entries(derived)) {
		if (key === "bookId" || key === "projectId" || key === "assets") continue;
		if (isDeepStrictEqual(base[key], derivedValue)) continue;
		const identityKey = BOOK_INDEX_ARRAY_IDENTITIES[key];
		if (identityKey) {
			next[key] = mergeChangedRecordArray({
				base: readManagedArray(base[key], key),
				current: readManagedArray(current[key], key),
				derived: readManagedArray(derivedValue, key),
				identityKey,
				fieldPath: key,
			});
			continue;
		}
		applyChangedValue({ target: next, base, current, derived, key, fieldPath: key });
	}

	const baseAssets = cloneAssets(base);
	const currentAssets = cloneAssets(current);
	const derivedAssets = cloneAssets(derived);
	for (const [key, derivedValue] of Object.entries(derivedAssets)) {
		if (isDeepStrictEqual(baseAssets[key], derivedValue)) continue;
		const identityKey = BOOK_ASSET_ARRAY_IDENTITIES[key];
		const fieldPath = `assets.${key}`;
		if (identityKey) {
			currentAssets[key] = mergeChangedRecordArray({
				base: readManagedArray(baseAssets[key], fieldPath),
				current: readManagedArray(currentAssets[key], fieldPath),
				derived: readManagedArray(derivedValue, fieldPath),
				identityKey,
				fieldPath,
			});
			continue;
		}
		applyChangedValue({
			target: currentAssets,
			base: baseAssets,
			current: currentAssets,
			derived: derivedAssets,
			key,
			fieldPath,
		});
	}
	next.assets = currentAssets;
	return next;
}
