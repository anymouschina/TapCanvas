import React from 'react'
import {
  fetchPublicTaskResultWithAuth,
  runPublicTaskWithAuth,
  type TaskResultDto,
} from '../api/server'
import { useAuth } from '../auth/store'
import {
  constrainImageModelCatalogConfigByPricing,
  findImageModelPricingSpec,
  parseImageModelCatalogConfig,
  type ImageModelCatalogConfig,
  type ImageModelControlBinding,
} from '../config/modelCatalogMeta'
import type { ModelOption } from '../config/models'
import {
  findModelOptionByIdentifier,
  getModelOptionRequestAlias,
  useModelOptionsState,
  type ModelOptionsState,
} from '../config/useModelOptions'
import { notifyAssetRefresh } from '../ui/assetEvents'
import { findPromptSourceModelOption, type PromptSourceModel } from './promptGenerationModelMatching'
import { findPromptGenerationAssets, readPromptGenerationTaskFailure } from './promptGenerationTaskResult'

export type PromptGeneratedImage = Readonly<{
  url: string
  title: string
}>

export type PromptImageGenerationSelection = Readonly<{
  modelValue: string
  aspectRatio: string
  imageSize: string
  resolution: string
  quality: string
}>

export type PromptImageControlState = Readonly<{
  visibleBindings: ReadonlySet<ImageModelControlBinding>
  aspectRatioOptions: ReadonlyArray<Readonly<{ value: string; label: string }>>
}>

type PromptImageGenerationStatus = 'idle' | 'submitting' | 'queued' | 'running' | 'accepted' | 'succeeded' | 'failed'

export type PromptImageGenerationState = Readonly<{
  authenticated: boolean
  prompt: string
  setPrompt: React.Dispatch<React.SetStateAction<string>>
  selection: PromptImageGenerationSelection
  selectModel: (value: string) => void
  setControl: (binding: ImageModelControlBinding, value: string) => void
  status: PromptImageGenerationStatus
  statusLabel: string
  error: string
  preview: readonly PromptGeneratedImage[]
  setPreview: React.Dispatch<React.SetStateAction<readonly PromptGeneratedImage[]>>
  modelCatalog: ModelOptionsState
  sourceModelLabel: string
  sourceModelUnavailable: boolean
  selectedOption: ModelOption | null
  selectedConfig: ImageModelCatalogConfig | null
  controlState: PromptImageControlState
  executableSelection: boolean
  generationCost: number | null
  busy: boolean
  generate: () => Promise<void>
  canRefreshAcceptedTask: boolean
  refreshAcceptedTask: () => void
}>

export const EMPTY_PROMPT_IMAGE_SELECTION: PromptImageGenerationSelection = {
  modelValue: '',
  aspectRatio: '',
  imageSize: '',
  resolution: '',
  quality: '',
}

export function resolvePromptImageCatalogConfig(option: ModelOption | null): ImageModelCatalogConfig | null {
  if (!option) return null
  return constrainImageModelCatalogConfigByPricing(parseImageModelCatalogConfig(option.meta), option.pricing)
}

function firstAllowedValue(
  options: ReadonlyArray<Readonly<{ value: string }>>,
  preferred: string | undefined,
): string {
  if (preferred && options.some((option) => option.value === preferred)) return preferred
  return options[0]?.value ?? preferred ?? ''
}

function readVisibleBindings(config: ImageModelCatalogConfig): Set<ImageModelControlBinding> {
  if (config.controls.length > 0) return new Set(config.controls.map((control) => control.binding))
  const bindings = new Set<ImageModelControlBinding>()
  if (config.aspectRatioOptions.length > 0) bindings.add('aspectRatio')
  if (config.imageSizeOptions.length > 0) bindings.add('imageSize')
  if (config.resolutionOptions.length > 0) bindings.add('resolution')
  if (config.qualityOptions.length > 0) bindings.add('quality')
  return bindings
}

