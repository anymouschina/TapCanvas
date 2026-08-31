import React from 'react'
import { ActionIcon, Button, Group, Select, Text, Textarea, Tooltip } from '@mantine/core'
import { IconActivity, IconAlertCircle, IconArrowsLeftRight, IconFocusCentered, IconMovie, IconMusic, IconPlayerPlay, IconRefresh, IconTable } from '@tabler/icons-react'
import { useReactFlow } from '@xyflow/react'
import type { ShotTableData } from '@tapcanvas/shot-table-protocol'
import {
  analyzeVideoToShotTable,
  uploadServerAssetFile,
} from '../../../../api/server'
import {
  findModelOptionByIdentifier,
  getModelOptionRequestAlias,
  useModelOptionsState,
} from '../../../../config/useModelOptions'
import { selectNodesById, useRFStore } from '../../../store'
import {
  createVideoAnalysisDeliveryId,
  createVideoAnalysisOutputTitle,
  findDeliveredShotTableNodeId,
  isVideoAnalysisActive,
  markVideoAnalysisActive,
  markVideoAnalysisSettled,
  readVideoAnalysisModelDescription,
  readVideoAnalysisText,
  readVideoUrl,
  resolveConnectedVideo,
  shouldAutoStartVideoAnalysis,
  VIDEO_ANALYSIS_CAPABILITY_TAG,
  VIDEO_ANALYSIS_DEFAULT_TAG,
  videoAnalysisErrorMessage,
  videoAnalysisErrorDetails,
  videoAnalysisModelHasTag,
  videoAnalysisRunButtonLabel,
} from './videoAnalysisRuntime'
import {
  readVideoAnalysisRuns,
  readVideoAnalysisUndeliveredResults,
} from './videoAnalysisHistory'
import './videoAnalysis.css'

export type VideoAnalysisContentProps = {
  className: string
  nodeId: string
  data: Record<string, unknown>
  readOnly: boolean
  nodeHeight: number
  nodeWidth: number
}

type ProducedAnalysis = {
  table: ShotTableData
  rawText: string
  model: string
  receivedAt: string
  videoUrl: string
  sourceVideoNodeId: string
  fps: number
  startedAt: string
  completedAt: string
  transport: unknown
  analysisExecution: unknown
}

const VIDEO_ANALYSIS_FPS_OPTIONS = [0.2, 0.5, 1, 2, 4, 5] as const
const VIDEO_ANALYSIS_DIMENSION_LABELS: Record<string, string> = {
  storyboard: '分镜',
  motion: '动态',
  music: '音乐',
}

