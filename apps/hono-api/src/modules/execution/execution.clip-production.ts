import { createWorkflowCollection, isWorkflowCollection, type WorkflowCollectionV1 } from "@tapcanvas/workflow-kernel-protocol";
import {
	canonicalClipProductionJson,
	collectClipProductionPackets as collectPackets,
	CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION,
	clipProductionPacketSchema,
	validateClipProductionPacket,
	validateClipProductionAssetIntent,
	type ClipProductionJsonValue,
	type ClipProductionAssetIntent,
	type ClipProductionAssetIdentity,
	type ClipProductionPacket,
	type ClipProductionSourceRange,
	type ClipProductionSpeechEvent,
	type CollectedClipProductionPackets,
} from "../../../../../packages/schemas/clip-production-packet/index.mjs";
import { clipProductionTimelineDraftSchema, compileClipProductionTimeline } from "../../../../../packages/schemas/clip-production-packet/timeline.mjs";
import { assetFactIdentity } from "./execution.asset-identity";
import type { ClipSourceSegment } from "./execution.clip-segmentation";
import type { WorkflowAgentJsonObjectContract } from "./execution.agent-output-contract";
import { chapterAssetRegistry, chapterBackgroundPlanIds, chapterBackgroundPlanNames, verifyClipAssetsAgainstChapterRegistry, type RegistryObject } from "./execution.clip-production-registry";
import { clipStagingPlan, readClipStaging } from "./execution.chapter-staging";
import { bindClipTimelineFacts, clipTimelineSegments, clipSegmentPresence } from "./execution.clip-timeline-contract";
import { CHARACTER_IDENTITY_BOARD_SPEC } from "./execution.character-identity-contract";
export { clipTimelineSegments, clipSegmentPresence, type ClipSegmentPresence } from "./execution.clip-timeline-contract";

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

/** Return only media input modes explicitly supported by the frozen model contract. */
export function resolveClipProductionInputModesFromDeliveryContract(
	deliveryContractValue: unknown,
): readonly VideoClipProductionInputMode[] {
	if (!isRecord(deliveryContractValue) || !isRecord(deliveryContractValue.generationContract)) {
		throw new Error("Clip production requires a frozen model generation contract");
	}
	const generationContract = deliveryContractValue.generationContract;
	return VIDEO_CLIP_PRODUCTION_WORKFLOW_INPUT_MODES.filter((mode) => {
		if (mode === "image_to_video") return generationContract.supportsFirstLastFrame === true;
		if (mode === "reference_to_video") return generationContract.supportsReferenceImages === true;
		return generationContract.supportsTextToVideo === true;
	});
}

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

/**
 * Every Clip writer needs the frozen registry's identities to pick objects and
 * describe them consistently, but not the image generation plans the host
 * projects verbatim. Rendering the identities here spares each writer paging
 * through the whole chapter asset plan (two extra provider turns per Clip).
 */
function registryCatalogDescription(registry: ReadonlyMap<string, RegistryObject>): string {
	const lines = [...registry.values()].map((entry) => {
		const assetIds = Array.isArray(entry.imageSource.assetIds) ? entry.imageSource.assetIds.length : 0;
		const source = entry.imageSource.mode === "reuse"
			? `复用已有图 ${assetIds} 张（registryAssetIndex 0～${Math.max(assetIds - 1, 0)}）`
			: "宿主生成新图";
		return `${entry.objectId}=${entry.name}（${entry.kind}${entry.referenceRole ? `/${entry.referenceRole}` : ""}，${source}）${entry.identityInvariant ? `：${entry.identityInvariant}` : ""}`;
	});
	return `Frozen chapter objects; choose by identity, the host projects their images and prompts:\n${lines.join("\n")}`;
}

/**
 * The host, not the author, decides how the draft is rendered into the
 * provider prompt, so the contract states that rendering exactly. How to write
 * the scene and each segment is method, and belongs to the loaded Skills.
 */
