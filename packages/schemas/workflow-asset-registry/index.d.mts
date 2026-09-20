export const ASSET_MEDIA_TYPES: readonly ['image','video','audio'];
export const ASSET_OBJECT_KINDS: readonly ['character','scene','prop','vfx','palette','composition'];
export const ASSET_REFERENCE_ROLES: readonly ['none','identity','wardrobe','prop','environment','palette','composition','vfx'];
export const IMAGE_REFERENCE_ROLES: readonly ['layout','style','identity','content'];
export const ASSET_SOURCE_MODES: readonly ['existing','generate'];
export type AssetRecord = Readonly<{
  assetId:string; mediaType:typeof ASSET_MEDIA_TYPES[number];
  source:Readonly<{mode:'existing';sourceAssetId:string;sourceVersionId:string}> | Readonly<{mode:'generate';generationSpecId:string;generationSpecVersion:string}>;
}>;
export type AssetBinding = Readonly<{
  bindingId:string;objectId:string;assetId:string;referenceRole:typeof ASSET_REFERENCE_ROLES[number];consumerClipIds:readonly string[];
}>;
export type WorkflowAssetRegistry = Readonly<{protocolVersion:'workflow.asset-registry/v1';assets:readonly AssetRecord[];bindings:readonly AssetBinding[]}>;
export const workflowAssetRegistrySchema:Record<string,unknown>;
export function assembleWorkflowAssetRegistry(assets:readonly AssetRecord[],bindings:readonly AssetBinding[]):WorkflowAssetRegistry;
export function materializationItems(registry:WorkflowAssetRegistry):Array<{itemId:string;asset:AssetRecord;bindings:AssetBinding[]}>;

export function validateAssetRecord(value:unknown):AssetRecord;
export function validateAssetBinding(value:unknown):AssetBinding;
