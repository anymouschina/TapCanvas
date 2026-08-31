import React from 'react'
import {
  fetchPublicTaskResultWithAuth,
  runPublicTaskWithAuth,
  type TaskAssetDto,
  type TaskResultDto,
} from '../api/server'
import { useAuth } from '../auth/store'
import {
  constrainVideoModelCatalogConfigByPricing,
  parseVideoModelCatalogConfig,
  type VideoModelCatalogConfig,
} from '../config/modelCatalogMeta'
import type { ModelOption } from '../config/models'
import {
  getModelOptionRequestAlias,
  findModelOptionByIdentifier,
  useModelOptionsState,
  type ModelOptionsState,
} from '../config/useModelOptions'
import { notifyAssetRefresh } from '../ui/assetEvents'
import { buildVideoBillingSpecKey } from '../utils/videoBillingSpec'
import { findPromptSourceModelOption, type PromptSourceModel } from './promptGenerationModelMatching'
import { findPromptGenerationAssets, readPromptGenerationTaskFailure } from './promptGenerationTaskResult'

export type PromptVideoSourceModel = PromptSourceModel

export type PromptVideoGenerationStatus = 'idle' | 'submitting' | 'queued' | 'running' | 'accepted' | 'succeeded' | 'failed'

export type PromptGeneratedVideo = Readonly<{
  url: string
  thumbnailUrl: string
  title: string
}>

export type PromptVideoGenerationSelection = Readonly<{
  modelValue: string
  durationSeconds: string
  resolution: string
  aspectRatio: string
}>

export type PromptVideoGenerationState = Readonly<{
  authenticated: boolean
  prompt: string
  setPrompt: React.Dispatch<React.SetStateAction<string>>
  selection: PromptVideoGenerationSelection
  setSelection: React.Dispatch<React.SetStateAction<PromptVideoGenerationSelection>>
  selectModel: (value: string) => void
  status: PromptVideoGenerationStatus
  statusLabel: string
  error: string
  preview: PromptGeneratedVideo | null
  setPreview: React.Dispatch<React.SetStateAction<PromptGeneratedVideo | null>>
  modelCatalog: ModelOptionsState
  sourceModelLabel: string
  sourceModelUnavailable: boolean
  selectedOption: ModelOption | null
  selectedConfig: VideoModelCatalogConfig | null
  executableSelection: boolean
  generationCost: number | null
  busy: boolean
  generate: () => Promise<void>
  canRefreshAcceptedTask: boolean
  refreshAcceptedTask: () => void
}>

export const EMPTY_PROMPT_VIDEO_SELECTION: PromptVideoGenerationSelection = {
  modelValue: '',
  durationSeconds: '',
  resolution: '',
  aspectRatio: '',
}

function findVideoAsset(assets: readonly TaskAssetDto[]): TaskAssetDto | null {
  return findPromptGenerationAssets(assets, 'video')[0] ?? null
}

export function resolvePromptVideoCatalogConfig(option: ModelOption | null): VideoModelCatalogConfig | null {
  if (!option) return null
  return constrainVideoModelCatalogConfigByPricing(parseVideoModelCatalogConfig(option.meta), option.pricing)
}

export function promptVideoSelectionForModel(option: ModelOption): PromptVideoGenerationSelection {
  const config = resolvePromptVideoCatalogConfig(option)
  return {
    modelValue: option.value,
    durationSeconds: typeof config?.defaultDurationSeconds === 'number' ? String(config.defaultDurationSeconds) : '',
    resolution: config?.defaultResolution ?? '',
    aspectRatio: config?.defaultSize ?? '',
  }
}

function hasOption<T extends string | number>(options: readonly Readonly<{ value: T }>[], value: string): boolean {
  return options.some((option) => String(option.value) === value)
}

export function promptVideoSelectionIsExecutable(
  selection: PromptVideoGenerationSelection,
  config: VideoModelCatalogConfig | null,
): boolean {
  if (!selection.modelValue || !config) return false
  if (config.durationOptions.length > 0 && !hasOption(config.durationOptions, selection.durationSeconds)) return false
  if (config.resolutionOptions.length > 0 && !hasOption(config.resolutionOptions, selection.resolution)) return false
  if (config.sizeOptions.length > 0 && !hasOption(config.sizeOptions, selection.aspectRatio)) return false
  return true
}

export function promptVideoGenerationStatusLabel(status: PromptVideoGenerationStatus): string {
  if (status === 'submitting') return '正在提交真实生成任务'
  if (status === 'queued') return '任务已排队，等待供应商处理'
  if (status === 'running') return '供应商正在生成视频'
  if (status === 'accepted') return '任务已受理，可刷新状态或稍后在历史记录查看'
  if (status === 'succeeded') return '视频已生成并写入个人生成历史'
  if (status === 'failed') return '本次生成失败'
  return ''
}

