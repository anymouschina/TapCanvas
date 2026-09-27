export const CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION: 'tapcanvas.clip-production-packet/v1';
export const CLIP_PRODUCTION_PACKET_COLLECTION_ARTIFACT_TYPE: 'tapcanvas.clip-production-packets/v1';
export const CLIP_PRODUCTION_ASSET_INTENTS_ARTIFACT_TYPE: 'tapcanvas.clip-production-asset-intents/v1';
export const CLIP_PRODUCTION_PACKET_MAX_ITEMS: 80;
export const clipProductionPacketSchema: Readonly<Record<string, unknown>>;
export const clipProductionBlockingPlanSchema: Readonly<Record<string, unknown>>;

export type ClipProductionJsonValue = null | boolean | number | string
  | readonly ClipProductionJsonValue[]
  | Readonly<Record<string, ClipProductionJsonValue>>;

export type ClipProductionSourceRange = Readonly<{
  sourceIndex: number;
  startOffset: number;
  endOffset: number;
  sourceId: string;
  sourceFingerprint: string;
}>;

export type ClipProductionReferenceAssetBinding = Readonly<{
  assetId: string;
  role: 'identity' | 'content' | 'layout' | 'style';
  strength?: number;
}>;

export type ClipProductionGenerationSpec = Readonly<Record<string, ClipProductionJsonValue>> & Readonly<{
  prompt: string;
  negativePrompt: string;
  modelKey: string;
  aspectRatio: string;
  size: string;
}>;

export type ClipProductionImageSource =
  | Readonly<{ mode: 'generate'; generationSpecVersion: string; generationSpec: ClipProductionGenerationSpec }>
  | Readonly<{ mode: 'reuse'; existingAssetId: string; existingProjectId: string }>;

export type ClipProductionAssetIntent = Readonly<{
  /** Canonical logical asset identity; state remains a separate identity dimension. */
  assetId: string;
  /** Explicit normalized state identity authored by the Agent. */
  state: string;
  registryObjectId: string;
  displayName: string;
  referenceType: 'character' | 'scene' | 'prop' | 'vfx' | 'palette' | 'composition';
  referenceAssetBindings: readonly ClipProductionReferenceAssetBinding[];
  imageSource: ClipProductionImageSource;
  canonicalName?: string;
  roleName?: string;
  physicalIdentityKey?: string;
  assetReuseKey?: string;
  characterAssetRole?: string;
  characterProfileVersion?: string;
  identityBoardSpec?: Readonly<Record<string, ClipProductionJsonValue>>;
  identityAnchors?: readonly string[];
  prohibitedDrift?: readonly string[];
  sceneCard?: Readonly<Record<string, ClipProductionJsonValue>>;
  sceneName?: string;
  propName?: string;
  assetPurpose?: string;
}>;

export type ClipProductionAssetIdentity = Readonly<{ assetId: string; state: string }>;

export type ClipProductionPoint = readonly [number, number];
export type ClipProductionBlockingPlan = Readonly<{
  title: string;
  sceneName: string;
  backgroundObjectId: string;
  landmarks: readonly Readonly<Record<string, ClipProductionJsonValue>>[];
  characters: readonly Readonly<{
    name: string;
    at: ClipProductionPoint;
    facingTo: ClipProductionPoint | null;
    moveTo: ClipProductionPoint | null;
  }>[];
  camera: Readonly<{ at: ClipProductionPoint; lookAt: ClipProductionPoint }>;
  compositionContract: Readonly<Record<string, ClipProductionJsonValue>>;
  axisLine?: Readonly<{ from: ClipProductionPoint; to: ClipProductionPoint }>;
}>;

export type ClipProductionPacket = Readonly<{
  protocolVersion: typeof CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION;
  clipId: string;
  clipIndex: number;
  durationSeconds: number;
  videoInputMode: 'image_to_video' | 'reference_to_video' | 'text_to_video';
  firstFrameAsset: ClipProductionAssetIdentity | null;
  referenceAssets: readonly ClipProductionAssetIdentity[];
  sourceRanges: readonly ClipProductionSourceRange[];
  videoPrompt: string;
  blockingPlan: ClipProductionBlockingPlan;
  clipFacts: Readonly<Record<string, ClipProductionJsonValue>>;
  assetIntents: readonly ClipProductionAssetIntent[];
}>;

export type CollectedClipProductionPackets = Readonly<{
  protocolVersion: typeof CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION;
  clips: readonly ClipProductionPacket[];
  assetIntents: readonly (ClipProductionAssetIntent & Readonly<{ consumerClipIds: readonly string[] }>)[];
}>;

export function canonicalClipProductionJson(value: ClipProductionJsonValue): string;
export function validateClipProductionPacket(value: unknown): ClipProductionPacket;
export function collectClipProductionPackets(input: readonly unknown[]): CollectedClipProductionPackets;
