import { createWorkflowCollection, isWorkflowCollection, type WorkflowCollectionV1 } from '@tapcanvas/workflow-kernel-protocol';
import { canonicalClipProductionJson, type ClipProductionJsonValue } from '../../../../../packages/schemas/clip-production-packet/index.mjs';
import { inspectWorkflowPromptPackageAdmission } from './execution.video-workflow-contract';

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): value is JsonRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = (value: unknown): string => canonicalClipProductionJson(value as ClipProductionJsonValue);

function collection(value: unknown, field: string): WorkflowCollectionV1 {
  if (!isWorkflowCollection(value)) throw new Error(`${field} must be a WorkflowCollection`);
  return value;
}

function indexById(value: WorkflowCollectionV1, field: string): Map<string, unknown> {
  const result = new Map<string, unknown>();
  for (const item of value.items) {
    if (result.has(item.itemId)) throw new Error(`${field} contains duplicate item ${item.itemId}`);
    result.set(item.itemId, item.value);
  }
  return result;
}

/** Joins independently completed Clip receipts in frozen source order. No authoring or media submission. */
export function aggregateClipProduction(input: Readonly<{
  executionId: string; nodeId: string; sourceSegments: unknown; promptPackages: unknown;
  estimates: unknown; videoAssets?: unknown; preparedNodes?: unknown;
}>): Readonly<{ ports: JsonRecord; selectedOutputPorts: readonly string[]; clipCount: number }> {
  const sources = collection(input.sourceSegments, 'source-segments');
  if (sources.items.length === 0) throw new Error('Clip aggregation requires frozen source segments');
  const packages = indexById(collection(input.promptPackages, 'prompt-packages'), 'prompt-packages');
  const estimates = indexById(collection(input.estimates, 'estimates'), 'estimates');
  const hasVideos = input.videoAssets !== undefined;
  const hasPrepared = input.preparedNodes !== undefined;
  if (hasVideos === hasPrepared) throw new Error('Clip aggregation requires exactly one selected delivery branch');
  const mediaPort = hasVideos ? 'video-assets' : 'prepared-nodes';
  const media = indexById(collection(hasVideos ? input.videoAssets : input.preparedNodes, mediaPort), mediaPort);
  const expected = new Set(sources.items.map(item => item.itemId));
  if (expected.size !== sources.items.length) throw new Error('Frozen source identities must be unique');
  for (const [label, values] of [['prompt-packages', packages], ['estimates', estimates], [mediaPort, media]] as const) {
    if (values.size !== expected.size || [...values.keys()].some(id => !expected.has(id))) {
      throw new Error(`${label} identities must exactly cover frozen source segments`);
    }
  }
  const clips: JsonRecord[] = [];
  const priceItems: JsonRecord[] = [];
  const mediaItems: WorkflowCollectionV1['items'][number][] = [];
  let firstPackage: JsonRecord | null = null;
  let firstEstimate: JsonRecord | null = null;
  const estimateIdentities: string[] = [];
  let estimatedCredits = 0;
  for (const source of sources.items) {
    if (!record(source.value)) throw new Error(`Source ${source.itemId} has no frozen facts`);
    const packet = packages.get(source.itemId);
    if (!record(packet) || !Array.isArray(packet.clips) || packet.clips.length !== 1
      || !inspectWorkflowPromptPackageAdmission(packet).structurallyValid) {
      throw new Error(`Clip ${source.itemId} requires one structurally verified prompt package`);
    }
    const clip: unknown = packet.clips[0];
    if (!record(clip) || clip.itemId !== source.itemId || clip.clipIndex !== source.value.clipIndex
      || clip.durationSeconds !== source.value.durationSeconds || canonical(clip.sourceRanges) !== canonical(source.value.sourceRanges)) {
      throw new Error(`Clip ${source.itemId} prompt package differs from frozen source identity, duration or ranges`);
    }
    if (firstPackage && ['protocolVersion', 'artifactType', 'authoringProtocol', 'executionId', 'workflowKey']
      .some(field => packet[field] !== firstPackage![field])) throw new Error('Clip prompt packages have conflicting provenance');
    firstPackage ??= packet;
    clips.push({ ...clip, index: clips.length });
    const estimate = estimates.get(source.itemId);
    if (!record(estimate) || !Array.isArray(estimate.perClip) || estimate.perClip.length !== 1
      || typeof estimate.estimateIdentity !== 'string' || typeof estimate.estimatedCredits !== 'number'
      || !Number.isFinite(estimate.estimatedCredits) || estimate.estimatedCredits < 0) {
      throw new Error(`Clip ${source.itemId} requires its original frozen estimate`);
    }
    const price: unknown = estimate.perClip[0];
    if (!record(price) || price.itemId !== source.itemId || price.durationSeconds !== source.value.durationSeconds) {
      throw new Error(`Clip ${source.itemId} estimate identity or duration differs from frozen source`);
    }
    if (firstEstimate && ['modelKey', 'resolution', 'aspectRatio', 'generationContract']
      .some(field => canonical(estimate[field] ?? null) !== canonical(firstEstimate![field] ?? null))) {
      throw new Error('Clip estimates have conflicting provider parameters');
    }
    firstEstimate ??= estimate;
    estimatedCredits += estimate.estimatedCredits;
    estimateIdentities.push(estimate.estimateIdentity);
    priceItems.push(price);
    const result = collection(media.get(source.itemId), `${mediaPort}.${source.itemId}`);
    if (result.items.length !== 1 || result.items[0]?.itemId !== source.itemId) {
      throw new Error(`Clip ${source.itemId} result must retain its exact source item identity`);
    }
    mediaItems.push(result.items[0]);
  }
  if (!firstPackage || !firstEstimate) throw new Error('Clip aggregation has no materialized inputs');
  const evidence = record(firstPackage.deliveryEvidence) ? firstPackage.deliveryEvidence : {};
  const characters = clips.reduce((sum, clip) => sum + (typeof clip.prompt === 'string' ? Array.from(clip.prompt).length : 0), 0);
  const promptPackage = {
    ...firstPackage, clips,
    deliveryEvidence: { ...evidence, clipCount: clips.length,
      totalDurationSeconds: clips.reduce((sum, clip) => sum + Number(clip.durationSeconds), 0),
      writerEnvelopeCharacters: characters, providerPromptCharacters: characters, providerToEnvelopeRatio: characters > 0 ? 1 : 0 },
    qualityAssessment: { version: 1, method: 'embedded_authoring', status: 'unreviewed', verdict: 'not_scored',
      clipCount: clips.length, reviewedClipCount: 0, unreviewedClipIndices: clips.map(clip => clip.index) },
  };
  return {
    clipCount: clips.length,
    selectedOutputPorts: ['prompt-package', 'estimate', mediaPort],
    ports: {
      'prompt-package': promptPackage,
      estimate: { ...firstEstimate, estimateIdentity: `${input.executionId}:${input.nodeId}:estimate`,
        sourceEstimateIdentities: estimateIdentities, estimatedCredits: Math.round(estimatedCredits * 100) / 100, perClip: priceItems },
      [mediaPort]: createWorkflowCollection({ collectionId: `${input.executionId}:${input.nodeId}:${mediaPort}`,
        producerNodeId: input.nodeId, producerPortId: mediaPort, itemIds: mediaItems.map(item => item.itemId),
        values: mediaItems.map(item => item.value), parentLineage: mediaItems.map(item => item.lineage) }),
    },
  };
}
