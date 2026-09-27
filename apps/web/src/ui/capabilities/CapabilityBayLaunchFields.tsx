import React from 'react'
import {
  constrainImageModelCatalogConfigByPricing,
  parseImageModelCatalogConfig,
} from '../../config/modelCatalogMeta'
import { resolveVideoGenerationPreferenceCatalog } from '../../config/generationPreferenceCatalog'
import type { ModelOptionsState } from '../../config/useModelOptions'
import type { ModelOption } from '../../config/models'
import {
  CAPABILITY_BAY_MEDIA_FIELDS,
  getCapabilityBayRequestModelOptions,
  type CapabilityBayLaunchMediaSelection,
  type CapabilityBayMediaField,
} from './capabilityBayLaunchPayload'

type CapabilityBayLaunchFieldsProps = Readonly<{
  workflowName: string
  requiredFields: readonly string[]
  source: string
  selectedGroupIds: readonly string[]
  mediaSelection: CapabilityBayLaunchMediaSelection
  imageModelState: ModelOptionsState
  videoModelState: ModelOptionsState
  disabled: boolean
  onSourceChange: (value: string) => void
  onMediaSelectionChange: (field: CapabilityBayMediaField, value: string) => void
}>

type SelectOption = Readonly<{ value: string; label: string }>

function resolveSelectedModel(
  options: readonly ModelOption[],
  requestModelKey: string | undefined,
): ModelOption | null {
  const key = requestModelKey?.trim() ?? ''
  if (!key) return null
  return options.find((option) => option.modelKey?.trim() === key) ?? null
}