function describeHostTimelineRendering(videoPrompt: Record<string, unknown>): void {
	const properties = videoPrompt.properties;
	if (!isRecord(properties)) return;
	videoPrompt.description = "Author ordered descriptive shots. The host renders scene once as the initial 【scene】 heading; write optional shot.sceneTitle only at an authored new or returning scene to insert 【sceneTitle】 before that shot. Numbered 镜头 rows combine action, camera, on-set sound and complete spoken lines with Chinese quotes, the real speaker, local voice category and delivery. The host never infers scene changes from prose. The video model adapts timing within the provider request; do not assign per-shot seconds or fill fixed time slots. Each frozen spoken line is inserted once through its explicit speechEventId; cuts do not fragment or duplicate it. Do not copy or paraphrase dialogue in shot fields. The provider body contains only the authored scene and shot audiovisual fields, each exact spoken line with its local voice category and delivery, the declared style and usable image reference legend. Source IDs, provenance, staging ledgers and internal review/planning facts remain metadata, never provider prose.";
	if (isRecord(properties.scene)) {
		properties.scene = {
			...properties.scene,
			description: "Initial scene heading and stable facts rendered once as 【scene】; use optional shot.sceneTitle for an authored new or returning scene, without duplicating the initial heading.",
		};
	}
}

