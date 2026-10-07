export const CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION: 'tapcanvas.clip-production-packet/v2';
export const CLIP_PRODUCTION_PACKET_COLLECTION_ARTIFACT_TYPE: 'tapcanvas.clip-production-packets/v2';
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

/** Ordered chapter-sequence speech, bound to this Clip without a timing grid. */
export type ClipProductionSpeechEvent = Readonly<{
  speechEventId: string;
  speaker: string;
  delivery: string;
  text: string;
  textOrigin: 'authored' | 'source_quote';
  voice?: 'onscreen' | 'inner' | 'offscreen' | 'narration';
  eventIndex: number;
  clipId: string;
  sceneId: string;
  scope: 'beat' | 'scene';
  storyEventId?: string;
  sourceRanges: readonly ClipProductionSourceRange[];
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
/** Host-derived staging: the chapter's frozen floor plans and who goes where in this Clip. */
export const CLIP_STAGING_PROTOCOL: 'tapcanvas.clip-staging/v2';
export type ClipProductionStagingCharacter = Readonly<{
  name: string;
  mark: string;
  posture: 'stand' | 'sit' | 'kneel' | 'crouch' | 'lie';
  at: ClipProductionPoint;
  endMark: string | null;
  endPosture: 'stand' | 'sit' | 'kneel' | 'crouch' | 'lie' | null;
  moveTo: ClipProductionPoint | null;
  enters: boolean;
  exits: boolean;
  /** `at` is a known origin, not a confirmed current position, when a move crosses the opening. */
  positionStatus?: 'origin_only' | 'target_only';
}>;
export type ClipProductionStagingTransition = Readonly<{
  eventId: string;
  name: string;
  from: Readonly<{ mark: string; posture: 'stand' | 'sit' | 'kneel' | 'crouch' | 'lie'; at: ClipProductionPoint }> | null;
  to: Readonly<{ mark: string; posture: 'stand' | 'sit' | 'kneel' | 'crouch' | 'lie'; at: ClipProductionPoint }>;
  eventIndex: number;
}>;
export type ClipProductionStagingPlan = Readonly<{
  protocol: typeof CLIP_STAGING_PROTOCOL;
  stages: readonly Readonly<{
    sceneId: string;
    setting: string;
    landmarks: readonly Readonly<{ kind: 'door' | 'window' | 'furniture' | 'area'; label: string; at: ClipProductionPoint }>[];
    marks: readonly Readonly<{ mark: string; where: string; at: ClipProductionPoint }>[];
    characters: readonly ClipProductionStagingCharacter[];
    transitions?: readonly ClipProductionStagingTransition[];
  }>[];
}>;
export function isClipProductionStagingPlan(value: unknown): value is ClipProductionStagingPlan;
export type ClipProductionBlockingPlan = ClipProductionAuthoredBlockingPlan | ClipProductionStagingPlan;
/** Per-Clip blocking authored by the Clip writer; used by timelines compiled without a staging ledger. */
export type ClipProductionAuthoredBlockingPlan = Readonly<{
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
  /** Absent when the producer has no bound chapter-sequence speech track. */
  speechEvents?: readonly ClipProductionSpeechEvent[];
  videoPrompt: string;
  /** Optional spatial facts; media execution does not require a staging diagram. */
  blockingPlan?: ClipProductionBlockingPlan;
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
export function validateClipProductionAssetIntent(value: unknown): ClipProductionAssetIntent;
export function collectClipProductionPackets(input: readonly unknown[]): CollectedClipProductionPackets;