export function promptImageControlState(
  config: ImageModelCatalogConfig | null,
  selection: PromptImageGenerationSelection,
): PromptImageControlState {
  if (!config) return { visibleBindings: new Set(), aspectRatioOptions: [] }
  const sizeConstraint = config.imageSizeOptions.find((option) => option.value === selection.imageSize)?.whenSelected
  const visibleBindings = readVisibleBindings(config)
  for (const hidden of sizeConstraint?.hides ?? []) visibleBindings.delete(hidden)
  const constrainedAspects = sizeConstraint?.aspectRatioOptions
  const aspectRatioOptions = constrainedAspects?.length
    ? constrainedAspects.map((value) => ({
        value,
        label: config.aspectRatioOptions.find((option) => option.value === value)?.label ?? value,
      }))
    : config.aspectRatioOptions
  return { visibleBindings, aspectRatioOptions }
}

function normalizePromptImageSelection(
  selection: PromptImageGenerationSelection,
  config: ImageModelCatalogConfig | null,
): PromptImageGenerationSelection {
  if (!config) return selection
  const declaredBindings = readVisibleBindings(config)
  const imageSize = declaredBindings.has('imageSize')
    ? firstAllowedValue(config.imageSizeOptions, selection.imageSize || config.defaultImageSize)
    : ''
  const state = promptImageControlState(config, { ...selection, imageSize })
  const aspectRatio = state.visibleBindings.has('aspectRatio')
    ? firstAllowedValue(state.aspectRatioOptions, selection.aspectRatio || config.defaultAspectRatio)
    : ''
  return {
    ...selection,
    aspectRatio,
    imageSize: state.visibleBindings.has('imageSize') ? imageSize : '',
    resolution: state.visibleBindings.has('resolution')
      ? firstAllowedValue(config.resolutionOptions, selection.resolution)
      : '',
    quality: state.visibleBindings.has('quality')
      ? firstAllowedValue(config.qualityOptions, selection.quality || config.defaultQuality)
      : '',
  }
}

export function promptImageSelectionForModel(option: ModelOption): PromptImageGenerationSelection {
  const config = resolvePromptImageCatalogConfig(option)
  const initial: PromptImageGenerationSelection = {
    modelValue: option.value,
    aspectRatio: config?.defaultAspectRatio ?? '',
    imageSize: config?.defaultImageSize ?? '',
    resolution: '',
    quality: config?.defaultQuality ?? '',
  }
  return normalizePromptImageSelection(initial, config)
}

function selectionHasAllowedValue(
  visible: boolean,
  options: ReadonlyArray<Readonly<{ value: string }>>,
  value: string,
): boolean {
  if (!visible || options.length === 0) return true
  return options.some((option) => option.value === value)
}

export function promptImageSelectionIsExecutable(
  selection: PromptImageGenerationSelection,
  config: ImageModelCatalogConfig | null,
): boolean {
  if (!selection.modelValue || !config || config.supportsTextToImage === false) return false
  const state = promptImageControlState(config, selection)
  return selectionHasAllowedValue(state.visibleBindings.has('aspectRatio'), state.aspectRatioOptions, selection.aspectRatio)
    && selectionHasAllowedValue(state.visibleBindings.has('imageSize'), config.imageSizeOptions, selection.imageSize)
    && selectionHasAllowedValue(state.visibleBindings.has('resolution'), config.resolutionOptions, selection.resolution)
    && selectionHasAllowedValue(state.visibleBindings.has('quality'), config.qualityOptions, selection.quality)
}

function promptImageGenerationStatusLabel(status: PromptImageGenerationStatus): string {
  if (status === 'submitting') return '正在提交真实图片生成任务'
  if (status === 'queued') return '任务已排队，等待供应商处理'
  if (status === 'running') return '供应商正在生成图片'
  if (status === 'accepted') return '任务已受理，可刷新状态或稍后在历史记录查看'
  if (status === 'succeeded') return '图片已生成并写入个人生成历史'
  if (status === 'failed') return '本次生成失败'
  return ''
}

function bindingKey(binding: ImageModelControlBinding): Exclude<keyof PromptImageGenerationSelection, 'modelValue'> {
  if (binding === 'imageSize') return 'imageSize'
  if (binding === 'resolution') return 'resolution'
  if (binding === 'quality') return 'quality'
  return 'aspectRatio'
}