/** Bind machine-owned Clip identity and source coverage into the Agent's repairable output contract. */
export function bindClipProductionPacketAuthoringContract(
	contract: WorkflowAgentJsonObjectContract,
	sourceSegmentValue: unknown,
	allowedVideoInputModes: readonly VideoClipProductionInputMode[],
	frozenImageModelKey?: string,
	frozenImageAspectRatio?: string,
	frozenImageSize?: string,
	chapterAssets?: unknown,
	projectId?: string,
	clipSequence?: unknown,
): WorkflowAgentJsonObjectContract {
	const segment = readSourceSegment(sourceSegmentValue, "clip-segment");
	if (clipSequence !== undefined) {
		if (!isRecord(clipSequence) || clipSequence.protocolVersion !== "tapcanvas.chapter-sequence-clip/v2"
			|| clipSequence.clipId !== segment.clipId || clipSequence.clipIndex !== segment.clipIndex
			|| clipSequence.durationSeconds !== segment.durationSeconds || !Array.isArray(clipSequence.speechEvents)) {
			throw new Error(`clip-sequence must match frozen source segment ${segment.clipId}`);
		}
	}
	const schema = structuredClone(clipProductionPacketSchema) as Record<string, unknown>;
	const properties = schema.properties as Record<string, unknown>;
	properties.videoPrompt = structuredClone(clipProductionTimelineDraftSchema);
	describeHostTimelineRendering(properties.videoPrompt as Record<string, unknown>);
	if (clipSequence !== undefined) {
		bindClipTimelineFacts(properties.videoPrompt as Record<string, unknown>, clipSequence as Record<string, unknown>);
	}
	// The speech track is host-bound from the already frozen clip-sequence after
	// authoring. Do not ask the packet writer to copy it into its audiovisual prose
	// or structured packet response.
	delete properties.speechEvents;
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
			registryObjectId: { type: "string", enum: [...registry.keys()], description: registryCatalogDescription(registry) },
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
		const backgroundNames = chapterBackgroundPlanNames(chapterAssets);
		blockingProperties.backgroundObjectId = { type: "string", enum: backgroundIds,
			description: `Exact stable objectId from frozen chapter-assets.backgroundPlans: ${backgroundIds
				.map((id) => `${id}=${backgroundNames.get(id) || id}`).join("；")}.` };
		delete properties.firstFrameAsset;
		delete properties.referenceAssets;
		properties.firstFrameAssetIndex = { oneOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
			description: "Zero-based index in this packet's assetIntents, or null when there is no first frame." };
		properties.referenceAssetIndices = { type: "array", items: { type: "integer", minimum: 0 }, uniqueItems: true,
			description: "Zero-based indices in this packet's assetIntents, in the exact author-selected reference order. The host does not add omitted character or scene references." };
		if (!frozenImageModelKey || !frozenImageAspectRatio || !frozenImageSize) {
			throw new Error("Clip production draft requires frozen image model, aspect ratio and size");
		}
		properties.imageModelKey = { type: "string", const: frozenImageModelKey };
		properties.imageAspectRatio = { type: "string", const: frozenImageAspectRatio };
		properties.imageSize = { type: "string", const: frozenImageSize };
		// Reference indices are authored selections; referenced identities must resolve declared intents.
		schema.required = (schema.required as string[]).filter((field) => field !== "referenceAssets").map((field) =>
			field === "firstFrameAsset" ? "firstFrameAssetIndex" : field)
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
	// Only image_to_video takes a first frame. Offering a first frame while no
	// allowed mode accepts one invited a choice the packet validator then
	// rejected, costing most Clips a repair round, so the dependency is the schema.
	const firstFrameField = chapterAssets === undefined ? "firstFrameAsset" : "firstFrameAssetIndex";
	const referenceField = chapterAssets === undefined ? "referenceAssets" : "referenceAssetIndices";
	properties[firstFrameField] = allowedVideoInputModes.includes("image_to_video")
		? { ...(properties[firstFrameField] as Record<string, unknown>),
			description: `${chapterAssets === undefined ? "" : "Zero-based index in this packet's assetIntents. "}image_to_video requires it and also lists it in ${referenceField}; reference_to_video and text_to_video require null.` }
		: { type: "null",
			description: `Always null: no allowed videoInputMode (${[...new Set(allowedVideoInputModes)].join(", ")}) takes a first frame; reference images go in ${referenceField}.` };
	// The source ranges are the frozen segment's own provenance: the author has no
	// choice to make there. Requiring an exact echo of a long offset/fingerprint
	// list only produced copy errors and repair rounds, so the host binds it.
	properties.sourceRanges = {
		type: "array",
		description: "Host-owned frozen provenance of this Clip. Omit it; the host binds the exact frozen source ranges after authoring.",
	};
	schema.required = (schema.required as string[]).filter((field) => field !== "sourceRanges");
	// Positions come from the chapter's staging ledger. Writers who each placed
	// people on their own seated the same cast differently from Clip to Clip.
	const hostStaging = clipSequence !== undefined && readClipStaging(clipSequence) !== null;
	if (hostStaging) {
		properties.blockingPlan = {
			type: "object",
			description: "Host-owned staging. Omit it: the host binds this Clip's floor plan, positions and moves from the frozen chapter staging ledger and renders the 站位图 from it.",
		};
		schema.required = (schema.required as string[]).filter((field) => field !== "blockingPlan");
	}
	return {
		...contract,
		jsonSchema: schema,
		contractName: "tapcanvas.clip-production-packet",
		contractVersion: "1",
		requiredStringFields: ["protocolVersion", "clipId"],
		exactStringFields: {
			...contract.exactStringFields,
			protocolVersion: CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION,
			clipId: segment.clipId,
		},
		requiredNumberFields: ["clipIndex", "durationSeconds"],
		requiredObjectFields: ["clipFacts", "videoPrompt"],
		requiredArrayFields: ["assetIntents"],
		...(contract.expectedArrayLengths ? { expectedArrayLengths: contract.expectedArrayLengths } : {}),
		allowedFields: [
			"protocolVersion", "clipId", "clipIndex", "durationSeconds", "videoInputMode",
			...(chapterAssets === undefined ? ["firstFrameAsset", "referenceAssets"] : ["firstFrameAssetIndex", "referenceAssetIndices"]), "sourceRanges",
			"videoPrompt", "blockingPlan", "clipFacts", "assetIntents",
			...(chapterAssets === undefined ? [] : ["imageModelKey", "imageAspectRatio", "imageSize"]),
		],
	};
}