function renderSelect(
  label: string,
  field: CapabilityBayMediaField,
  value: string | undefined,
  options: readonly SelectOption[],
  placeholder: string,
  disabled: boolean,
  onChange: (field: CapabilityBayMediaField, value: string) => void,
): JSX.Element {
  return (
    <label className="capability-bay__launch-field">
      <span className="capability-bay__launch-field-label">{label}</span>
      <select
        className="capability-bay__launch-select"
        aria-label={label}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(field, event.currentTarget.value)}
      >
        <option className="capability-bay__launch-option" value="">{placeholder}</option>
        {options.map((option) => (
          <option className="capability-bay__launch-option" key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function catalogStatus(
  name: string,
  state: ModelOptionsState,
  options: readonly ModelOption[],
): JSX.Element | null {
  if (state.loading) {
    return <span className="capability-bay__launch-status" role="status">正在加载系统{name}模型目录</span>
  }
  if (state.error) {
    return <span className="capability-bay__launch-status is-error" role="alert">系统{name}模型目录加载失败：{state.error.message}</span>
  }
  if (options.length === 0) {
    return <span className="capability-bay__launch-status is-error" role="alert">系统{name}模型目录没有可用选项</span>
  }
  return null
}

export function CapabilityBayLaunchFields({
  workflowName,
  requiredFields,
  source,
  selectedGroupIds,
  mediaSelection,
  imageModelState,
  videoModelState,
  disabled,
  onSourceChange,
  onMediaSelectionChange,
}: CapabilityBayLaunchFieldsProps): JSX.Element | null {
  const required = new Set(requiredFields)
  const hasImageRequirements = CAPABILITY_BAY_MEDIA_FIELDS.slice(0, 3).some((field) => required.has(field))
  const hasVideoRequirements = CAPABILITY_BAY_MEDIA_FIELDS.slice(3).some((field) => required.has(field))
  if (required.size === 0) return null

  const imageRequestOptions = getCapabilityBayRequestModelOptions(imageModelState.options)
  const selectedImageModel = resolveSelectedModel(imageModelState.options, mediaSelection.imageModelKey)
  const imageConfig = selectedImageModel
    ? constrainImageModelCatalogConfigByPricing(
        parseImageModelCatalogConfig(selectedImageModel.meta),
        selectedImageModel.pricing,
      )
    : null
  const imageSizeOptions = imageConfig
    ? (imageConfig.imageSizeOptions.length > 0 ? imageConfig.imageSizeOptions : imageConfig.resolutionOptions)
    : []
  const videoRequestOptions = getCapabilityBayRequestModelOptions(videoModelState.options)
  const selectedVideoModel = resolveSelectedModel(videoModelState.options, mediaSelection.videoModelKey)
  const videoCatalog = resolveVideoGenerationPreferenceCatalog(selectedVideoModel)

  const imageDimensionRequired = required.has('imageAspectRatio') || required.has('imageSize')
  const videoDimensionRequired = required.has('videoResolution') || required.has('videoAspectRatio')
  const imageConfigMissing = hasImageRequirements
    && !imageModelState.loading
    && !imageModelState.error
    && imageModelState.options.length > 0
    && imageDimensionRequired
    && !required.has('imageModelKey')
  const videoConfigMissing = hasVideoRequirements
    && !videoModelState.loading
    && !videoModelState.error
    && videoModelState.options.length > 0
    && videoDimensionRequired
    && !required.has('videoModelKey')

  return (
    <div className="capability-bay__launch-fields">
      {required.has('source') ? (
        <textarea
          className="capability-bay__launch-source"
          aria-label={`${workflowName} 文本来源`}
          placeholder="输入本次工作流的文本来源"
          rows={3}
          value={source}
          disabled={disabled}
          onChange={(event) => onSourceChange(event.currentTarget.value)}
        />
      ) : null}
      {required.has('sourceGroupId') ? (
        <span className="capability-bay__launch-hint">
          {selectedGroupIds.length === 1
            ? `来源组：${selectedGroupIds[0]}`
            : '请在当前画布中选中且仅选中一个来源组'}
        </span>
      ) : null}
      {hasImageRequirements ? (
        <div className="capability-bay__launch-media-fields">
          {required.has('imageModelKey') ? renderSelect(
            `${workflowName} 图片模型`,
            'imageModelKey',
            mediaSelection.imageModelKey,
            imageRequestOptions,
            '选择系统图片模型',
            disabled || imageModelState.loading || imageRequestOptions.length === 0,
            onMediaSelectionChange,
          ) : null}
          {required.has('imageAspectRatio') ? renderSelect(
            `${workflowName} 图片比例`,
            'imageAspectRatio',
            mediaSelection.imageAspectRatio,
            imageConfig?.aspectRatioOptions ?? [],
            selectedImageModel ? '选择图片比例' : '先选择图片模型',
            disabled || imageModelState.loading || !selectedImageModel || (imageConfig?.aspectRatioOptions.length ?? 0) === 0,
            onMediaSelectionChange,
          ) : null}
          {required.has('imageSize') ? renderSelect(
            `${workflowName} 图片尺寸`,
            'imageSize',
            mediaSelection.imageSize,
            imageSizeOptions,
            selectedImageModel ? '选择图片尺寸' : '先选择图片模型',
            disabled || imageModelState.loading || !selectedImageModel || imageSizeOptions.length === 0,
            onMediaSelectionChange,
          ) : null}
          {catalogStatus('图片', imageModelState, imageModelState.options)}
          {imageConfigMissing ? (
            <span className="capability-bay__launch-status is-error" role="alert">调用合同要求图片参数但未声明 imageModelKey，无法定位模型目录选项</span>
          ) : null}
          {selectedImageModel && imageDimensionRequired && !imageConfig ? (
            <span className="capability-bay__launch-status is-error" role="alert">所选图片模型没有可用的图片参数目录</span>
          ) : null}
          {selectedImageModel && required.has('imageAspectRatio') && imageConfig && imageConfig.aspectRatioOptions.length === 0 ? (
            <span className="capability-bay__launch-status is-error" role="alert">所选图片模型没有可用的图片比例选项</span>
          ) : null}
          {selectedImageModel && required.has('imageSize') && imageSizeOptions.length === 0 ? (
            <span className="capability-bay__launch-status is-error" role="alert">所选图片模型没有可用的图片尺寸选项</span>
          ) : null}
        </div>
      ) : null}
      {hasVideoRequirements ? (
        <div className="capability-bay__launch-media-fields">
          {required.has('videoModelKey') ? renderSelect(
            `${workflowName} 视频模型`,
            'videoModelKey',
            mediaSelection.videoModelKey,
            videoRequestOptions,
            '选择系统视频模型',
            disabled || videoModelState.loading || videoRequestOptions.length === 0,
            onMediaSelectionChange,
          ) : null}
          {required.has('videoResolution') ? renderSelect(
            `${workflowName} 视频分辨率`,
            'videoResolution',
            mediaSelection.videoResolution,
            videoCatalog?.resolutionOptions ?? [],
            selectedVideoModel ? '选择视频分辨率' : '先选择视频模型',
            disabled || videoModelState.loading || !selectedVideoModel || (videoCatalog?.resolutionOptions.length ?? 0) === 0,
            onMediaSelectionChange,
          ) : null}
          {required.has('videoAspectRatio') ? renderSelect(
            `${workflowName} 视频比例`,
            'videoAspectRatio',
            mediaSelection.videoAspectRatio,
            videoCatalog?.aspectOptions ?? [],
            selectedVideoModel ? '选择视频比例' : '先选择视频模型',
            disabled || videoModelState.loading || !selectedVideoModel || (videoCatalog?.aspectOptions.length ?? 0) === 0,
            onMediaSelectionChange,
          ) : null}
          {catalogStatus('视频', videoModelState, videoModelState.options)}
          {videoConfigMissing ? (
            <span className="capability-bay__launch-status is-error" role="alert">调用合同要求视频参数但未声明 videoModelKey，无法定位模型目录选项</span>
          ) : null}
          {selectedVideoModel && videoDimensionRequired && !videoCatalog ? (
            <span className="capability-bay__launch-status is-error" role="alert">所选视频模型没有可用的视频参数目录</span>
          ) : null}
          {selectedVideoModel && required.has('videoResolution') && videoCatalog && videoCatalog.resolutionOptions.length === 0 ? (
            <span className="capability-bay__launch-status is-error" role="alert">所选视频模型没有可用的视频分辨率选项</span>
          ) : null}
          {selectedVideoModel && required.has('videoAspectRatio') && videoCatalog && videoCatalog.aspectOptions.length === 0 ? (
            <span className="capability-bay__launch-status is-error" role="alert">所选视频模型没有可用的视频比例选项</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
