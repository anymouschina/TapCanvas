import type { LaunchEquippedWorkflowRequestDto } from '../../api/server'
import {
  constrainImageModelCatalogConfigByPricing,
  parseImageModelCatalogConfig,
} from '../../config/modelCatalogMeta'
import {
  type ModelOption,
} from '../../config/models'
import { resolveVideoGenerationPreferenceCatalog } from '../../config/generationPreferenceCatalog'

export const CAPABILITY_BAY_MEDIA_FIELDS = [
  'imageModelKey',
  'imageAspectRatio',
  'imageSize',
  'videoModelKey',
  'videoResolution',
  'videoAspectRatio',
] as const

export type CapabilityBayMediaField = typeof CAPABILITY_BAY_MEDIA_FIELDS[number]

export type CapabilityBayLaunchMediaSelection = Readonly<Partial<Record<CapabilityBayMediaField, string>>>

export type CapabilityBayLaunchPayloadInput = Readonly<{
  requiredFields: readonly string[]
  source: string
  selectedGroupIds: readonly string[]
  mediaSelection: CapabilityBayLaunchMediaSelection
  imageModelOptions: readonly ModelOption[]
  videoModelOptions: readonly ModelOption[]
  imageCatalogLoading: boolean
  imageCatalogError: Error | null
  videoCatalogLoading: boolean
  videoCatalogError: Error | null
}>

export type CapabilityBayLaunchPayloadResult =
  | Readonly<{ ok: true; payload?: NonNullable<LaunchEquippedWorkflowRequestDto['triggerPayload']> }>
  | Readonly<{ ok: false; error: string }>

type MutableLaunchTriggerPayload = {
  -readonly [Key in keyof NonNullable<LaunchEquippedWorkflowRequestDto['triggerPayload']>]?:
    NonNullable<LaunchEquippedWorkflowRequestDto['triggerPayload']>[Key]
}

export type CapabilityBayRequestModelOption = Readonly<{ value: string; label: string }>

export function getCapabilityBayRequestModelOptions(
  options: readonly ModelOption[],
): CapabilityBayRequestModelOption[] {
  const seen = new Set<string>()
  return options.flatMap((option) => {
    const modelKey = option.modelKey?.trim() ?? ''
    if (!modelKey || seen.has(modelKey)) return []
    seen.add(modelKey)
    return [{ value: modelKey, label: option.label }]
  })
}

function selectedCatalogModel(
  options: readonly ModelOption[],
  requestModelKey: string | undefined,
): ModelOption | null {
  const key = requestModelKey?.trim() ?? ''
  if (!key) return null
  return options.find((option) => option.modelKey?.trim() === key) ?? null
}

function requireSelectedOption(
  options: readonly Readonly<{ value: string }>[],
  selectedValue: string | undefined,
  label: string,
): CapabilityBayLaunchPayloadResult | null {
  if (!selectedValue) return { ok: false, error: `请选择${label}` }
  if (!options.some((option) => option.value === selectedValue)) {
    return { ok: false, error: `所选${label}已不在当前系统模型目录中，请重新选择` }
  }
  return null
}

function resolveImageConfig(option: ModelOption | null) {
  return option
    ? constrainImageModelCatalogConfigByPricing(
        parseImageModelCatalogConfig(option.meta),
        option.pricing,
      )
    : null
}