const formatSourceDuration = (seconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  const remainder = safeSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

export function VideoAnalysisContent({
  className,
  nodeId,
  data,
  readOnly,
  nodeHeight,
  nodeWidth,
}: VideoAnalysisContentProps): JSX.Element {
  const reactFlow = useReactFlow()
  const modelState = useModelOptionsState('text')
  const edges = useRFStore((state) => state.edges)
  const addNode = useRFStore((state) => state.addNode)
  const updateNodeData = useRFStore((state) => state.updateNodeData)
  const inputEdges = React.useMemo(
    () => edges.filter((edge) => edge.target === nodeId && edge.targetHandle === 'in-video'),
    [edges, nodeId],
  )
  const sourceNodeId = inputEdges.length === 1 ? inputEdges[0]?.source ?? '' : ''
  const sourceInputError = inputEdges.length > 1
    ? '视频分析只允许一个视频输入；请移除多余连线后重试。'
    : ''
  const capabilityDeclaredModels = React.useMemo(
    () => modelState.options.filter((option) => videoAnalysisModelHasTag(option, VIDEO_ANALYSIS_CAPABILITY_TAG)),
    [modelState.options],
  )
  const capableModels = React.useMemo(
    () => capabilityDeclaredModels.filter((option) =>
      option.videoAnalysisPricing?.enabled === true
      && option.videoAnalysisPricing.mode === 'duration_metered'
      && Number.isFinite(option.videoAnalysisPricing.priceCnyPerSecond)
      && option.videoAnalysisPricing.priceCnyPerSecond > 0),
    [capabilityDeclaredModels],
  )
  const catalogDefaults = React.useMemo(
    () => capableModels.filter((option) => videoAnalysisModelHasTag(option, VIDEO_ANALYSIS_DEFAULT_TAG)),
    [capableModels],
  )
  const storedModel = readVideoAnalysisText(data.videoAnalysisModel)
  const resolvedDefault = catalogDefaults.length === 1 ? catalogDefaults[0] : null
  const selectedValue = storedModel || resolvedDefault?.value || null
  const selectedOption = findModelOptionByIdentifier(capableModels, selectedValue)
  const selectedModelLabel = selectedOption?.label?.trim() || '视频理解模型'
  const selectedDescription = readVideoAnalysisModelDescription(selectedOption)
  const selectedUpfrontPricing = selectedOption?.videoAnalysisPricing
  const [sourceDurationSeconds, setSourceDurationSeconds] = React.useState<number | null>(() => {
    const persisted = data.sourceVideoDurationSeconds
    return typeof persisted === 'number' && Number.isFinite(persisted) && persisted > 0 ? persisted : null
  })
  const [sourceDimensions, setSourceDimensions] = React.useState<{ width: number; height: number } | null>(() => {
    const width = typeof data.sourceVideoWidth === 'number' && Number.isFinite(data.sourceVideoWidth) ? data.sourceVideoWidth : 0
    const height = typeof data.sourceVideoHeight === 'number' && Number.isFinite(data.sourceVideoHeight) ? data.sourceVideoHeight : 0
    return width > 0 && height > 0 ? { width, height } : null
  })
  const selectedUpfrontCredits = selectedUpfrontPricing?.enabled === true
    && selectedUpfrontPricing.mode === 'duration_metered'
    && Number.isFinite(selectedUpfrontPricing.priceCnyPerSecond)
    && selectedUpfrontPricing.priceCnyPerSecond > 0
    && sourceDurationSeconds !== null
    ? Math.max(1, Math.ceil(sourceDurationSeconds * selectedUpfrontPricing.priceCnyPerSecond * selectedUpfrontPricing.creditsPerCny - 1e-10))
    : null
  const storedFps = typeof data.videoAnalysisFps === 'number' && Number.isFinite(data.videoAnalysisFps)
    ? data.videoAnalysisFps
    : null
  const defaultAnalysisFps = selectedUpfrontPricing
    ? Math.min(Math.max(1, selectedUpfrontPricing.limits.minFps), selectedUpfrontPricing.limits.maxFps)
    : null
  const effectiveAnalysisFps = storedFps ?? defaultAnalysisFps
  const analysisFocus = typeof data.videoAnalysisFocus === 'string' ? data.videoAnalysisFocus : ''
  const status = readVideoAnalysisText(data.status)
  const running = status === 'running'
  const sourceOverrideUrl = readVideoAnalysisText(data.videoAnalysisSourceOverrideUrl)
  const sourceSnapshotUrl = sourceOverrideUrl || readVideoAnalysisText(data.sourceVideoUrl)
  const persistedError = readVideoAnalysisText(data.videoAnalysisError)
  const latestShotTableNodeId = readVideoAnalysisText(data.latestShotTableNodeId)
  const [interactionError, setInteractionError] = React.useState('')
  const [replaceSourceBusy, setReplaceSourceBusy] = React.useState(false)
  const replaceSourceInputRef = React.useRef<HTMLInputElement>(null)
  const autoStartConsumedRef = React.useRef(false)
  const analysisSetupCompleted = data.videoAnalysisSetupCompleted === true
  const selectedDimensions = React.useMemo(() => {
    const raw = data.videoAnalysisDimensions
    if (!Array.isArray(raw)) return new Set(['storyboard', 'motion', 'music'])
    return new Set(raw.filter((value): value is string => typeof value === 'string'))
  }, [data.videoAnalysisDimensions])
  const selectedDimensionPrompt = React.useMemo(
    () => Array.from(selectedDimensions)
      .map((key) => VIDEO_ANALYSIS_DIMENSION_LABELS[key] || key)
      .join('、'),
    [selectedDimensions],
  )
  const analysisRequestPrompt = React.useMemo(() => {
    const focus = analysisFocus.trim()
    const dimensions = selectedDimensionPrompt ? `拆解维度：${selectedDimensionPrompt}` : ''
    return [focus, dimensions].filter(Boolean).join('\n')
  }, [analysisFocus, selectedDimensionPrompt])
  const promptBytes = React.useMemo(
    () => new TextEncoder().encode(analysisRequestPrompt).byteLength,
    [analysisRequestPrompt],
  )
  const runHistory = React.useMemo(
    () => readVideoAnalysisRuns(data.videoAnalysisRuns),
    [data.videoAnalysisRuns],
  )
  const undeliveredHistory = React.useMemo(
    () => readVideoAnalysisUndeliveredResults(data.videoAnalysisUndeliveredResults),
    [data.videoAnalysisUndeliveredResults],
  )

  React.useEffect(() => {
    if (!storedModel && resolvedDefault) updateNodeData(nodeId, { videoAnalysisModel: resolvedDefault.value })
  }, [nodeId, resolvedDefault, storedModel, updateNodeData])

  React.useEffect(() => {
    if (status !== 'running' || isVideoAnalysisActive(nodeId)) return
    updateNodeData(nodeId, {
      status: 'error',
      videoAnalysisPhase: '',
      videoAnalysisError: '上次同步视频分析请求已不在当前浏览器运行，无法恢复；请核对未交付记录后重新执行。',
      videoAnalysisCompletedAt: new Date().toISOString(),
    })
  }, [nodeId, status, updateNodeData])

  React.useEffect(() => {
    if (!sourceNodeId) {
      if (data.sourceVideoNodeId || data.sourceVideoUrl || sourceOverrideUrl) {
        updateNodeData(nodeId, {
          sourceVideoNodeId: '',
          sourceVideoUrl: '',
          videoAnalysisSourceOverrideUrl: '',
          videoAnalysisSourceAssetId: '',
        })
      }
      return
    }
    const source = selectNodesById(useRFStore.getState()).get(sourceNodeId)
    const url = readVideoUrl(source?.data)
    updateNodeData(nodeId, {
      sourceVideoNodeId: sourceNodeId,
      ...(sourceOverrideUrl ? {} : { sourceVideoUrl: url }),
    })
  }, [data.sourceVideoNodeId, data.sourceVideoUrl, nodeId, sourceNodeId, sourceOverrideUrl, updateNodeData])

  const readUploadedVideoDuration = React.useCallback((file: File): Promise<number | null> => {
    const localUrl = URL.createObjectURL(file)
    return new Promise<number | null>((resolve) => {
      const probe = document.createElement('video')
      const finish = (value: number | null) => {
        probe.removeAttribute('src')
        probe.load()
        URL.revokeObjectURL(localUrl)
        resolve(value)
      }
      probe.preload = 'metadata'
      probe.onloadedmetadata = () => {
        const duration = probe.duration
        finish(Number.isFinite(duration) && duration > 0 ? duration : null)
      }
      probe.onerror = () => finish(null)
      probe.src = localUrl
    })
  }, [])

  const handleReplaceSource = React.useCallback(async (file: File | undefined): Promise<void> => {
    if (!file || readOnly || replaceSourceBusy) return
    if (!file.type.startsWith('video/')) {
      setInteractionError('替换素材只支持视频文件。')
      return
    }
    if (file.size > 500 * 1024 * 1024) {
      setInteractionError('替换素材不能超过 500MB。')
      return
    }
    setInteractionError('')
    setReplaceSourceBusy(true)
    try {
      const duration = await readUploadedVideoDuration(file)
      const title = file.name.replace(/\.[a-z0-9]+$/i, '').trim() || '视频分析素材'
      const hosted = await uploadServerAssetFile(file, title, { ownerNodeId: nodeId })
      const hostedUrl = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
      if (!hostedUrl) throw new Error('替换素材上传成功但没有返回真实视频链接。')
      updateNodeData(nodeId, {
        videoAnalysisSourceOverrideUrl: hostedUrl,
        videoAnalysisSourceAssetId: hosted.id,
        sourceVideoUrl: hostedUrl,
        ...(duration === null ? {} : { sourceVideoDurationSeconds: duration }),
        videoAnalysisSetupCompleted: false,
        videoAnalysisError: '',
      })
      if (duration !== null) setSourceDurationSeconds(duration)
    } catch (error: unknown) {
      setInteractionError(error instanceof Error ? error.message : '替换视频素材失败。')
    } finally {
      setReplaceSourceBusy(false)
    }
  }, [nodeId, readOnly, readUploadedVideoDuration, replaceSourceBusy, updateNodeData])

  const catalogError = modelState.error
    ? `模型目录加载失败：${modelState.error.message}`
    : capabilityDeclaredModels.length === 0 && !modelState.loading
      ? '系统模型目录没有声明视频分析能力的可执行模型。'
      : capableModels.length === 0 && !modelState.loading
        ? '系统模型目录声明了视频分析模型，但没有配置可执行的按时长价格。'
      : catalogDefaults.length > 1
        ? '系统模型目录声明了多个视频分析默认模型，请管理员修正目录。'
        : storedModel && !selectedOption
          ? `节点保存的模型“${storedModel}”当前不可执行。`
          : ''
  const selectionError = !modelState.loading && capableModels.length > 0 && !selectedOption && !catalogError
    ? '请选择一个当前可执行的视频分析模型。'
    : ''
  const structuralError = runHistory.error
    ? `${runHistory.error} 为避免覆盖记录，当前禁止继续分析。`
    : undeliveredHistory.error
      ? `${undeliveredHistory.error} 为避免覆盖未交付结果，当前禁止继续分析。`
      : sourceInputError
  const promptLimitError = selectedUpfrontPricing
    && promptBytes > selectedUpfrontPricing.limits.maxPromptBytes
    ? `视频分析补充要求最多 ${selectedUpfrontPricing.limits.maxPromptBytes} 字节；当前为 ${promptBytes} 字节。`
    : ''
  const activeError = structuralError
    || catalogError
    || selectionError
    || promptLimitError
    || persistedError
    || interactionError

  const locateLatestShotTable = React.useCallback(async (): Promise<void> => {
    setInteractionError('')
    if (!latestShotTableNodeId) {
      setInteractionError('当前视频分析节点没有可定位的分镜表交付记录。')
      return
    }
    if (!reactFlow.getNode(latestShotTableNodeId)) {
      setInteractionError(`最近交付的分镜表节点“${latestShotTableNodeId}”已不在当前画布。`)
      return
    }
    try {
      await reactFlow.fitView({
        nodes: [{ id: latestShotTableNodeId }],
        padding: 0.18,
        duration: 420,
        maxZoom: 1,
      })
    } catch (focusError: unknown) {
      setInteractionError(videoAnalysisErrorMessage(focusError))
    }
  }, [latestShotTableNodeId, reactFlow])

  const runAnalysis = React.useCallback(async (): Promise<void> => {
    if (readOnly) return
    setInteractionError('')
    let produced: ProducedAnalysis | null = null
    let outputNodeId: string | null = null
    let deliveryId: string | null = null
    let activeRequest = false
    let failureStage: 'video_analysis' | 'delivery' = 'video_analysis'
    let attempt: {
      startedAt: string
      model: string
      fps: number
      sourceVideoNodeId: string
      sourceVideoUrl: string
    } | null = null
    try {
      if (runHistory.error) throw new Error(structuralError)
      if (undeliveredHistory.error) throw new Error(structuralError)
      if (modelState.loading) throw new Error('视频分析模型目录仍在加载，请等待加载完成后重试。')
      if (modelState.error) throw new Error(`视频分析模型目录加载失败：${modelState.error.message}`)
      const connectedVideo = resolveConnectedVideo(nodeId)
      const analysisVideoUrl = sourceOverrideUrl || connectedVideo.videoUrl
      if (!selectedOption) throw new Error(catalogError || '必须从系统模型目录明确选择视频分析模型。')
      if (!selectedUpfrontPricing || selectedUpfrontCredits === null) {
        throw new Error('所选模型没有可执行的按时长价格。')
      }
      if (
        effectiveAnalysisFps === null
        || effectiveAnalysisFps < selectedUpfrontPricing.limits.minFps
        || effectiveAnalysisFps > selectedUpfrontPricing.limits.maxFps
      ) {
        throw new Error(`必须明确选择 ${selectedUpfrontPricing.limits.minFps}–${selectedUpfrontPricing.limits.maxFps} 范围内的分析帧率。`)
      }
      const requestModel = getModelOptionRequestAlias(capableModels, selectedOption.value)
      if (!requestModel) throw new Error('模型目录没有返回可执行 requestModelKey。')
      const analysisFps = effectiveAnalysisFps
      markVideoAnalysisActive(nodeId)
      activeRequest = true
      const startedAt = new Date().toISOString()
      attempt = {
        startedAt,
        model: requestModel,
        fps: analysisFps,
        sourceVideoNodeId: connectedVideo.sourceNodeId,
        sourceVideoUrl: analysisVideoUrl,
      }
      updateNodeData(nodeId, {
        status: 'running',
        videoAnalysisError: '',
        videoAnalysisPhase: 'video_analysis',
        sourceVideoNodeId: connectedVideo.sourceNodeId,
        sourceVideoUrl: analysisVideoUrl,
        videoAnalysisStartedAt: startedAt,
      })
      const response = await analyzeVideoToShotTable({
        model: requestModel,
        videoUrl: analysisVideoUrl,
        userPrompt: analysisRequestPrompt,
        fps: analysisFps,
      })
      const receivedAt = new Date().toISOString()
      produced = {
        table: response.table,
        rawText: response.text,
        model: response.model,
        receivedAt,
        videoUrl: analysisVideoUrl,
        sourceVideoNodeId: connectedVideo.sourceNodeId,
        fps: analysisFps,
        startedAt,
        completedAt: new Date().toISOString(),
        transport: response.transport,
        analysisExecution: response.analysisExecution,
      }

      failureStage = 'delivery'
      deliveryId = createVideoAnalysisDeliveryId()
      addNode('taskNode', createVideoAnalysisOutputTitle(), {
        kind: 'shotTable',
        nodeWidth: 920,
        nodeHeight: 620,
        shotTable: produced.table,
        shotTableRawText: produced.rawText,
        shotTableViewMode: 'table',
        shotTableCurrentSource: '逐帧拉片 · 视频理解模型观察记录',
        shotTableCurrentNote: `视频观察模型：${produced.model} · 结构已校验：镜头数、时间轴与媒体总时长 · 内容仍需回看原视频确认 · 未经创作 Skill 改写`,
        shotTableHistory: [],
        shotTableAssetBindings: [],
        prompt: produced.rawText,
        sourceVideoUrl: produced.videoUrl,
        sourceVideoNodeId: produced.sourceVideoNodeId,
        sourceVideoAnalysisNodeId: nodeId,
        videoAnalysisDeliveryId: deliveryId,
        analysisModel: produced.model,
        analysisFps: produced.fps,
        analysisCompletedAt: produced.receivedAt,
        analysisTransport: produced.transport,
        analysisExecution: produced.analysisExecution,
        status: 'success',
      })
      const stateAfterAdd = useRFStore.getState()
      outputNodeId = findDeliveredShotTableNodeId(deliveryId)
      if (!outputNodeId) throw new Error('视频分析已完成，但画布没有按交付标识创建分镜表节点。')
      const sourceNode = selectNodesById(stateAfterAdd).get(nodeId)
      if (!sourceNode) throw new Error('分镜表已创建，但原视频分析节点已不存在，无法完成定位与连线。')
      stateAfterAdd.onNodesChange([{
        id: outputNodeId,
        type: 'position',
        position: {
          x: sourceNode.position.x + nodeWidth + 80,
          y: sourceNode.position.y,
        },
        dragging: false,
      }])
      stateAfterAdd.onConnect({
        source: nodeId,
        sourceHandle: 'out-text',
        target: outputNodeId,
        targetHandle: 'in-text',
      })
      const connected = useRFStore.getState().edges.some((edge) =>
        edge.source === nodeId
        && edge.sourceHandle === 'out-text'
        && edge.target === outputNodeId
        && edge.targetHandle === 'in-text')
      const previousRuns = runHistory.entries
      const connectionError = connected ? '' : '分镜表已创建，但分析节点到分镜表的连线失败。'
      updateNodeData(nodeId, {
        status: connected ? 'success' : 'error',
        videoAnalysisPhase: '',
        videoAnalysisError: connectionError,
        videoAnalysisCompletedAt: produced.completedAt,
        latestShotTableNodeId: outputNodeId,
        videoAnalysisRuns: [...previousRuns, {
          startedAt: produced.startedAt,
          completedAt: produced.completedAt,
          model: produced.model,
          fps: produced.fps,
          sourceVideoNodeId: produced.sourceVideoNodeId,
          sourceVideoUrl: produced.videoUrl,
          analysisTransport: produced.transport,
          analysisExecution: produced.analysisExecution,
          outputNodeId,
          deliveryId,
          delivery: connected ? 'created_and_connected' : 'created_connection_failed',
          ...(connectionError ? { error: connectionError } : {}),
        }],
      })
    } catch (runError: unknown) {
      const error = videoAnalysisErrorMessage(runError)
      const errorDetails = videoAnalysisErrorDetails(runError)
      const completedAt = new Date().toISOString()
      const previousRuns = runHistory.entries
      const previousOrphans = undeliveredHistory.entries
      updateNodeData(nodeId, {
        status: 'error',
        videoAnalysisPhase: '',
        videoAnalysisError: error,
        videoAnalysisCompletedAt: completedAt,
        ...(produced && outputNodeId ? {
          latestShotTableNodeId: outputNodeId,
          videoAnalysisRuns: [...previousRuns, {
            startedAt: produced.startedAt,
            completedAt,
            model: produced.model,
            fps: produced.fps,
            sourceVideoNodeId: produced.sourceVideoNodeId,
            sourceVideoUrl: produced.videoUrl,
            analysisTransport: produced.transport,
            analysisExecution: produced.analysisExecution,
            outputNodeId,
            deliveryId,
            delivery: 'created_postprocess_failed',
            failureStage,
            error,
            ...(errorDetails === undefined ? {} : { errorDetails }),
          }],
        } : produced ? {
          videoAnalysisUndeliveredResults: [...previousOrphans, {
            ...produced,
            sourceVideoUrl: produced.videoUrl,
            deliveryId,
            failureStage,
            deliveryError: error,
            ...(errorDetails === undefined ? {} : { errorDetails }),
          }],
        } : attempt ? {
          videoAnalysisRuns: [...previousRuns, {
            ...attempt,
            completedAt,
            outputNodeId: null,
            delivery: 'analysis_failed',
            failureStage,
            error,
            ...(errorDetails === undefined ? {} : { errorDetails }),
          }],
        } : {}),
      })
    } finally {
      if (activeRequest) markVideoAnalysisSettled(nodeId)
    }
  }, [addNode, analysisRequestPrompt, capableModels, catalogError, effectiveAnalysisFps, modelState.error, modelState.loading, nodeId, nodeWidth, readOnly, runHistory.entries, runHistory.error, selectedOption, selectedUpfrontCredits, selectedUpfrontPricing, sourceOverrideUrl, structuralError, undeliveredHistory.entries, undeliveredHistory.error, updateNodeData])

  React.useEffect(() => {
    const requested = data.videoAnalysisAutoStart === true
    if (!requested) {
      autoStartConsumedRef.current = false
      return
    }
    if (autoStartConsumedRef.current) return
    const ready = shouldAutoStartVideoAnalysis({
      requested,
      readOnly,
      running,
      modelLoading: modelState.loading,
      blockingError: structuralError || catalogError || selectionError || promptLimitError || persistedError,
      hasSelectedModel: Boolean(selectedOption),
      hasQuotedCredits: selectedUpfrontCredits !== null,
      hasSourceNode: Boolean(sourceNodeId),
      hasFps: effectiveAnalysisFps !== null,
    })
    if (!ready) return
    autoStartConsumedRef.current = true
    updateNodeData(nodeId, { videoAnalysisAutoStart: false })
    void runAnalysis()
  }, [
    catalogError,
    data.videoAnalysisAutoStart,
    modelState.loading,
    nodeId,
    persistedError,
    promptLimitError,
    readOnly,
    runAnalysis,
    running,
    selectedOption,
    selectedUpfrontCredits,
    selectionError,
    sourceNodeId,
    effectiveAnalysisFps,
    structuralError,
    updateNodeData,
  ])

  if (!analysisSetupCompleted) {
    const dimensionOptions = [
      { key: 'storyboard', label: '分镜', icon: <IconTable size={16} /> },
      { key: 'motion', label: '动态', icon: <IconActivity size={16} /> },
      { key: 'music', label: '音乐', icon: <IconMusic size={16} /> },
    ]
    return (
      <section className={`tc-video-analysis tc-video-analysis--libtv-setup nodrag nopan ${className}`} aria-label="逐帧拉片">
        <Group className="tc-video-analysis__libtv-heading" gap={6} wrap="nowrap">
          <IconMovie size={20} />
          <Text size="sm" fw={600}>逐帧拉片</Text>
          <Tooltip label={`${selectedModelLabel} · 视频理解模型`} withArrow>
            <span className="tc-video-analysis__libtv-model">视频理解</span>
          </Tooltip>
        </Group>
        <Text className="tc-video-analysis__libtv-description" size="10px" c="dimmed">
          按选定帧率抽帧，调用视频理解模型生成结构化拉片表；不调用视频生成模型。
        </Text>
        <Group className="tc-video-analysis__libtv-meta" justify="space-between" gap={8} wrap="nowrap">
          <div>
            <Text size="xs" c="dimmed">视频素材</Text>
            <Text size="xs" c="dimmed">
              {sourceDurationSeconds
                ? `${formatSourceDuration(sourceDurationSeconds)}${sourceDimensions ? ` · ${sourceDimensions.width}×${sourceDimensions.height}` : ''}`
                : '读取中'}
            </Text>
          </div>
        </Group>
        <div
          className="tc-video-analysis__libtv-preview"
          style={{
            aspectRatio: sourceDimensions ? `${sourceDimensions.width} / ${sourceDimensions.height}` : '16 / 9',
          }}
        >
          {sourceSnapshotUrl ? (
            <video
              src={sourceSnapshotUrl}
              muted
              playsInline
              preload="metadata"
              onLoadedMetadata={(event) => {
                const duration = event.currentTarget.duration
                const width = event.currentTarget.videoWidth
                const height = event.currentTarget.videoHeight
                if (Number.isFinite(duration) && duration > 0) {
                  setSourceDurationSeconds(duration)
                  updateNodeData(nodeId, {
                    sourceVideoDurationSeconds: duration,
                    ...(width > 0 && height > 0 ? { sourceVideoWidth: width, sourceVideoHeight: height } : {}),
                  })
                }
                if (width > 0 && height > 0) setSourceDimensions({ width, height })
              }}
            />
          ) : (
            <div className="tc-video-analysis__source-empty">
              <IconMovie size={24} />
              <Text size="xs" c="dimmed">请连接真实视频节点</Text>
            </div>
          )}
          <input
            ref={replaceSourceInputRef}
            className="tc-video-analysis__replace-input"
            type="file"
            accept="video/*"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              void handleReplaceSource(file)
            }}
          />
          <ActionIcon
            className="tc-video-analysis__replace-source"
            size="sm"
            variant="filled"
            loading={replaceSourceBusy}
            disabled={readOnly || replaceSourceBusy}
            onClick={() => replaceSourceInputRef.current?.click()}
            aria-label="替换素材"
          >
            <IconArrowsLeftRight size={13} />
          </ActionIcon>
        </div>
        <Text className="tc-video-analysis__libtv-section-label" size="xs" c="dimmed">拆解维度</Text>
        <Group className="tc-video-analysis__libtv-dimensions" gap={8} wrap="nowrap">
          {dimensionOptions.map((option) => {
            const active = selectedDimensions.has(option.key)
            return (
              <button
                key={option.key}
                type="button"
                className={active ? 'is-active' : ''}
                aria-pressed={active}
                disabled={readOnly}
                onClick={() => {
                  const next = new Set(selectedDimensions)
                  if (active) next.delete(option.key)
                  else next.add(option.key)
                  updateNodeData(nodeId, { videoAnalysisDimensions: Array.from(next) })
                }}
              >
                {option.icon}
                <span>{option.label}</span>
              </button>
            )
          })}
        </Group>
        <Group className="tc-video-analysis__libtv-config" gap={8} wrap="nowrap">
          <Select
            className="tc-video-analysis__libtv-model-select"
            size="xs"
            searchable
            value={selectedValue}
            data={capableModels.map((option) => ({ value: option.value, label: option.label }))}
            placeholder={modelState.loading ? '加载模型目录…' : '选择视频理解模型'}
            disabled={readOnly || modelState.loading}
            nothingFoundMessage="没有视频理解模型"
            onChange={(value) => updateNodeData(nodeId, { videoAnalysisModel: value ?? '' })}
            aria-label="视频理解模型"
          />
          <Select
            className="tc-video-analysis__libtv-fps-select"
            size="xs"
            value={effectiveAnalysisFps === null ? null : String(effectiveAnalysisFps)}
            data={(selectedUpfrontPricing
              ? VIDEO_ANALYSIS_FPS_OPTIONS.filter((value) =>
                  value >= selectedUpfrontPricing.limits.minFps
                  && value <= selectedUpfrontPricing.limits.maxFps)
              : []).map((value) => ({ value: String(value), label: `${value} fps` }))}
            placeholder="选择抽帧率"
            allowDeselect={false}
            disabled={readOnly || !selectedUpfrontPricing}
            onChange={(value) => updateNodeData(nodeId, {
              videoAnalysisFps: value === null ? null : Number(value),
            })}
            aria-label="视频分析帧率"
          />
        </Group>
        {catalogError || selectionError ? (
          <Text size="xs" c="red">{catalogError || selectionError}</Text>
        ) : null}
        <Button
          className="tc-video-analysis__libtv-start"
          size="sm"
          variant="white"
          disabled={readOnly || !sourceSnapshotUrl || selectedDimensions.size === 0 || !selectedOption || effectiveAnalysisFps === null || Boolean(catalogError || selectionError || promptLimitError)}
          onClick={() => {
            if (!selectedOption || effectiveAnalysisFps === null) return
            updateNodeData(nodeId, {
              videoAnalysisSetupCompleted: true,
              videoAnalysisModel: selectedOption.value,
              videoAnalysisFps: effectiveAnalysisFps,
            })
            void runAnalysis()
          }}
        >
          开始拉片
        </Button>
      </section>
    )
  }

  const contentHeight = Math.max(250, nodeHeight - 72)
  return (
    <section className={`tc-video-analysis nodrag nopan ${className}`} style={{ height: contentHeight }} aria-label="视频分析">
      <div className="tc-video-analysis__source">
        {sourceSnapshotUrl ? (
          <video
            className="tc-video-analysis__preview nodrag nopan nowheel"
            src={sourceSnapshotUrl}
            controls
            preload="metadata"
            onLoadedMetadata={(event) => {
              const duration = event.currentTarget.duration
              const nextDuration = Number.isFinite(duration) && duration > 0 ? duration : null
              const width = event.currentTarget.videoWidth
              const height = event.currentTarget.videoHeight
              setSourceDurationSeconds(nextDuration)
              if (width > 0 && height > 0) setSourceDimensions({ width, height })
              if (nextDuration !== null) {
                updateNodeData(nodeId, {
                  sourceVideoDurationSeconds: nextDuration,
                  ...(width > 0 && height > 0 ? { sourceVideoWidth: width, sourceVideoHeight: height } : {}),
                })
              }
            }}
            onError={() => setSourceDurationSeconds(null)}
          />
        ) : (
          <div className="tc-video-analysis__source-empty">
            <IconMovie className="tc-video-analysis__source-icon" size={24} />
            <Text className="tc-video-analysis__source-text" size="xs" c="dimmed">
              {sourceNodeId ? '视频节点已连接，尚无真实视频 URL' : '连接一个视频节点到左侧输入'}
            </Text>
          </div>
        )}
      </div>
      <div className="tc-video-analysis__controls">
        <div className="tc-video-analysis__control-scroll nodrag nopan nowheel">
          <Group className="tc-video-analysis__control-row" gap={6} wrap="nowrap">
            <Select
              className="tc-video-analysis__model-select"
              size="xs"
              searchable
              value={selectedValue}
              data={capableModels.map((option) => ({ value: option.value, label: option.label }))}
              placeholder={modelState.loading ? '加载模型目录…' : '选择视频分析模型'}
              disabled={readOnly || running || modelState.loading}
              nothingFoundMessage="没有视频分析模型"
              onChange={(value) => updateNodeData(nodeId, { videoAnalysisModel: value ?? '' })}
              aria-label="视频分析模型"
            />
            <Select
              className="tc-video-analysis__fps-select"
              size="xs"
              value={storedFps === null ? null : String(storedFps)}
              data={(selectedUpfrontPricing
                ? VIDEO_ANALYSIS_FPS_OPTIONS.filter((value) =>
                    value >= selectedUpfrontPricing.limits.minFps
                    && value <= selectedUpfrontPricing.limits.maxFps)
                : []).map((value) => ({ value: String(value), label: `${value} fps` }))}
              placeholder="帧率"
              allowDeselect={false}
              disabled={readOnly || running}
              onChange={(value) => updateNodeData(nodeId, {
                videoAnalysisFps: value === null ? null : Number(value),
              })}
              aria-label="视频分析帧率"
            />
          </Group>
          {selectedDescription || selectedUpfrontCredits !== null ? (
            <Text className="tc-video-analysis__model-meta" size="xs" c="dimmed">
              {[
                selectedDescription,
                selectedUpfrontCredits === null ? '' : `视频观察提取约 ${selectedUpfrontCredits} 积分`,
                selectedUpfrontPricing ? `≤${selectedUpfrontPricing.limits.maxDurationSeconds} 秒` : '',
                selectedUpfrontPricing ? `输入封顶 ${selectedUpfrontPricing.tokenBudget.maxTotalInputTokens.toLocaleString()} tokens` : '',
                selectedUpfrontPricing ? `输出封顶 ${selectedUpfrontPricing.tokenBudget.maxOutputTokens.toLocaleString()} tokens` : '',
                sourceDurationSeconds === null ? '读取视频时长后报价' : `参考视频 ${sourceDurationSeconds.toFixed(1)} 秒`,
                '按实际时长计费',
                '交付：模型观察表（事实型字段，不做创作改写）',
              ].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
          <Textarea
            className="tc-video-analysis__prompt nodrag nopan nowheel"
            size="xs"
            autosize
            minRows={3}
            maxRows={7}
            value={analysisFocus}
            readOnly={readOnly || running}
            onChange={(event) => updateNodeData(nodeId, { videoAnalysisFocus: event.currentTarget.value })}
            placeholder="补充需要观察的对象或维度；未知内容留空，不生成导演推断或裂变方案"
            aria-label="视频分析要求"
          />
          {activeError ? (
            <div className="tc-video-analysis__error">
              <IconAlertCircle className="tc-video-analysis__error-icon" size={14} />
              <Text className="tc-video-analysis__error-text" size="xs" c="red">{activeError}</Text>
            </div>
          ) : null}
          {latestShotTableNodeId ? (
            <Group className="tc-video-analysis__delivery" gap={6} justify="space-between" wrap="nowrap">
              <Text className="tc-video-analysis__delivery-text" size="xs" c="dimmed">最近一次交付已追加到独立分镜表节点</Text>
              <Tooltip className="tc-video-analysis__delivery-tooltip" label="定位最近分镜表">
                <ActionIcon
                  className="tc-video-analysis__delivery-focus"
                  size="sm"
                  variant="subtle"
                  onClick={() => { void locateLatestShotTable() }}
                  aria-label="定位最近分镜表"
                >
                  <IconFocusCentered className="tc-video-analysis__delivery-icon" size={15} />
                </ActionIcon>
              </Tooltip>
            </Group>
          ) : null}
        </div>
        <div className="tc-video-analysis__actions">
          <Button
            className="tc-video-analysis__run"
            size="compact-sm"
            variant="light"
            leftSection={running
              ? <IconTable className="tc-video-analysis__button-icon" size={15} />
              : status === 'error'
                ? <IconRefresh className="tc-video-analysis__button-icon" size={15} />
                : <IconPlayerPlay className="tc-video-analysis__button-icon" size={15} />}
            loading={running}
            disabled={readOnly || running || modelState.loading || Boolean(catalogError || structuralError || selectionError || promptLimitError) || !selectedOption || selectedUpfrontCredits === null || !sourceNodeId || storedFps === null}
            rightSection={selectedUpfrontCredits === null
              ? undefined
              : <span className="tc-video-analysis__run-credits">视频分析约 {selectedUpfrontCredits} 积分</span>}
            onClick={() => { void runAnalysis() }}
          >
            {videoAnalysisRunButtonLabel(status)}
          </Button>
        </div>
      </div>
    </section>
  )
}