/**
 * Expand one frozen chapter registry object into its exact shared asset intent.
 * Clip writers and the chapter asset preview stage both use this projection, so
 * the same object always yields the same effect identity and generation contract.
 */
export function chapterObjectAssetIntent(input: Readonly<{
	entry: RegistryObject;
	source: Readonly<Record<string, unknown>>;
	projectId: string;
	imageModelKey: string;
	imageAspectRatio: string;
	imageSize: string;
	label: string;
}>): Record<string, unknown> {
	const { entry, source, projectId, imageModelKey, imageAspectRatio, imageSize, label } = input;
	const objectId = entry.objectId;
	if (source.mode !== entry.imageSource.mode) {
		throw new Error(`${label} source mode differs from frozen chapter object`);
	}
	let identitySuffix: string;
	let imageSource: Record<string, unknown>;
	let plan: Record<string, unknown> | null = null;
	let referenceAssetBindings: unknown[] = [];
	if (source.mode === "reuse") {
		if (!Array.isArray(entry.imageSource.assetIds)) {
			throw new Error(`${label} has no frozen reusable assets`);
		}
		const assetIndex = source.registryAssetIndex;
		if (typeof assetIndex !== "number" || !Number.isSafeInteger(assetIndex) || assetIndex < 0) {
			throw new Error(`${label} requires an exact registryAssetIndex`);
		}
		const assetId = entry.imageSource.assetIds[assetIndex];
		if (typeof assetId !== "string" || !assetId.trim()) {
			throw new Error(`${label} registryAssetIndex is outside the frozen selection`);
		}
		identitySuffix = `reuse:${assetIndex}`;
		imageSource = { mode: "reuse", existingAssetId: assetId, existingProjectId: projectId };
	} else if (source.mode === "generate") {
		plan = isRecord(entry.imageSource.plan) ? entry.imageSource.plan : null;
		if (!plan) throw new Error(`${label} has no frozen generation plan`);
		const sceneCard = isRecord(plan.sceneCard) ? plan.sceneCard : null;
		const prompt = entry.kind === "scene" ? sceneCard?.spacePrompt : plan.prompt;
		const negativePrompt = entry.kind === "scene" ? sceneCard?.negativePrompt : plan.negativePrompt;
		if (typeof prompt !== "string" || !prompt.trim() || typeof negativePrompt !== "string" || !negativePrompt.trim()) {
			throw new Error(`${label} frozen generation plan lacks image prompt fields`);
		}
		if (!Array.isArray(entry.imageSource.referenceAssetBindings)) {
			throw new Error(`${label} frozen generation references are invalid`);
		}
		referenceAssetBindings = entry.imageSource.referenceAssetBindings;
		identitySuffix = "generate";
		imageSource = { mode: "generate", generationSpecVersion: "chapter-object-plan/v1",
			generationSpec: { prompt, negativePrompt, modelKey: imageModelKey, aspectRatio: imageAspectRatio, size: imageSize } };
	} else {
		throw new Error(`${label} has an unsupported image source mode`);
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
		...(plan && entry.kind === "character" ? { identityBoardSpec: CHARACTER_IDENTITY_BOARD_SPEC } : {}),
		...(plan && isRecord(plan.sceneCard) ? { sceneCard: plan.sceneCard } : {}),
	};
}

/** Expand the compact author selection from the frozen chapter registry before packet validation. */
/**
 * Bind the frozen segment's source ranges onto an authored packet. They are
 * host-owned provenance, so an author echo is never needed; one that differs is
 * reported and replaced by the frozen value instead of sending the author back.
 */