export function buildCapabilityBayLaunchTriggerPayload(
  input: CapabilityBayLaunchPayloadInput,
): CapabilityBayLaunchPayloadResult {
  const required = new Set(input.requiredFields)
  const supportedFields = new Set<string>(['source', 'sourceGroupId', ...CAPABILITY_BAY_MEDIA_FIELDS])
  const unsupportedField = input.requiredFields.find((field) => !supportedFields.has(field))
  if (unsupportedField) {
    return { ok: false, error: `该工作流要求尚未支持的触发参数：${unsupportedField}` }
  }
  const payload: MutableLaunchTriggerPayload = {}

  if (required.has('source')) {
    const source = input.source.trim()
    if (!source) return { ok: false, error: '该工作流需要文本来源；请填写后再启动' }
    payload.source = source
  }

  if (required.has('sourceGroupId')) {
    if (input.selectedGroupIds.length !== 1) {
      return { ok: false, error: '该工作流需要来源组；请在当前画布中明确选中且仅选中一个组' }
    }
    payload.sourceGroupId = input.selectedGroupIds[0]
  }

  const imageFieldsRequired = required.has('imageModelKey')
    || required.has('imageAspectRatio')
    || required.has('imageSize')
  if (imageFieldsRequired) {
    if (input.imageCatalogLoading) return { ok: false, error: '系统图片模型目录仍在加载，请稍后再启动' }
    if (input.imageCatalogError) return { ok: false, error: `系统图片模型目录加载失败：${input.imageCatalogError.message}` }
    if (input.imageModelOptions.length === 0) {
      return { ok: false, error: '系统图片模型目录没有可用选项，工作流未启动' }
    }
    if ((required.has('imageAspectRatio') || required.has('imageSize')) && !required.has('imageModelKey')) {
      return { ok: false, error: '调用合同要求图片参数但未声明 imageModelKey，无法定位模型目录选项' }
    }

    const imageModel = selectedCatalogModel(input.imageModelOptions, input.mediaSelection.imageModelKey)
    if (required.has('imageModelKey')) {
      if (!imageModel) return { ok: false, error: '请选择系统图片模型' }
      payload.imageModelKey = imageModel.modelKey?.trim()
    }
    if (required.has('imageAspectRatio')) {
      if (!imageModel) return { ok: false, error: '请选择系统图片模型以加载图片比例选项' }
      const config = resolveImageConfig(imageModel)
      if (!config || config.aspectRatioOptions.length === 0) {
        return { ok: false, error: '所选图片模型没有可用的图片比例目录选项' }
      }
      const invalid = requireSelectedOption(config.aspectRatioOptions, input.mediaSelection.imageAspectRatio, '图片比例')
      if (invalid) return invalid
      payload.imageAspectRatio = input.mediaSelection.imageAspectRatio
    }
    if (required.has('imageSize')) {
      if (!imageModel) return { ok: false, error: '请选择系统图片模型以加载图片尺寸选项' }
      const config = resolveImageConfig(imageModel)
      const sizeOptions = config
        ? (config.imageSizeOptions.length > 0 ? config.imageSizeOptions : config.resolutionOptions)
        : []
      if (sizeOptions.length === 0) return { ok: false, error: '所选图片模型没有可用的图片尺寸目录选项' }
      const invalid = requireSelectedOption(sizeOptions, input.mediaSelection.imageSize, '图片尺寸')
      if (invalid) return invalid
      payload.imageSize = input.mediaSelection.imageSize
    }
  }

  const videoFieldsRequired = required.has('videoModelKey')
    || required.has('videoResolution')
    || required.has('videoAspectRatio')
  if (videoFieldsRequired) {
    if (input.videoCatalogLoading) return { ok: false, error: '系统视频模型目录仍在加载，请稍后再启动' }
    if (input.videoCatalogError) return { ok: false, error: `系统视频模型目录加载失败：${input.videoCatalogError.message}` }
    if (input.videoModelOptions.length === 0) {
      return { ok: false, error: '系统视频模型目录没有可用选项，工作流未启动' }
    }
    if ((required.has('videoResolution') || required.has('videoAspectRatio')) && !required.has('videoModelKey')) {
      return { ok: false, error: '调用合同要求视频参数但未声明 videoModelKey，无法定位模型目录选项' }
    }

    const videoModel = selectedCatalogModel(input.videoModelOptions, input.mediaSelection.videoModelKey)
    if (required.has('videoModelKey')) {
      if (!videoModel) return { ok: false, error: '请选择系统视频模型' }
      payload.videoModelKey = videoModel.modelKey?.trim()
    }
    if (required.has('videoResolution') || required.has('videoAspectRatio')) {
      if (!videoModel) return { ok: false, error: '请选择系统视频模型以加载视频参数选项' }
      const catalog = resolveVideoGenerationPreferenceCatalog(videoModel)
      if (!catalog) return { ok: false, error: '所选视频模型没有可用的视频参数目录' }
      if (required.has('videoResolution')) {
        const invalid = requireSelectedOption(catalog.resolutionOptions, input.mediaSelection.videoResolution, '视频分辨率')
        if (invalid) return invalid
        payload.videoResolution = input.mediaSelection.videoResolution
      }
      if (required.has('videoAspectRatio')) {
        const invalid = requireSelectedOption(catalog.aspectOptions, input.mediaSelection.videoAspectRatio, '视频比例')
        if (invalid) return invalid
        payload.videoAspectRatio = input.mediaSelection.videoAspectRatio
      }
    }
  }

  return Object.keys(payload).length > 0 ? { ok: true, payload } : { ok: true }
}
