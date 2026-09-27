import { isWorkflowCollection, type WorkflowCollectionV1 } from "@tapcanvas/workflow-kernel-protocol";
import {
	canonicalClipProductionJson,
	CLIP_PRODUCTION_PACKET_COLLECTION_ARTIFACT_TYPE,
	type ClipProductionJsonValue,
	type ClipProductionAssetIdentity,
	type ClipProductionAssetIntent,
	type ClipProductionPacket,
} from "../../../../../packages/schemas/clip-production-packet/index.mjs";
import {
	VIDEO_CLIP_PRODUCTION_WORKFLOW_INPUT_MODES,
	type ClipProductionMaterializedImageReference,
	type VideoClipProductionInputMode,
} from "./execution.clip-production";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
	return value;
}

function identityKey(identity: ClipProductionAssetIdentity): string {
	return JSON.stringify([identity.assetId, identity.state]);
}

function persistentHttpUrl(value: unknown, field: string): string {
	const url = requiredString(value, field);
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("unsupported protocol");
	} catch {
		throw new Error(`${field} must be a persistent HTTP(S) URL`);
	}
	return url;
}

function readPacket(value: unknown, field: string): ClipProductionPacket {
	if (!isRecord(value)
		|| value.protocolVersion !== "tapcanvas.clip-production-packet/v1"
		|| typeof value.clipId !== "string"
		|| typeof value.videoPrompt !== "string"
		|| !Array.isArray(value.assetIntents)
		|| !Array.isArray(value.referenceAssets)) {
		throw new Error(`${field} must be one validated Clip production packet`);
	}
	return value as unknown as ClipProductionPacket;
}

function readMaterializedReference(value: unknown, field: string): ClipProductionMaterializedImageReference {
	if (!isRecord(value) || !isRecord(value.assetPlan)) throw new Error(`${field} must contain an assetPlan`);
	const plan = value.assetPlan;
	const sourceAssetId = requiredString(plan.canonicalAssetId, `${field}.assetPlan.canonicalAssetId`);
	const state = requiredString(plan.state, `${field}.assetPlan.state`);
	const effectAssetId = requiredString(plan.effectAssetId, `${field}.assetPlan.effectAssetId`);
	if (requiredString(plan.assetId, `${field}.assetPlan.assetId`) !== effectAssetId) {
		throw new Error(`${field}.assetPlan.assetId must equal its effectAssetId`);
	}
	const imageUrl = persistentHttpUrl(value.imageUrl, `${field}.imageUrl`);
	const nodeId = requiredString(value.nodeId, `${field}.nodeId`);
	const generatedAssetId = typeof value.generatedAssetId === "string" && value.generatedAssetId.trim()
		? value.generatedAssetId.trim()
		: null;
	return { assetId: sourceAssetId, state, effectAssetId, imageUrl, nodeId, generatedAssetId };
}

/**
 * Deterministically projects exact per-Clip prompts and materialized generated-image URLs
 * into the existing video prompt-package contract. It never parses creative prose.
 */