export function usePromptVideoGeneration(input: Readonly<{
  entryId: string
  title: string
  initialPrompt: string
  sourceModels: readonly PromptVideoSourceModel[]
  onRequestLogin: () => void
}>): PromptVideoGenerationState {
  const token = useAuth((state) => state.token)
  const authenticated = Boolean(token)
  const modelCatalog = useModelOptionsState('video', { enabled: authenticated })
  const [prompt, setPrompt] = React.useState(input.initialPrompt)
  const [selection, setSelection] = React.useState<PromptVideoGenerationSelection>(EMPTY_PROMPT_VIDEO_SELECTION)
  const [status, setStatus] = React.useState<PromptVideoGenerationStatus>('idle')
  const [taskId, setTaskId] = React.useState('')
  const [taskVendor, setTaskVendor] = React.useState('')
  const [error, setError] = React.useState('')
  const [preview, setPreview] = React.useState<PromptGeneratedVideo | null>(null)
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
    setSelection(EMPTY_PROMPT_VIDEO_SELECTION)
    setStatus('idle')
    setTaskId('')
    setTaskVendor('')
    setError('')
    setPreview(null)
  }, [input.entryId, input.initialPrompt])

  React.useEffect(() => {
    if (!authenticated || modelCatalog.loading || modelCatalog.error || selection.modelValue) return
    if (matchedSourceOption) setSelection(promptVideoSelectionForModel(matchedSourceOption))
  }, [authenticated, matchedSourceOption, modelCatalog.error, modelCatalog.loading, selection.modelValue])

  React.useEffect(() => () => {
    generationVersionRef.current += 1
  }, [])

  const selectedOption = React.useMemo(
    () => findModelOptionByIdentifier(modelCatalog.options, selection.modelValue),
    [modelCatalog.options, selection.modelValue],
  )
  const selectedConfig = React.useMemo(() => resolvePromptVideoCatalogConfig(selectedOption), [selectedOption])
  const executableSelection = promptVideoSelectionIsExecutable(selection, selectedConfig)
  const trimmedPrompt = prompt.trim()
  const durationSeconds = Number(selection.durationSeconds)
  const specKey = buildVideoBillingSpecKey(selection.resolution, durationSeconds)
  const selectedSpecPrice = selectedOption?.pricing?.specCosts.find((candidate) => candidate.specKey === specKey && candidate.enabled !== false)
  const generationCost = selectedSpecPrice?.cost ?? selectedOption?.pricing?.cost ?? null
  const busy = status === 'submitting' || status === 'queued' || status === 'running'

  const selectModel = React.useCallback((value: string): void => {
    const option = findModelOptionByIdentifier(modelCatalog.options, value)
    setSelection(option ? promptVideoSelectionForModel(option) : EMPTY_PROMPT_VIDEO_SELECTION)
  }, [modelCatalog.options])

  const applyResult = React.useCallback((result: TaskResultDto, resultTitle: string): boolean => {
    if (result.status === 'failed') {
      setStatus('failed')
      setError(readPromptGenerationTaskFailure(result, '视频'))
      return true
    }
    if (result.status !== 'succeeded') {
      setStatus(result.status)
      return false
    }
    const asset = findVideoAsset(result.assets)
    if (!asset) {
      setStatus('failed')
      setError('任务已完成，但结果中没有真实视频 URL')
      return true
    }
    setPreview({ url: asset.url, thumbnailUrl: asset.thumbnailUrl?.trim() ?? '', title: resultTitle })
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
        taskKind: 'text_to_video',
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
      setError('请选择模型目录提供的完整视频规格')
      return
    }
    const requestModelKey = getModelOptionRequestAlias(modelCatalog.options, selectedOption.value)
    if (!requestModelKey) {
      setError('所选视频模型缺少可执行请求键')
      return
    }

    const version = generationVersionRef.current + 1
    generationVersionRef.current = version
    setStatus('submitting')
    setError('')
    try {
      const response = await runPublicTaskWithAuth({
        request: {
          kind: 'text_to_video',
          prompt: trimmedPrompt,
          extras: {
            modelKey: requestModelKey,
            awaitResult: false,
            persistAssets: true,
            sourcePromptLibraryEntryId: input.entryId,
            ...(Number.isFinite(durationSeconds) && durationSeconds > 0 ? { durationSeconds } : {}),
            ...(selection.resolution ? { resolution: selection.resolution } : {}),
            ...(selection.aspectRatio ? { aspectRatio: selection.aspectRatio, size: selection.aspectRatio } : {}),
            ...(specKey ? { specKey, videoSpecKey: specKey } : {}),
            ...(selectedConfig.supportsNativeAudio === true ? { audio: true } : {}),
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
      setError(reason instanceof Error ? reason.message : '视频生成请求失败')
    }
  }, [
    applyResult,
    authenticated,
    durationSeconds,
    executableSelection,
    input.entryId,
    input.onRequestLogin,
    input.title,
    modelCatalog.options,
    selectedConfig,
    selectedOption,
    selection.aspectRatio,
    selection.resolution,
    specKey,
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
    setSelection,
    selectModel,
    status,
    statusLabel: promptVideoGenerationStatusLabel(status),
    error,
    preview,
    setPreview,
    modelCatalog,
    sourceModelLabel,
    sourceModelUnavailable,
    selectedOption,
    selectedConfig,
    executableSelection,
    generationCost,
    busy,
    generate,
    canRefreshAcceptedTask: status === 'accepted' && Boolean(taskId),
    refreshAcceptedTask,
  }
}
