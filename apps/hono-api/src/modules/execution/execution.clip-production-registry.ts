import { isClipProductionStagingPlan, type ClipProductionPacket } from "../../../../../packages/schemas/clip-production-packet/index.mjs";

export type RegistryObject = Readonly<{
	objectId: string;
	kind: string;
	name: string;
	physicalIdentityKey: string | null;
	referenceRole: string | null;
	identityInvariant: string | null;
	imageSource: Readonly<Record<string, unknown>>;
}>;

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function frozenChapterAssets(value: unknown): Record<string, unknown> {
	if (record(value) && typeof value.text === "string") {
		let parsed: unknown;
		try {
			parsed = JSON.parse(value.text);
		} catch (error: unknown) {
			throw new Error(`Frozen chapter asset Agent output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (!record(parsed)) throw new Error("Frozen chapter asset Agent output must be an object");
		return parsed;
	}
	if (!record(value)) throw new Error("Frozen chapter asset plan must be an object or a typed Agent result");
	return value;
}

/** Exact chapter identity facts, authored once before parallel Clip writers. */
export function chapterAssetRegistry(value: unknown): ReadonlyMap<string, RegistryObject> {
	const assets = frozenChapterAssets(value);
	if (!Array.isArray(assets.objectRegistry) || assets.objectRegistry.length === 0) {
		throw new Error("Clip production requires a non-empty frozen chapter objectRegistry");
	}
	const objects = new Map<string, RegistryObject>();
	for (const [index, raw] of assets.objectRegistry.entries()) {
		if (!record(raw) || typeof raw.objectId !== "string" || !raw.objectId.trim()
			|| typeof raw.kind !== "string" || !raw.kind.trim()
			|| typeof raw.name !== "string" || !raw.name.trim()
			|| !record(raw.imageSource)) {
			throw new Error(`chapter-assets.objectRegistry[${index}] has invalid identity or image source`);
		}
		if (objects.has(raw.objectId)) throw new Error(`chapter-assets.objectRegistry duplicates ${raw.objectId}`);
		objects.set(raw.objectId, {
			objectId: raw.objectId,
			kind: raw.kind,
			name: raw.name,
			physicalIdentityKey: typeof raw.physicalIdentityKey === "string" ? raw.physicalIdentityKey : null,
			referenceRole: typeof raw.referenceRole === "string" ? raw.referenceRole : null,
			identityInvariant: typeof raw.identityInvariant === "string" ? raw.identityInvariant : null,
			imageSource: raw.imageSource,
		});
	}
	return objects;
}

export function chapterBackgroundPlanIds(value: unknown): readonly string[] {
	const assets = frozenChapterAssets(value);
	if (!Array.isArray(assets.backgroundPlans) || assets.backgroundPlans.length === 0) {
		throw new Error("Clip production requires frozen chapter backgroundPlans");
	}
	const ids = new Set<string>();
	for (const [index, background] of assets.backgroundPlans.entries()) {
		if (!record(background) || typeof background.objectId !== "string" || !background.objectId.trim()
			|| !record(background.plan)) {
			throw new Error(`chapter-assets.backgroundPlans[${index}] has invalid identity or plan`);
		}
		if (ids.has(background.objectId)) throw new Error(`chapter-assets.backgroundPlans duplicates ${background.objectId}`);
		ids.add(background.objectId);
	}
	return [...ids];
}

/** Display names of the frozen background plans, keyed by their stable objectId. */
export function chapterBackgroundPlanNames(value: unknown): ReadonlyMap<string, string> {
	const assets = frozenChapterAssets(value);
	const names = new Map<string, string>();
	for (const id of chapterBackgroundPlanIds(value)) {
		const background = (assets.backgroundPlans as unknown[]).find((item) => record(item) && item.objectId === id);
		const plan = record(background) && record(background.plan) ? background.plan : null;
		names.set(id, plan && typeof plan.displayName === "string" ? plan.displayName : "");
	}
	return names;
}

/** Checks frozen references only; creative prose and quality remain Agent-owned. */
export function verifyClipAssetsAgainstChapterRegistry(packet: ClipProductionPacket, registryValue: unknown): void {
	const registry = chapterAssetRegistry(registryValue);
	// Staging bound from the chapter ledger names no background plan; an authored plan must resolve one.
	if (packet.blockingPlan && !isClipProductionStagingPlan(packet.blockingPlan)
		&& !chapterBackgroundPlanIds(registryValue).includes(packet.blockingPlan.backgroundObjectId)) {
		throw new Error(`Clip ${packet.clipId} blockingPlan.backgroundObjectId must resolve one frozen background plan`);
	}
	for (const [index, intent] of packet.assetIntents.entries()) {
		const entry = registry.get(intent.registryObjectId);
		if (!entry) throw new Error(`Clip ${packet.clipId} assetIntents[${index}] references unknown chapter object ${intent.registryObjectId}`);
		if (entry.kind !== intent.referenceType) {
			throw new Error(`Clip ${packet.clipId} assetIntents[${index}] referenceType differs from frozen chapter object kind`);
		}
		if (entry.kind === "character" && entry.physicalIdentityKey
			&& intent.physicalIdentityKey && entry.physicalIdentityKey !== intent.physicalIdentityKey) {
			throw new Error(`Clip ${packet.clipId} assetIntents[${index}] physical identity differs from frozen chapter object`);
		}
		const source = intent.imageSource;
		if (source.mode === "reuse") {
			if (entry.imageSource.mode !== "reuse") {
				throw new Error(`Clip ${packet.clipId} assetIntents[${index}] reuses an asset not selected by chapter planning`);
			}
			const permitted = entry.imageSource.assetIds;
			if (!Array.isArray(permitted) || !permitted.includes(source.existingAssetId)) {
				throw new Error(`Clip ${packet.clipId} assetIntents[${index}] reuses an asset outside the frozen chapter selection`);
			}
		}
	}
}