export function bindFrozenClipSourceRanges(packetValue: unknown, sourceSegmentValue: unknown): unknown {
	if (!isRecord(packetValue)) return packetValue;
	const segment = readSourceSegment(sourceSegmentValue, "clip-segment");
	const sourceRanges = sourceRangesFromSegment(segment);
	if (packetValue.sourceRanges !== undefined
		&& (!Array.isArray(packetValue.sourceRanges)
			|| canonicalSourceRanges(packetValue.sourceRanges as readonly ClipProductionSourceRange[]) !== canonicalSourceRanges(sourceRanges))) {
		console.info(JSON.stringify({ message: "clip_production_source_ranges_echo_replaced", clipId: segment.clipId }));
	}
	return { ...packetValue, sourceRanges };
}

export function materializeClipProductionDraft(
	packetValue: unknown,
	chapterAssets: unknown,
	projectId: string,
	clipSequence?: unknown,
): unknown {
	if (!isRecord(packetValue) || !Array.isArray(packetValue.assetIntents)) {
		throw new Error("Clip production draft requires assetIntents");
	}
	const speechEvents = bindClipProductionSpeechEvents(packetValue, clipSequence);
	const videoPrompt = compileClipProductionTimeline({
		draft: packetValue.videoPrompt,
		storyEvents: isRecord(clipSequence) ? clipSequence.storyEvents : [],
		speechEvents: speechEvents ?? [],
	});
	// The chapter staging ledger owns positions; an authored blockingPlan echo is replaced.
	const stagingPlan = clipSequence === undefined ? null : clipStagingPlan(clipSequence);
	if (chapterAssets === undefined) {
		const { videoPrompt: _videoPrompt, speechEvents: _speechEvents, ...packet } = packetValue;
		return { ...packet, videoPrompt, ...(speechEvents === undefined ? {} : { speechEvents }),
			...(stagingPlan ? { blockingPlan: stagingPlan } : {}) };
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
		return chapterObjectAssetIntent({ entry, source: value.imageSource, projectId,
			imageModelKey, imageAspectRatio, imageSize, label: `Clip production draft assetIntents[${index}]` });
	});
	// Preserve the author-selected reference order; asset intents do not imply video visibility.
	const authoredReferenceIndices = Array.isArray(packetValue.referenceAssetIndices) ? packetValue.referenceAssetIndices : [];
	const referenceIndices = authoredReferenceIndices;
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
	if (!stagingPlan && packetValue.blockingPlan !== undefined) {
		if (!isRecord(packetValue.blockingPlan)) throw new Error("Clip production draft blockingPlan must be an object when provided");
		const backgroundIds = chapterBackgroundPlanIds(chapterAssets);
		const backgroundObjectId = packetValue.blockingPlan.backgroundObjectId;
		if (typeof backgroundObjectId !== "string" || !backgroundIds.includes(backgroundObjectId)) {
			throw new Error("backgroundObjectId is not in frozen chapter plans");
		}
	}
	const { videoPrompt: _videoPrompt, speechEvents: _speechEvents,
		firstFrameAssetIndex: _firstFrameAssetIndex, referenceAssetIndices: _referenceAssetIndices,
		imageModelKey: _imageModelKey, imageAspectRatio: _imageAspectRatio, imageSize: _imageSize, ...packet } = packetValue;
	return { ...packet, videoPrompt, ...(speechEvents === undefined ? {} : { speechEvents }), assetIntents, firstFrameAsset, referenceAssets,
		...(stagingPlan || packetValue.blockingPlan ? { blockingPlan: stagingPlan ?? packetValue.blockingPlan } : {}) };
}

