import type { TaskAssetDto, TaskResultDto } from '../../../api/server'

export const IMAGE_LAYER_DECOMPOSITION_MODEL_KEY = 'fal-ai/qwen-image-layered'
export const IMAGE_LAYER_DECOMPOSITION_DEFAULTS = {
  numLayers: 4,
  numInferenceSteps: 28,
  guidanceScale: 5,
} as const

export type ImageLayerAsset = Pick<
  TaskAssetDto,
  'url' | 'assetId' | 'assetRefId' | 'assetName'
>

export function readImageLayerAssets(result: TaskResultDto): ImageLayerAsset[] {
  return result.assets
    .filter((asset) => asset.type === 'image' && asset.url.trim().length > 0)
    .map((asset) => ({
      url: asset.url.trim(),
      assetId: asset.assetId ?? null,
      assetRefId: asset.assetRefId ?? null,
      assetName: asset.assetName ?? null,
    }))
}
