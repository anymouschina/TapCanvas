import { createWorkflowCollection, isWorkflowCollection, type WorkflowCollectionV1 } from "@tapcanvas/workflow-kernel-protocol";
import {
	canonicalClipProductionJson,
	collectClipProductionPackets as collectPackets,
	CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION,
	clipProductionPacketSchema,
	validateClipProductionPacket,
	type ClipProductionJsonValue,
	type ClipProductionAssetIntent,
	type ClipProductionAssetIdentity,
	type ClipProductionPacket,
	type ClipProductionSourceRange,
	type CollectedClipProductionPackets,
} from "../../../../../packages/schemas/clip-production-packet/index.mjs";
import { assetFactIdentity } from "./execution.asset-identity";
import type { ClipSourceSegment } from "./execution.clip-segmentation";
import type { WorkflowAgentJsonObjectContract } from "./execution.agent-output-contract";
import { chapterAssetRegistry, chapterBackgroundPlanIds, verifyClipAssetsAgainstChapterRegistry } from "./execution.clip-production-registry";

export type MaterializedClipAssetIntent = ClipProductionAssetIntent & Readonly<{
	consumerClipIds: readonly string[];
	/** Stable effect identity includes state and complete generation facts. */
	effectAssetId: string;
}>;

export type ClipProductionProjection = Readonly<{
	clipProductionCollection: WorkflowCollectionV1<ClipProductionPacket>;
	assetIntentCollection: WorkflowCollectionV1<MaterializedClipAssetIntent>;
	collected: CollectedClipProductionPackets;
}>;

export const VIDEO_CLIP_PRODUCTION_WORKFLOW_INPUT_MODES = ["image_to_video", "reference_to_video", "text_to_video"] as const;
export type VideoClipProductionInputMode = (typeof VIDEO_CLIP_PRODUCTION_WORKFLOW_INPUT_MODES)[number];

export type ClipProductionAssetPlanItem = Readonly<{
	protocolVersion: "tapcanvas.clip-production-asset-item/v1";
	assetId: string;
	effectAssetId: string;
	canonicalAssetId: string;
	state: string;
	registryObjectId: string;
	displayName: string;
	referenceType: ClipProductionAssetIntent["referenceType"];
	referenceAssetBindings: ClipProductionAssetIntent["referenceAssetBindings"];
	imageSource: ClipProductionAssetIntent["imageSource"];
	canonicalName?: string;
	roleName?: string;
	physicalIdentityKey?: string;
	assetReuseKey?: string;
	characterAssetRole?: string;
	characterProfileVersion?: string;
	identityBoardSpec?: ClipProductionAssetIntent["identityBoardSpec"];
	identityAnchors?: readonly string[];
	prohibitedDrift?: readonly string[];
	sceneCard?: ClipProductionAssetIntent["sceneCard"];
	sceneName?: string;
	propName?: string;
	assetPurpose?: string;
	generationSpecVersion: string;
	generationSpec?: Extract<ClipProductionAssetIntent["imageSource"], { mode: "generate" }>["generationSpec"];
	prompt?: string;
	negativePrompt?: string;
	modelKey?: string;
	aspectRatio?: string;
	size?: string;
	existingAssetId?: string;
	existingProjectId?: string;
	consumerClipIds: readonly string[];
}>;

export type ClipProductionMaterializedImageReference = ClipProductionAssetIdentity & Readonly<{
	effectAssetId: string;
	imageUrl: string;
	nodeId: string;
	generatedAssetId: string | null;
}>;