export function projectClipProductionPromptPackage(input: Readonly<{
	executionId: string;
	workflowKey: string | null;
	clipProductionCollection: unknown;
	assetBindings: unknown;
	deliveryContract: unknown;
}>): Readonly<Record<string, unknown>> {
	if (!isWorkflowCollection(input.clipProductionCollection)) {
		throw new Error("Clip production projection requires the completed clip-production collection");
	}
	if (!isWorkflowCollection(input.assetBindings)) {
		throw new Error("Clip production projection requires the completed generated asset-bindings collection");
	}
	if (!isRecord(input.deliveryContract) || input.deliveryContract.protocolVersion !== "2") {
		throw new Error("Clip production projection requires the frozen delivery-contract/v2");
	}
	const workflowKey = requiredString(input.workflowKey, "workflowKey");
	const contractWorkflowKey = requiredString(input.deliveryContract.workflowKey, "deliveryContract.workflowKey");
	if (workflowKey !== contractWorkflowKey) {
		throw new Error("Clip production workflowKey must match the frozen delivery contract");
	}
	const clipCollection = input.clipProductionCollection as WorkflowCollectionV1<ClipProductionPacket>;
	const assetBindingCollection = input.assetBindings as WorkflowCollectionV1<unknown>;
	if (clipCollection.items.length === 0 || clipCollection.items.length > 80) {
		throw new Error("Clip production collection must contain 1..80 items");
	}
	const intentsByIdentity = new Map<string, ClipProductionAssetIntent>();
	const clips = clipCollection.items.map((item, index) => {
		const packet = readPacket(item.value, `clip-production[${index}]`);
		if (packet.clipId !== item.itemId || !Number.isSafeInteger(packet.clipIndex) || packet.clipIndex < 0
			|| (index > 0 && packet.clipIndex <= readPacket(clipCollection.items[index - 1]!.value, "previous clip").clipIndex)) {
			throw new Error(`clip-production[${index}] identity must match its item and frozen clip indices must increase`);
		}
		if (!VIDEO_CLIP_PRODUCTION_WORKFLOW_INPUT_MODES.includes(packet.videoInputMode as VideoClipProductionInputMode)) {
			throw new Error(`Clip ${packet.clipId} videoInputMode ${packet.videoInputMode} is not allowed in one-click production`);
		}
		for (const intent of packet.assetIntents) {
			const key = identityKey(intent);
			const existing = intentsByIdentity.get(key);
			if (existing && canonicalClipProductionJson({
				registryObjectId: existing.registryObjectId,
				displayName: existing.displayName,
				referenceType: existing.referenceType,
				referenceAssetBindings: existing.referenceAssetBindings,
				imageSource: existing.imageSource,
			}) !== canonicalClipProductionJson({
				registryObjectId: intent.registryObjectId,
				displayName: intent.displayName,
				referenceType: intent.referenceType,
				referenceAssetBindings: intent.referenceAssetBindings,
				imageSource: intent.imageSource,
			})) {
				throw new Error(`Clip ${packet.clipId} has conflicting source or semantic identity for asset ${key}`);
			}
			intentsByIdentity.set(key, intent);
		}
		return packet;
	});

	const referencesByIdentity = new Map<string, ClipProductionMaterializedImageReference>();
	const referencesByEffectId = new Map<string, ClipProductionMaterializedImageReference>();
	for (const [index, item] of assetBindingCollection.items.entries()) {
		const reference = readMaterializedReference(item.value, `asset-bindings[${index}]`);
		const key = identityKey(reference);
		const intent = intentsByIdentity.get(key);
		if (!intent) throw new Error(`Generated image binding ${key} is not declared by any Clip packet`);
		if (reference.effectAssetId !== item.itemId) throw new Error(`Generated image binding ${key} item identity differs from effectAssetId`);
		const plan = (item.value as Record<string, unknown>).assetPlan as Record<string, unknown>;
		if (canonicalClipProductionJson(plan.imageSource as ClipProductionJsonValue)
			!== canonicalClipProductionJson(intent.imageSource as ClipProductionJsonValue)) {
			throw new Error(`Image binding ${key} source differs from the Clip packet`);
		}
		if (referencesByIdentity.has(key) || referencesByEffectId.has(reference.effectAssetId)) {
			throw new Error(`Generated image binding ${key} is duplicated`);
		}
		referencesByIdentity.set(key, reference);
		referencesByEffectId.set(reference.effectAssetId, reference);
	}
	if (referencesByIdentity.size !== intentsByIdentity.size) {
		const missing = [...intentsByIdentity.keys()].filter((key) => !referencesByIdentity.has(key));
		throw new Error(`Clip production is missing generated image URL bindings for ${missing.join(",")}`);
	}

	const promptClips = clips.map((packet, index) => {
		const imageReferences = packet.referenceAssets.map((identity) => {
			const reference = referencesByIdentity.get(identityKey(identity));
			if (!reference) throw new Error(`Clip ${packet.clipId} requires missing generated image URL for ${identityKey(identity)}`);
			return reference;
		});
		if (packet.videoInputMode !== "text_to_video" && imageReferences.length === 0) {
			throw new Error(`Clip ${packet.clipId} requires at least one generated image reference`);
		}
		const firstFrame = packet.firstFrameAsset
			? referencesByIdentity.get(identityKey(packet.firstFrameAsset)) ?? null
			: null;
		if (packet.videoInputMode === "image_to_video" && !firstFrame) {
			throw new Error(`Clip ${packet.clipId} image_to_video requires a materialized first-frame URL`);
		}
		if (packet.videoInputMode === "reference_to_video" && packet.firstFrameAsset !== null) {
			throw new Error(`Clip ${packet.clipId} reference_to_video must not declare a first-frame asset`);
		}
		if (packet.videoInputMode === "text_to_video" && (firstFrame || imageReferences.length > 0)) {
			throw new Error(`Clip ${packet.clipId} text_to_video cannot declare image inputs`);
		}
		const prompt = packet.videoPrompt;
		const effectAssetIds = imageReferences.map((reference) => reference.effectAssetId);
		return {
			itemId: packet.clipId,
			index,
			clipIndex: packet.clipIndex,
			prompt,
			durationSeconds: packet.durationSeconds,
			videoInputMode: packet.videoInputMode,
			firstFrameAsset: packet.firstFrameAsset,
			firstFrameEffectAssetId: firstFrame?.effectAssetId ?? null,
			...(firstFrame ? { firstFrameUrl: firstFrame.imageUrl } : {}),
			referenceAssets: packet.referenceAssets,
			referenceImageNodeIds: imageReferences.map((reference) => reference.nodeId),
			referenceAssetIds: imageReferences.flatMap((reference) => reference.generatedAssetId ? [reference.generatedAssetId] : []),
			imageReferences,
			declaredAssetIds: effectAssetIds,
			assetBindings: [],
			structuredClip: null,
			clipFacts: packet.clipFacts,
			sourceRanges: packet.sourceRanges,
			authoringEvidence: { sourceDialogueLineIds: [], spokenLineIds: [] },
			promptMetrics: {
				writerEnvelopeCharacters: Array.from(prompt).length,
				providerPromptCharacters: Array.from(prompt).length,
				providerToEnvelopeRatio: 1,
			},
			lineage: clipCollection.items[index]?.lineage ?? [],
		};
	});
	const promptCharacters = promptClips.reduce((total, clip) => total + clip.promptMetrics.providerPromptCharacters, 0);
	const totalDurationSeconds = promptClips.reduce((total, clip) => total + clip.durationSeconds, 0);
	return {
		protocolVersion: "2",
		artifactType: "tapcanvas.prompt-package/v2",
		authoringProtocol: CLIP_PRODUCTION_PACKET_COLLECTION_ARTIFACT_TYPE,
		executionId: requiredString(input.executionId, "executionId"),
		workflowKey,
		clips: promptClips,
		deliveryEvidence: {
			version: 2,
			source: "workflow_prompt_package",
			clipCount: promptClips.length,
			totalDurationSeconds,
			// This packet contract does not expose a structured speech ledger. Zero
			// means zero ledger entries projected here; it makes no claim about
			// dialogue that may appear in the authored videoPrompt.
			speechEvidenceStatus: "not_projected_from_clip_packets",
			sourceSpeechLineCount: 0,
			narrativeSpeechLineCount: 0,
			executableSpeechLineCount: 0,
			assetBindingCount: 0,
			embeddedAuthoringReviewCount: 0,
			writerEnvelopeCharacters: promptCharacters,
			providerPromptCharacters: promptCharacters,
			providerToEnvelopeRatio: promptCharacters > 0 ? 1 : 0,
		},
		qualityAssessment: {
			version: 1,
			method: "embedded_authoring",
			status: "unreviewed",
			verdict: "not_scored",
			clipCount: promptClips.length,
			reviewedClipCount: 0,
			unreviewedClipIndices: promptClips.map((clip) => clip.index),
		},
		deliveryVerification: {
			version: 2,
			status: "satisfied",
			verifiedBy: "workflow_prompt_package_contract",
			scope: "prompt_package_structure_only",
		},
	};
}