export function usePromptImageGeneration(input: Readonly<{
  entryId: string
  title: string
  initialPrompt: string
  sourceModels: readonly PromptSourceModel[]
  onRequestLogin: () => void
}>): PromptImageGenerationState {
  const token = useAuth((state) => state.token)
  const authenticated = Boolean(token)
  const modelCatalog = useModelOptionsState('image', { enabled: authenticated })
  const [prompt, setPrompt] = React.useState(input.initialPrompt)
  const [selection, setSelection] = React.useState<PromptImageGenerationSelection>(EMPTY_PROMPT_IMAGE_SELECTION)
  const [status, setStatus] = React.useState<PromptImageGenerationStatus>('idle')
  const [taskId, setTaskId] = React.useState('')
  const [taskVendor, setTaskVendor] = React.useState('')
  const [error, setError] = React.useState('')
  const [preview, setPreview] = React.useState<readonly PromptGeneratedImage[]>([])
  const generationVersionRef = React.useRef(0)
  const matchedSourceOption = React.useMemo(
    () => findPromptSourceModelOption(modelCatalog.options, input.sourceModels),
    [input.sourceModels, modelCatalog.options],
  )
  const sourceModelLabel = input.sourceModels.map((model) => model.name.trim()).filter(Boolean).join(' / ')
  const sourceModelUnavailable = authenticated
    && !modelCatalog.loading
    && !modelCatalog.error
    && input.sourceModels.length > 0
    && !matchedSourceOption

  React.useEffect(() => {
    generationVersionRef.current += 1
    setPrompt(input.initialPrompt)
    setSelection(EMPTY_PROMPT_IMAGE_SELECTION)
    setStatus('idle')
    setTaskId('')
    setTaskVendor('')
    setError('')
    setPreview([])
  }, [input.entryId, input.initialPrompt])

  React.useEffect(() => {
    if (!authenticated || modelCatalog.loading || modelCatalog.error || selection.modelValue) return
    if (matchedSourceOption) setSelection(promptImageSelectionForModel(matchedSourceOption))
  }, [authenticated, matchedSourceOption, modelCatalog.error, modelCatalog.loading, selection.modelValue])

  React.useEffect(() => () => {
    generationVersionRef.current += 1
  }, [])

  const selectedOption = React.useMemo(
    () => findModelOptionByIdentifier(modelCatalog.options, selection.modelValue),
    [modelCatalog.options, selection.modelValue],
  )
  const selectedConfig = React.useMemo(() => resolvePromptImageCatalogConfig(selectedOption), [selectedOption])
  const controlState = React.useMemo(() => promptImageControlState(selectedConfig, selection), [selectedConfig, selection])
  const executableSelection = promptImageSelectionIsExecutable(selection, selectedConfig)
  const selectedSpecPrice = findImageModelPricingSpec(selectedOption?.pricing, selection)
  const generationCost = selectedSpecPrice?.cost ?? selectedOption?.pricing?.cost ?? null
  const trimmedPrompt = prompt.trim()
  const busy = status === 'submitting' || status === 'queued' || status === 'running'

  const selectModel = React.useCallback((value: string): void => {
    const option = findModelOptionByIdentifier(modelCatalog.options, value)
    setSelection(option ? promptImageSelectionForModel(option) : EMPTY_PROMPT_IMAGE_SELECTION)
  }, [modelCatalog.options])

  const setControl = React.useCallback((binding: ImageModelControlBinding, value: string): void => {
    setSelection((current) => normalizePromptImageSelection({ ...current, [bindingKey(binding)]: value }, selectedConfig))
  }, [selectedConfig])

  const applyResult = React.useCallback((result: TaskResultDto, resultTitle: string): boolean => {
    if (result.status === 'failed') {
      setStatus('failed')
      setError(readPromptGenerationTaskFailure(result, '图片'))
      return true
    }
    if (result.status !== 'succeeded') {
      setStatus(result.status)
      return false
    }
    const assets = findPromptGenerationAssets(result.assets, 'image')
    if (assets.length === 0) {
      setStatus('failed')
      setError('任务已完成，但结果中没有真实图片 URL')
      return true
    }
    setPreview(assets.map((asset, index) => ({
      url: asset.url,
      title: assets.length > 1 ? `${resultTitle} ${index + 1}` : resultTitle,
    })))
    setStatus('succeeded')
    setError('')
    notifyAssetRefresh()
    return true
  }, [])

  type PollInput = Readonly<{ id: string; vendor: string; promptText: string; resultTitle: string; version: number }>
  const pollTaskRef = React.useRef<(pollInput: PollInput) => Promise<void>>(async () => undefined)
  const pollTask = React.useCallback(async (pollInput: PollInput): Promise<void> => {
    if (!pollInput.id || generationVersionRef.current !== pollInput.version) return
    try {
      const response = await fetchPublicTaskResultWithAuth({
        taskId: pollInput.id,
        vendor: pollInput.vendor || undefined,
        taskKind: 'text_to_image',
        prompt: pollInput.promptText,
      })
      if (generationVersionRef.current !== pollInput.version) return
      const terminal = applyResult(response.result, pollInput.resultTitle)
      if (terminal) return
      window.setTimeout(() => { void pollTaskRef.current(pollInput) }, 4_000)
    } catch (reason: unknown) {
      if (generationVersionRef.current !== pollInput.version) return
      setStatus('accepted')
      setError(`任务已受理，但状态查询失败：${reason instanceof Error ? reason.message : '未知错误'}`)
    }
  }, [applyResult])
  pollTaskRef.current = pollTask

  const generate = React.useCallback(async (): Promise<void> => {
    if (!authenticated) {
      input.onRequestLogin()
      return
    }
    if (!trimmedPrompt) {
      setError('请输入提示词后再生成')
      return
    }
    if (!selectedOption || !selectedConfig || !executableSelection) {
      setError('请选择模型目录提供的完整图片规格')
      return
    }
    const requestModelKey = getModelOptionRequestAlias(modelCatalog.options, selectedOption.value)
    if (!requestModelKey) {
      setError('所选图片模型缺少可执行请求键')
      return
    }

    const version = generationVersionRef.current + 1
    generationVersionRef.current = version
    setStatus('submitting')
    setError('')
    try {
      const specKey = selectedSpecPrice?.specKey ?? ''
      const response = await runPublicTaskWithAuth({
        request: {
          kind: 'text_to_image',
          prompt: trimmedPrompt,
          extras: {
            modelKey: requestModelKey,
            awaitResult: false,
            persistAssets: true,
            sourcePromptLibraryEntryId: input.entryId,
            ...(selection.aspectRatio ? { aspectRatio: selection.aspectRatio } : {}),
            ...(selection.imageSize ? { imageSize: selection.imageSize } : {}),
            ...(selection.resolution ? { imageResolution: selection.resolution, resolution: selection.resolution } : {}),
            ...(selection.quality ? { quality: selection.quality } : {}),
            ...(specKey ? { specKey, billingSpecKey: specKey } : {}),
          },
        },
      })
      if (generationVersionRef.current !== version) return
      setTaskId(response.result.id)
      setTaskVendor(response.vendor)
      const resultTitle = `${input.title} · 临时生成`
      const terminal = applyResult(response.result, resultTitle)
      if (terminal) return
      window.setTimeout(() => {
        void pollTaskRef.current({ id: response.result.id, vendor: response.vendor, promptText: trimmedPrompt, resultTitle, version })
      }, 4_000)
    } catch (reason: unknown) {
      if (generationVersionRef.current !== version) return
      setStatus('failed')
      setError(reason instanceof Error ? reason.message : '图片生成请求失败')
    }
  }, [
    applyResult,
    authenticated,
    executableSelection,
    input.entryId,
    input.onRequestLogin,
    input.title,
    modelCatalog.options,
    selectedConfig,
    selectedOption,
    selectedSpecPrice?.specKey,
    selection.aspectRatio,
    selection.imageSize,
    selection.quality,
    selection.resolution,
    trimmedPrompt,
  ])

  const refreshAcceptedTask = React.useCallback((): void => {
    if (!taskId) return
    const version = generationVersionRef.current + 1
    generationVersionRef.current = version
    setStatus('running')
    setError('')
    void pollTaskRef.current({ id: taskId, vendor: taskVendor, promptText: trimmedPrompt, resultTitle: `${input.title} · 临时生成`, version })
  }, [input.title, taskId, taskVendor, trimmedPrompt])

  return {
    authenticated,
    prompt,
    setPrompt,
    selection,
    selectModel,
    setControl,
    status,
    statusLabel: promptImageGenerationStatusLabel(status),
    error,
    preview,
    setPreview,
    modelCatalog,
    sourceModelLabel,
    sourceModelUnavailable,
    selectedOption,
    selectedConfig,
    controlState,
    executableSelection,
    generationCost,
    busy,
    generate,
    canRefreshAcceptedTask: status === 'accepted' && Boolean(taskId),
    refreshAcceptedTask,
  }
}