/** Persist author-produced semantics unchanged; the host never derives names from prompts or IDs. */
export function clipProductionAssetMetadata(
	value: Pick<ClipProductionAssetPlanItem,
		"registryObjectId" | "displayName" | "referenceType" | "canonicalName" | "roleName"
		| "physicalIdentityKey" | "characterAssetRole" | "characterProfileVersion" | "identityBoardSpec"
		| "assetReuseKey"
		| "identityAnchors" | "prohibitedDrift" | "sceneCard" | "sceneName" | "propName" | "assetPurpose">,
): Readonly<Record<string, unknown>> {
	return {
		workflowObjectId: value.registryObjectId,
		displayName: value.displayName,
		referenceType: value.referenceType,
		...(value.canonicalName ? { canonicalName: value.canonicalName } : {}),
		...(value.roleName ? { roleName: value.roleName } : {}),
		...(value.physicalIdentityKey ? { physicalIdentityKey: value.physicalIdentityKey } : {}),
		...(value.assetReuseKey ? { assetReuseKey: value.assetReuseKey } : {}),
		...(value.characterAssetRole ? { characterAssetRole: value.characterAssetRole } : {}),
		...(value.characterProfileVersion ? { characterProfileVersion: value.characterProfileVersion } : {}),
		...(value.identityBoardSpec ? { identityBoardSpec: value.identityBoardSpec } : {}),
		...(value.identityAnchors ? { identityAnchors: value.identityAnchors } : {}),
		...(value.prohibitedDrift ? { prohibitedDrift: value.prohibitedDrift } : {}),
		...(value.sceneCard ? { sceneCard: value.sceneCard } : {}),
		...(value.sceneName ? { sceneName: value.sceneName } : {}),
		...(value.propName ? { propName: value.propName } : {}),
		...(value.assetPurpose ? { workflowAssetPurpose: value.assetPurpose } : {}),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredCanonicalText(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
		throw new Error(`${field} must be a canonical non-empty string`);
	}
	return value;
}

function sourceRangesFromSegment(segment: ClipSourceSegment): readonly ClipProductionSourceRange[] {
	return segment.sourceRanges.map((range) => ({
		sourceIndex: range.sourceIndex,
		startOffset: range.startOffset,
		endOffset: range.endOffset,
		sourceId: range.sourceId,
		sourceFingerprint: range.sourceFingerprint,
	}));
}

function readSourceSegment(value: unknown, field: string): ClipSourceSegment {
	if (!isRecord(value)
		|| value.protocolVersion !== "tapcanvas.clip-source-segment/v1"
		|| typeof value.clipId !== "string"
		|| !Number.isSafeInteger(value.clipIndex)
		|| typeof value.sourceId !== "string"
		|| typeof value.sourceFingerprint !== "string"
		|| !Number.isSafeInteger(value.durationSeconds)
		|| !Array.isArray(value.sourceRanges)) {
		throw new Error(`${field} must be one frozen tapcanvas.clip-source-segment/v1 item`);
	}
	return value as unknown as ClipSourceSegment;
}

function canonicalSourceRanges(ranges: readonly ClipProductionSourceRange[]): string {
	return canonicalClipProductionJson(ranges as unknown as ClipProductionJsonValue);
}

function materializationEffectAssetId(intent: ClipProductionAssetIntent): string {
	return assetFactIdentity("clip-production-image-effect", {
		assetId: intent.assetId,
		state: intent.state,
		imageSource: intent.imageSource,
	});
}

/** Bind machine-owned Clip identity and source coverage into the Agent's repairable output contract. */
export function bindClipProductionPacketAuthoringContract(
	contract: WorkflowAgentJsonObjectContract,
	sourceSegmentValue: unknown,
	allowedVideoInputModes: readonly VideoClipProductionInputMode[] = VIDEO_CLIP_PRODUCTION_WORKFLOW_INPUT_MODES,
	frozenImageModelKey?: string,
	frozenImageAspectRatio?: string,
	frozenImageSize?: string,
	chapterAssets?: unknown,
	projectId?: string,
	clipSequence?: unknown,
): WorkflowAgentJsonObjectContract {
	const segment = readSourceSegment(sourceSegmentValue, "clip-segment");
	if (clipSequence !== undefined) {
		if (!isRecord(clipSequence) || clipSequence.protocolVersion !== "tapcanvas.chapter-sequence-clip/v1"
			|| clipSequence.clipId !== segment.clipId || clipSequence.clipIndex !== segment.clipIndex
			|| clipSequence.durationSeconds !== segment.durationSeconds) {
			throw new Error(`clip-sequence must match frozen source segment ${segment.clipId}`);
		}
	}
	const sourceRanges = sourceRangesFromSegment(segment);
	const schema = structuredClone(clipProductionPacketSchema) as Record<string, unknown>;
	const properties = schema.properties as Record<string, unknown>;
	if (clipSequence !== undefined) {
		properties.clipFacts = { type: "object", minProperties: 1,
			properties: { sequenceClipId: { type: "string", const: segment.clipId } },
			required: ["sequenceClipId"], additionalProperties: true };
	}
	if (chapterAssets !== undefined) {
		const registry = chapterAssetRegistry(chapterAssets);
		const backgroundIds = chapterBackgroundPlanIds(chapterAssets);
		const intents = properties.assetIntents as Record<string, unknown>;
		const intentItem = intents.items as Record<string, unknown>;
		intentItem.properties = {
			registryObjectId: { type: "string", enum: [...registry.keys()] },
			imageSource: { oneOf: [
				{ type: "object", properties: { mode: { const: "generate" } }, required: ["mode"], additionalProperties: false },
				{ type: "object", properties: { mode: { const: "reuse" }, registryAssetIndex: { type: "integer", minimum: 0,
					description: `Zero-based index in the selected registry object's frozen imageSource.assetIds; resolved in ${projectId ?? "caller"} project.` } },
					required: ["mode", "registryAssetIndex"], additionalProperties: false },
			] },
		};
		intentItem.required = ["registryObjectId", "imageSource"];
		intentItem.additionalProperties = false;
		const blockingPlan = properties.blockingPlan as Record<string, unknown>;
		const blockingProperties = blockingPlan.properties as Record<string, unknown>;
		delete blockingProperties.backgroundObjectId;
		blockingProperties.backgroundPlanIndex = { type: "integer", minimum: 0, maximum: backgroundIds.length - 1,
			description: "Zero-based selection within frozen chapter-assets.backgroundPlans; the host resolves backgroundObjectId." };
		blockingPlan.required = (blockingPlan.required as string[]).map((field) => field === "backgroundObjectId" ? "backgroundPlanIndex" : field);
		delete properties.firstFrameAsset;
		delete properties.referenceAssets;
		properties.firstFrameAssetIndex = { oneOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
			description: "Zero-based index in this packet's assetIntents, or null when there is no first frame." };
		properties.referenceAssetIndices = { type: "array", items: { type: "integer", minimum: 0 }, uniqueItems: true,
			description: "Zero-based indices in this packet's assetIntents selected as video references." };
		if (!frozenImageModelKey || !frozenImageAspectRatio || !frozenImageSize) {
			throw new Error("Clip production draft requires frozen image model, aspect ratio and size");
		}
		properties.imageModelKey = { type: "string", const: frozenImageModelKey };
		properties.imageAspectRatio = { type: "string", const: frozenImageAspectRatio };
		properties.imageSize = { type: "string", const: frozenImageSize };
		schema.required = (schema.required as string[]).map((field) =>
			field === "firstFrameAsset" ? "firstFrameAssetIndex" : field === "referenceAssets" ? "referenceAssetIndices" : field)
			.concat(["imageModelKey", "imageAspectRatio", "imageSize"]);
	}
	if (frozenImageModelKey && chapterAssets === undefined) {
		const intents = properties.assetIntents as Record<string, unknown>;
		const intentItem = intents.items as Record<string, unknown>;
		const intentProperties = intentItem.properties as Record<string, unknown>;
		const imageSource = intentProperties.imageSource as Record<string, unknown>;
		const generateVariant = (imageSource.oneOf as Record<string, unknown>[])[0];
		const generationSpec = (generateVariant.properties as Record<string, unknown>).generationSpec as Record<string, unknown>;
		const generationProperties = generationSpec.properties as Record<string, unknown>;
		generationProperties.modelKey = { type: "string", const: frozenImageModelKey };
		if (frozenImageAspectRatio) generationProperties.aspectRatio = { type: "string", const: frozenImageAspectRatio };
		if (frozenImageSize) generationProperties.size = { type: "string", const: frozenImageSize };
	}
	properties.protocolVersion = { type: "string", const: CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION };
	properties.clipId = { type: "string", minLength: 1, const: segment.clipId };
	properties.clipIndex = { type: "integer", minimum: 0, maximum: 79, const: segment.clipIndex };
	properties.durationSeconds = { type: "integer", minimum: 1, const: segment.durationSeconds };
	if (allowedVideoInputModes.length === 0) throw new Error("clip-production allowed video input modes must not be empty");
	properties.videoInputMode = { type: "string", enum: [...new Set(allowedVideoInputModes)] };
	properties.sourceRanges = {
		type: "array",
		minItems: sourceRanges.length,
		maxItems: sourceRanges.length,
		items: (properties.sourceRanges as Record<string, unknown>).items,
		const: sourceRanges,
	};
	return {
		...contract,
		jsonSchema: schema,
		contractName: "tapcanvas.clip-production-packet",
		contractVersion: "1",
		requiredStringFields: ["protocolVersion", "clipId", "videoPrompt"],
		exactStringFields: {
			...contract.exactStringFields,
			protocolVersion: CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION,
			clipId: segment.clipId,
		},
		requiredNumberFields: ["clipIndex", "durationSeconds"],
		requiredObjectFields: ["blockingPlan", "clipFacts"],
		requiredArrayFields: ["sourceRanges", "assetIntents"],
		expectedArrayLengths: {
			...contract.expectedArrayLengths,
			sourceRanges: sourceRanges.length,
		},
		allowedFields: [
			"protocolVersion", "clipId", "clipIndex", "durationSeconds", "videoInputMode",
			...(chapterAssets === undefined ? ["firstFrameAsset", "referenceAssets"] : ["firstFrameAssetIndex", "referenceAssetIndices"]), "sourceRanges",
			"videoPrompt", "blockingPlan", "clipFacts", "assetIntents",
			...(chapterAssets === undefined ? [] : ["imageModelKey", "imageAspectRatio", "imageSize"]),
		],
	};
}

/** Expand the compact author selection from the frozen chapter registry before packet validation. */
export function materializeClipProductionDraft(
	packetValue: unknown,
	chapterAssets: unknown,
	projectId: string,
): unknown {
	if (!isRecord(packetValue) || !Array.isArray(packetValue.assetIntents)) {
		throw new Error("Clip production draft requires assetIntents");
	}
	if (!projectId.trim()) throw new Error("Clip production requires the frozen caller project ID");
	const imageModelKey = requiredCanonicalText(packetValue.imageModelKey, "imageModelKey");
	const imageAspectRatio = requiredCanonicalText(packetValue.imageAspectRatio, "imageAspectRatio");
	const imageSize = requiredCanonicalText(packetValue.imageSize, "imageSize");
	const registry = chapterAssetRegistry(chapterAssets);
	const assetIntents = packetValue.assetIntents.map((value, index) => {
		if (!isRecord(value) || !isRecord(value.imageSource)) {
			throw new Error(`Clip production draft assetIntents[${index}] is invalid`);
		}
		const objectId = requiredCanonicalText(value.registryObjectId, `assetIntents[${index}].registryObjectId`);
		const entry = registry.get(objectId);
		if (!entry) throw new Error(`Clip production draft assetIntents[${index}] references an unknown frozen object`);
		const source = value.imageSource;
		if (source.mode !== entry.imageSource.mode) {
			throw new Error(`Clip production draft assetIntents[${index}] source mode differs from frozen chapter object`);
		}
		let identitySuffix: string;
		let imageSource: Record<string, unknown>;
		let plan: Record<string, unknown> | null = null;
		let referenceAssetBindings: unknown[] = [];
		if (source.mode === "reuse") {
			if (!Array.isArray(entry.imageSource.assetIds)) {
				throw new Error(`Clip production draft assetIntents[${index}] has no frozen reusable assets`);
			}
			const assetIndex = source.registryAssetIndex;
			if (typeof assetIndex !== "number" || !Number.isSafeInteger(assetIndex) || assetIndex < 0) {
				throw new Error(`Clip production draft assetIntents[${index}] requires an exact registryAssetIndex`);
			}
			const assetId = entry.imageSource.assetIds[assetIndex];
			if (typeof assetId !== "string" || !assetId.trim()) {
				throw new Error(`Clip production draft assetIntents[${index}] registryAssetIndex is outside the frozen selection`);
			}
			identitySuffix = `reuse:${assetIndex}`;
			imageSource = { mode: "reuse", existingAssetId: assetId, existingProjectId: projectId };
		} else if (source.mode === "generate") {
			plan = isRecord(entry.imageSource.plan) ? entry.imageSource.plan : null;
			if (!plan) throw new Error(`Clip production draft assetIntents[${index}] has no frozen generation plan`);
			const sceneCard = isRecord(plan.sceneCard) ? plan.sceneCard : null;
			const prompt = entry.kind === "scene" ? sceneCard?.spacePrompt : plan.prompt;
			const negativePrompt = entry.kind === "scene" ? sceneCard?.negativePrompt : plan.negativePrompt;
			if (typeof prompt !== "string" || !prompt.trim() || typeof negativePrompt !== "string" || !negativePrompt.trim()) {
				throw new Error(`Clip production draft assetIntents[${index}] frozen generation plan lacks image prompt fields`);
			}
			if (!Array.isArray(entry.imageSource.referenceAssetBindings)) {
				throw new Error(`Clip production draft assetIntents[${index}] frozen generation references are invalid`);
			}
			referenceAssetBindings = entry.imageSource.referenceAssetBindings;
			identitySuffix = "generate";
			imageSource = { mode: "generate", generationSpecVersion: "chapter-object-plan/v1",
				generationSpec: { prompt, negativePrompt, modelKey: imageModelKey, aspectRatio: imageAspectRatio, size: imageSize } };
		} else {
			throw new Error(`Clip production draft assetIntents[${index}] has an unsupported image source mode`);
		}
		return {
			assetId: `chapter-object:${objectId}:${identitySuffix}`,
			state: `chapter-shared:${identitySuffix}`,
			registryObjectId: objectId,
			displayName: entry.name,
			referenceType: entry.kind,
			referenceAssetBindings,
			imageSource,
			canonicalName: entry.name,
			...(entry.kind === "character" ? { roleName: entry.name } : {}),
			...(entry.kind === "scene" ? { sceneName: entry.name } : {}),
			...(entry.kind === "prop" ? { propName: entry.name } : {}),
			...(entry.physicalIdentityKey ? { physicalIdentityKey: entry.physicalIdentityKey } : {}),
			...(entry.kind === "character" ? { characterAssetRole: "identity_anchor", characterProfileVersion: "character-card/v3" } : {}),
			...(entry.referenceRole && (entry.kind === "character" ? entry.physicalIdentityKey : entry.identityInvariant)
				? { assetReuseKey: assetFactIdentity("asset-reuse", { kind: entry.kind, referenceRole: entry.referenceRole,
					identity: entry.kind === "character" ? entry.physicalIdentityKey
						: { name: entry.name, invariant: entry.identityInvariant } }) }
				: {}),
			...(plan && Array.isArray(plan.identityAnchors) ? { identityAnchors: plan.identityAnchors } : {}),
			...(plan && Array.isArray(plan.prohibitedDrift) ? { prohibitedDrift: plan.prohibitedDrift } : {}),
			...(plan && isRecord(plan.identityBoardSpec) ? { identityBoardSpec: plan.identityBoardSpec } : {}),
			...(plan && isRecord(plan.sceneCard) ? { sceneCard: plan.sceneCard } : {}),
		};
	});
	const referenceIndices = packetValue.referenceAssetIndices;
	if (!Array.isArray(referenceIndices)) throw new Error("Clip production draft requires referenceAssetIndices");
	const assetIdentityAt = (rawIndex: unknown, field: string): { assetId: string; state: string } => {
		if (typeof rawIndex !== "number" || !Number.isSafeInteger(rawIndex) || rawIndex < 0
			|| !isRecord(assetIntents[rawIndex])) throw new Error(`${field} is outside the frozen assetIntents`);
		const intent = assetIntents[rawIndex];
		if (typeof intent.assetId !== "string" || typeof intent.state !== "string") {
			throw new Error(`${field} does not resolve an asset identity`);
		}
		return { assetId: intent.assetId, state: intent.state };
	};
	const referenceAssets = referenceIndices.map((rawIndex, index) => assetIdentityAt(rawIndex, `referenceAssetIndices[${index}]`));
	const firstFrameAsset = packetValue.firstFrameAssetIndex === null ? null
		: assetIdentityAt(packetValue.firstFrameAssetIndex, "firstFrameAssetIndex");
	if (!isRecord(packetValue.blockingPlan)) throw new Error("Clip production draft requires blockingPlan");
	const backgroundIds = chapterBackgroundPlanIds(chapterAssets);
	const backgroundIndex = packetValue.blockingPlan.backgroundPlanIndex;
	if (typeof backgroundIndex !== "number" || !Number.isSafeInteger(backgroundIndex) || backgroundIndex < 0
		|| backgroundIndex >= backgroundIds.length) throw new Error("backgroundPlanIndex is outside frozen chapter plans");
	const { backgroundPlanIndex: _backgroundPlanIndex, ...blockingPlan } = packetValue.blockingPlan;
	const { firstFrameAssetIndex: _firstFrameAssetIndex, referenceAssetIndices: _referenceAssetIndices,
		imageModelKey: _imageModelKey, imageAspectRatio: _imageAspectRatio, imageSize: _imageSize, ...packet } = packetValue;
	return { ...packet, assetIntents, firstFrameAsset, referenceAssets,
		blockingPlan: { ...blockingPlan, backgroundObjectId: backgroundIds[backgroundIndex] } };
}

/** Confirm the packet's machine-owned fields against the exact frozen Clip input. */
export function verifyClipProductionPacketSourceBinding(
	packetValue: unknown,
	sourceSegmentValue: unknown,
	allowedVideoInputModes: readonly VideoClipProductionInputMode[] = VIDEO_CLIP_PRODUCTION_WORKFLOW_INPUT_MODES,
): ClipProductionPacket {
	const packet = validateClipProductionPacket(packetValue);
	if (!allowedVideoInputModes.includes(packet.videoInputMode as VideoClipProductionInputMode)) {
		throw new Error(`clip-production packet videoInputMode ${packet.videoInputMode} is not allowed in this workflow`);
	}
	const segment = readSourceSegment(sourceSegmentValue, "clip-segment");
	if (packet.clipId !== segment.clipId || packet.clipIndex !== segment.clipIndex
		|| packet.durationSeconds !== segment.durationSeconds) {
		throw new Error("clip-production packet identity or duration differs from the frozen source segment");
	}
	if (Object.hasOwn(packet.clipFacts, "sequenceClipId") && packet.clipFacts.sequenceClipId !== segment.clipId) {
		throw new Error("clip-production packet sequenceClipId differs from the frozen source segment");
	}
	const sourceRanges = sourceRangesFromSegment(segment);
	if (canonicalSourceRanges(packet.sourceRanges) !== canonicalSourceRanges(sourceRanges)) {
		throw new Error(`clip-production packet sourceRanges differ from frozen source segment ${packet.clipId}`);
	}
	return { ...packet, sourceRanges };
}

/**
 * Bind Clip writer packets to the exact upstream segmentation items, then
 * assemble clip and deduplicated asset collections without interpreting prose.
 * This is a pure projection; it does not start media work or share effects across families.
 */
export function projectClipProductionPackets(input: Readonly<{
	executionId: string;
	nodeId: string;
	packets: readonly unknown[];
	sourceSegmentCollection: unknown;
	allowedVideoInputModes?: readonly VideoClipProductionInputMode[];
	chapterAssets?: unknown;
}>): ClipProductionProjection {
	const executionId = requiredCanonicalText(input.executionId, "executionId");
	const nodeId = requiredCanonicalText(input.nodeId, "nodeId");
	if (!isWorkflowCollection(input.sourceSegmentCollection)) {
		throw new Error("clip-production projection requires the source segmentation WorkflowCollection");
	}
	const sourceSegmentCollection = input.sourceSegmentCollection as WorkflowCollectionV1<ClipSourceSegment>;
	const collected = collectPackets(input.packets);
	if (sourceSegmentCollection.items.length !== collected.clips.length) {
		throw new Error(`clip-production packet count must match source segments: expected=${sourceSegmentCollection.items.length}:actual=${collected.clips.length}`);
	}

	const clips = collected.clips.map((packet, index): ClipProductionPacket => {
		const sourceItem = sourceSegmentCollection.items[index];
		if (!sourceItem) {
			throw new Error(`source segment ${index} is missing or malformed`);
		}
		if (sourceItem.itemId !== packet.clipId) throw new Error(`clip-production packet identity differs from source segment ${index}`);
		const verified = verifyClipProductionPacketSourceBinding(packet, sourceItem.value, input.allowedVideoInputModes);
		if (input.chapterAssets !== undefined) verifyClipAssetsAgainstChapterRegistry(verified, input.chapterAssets);
		return verified;
	});

	const projectedAssetIntents: MaterializedClipAssetIntent[] = collected.assetIntents.map((intent) => ({
		...intent,
		effectAssetId: materializationEffectAssetId(intent),
	}));
	const effectIds = projectedAssetIntents.map((intent) => intent.effectAssetId);
	if (new Set(effectIds).size !== effectIds.length) {
		throw new Error("clip-production asset effect identities must be unique");
	}
	const sourceLineageByClipId = new Map(sourceSegmentCollection.items.map((item) => [item.itemId, item.lineage]));
	const clipParentLineage = clips.map((clip) => {
		const lineage = sourceLineageByClipId.get(clip.clipId);
		if (!lineage) throw new Error(`source lineage is missing for Clip ${clip.clipId}`);
		return lineage;
	});
	const assetParentLineage = projectedAssetIntents.map((intent) => intent.consumerClipIds.flatMap((clipId) => {
		const lineage = sourceLineageByClipId.get(clipId);
		if (!lineage) throw new Error(`source lineage is missing for asset consumer Clip ${clipId}`);
		return lineage;
	}));

	return {
		collected: { ...collected, clips },
		clipProductionCollection: createWorkflowCollection({
			collectionId: `${executionId}:${nodeId}:clip-production`,
			producerNodeId: nodeId,
			producerPortId: "clip-production",
			values: clips,
			itemIds: clips.map((clip) => clip.clipId),
			parentLineage: clipParentLineage,
		}),
		assetIntentCollection: createWorkflowCollection({
			collectionId: `${executionId}:${nodeId}:asset-intents`,
			producerNodeId: nodeId,
			producerPortId: "asset-intents",
			values: projectedAssetIntents,
			itemIds: effectIds,
			parentLineage: assetParentLineage,
		}),
	};
}

/** Project deduplicated Agent asset intents into explicit paid image-runner items. */
export function projectClipProductionAssetItems(input: Readonly<{
	executionId: string;
	nodeId: string;
	assetIntentCollection: unknown;
}>): WorkflowCollectionV1<ClipProductionAssetPlanItem> {
	const executionId = requiredCanonicalText(input.executionId, "executionId");
	const nodeId = requiredCanonicalText(input.nodeId, "nodeId");
	if (!isWorkflowCollection(input.assetIntentCollection)) {
		throw new Error("Clip asset projection requires the deduplicated asset-intents WorkflowCollection");
	}
	const collection = input.assetIntentCollection as WorkflowCollectionV1<MaterializedClipAssetIntent>;
	const items = collection.items.map((item, index): ClipProductionAssetPlanItem => {
		const intent = item.value;
		if (!intent || typeof intent.assetId !== "string" || typeof intent.state !== "string"
			|| typeof intent.effectAssetId !== "string" || typeof intent.registryObjectId !== "string"
			|| typeof intent.displayName !== "string" || typeof intent.referenceType !== "string"
			|| !Array.isArray(intent.referenceAssetBindings) || !isRecord(intent.imageSource)) {
			throw new Error(`asset-intents[${index}] is missing its canonical source or semantic identity`);
		}
		if (intent.imageSource.mode === "generate") {
			const fields = ["prompt", "negativePrompt", "modelKey", "aspectRatio", "size"] as const;
			for (const field of fields) requiredCanonicalText(intent.imageSource.generationSpec[field], `asset-intents[${index}].imageSource.generationSpec.${field}`);
		} else if (intent.imageSource.mode !== "reuse") {
			throw new Error(`asset-intents[${index}] has unsupported image source mode`);
		}
		if (!Array.isArray(intent.consumerClipIds) || intent.consumerClipIds.length === 0
			|| intent.consumerClipIds.some((clipId) => typeof clipId !== "string" || !clipId.trim())) {
			throw new Error(`asset-intents[${index}] must declare at least one Clip consumer`);
		}
		return {
			protocolVersion: "tapcanvas.clip-production-asset-item/v1",
			assetId: intent.effectAssetId,
			effectAssetId: intent.effectAssetId,
			canonicalAssetId: intent.assetId,
			state: intent.state,
			registryObjectId: intent.registryObjectId,
			displayName: intent.displayName,
			referenceType: intent.referenceType,
			referenceAssetBindings: intent.referenceAssetBindings,
			imageSource: intent.imageSource,
			...(intent.canonicalName ? { canonicalName: intent.canonicalName } : {}),
			...(intent.roleName ? { roleName: intent.roleName } : {}),
			...(intent.physicalIdentityKey ? { physicalIdentityKey: intent.physicalIdentityKey } : {}),
			...(intent.assetReuseKey ? { assetReuseKey: intent.assetReuseKey } : {}),
			...(intent.characterAssetRole ? { characterAssetRole: intent.characterAssetRole } : {}),
			...(intent.characterProfileVersion ? { characterProfileVersion: intent.characterProfileVersion } : {}),
			...(intent.identityBoardSpec ? { identityBoardSpec: intent.identityBoardSpec } : {}),
			...(intent.identityAnchors ? { identityAnchors: intent.identityAnchors } : {}),
			...(intent.prohibitedDrift ? { prohibitedDrift: intent.prohibitedDrift } : {}),
			...(intent.sceneCard ? { sceneCard: intent.sceneCard } : {}),
			...(intent.sceneName ? { sceneName: intent.sceneName } : {}),
			...(intent.propName ? { propName: intent.propName } : {}),
			...(intent.assetPurpose ? { assetPurpose: intent.assetPurpose } : {}),
			generationSpecVersion: intent.imageSource.mode === "generate"
				? intent.imageSource.generationSpecVersion : "project-asset-reuse/v1",
			...(intent.imageSource.mode === "generate" ? {
				generationSpec: intent.imageSource.generationSpec,
				prompt: intent.imageSource.generationSpec.prompt,
				negativePrompt: intent.imageSource.generationSpec.negativePrompt,
				modelKey: intent.imageSource.generationSpec.modelKey,
				aspectRatio: intent.imageSource.generationSpec.aspectRatio,
				size: intent.imageSource.generationSpec.size,
			} : {
				existingAssetId: intent.imageSource.existingAssetId,
				existingProjectId: intent.imageSource.existingProjectId,
			}),
			consumerClipIds: [...intent.consumerClipIds],
		};
	});
	return createWorkflowCollection({
		collectionId: `${executionId}:${nodeId}:asset-items`,
		producerNodeId: nodeId,
		producerPortId: "asset-items",
		itemIds: items.map((value) => value.effectAssetId),
		values: items,
		parentLineage: items.map((_, index) => collection.items[index]?.lineage ?? []),
	});
}