/** Bind the exact projected chapter-sequence speech track after creative packet authoring. */
function bindClipProductionSpeechEvents(
	packetValue: Record<string, unknown>,
	clipSequence: unknown,
): readonly ClipProductionSpeechEvent[] | undefined {
	if (clipSequence === undefined) return undefined;
	if (!isRecord(clipSequence) || clipSequence.protocolVersion !== "tapcanvas.chapter-sequence-clip/v2"
		|| clipSequence.clipId !== packetValue.clipId || clipSequence.clipIndex !== packetValue.clipIndex
		|| clipSequence.durationSeconds !== packetValue.durationSeconds || !Array.isArray(clipSequence.speechEvents)) {
		throw new Error("Clip production speech binding requires the matching frozen chapter-sequence clip");
	}
	return structuredClone(clipSequence.speechEvents) as readonly ClipProductionSpeechEvent[];
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

/** Map one materialized asset intent to its explicit paid image-runner item. */
function clipProductionAssetPlanItem(intent: MaterializedClipAssetIntent, label: string): ClipProductionAssetPlanItem {
	if (!intent || typeof intent.assetId !== "string" || typeof intent.state !== "string"
		|| typeof intent.effectAssetId !== "string" || typeof intent.registryObjectId !== "string"
		|| typeof intent.displayName !== "string" || typeof intent.referenceType !== "string"
		|| !Array.isArray(intent.referenceAssetBindings) || !isRecord(intent.imageSource)) {
		throw new Error(`${label} is missing its canonical source or semantic identity`);
	}
	if (intent.imageSource.mode === "generate") {
		const fields = ["prompt", "negativePrompt", "modelKey", "aspectRatio", "size"] as const;
		for (const field of fields) requiredCanonicalText(intent.imageSource.generationSpec[field], `${label}.imageSource.generationSpec.${field}`);
	} else if (intent.imageSource.mode !== "reuse") {
		throw new Error(`${label} has unsupported image source mode`);
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
		if (!intent || !Array.isArray(intent.consumerClipIds) || intent.consumerClipIds.length === 0
			|| intent.consumerClipIds.some((clipId) => typeof clipId !== "string" || !clipId.trim())) {
			throw new Error(`asset-intents[${index}] must declare at least one Clip consumer`);
		}
		return clipProductionAssetPlanItem(intent, `asset-intents[${index}]`);
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

/**
 * Project every frozen chapter object that needs generation into the exact
 * paid image items Clip writers will later request. Running these right after
 * the chapter asset plan puts identity cards on the canvas before per-Clip
 * authoring finishes; Clip pipelines then claim the same effect identities
 * instead of submitting again. Reuse objects already exist and are skipped.
 */
export function projectChapterAssetPreviewItems(input: Readonly<{
	executionId: string;
	nodeId: string;
	chapterAssets: unknown;
	projectId: string;
	imageModelKey: string;
	imageAspectRatio: string;
	imageSize: string;
}>): WorkflowCollectionV1<ClipProductionAssetPlanItem> {
	const executionId = requiredCanonicalText(input.executionId, "executionId");
	const nodeId = requiredCanonicalText(input.nodeId, "nodeId");
	if (!input.projectId.trim()) throw new Error("Chapter asset preview requires the frozen caller project ID");
	const imageModelKey = requiredCanonicalText(input.imageModelKey, "imageModelKey");
	const imageAspectRatio = requiredCanonicalText(input.imageAspectRatio, "imageAspectRatio");
	const imageSize = requiredCanonicalText(input.imageSize, "imageSize");
	const items = [...chapterAssetRegistry(input.chapterAssets).values()]
		.filter((entry) => entry.imageSource.mode === "generate")
		.map((entry): ClipProductionAssetPlanItem => {
			const label = `chapter-assets.objectRegistry[${entry.objectId}]`;
			const intent = validateClipProductionAssetIntent(chapterObjectAssetIntent({ entry, source: { mode: "generate" },
				projectId: input.projectId, imageModelKey, imageAspectRatio, imageSize, label }));
			return clipProductionAssetPlanItem({ ...intent, consumerClipIds: [],
				effectAssetId: materializationEffectAssetId(intent) }, label);
		})
		.sort((left, right) => left.canonicalAssetId.localeCompare(right.canonicalAssetId));
	return createWorkflowCollection({
		collectionId: `${executionId}:${nodeId}:chapter-asset-preview-items`,
		producerNodeId: nodeId,
		producerPortId: "asset-items",
		values: items,
		itemIds: items.map((item) => item.effectAssetId),
	});
}
