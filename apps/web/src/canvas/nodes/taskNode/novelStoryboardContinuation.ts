import {
  createAgentPipelineRun,
  executeAgentPipelineRun,
} from '../../../api/server'
import { toast } from '../../../ui/toast'
import { useRFStore } from '../../store'
import {
  STORYBOARD_SELECTION_PROTOCOL_VERSION,
  normalizeStoryboardReferenceBindings,
  normalizeStoryboardSelectionContext,
  type StoryboardReferenceBinding,
  type StoryboardSelectionContext,
} from '@tapcanvas/storyboard-selection-protocol'
import {
  deriveShotPromptsFromStructuredData,
  normalizeStoryboardStructuredData,
  STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION,
  type StoryboardStructuredData,
} from '../../../storyboard/storyboardStructure'

type CanvasStore = ReturnType<typeof useRFStore.getState>
type CanvasNode = CanvasStore['nodes'][number]

export type NovelStoryboardProgressMeta = {
  projectId: string
  bookId: string
  taskId: string
  chapter: number
  currentShotEnd: number
}

type NovelStoryboardContinuationInput = {
  progressMeta: NovelStoryboardProgressMeta
  data: Record<string, unknown>
  nodeId: string
  addNode: CanvasStore['addNode']
  appendLog: CanvasStore['appendLog']
  resolveImageEditModelForAction: (requestedModel?: string | null) => string | null
  setNodeStatus: CanvasStore['setNodeStatus']
  updateNodeData: CanvasStore['updateNodeData']
}

function readCanvasNodeWidth(node: CanvasNode | undefined): number {
  const styleWidth = Number(node?.style?.width)
  if (Number.isFinite(styleWidth) && styleWidth > 0) return styleWidth
  const measuredWidth = Number(node?.measured?.width)
  return Number.isFinite(measuredWidth) && measuredWidth > 0 ? measuredWidth : 980
}

export function normalizeStoryboardSelectionProtocolGroupSize(
  value: unknown,
): StoryboardSelectionContext['groupSize'] | undefined {
  const numeric = Math.trunc(Number(value))
  if (numeric === 1 || numeric === 4 || numeric === 9 || numeric === 25) {
    return numeric
  }
  return undefined
}

function buildStoryboardSelectionContextOrThrow(
  input: Omit<StoryboardSelectionContext, 'version'>,
): StoryboardSelectionContext {
  const normalized = normalizeStoryboardSelectionContext({
    version: STORYBOARD_SELECTION_PROTOCOL_VERSION,
    ...input,
  })
  if (!normalized) {
    throw new Error('分镜选择协议构造失败')
  }
  return normalized
}

export function buildStoryboardChunkScript(shotItems: Array<{ shotNo: number; script: string }>): string {
  return shotItems
    .map((item) => `镜头 ${item.shotNo}：${item.script}`)
    .join('\n')
}

export function buildReplayStoryboardChunkId(input: {
  taskId: string
  chunkId?: string | null
  chunkIndex: number
}): string {
  const normalizedChunkId = String(input.chunkId || '').trim()
  if (normalizedChunkId) return normalizedChunkId.slice(0, 200)
  const normalizedTaskId = String(input.taskId || '').trim() || 'task'
  return `task-${normalizedTaskId}-chunk-${input.chunkIndex}`.slice(0, 200)
}

export async function runNovelStoryboardContinuation({
  progressMeta,
  data,
  nodeId: id,
  addNode,
  appendLog,
  resolveImageEditModelForAction,
  setNodeStatus,
  updateNodeData,
}: NovelStoryboardContinuationInput): Promise<void> {
    let storyboardPlaceholderNodeId = ''
    try {
      const chapterNo = Math.max(1, Math.trunc(Number(progressMeta.chapter || 1)))
      const taskId = String(progressMeta.taskId || '').trim()
      const sourceNodeData = data as Record<string, unknown>
      const currentChunkIndexRaw = Number(sourceNodeData.storyboardChunkIndex)
      const currentChunkIndex = Number.isFinite(currentChunkIndexRaw)
        ? Math.max(0, Math.trunc(currentChunkIndexRaw))
        : Math.max(0, Math.floor(Math.max(0, progressMeta.currentShotEnd - 1) / 25))
      const previousChunkId = typeof sourceNodeData.storyboardChunkId === 'string'
        ? sourceNodeData.storyboardChunkId.trim()
        : ''
      const nextShotStart = Math.max(1, progressMeta.currentShotEnd + 1)
      const nextShotEnd = nextShotStart + 24
      const chunkIndex = currentChunkIndex + 1
      const storyboardAspectRatio =
        typeof sourceNodeData.storyboardAspectRatio === 'string' && sourceNodeData.storyboardAspectRatio.trim()
          ? sourceNodeData.storyboardAspectRatio.trim()
          : '16:9'
      const requestedImageModel =
        typeof sourceNodeData.imageModel === 'string' ? sourceNodeData.imageModel.trim() : ''
      const imageModelKey = resolveImageEditModelForAction(requestedImageModel || null)
      if (!imageModelKey) {
        throw new Error('无法续写分镜：当前没有可用图片模型')
      }
      const storyboardStoryContext =
        typeof sourceNodeData.storyboardStoryContext === 'string' && sourceNodeData.storyboardStoryContext.trim()
          ? sourceNodeData.storyboardStoryContext.trim()
          : undefined
      const createReplayTaskNode = (label: string, payload: Record<string, unknown>): string => {
        const creationId = crypto.randomUUID()
        addNode('taskNode', label, {
          ...payload,
          storyboardClientCreationId: creationId,
        })
        const createdNode = useRFStore
          .getState()
          .nodes
          .find((node) => {
            const nodeData = node.data as Record<string, unknown> | undefined
            return nodeData?.storyboardClientCreationId === creationId
          })
        return createdNode?.id ? String(createdNode.id) : ''
      }

      storyboardPlaceholderNodeId = createReplayTaskNode(
        `分镜续写 · 任务 ${taskId} 镜头${nextShotStart}-${nextShotEnd}`,
        {
          kind: 'novelStoryboard',
          autoLabel: false,
          storyboardCount: 25,
          storyboardAspectRatio,
          storyboardStyle: 'realistic',
          imageModel: imageModelKey,
          sourceBookId: progressMeta.bookId,
          storyboardTaskId: taskId,
          storyboardPreviousChunkId: previousChunkId || undefined,
          chapter: chapterNo,
          materialChapter: chapterNo,
          source: 'novel_storyboard_pipeline_placeholder',
          storyboardGroupSize: 25,
          storyboardChunkIndex: chunkIndex,
          storyboardShotStart: nextShotStart,
          storyboardShotEnd: nextShotEnd,
          storyboardStoryContext,
          storyboardPipelineStatus: 'queued',
          status: 'queued',
          progress: 0,
        },
      )
      if (!storyboardPlaceholderNodeId) {
        throw new Error('无法创建后续分镜 queued 占位节点')
      }
      const placeholderStore = useRFStore.getState()
      placeholderStore.onConnect({
        source: id,
        sourceHandle: 'out-image-wide',
        target: storyboardPlaceholderNodeId,
        targetHandle: 'in-image-wide',
      })
      appendLog(storyboardPlaceholderNodeId, `[${new Date().toLocaleTimeString()}] queued: 等待 agents pipeline 生成并审查下一组 25 镜`)

      if (progressMeta.currentShotEnd > 0 && !previousChunkId) {
        throw new Error('当前分镜节点缺少已持久化 storyboardChunkId，无法建立下一组精确连续性引用')
      }
      const runTitle = `分镜渐进续写 · ${new Date().toLocaleString()}`
      const runGoal = '仅生成当前全书进度的下一组 25 镜头（从当前节点继续）'

      const created = await createAgentPipelineRun({
        projectId: progressMeta.projectId,
        title: runTitle,
        goal: runGoal,
        stages: [
          'material_ingest',
          'script_breakdown',
          'storyboard_generation',
          'shot_planning',
          'image_generation',
          'video_generation',
          'qc_publish',
        ],
      })
      setNodeStatus(storyboardPlaceholderNodeId, 'running', {
        progress: 5,
        storyboardPipelineStatus: 'running',
        storyboardPipelineRunId: created.id,
      })
      appendLog(storyboardPlaceholderNodeId, `[${new Date().toLocaleTimeString()}] running: agents pipeline run=${created.id}`)
      const lastDoneResult: Awaited<ReturnType<typeof executeAgentPipelineRun>> = await executeAgentPipelineRun(created.id, {
        chapter: chapterNo,
        bookId: progressMeta.bookId,
        progress: {
          taskId,
          ...(previousChunkId ? { previousChunkId } : null),
          mode: 'single',
          groupSize: 25,
          nextShotStart,
          nextShotEnd,
        },
      })
      if (lastDoneResult.status !== 'succeeded') {
        throw new Error(lastDoneResult.errorMessage?.trim() || `agents pipeline 未成功完成：${lastDoneResult.status}`)
      }
      const pipelineResult = lastDoneResult.result
      const rawArtifact = pipelineResult?.storyboardArtifact
      if (!rawArtifact || typeof rawArtifact !== 'object' || Array.isArray(rawArtifact)) {
        throw new Error('agents pipeline 未返回完整 storyboard-director/v1.2 artifact')
      }
      if (rawArtifact.schemaVersion !== STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION) {
        throw new Error('agents pipeline 返回的 artifact 不是 storyboard-director/v1.2')
      }
      const storyboardArtifact = rawArtifact as Record<string, unknown>
      const normalizedArtifact = normalizeStoryboardStructuredData(storyboardArtifact)
      if (!normalizedArtifact || normalizedArtifact.sourceSchemaVersion !== STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION) {
        throw new Error('agents pipeline 的 v1.2 artifact 无法形成确定性结构投影')
      }
      const storyboardStructured: StoryboardStructuredData | null | undefined = pipelineResult?.storyboardStructured
      if (!storyboardStructured || storyboardStructured.sourceSchemaVersion !== STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION) {
        throw new Error('agents pipeline 未返回 storyboard-director/v1.2 确定性结构投影')
      }
      const artifactPrompts = deriveShotPromptsFromStructuredData(normalizedArtifact)
      const projectionPrompts = deriveShotPromptsFromStructuredData(storyboardStructured)
      if (
        artifactPrompts.length !== projectionPrompts.length ||
        artifactPrompts.some((prompt, index) => prompt !== projectionPrompts[index])
      ) {
        throw new Error('agents pipeline 的原始 artifact 与结构投影不一致')
      }
      if (artifactPrompts.length !== 25 || normalizedArtifact.shots.length !== 25) {
        throw new Error(`本次续写要求 25 镜，agents pipeline 实际返回 ${artifactPrompts.length} 镜`)
      }
      const storyboardPlanId = String(pipelineResult?.storyboardPlanId || '').trim()
      if (!storyboardPlanId) {
        throw new Error('agents pipeline 未返回已持久化 storyboardPlanId')
      }
      const validatedShots = normalizedArtifact.shots.map((shot, index) => {
        const shotNo = shot.shotNo
        const script = artifactPrompts[index]?.trim() || ''
        if (!Number.isInteger(shotNo) || (shotNo ?? 0) <= 0 || !script) {
          throw new Error(`结构化分镜第 ${index + 1} 镜缺少有效 shotNo 或确定性 Prompt`)
        }
        return { shotNo: shotNo as number, script }
      })
      for (let index = 0; index < validatedShots.length; index += 1) {
        const expectedShotNo = nextShotStart + index
        if (validatedShots[index]?.shotNo !== expectedShotNo) {
          throw new Error(`结构化分镜镜号不连续：期望 ${expectedShotNo}，实际 ${validatedShots[index]?.shotNo ?? 'missing'}`)
        }
      }
      const historyChapter = chapterNo
      const shotStart = validatedShots[0].shotNo
      const shotEnd = validatedShots[validatedShots.length - 1].shotNo
      const groupSize = 25
      const reviewedChunkId = `plan-${storyboardPlanId}-chunk-${chunkIndex}`
      const normalizedBatch = validatedShots.map((shot, index) => ({
        ...shot,
        imageUrl: '',
        selectedImageUrl: '',
        roleCardAnchors: [] as Array<{ cardId: string; roleName: string; imageUrl: string }>,
        references: [] as Array<{ label: string; url: string }>,
        shotIndexInChunk: index,
        chunkId: reviewedChunkId,
      }))
      const nodeDataRecord = sourceNodeData
      const replayChunkId = buildReplayStoryboardChunkId({
        taskId,
        chunkId: normalizedBatch[0]?.chunkId,
        chunkIndex,
      })

      type ReplayShotItem = {
        shotNo: number
        frameIndex: number
        script: string
        imageUrl: string
        roleAnchorUrls: string[]
        referenceBindings: StoryboardReferenceBinding[]
      }

      const shotItems: ReplayShotItem[] = normalizedBatch.map((item, index) => {
        const shotNo = item.shotNo
        const script = String(item.script || '').trim()
        if (!script) {
          throw new Error(`已审查 artifact 缺少确定性 Prompt：shotNo=${shotNo}`)
        }
        const imageUrl = String(item.selectedImageUrl || item.imageUrl || '').trim()
        const roleBindings = Array.isArray(item.roleCardAnchors)
          ? item.roleCardAnchors.map((anchor) => ({
              kind: 'role' as const,
              refId: String(anchor.cardId || '').trim() || undefined,
              label: String(anchor.roleName || '').trim() || '角色锚点',
              imageUrl: String(anchor.imageUrl || '').trim(),
            }))
          : []
        const genericReferenceBindings = Array.isArray(item.references)
          ? item.references.map((reference) => ({
              kind: 'reference' as const,
              label: String(reference.label || '').trim() || '参考图',
              imageUrl: String(reference.url || '').trim(),
            }))
          : []
        const referenceBindings = normalizeStoryboardReferenceBindings([
          ...roleBindings,
          ...genericReferenceBindings,
        ])
        const roleAnchorUrls = roleBindings
          .map((binding) => String(binding.imageUrl || '').trim())
          .filter(Boolean)
        const shotIndexRaw = Number(item.shotIndexInChunk)
        const frameIndex =
          Number.isFinite(shotIndexRaw) && shotIndexRaw >= 0
            ? Math.trunc(shotIndexRaw)
            : Math.max(0, shotNo - shotStart || index)
        return {
          shotNo,
          frameIndex,
          script,
          imageUrl,
          roleAnchorUrls,
          referenceBindings,
        }
      })

      const imageShotItems = shotItems.filter((item) => item.imageUrl)
      const inheritedRoleRefs = Array.isArray(nodeDataRecord.roleCardReferenceImages)
        ? nodeDataRecord.roleCardReferenceImages
            .map((value) => String(value || '').trim())
            .filter(Boolean)
        : []
      const roleRefs = Array.from(
        new Set([...inheritedRoleRefs, ...shotItems.flatMap((item) => item.roleAnchorUrls)]),
      ).slice(0, 8)
      const storyboardShotPrompts = shotItems.map((item) => item.script)
      const storyboardScript = buildStoryboardChunkScript(shotItems)
      const tailFrameUrl = imageShotItems.length > 0 ? imageShotItems[imageShotItems.length - 1]?.imageUrl || '' : ''
      const chunkReferenceBindings = normalizeStoryboardReferenceBindings([
        ...(tailFrameUrl
          ? [{ kind: 'continuity_tail' as const, label: '本组尾帧', imageUrl: tailFrameUrl }]
          : []),
        ...shotItems.flatMap((item) => item.referenceBindings),
      ])
      const protocolGroupSize = normalizeStoryboardSelectionProtocolGroupSize(groupSize)
      const buildChunkSelectionContext = (input?: { title?: string; imageUrl?: string }): StoryboardSelectionContext => (
        buildStoryboardSelectionContextOrThrow({
          scope: 'chunk',
          taskId,
          planId: storyboardPlanId,
          chunkId: replayChunkId,
          chunkIndex,
          groupSize: protocolGroupSize,
          shotStart,
          shotEnd,
          title: typeof input?.title === 'string' && input.title.trim() ? input.title.trim() : undefined,
          imageUrl: typeof input?.imageUrl === 'string' && input.imageUrl.trim() ? input.imageUrl.trim() : undefined,
          sourceBookId: progressMeta.bookId,
          materialChapter: historyChapter,
          storyContext: storyboardStoryContext,
          storyboardScript,
          modelKey: imageModelKey,
          aspectRatio: storyboardAspectRatio,
          referenceBindings: chunkReferenceBindings.length > 0 ? chunkReferenceBindings : undefined,
        })
      )
      const buildFrameSelectionContext = (
        shotItem: ReplayShotItem,
        input?: { title?: string; imageUrl?: string },
      ): StoryboardSelectionContext => (
        buildStoryboardSelectionContextOrThrow({
          scope: 'frame',
          taskId,
          planId: storyboardPlanId,
          chunkId: replayChunkId,
          chunkIndex,
          groupSize: protocolGroupSize,
          shotStart,
          shotEnd,
          shotNo: shotItem.shotNo,
          frameIndex: shotItem.frameIndex,
          title: typeof input?.title === 'string' && input.title.trim() ? input.title.trim() : undefined,
          imageUrl:
            typeof input?.imageUrl === 'string' && input.imageUrl.trim()
              ? input.imageUrl.trim()
              : shotItem.imageUrl || undefined,
          sourceBookId: progressMeta.bookId,
          materialChapter: historyChapter,
          storyContext: storyboardStoryContext,
          shotPrompt: shotItem.script,
          storyboardScript,
          modelKey: imageModelKey,
          aspectRatio: storyboardAspectRatio,
          referenceBindings:
            shotItem.referenceBindings.length > 0
              ? shotItem.referenceBindings
              : chunkReferenceBindings.length > 0
                ? chunkReferenceBindings
                : undefined,
        })
      )
      const imageResults = imageShotItems.map((item) => ({
        url: item.imageUrl,
        title: `镜头 ${item.shotNo}`,
        shotPrompt: item.script,
        storyboardSelectionContext: buildFrameSelectionContext(item, {
          title: `镜头 ${item.shotNo}`,
          imageUrl: item.imageUrl,
        }),
      }))
      const primaryImageUrl = imageResults[0]?.url || ''
      const primaryShotNo = imageShotItems[0]?.shotNo || shotStart
      const chunkSelectionContext = buildChunkSelectionContext({
        title: `分镜续写 · 任务 ${taskId} 镜头${shotStart}-${shotEnd}`,
        imageUrl: primaryImageUrl || undefined,
      })

      const shotScriptNodeIds = shotItems
        .map((item, idx) => (
          createReplayTaskNode(
            `镜头脚本 ${item.shotNo} · 任务 ${taskId}`,
            {
              kind: 'storyboardScript',
              autoLabel: false,
              prompt: item.script,
              textBackgroundColor: idx % 2 === 0 ? '#eff6ff' : '#f6f7f8',
              sourceBookId: progressMeta.bookId,
              storyboardTaskId: taskId,
              chapter: historyChapter,
              materialChapter: historyChapter,
              source: 'novel_storyboard_pipeline_replay_shot',
              storyboardGroupSize: groupSize,
              storyboardChunkIndex: chunkIndex,
              storyboardShotStart: item.shotNo,
              storyboardShotEnd: item.shotNo,
              storyboardShotNo: item.shotNo,
              storyboardSelectionContext: buildFrameSelectionContext(item, {
                title: `镜头脚本 ${item.shotNo} · 任务 ${taskId}`,
              }),
              status: 'success',
              progress: 100,
              nodeWidth: 250,
              nodeHeight: 105,
            },
          )
        ))
        .filter(Boolean)

      const anchorNodeId = roleRefs.length
        ? createReplayTaskNode(
            `角色锚点 · 任务 ${taskId} 镜头${shotStart}-${shotEnd}`,
            {
              kind: 'image',
              autoLabel: false,
              sourceBookId: progressMeta.bookId,
              storyboardTaskId: taskId,
              chapter: historyChapter,
              materialChapter: historyChapter,
              source: 'novel_storyboard_pipeline_anchor',
              roleCardReferenceImages: roleRefs,
              imageUrl: roleRefs[0],
              imagePrimaryIndex: 0,
              imageResults: roleRefs.map((url, idx) => ({ url, title: `角色锚点 ${idx + 1}` })),
              storyboardSelectionContext: buildChunkSelectionContext({
                title: `角色锚点 · 任务 ${taskId} 镜头${shotStart}-${shotEnd}`,
                imageUrl: roleRefs[0],
              }),
              status: 'success',
              progress: 100,
              nodeWidth: 320,
              nodeHeight: 210,
            },
          )
        : ''

      const storyboardNodeId = storyboardPlaceholderNodeId
      updateNodeData(storyboardNodeId, {
        kind: 'novelStoryboard',
        autoLabel: false,
        storyboardCount: groupSize,
        storyboardAspectRatio,
        storyboardStyle: 'realistic',
        imageModel: imageModelKey,
        storyboardScript,
        storyboardShotPrompts,
        storyboardChunkNarrative: storyboardShotPrompts.join('；'),
        storyboardStoryContext: storyboardStoryContext || undefined,
        sourceBookId: progressMeta.bookId,
        roleCardReferenceImages: roleRefs.length ? roleRefs : undefined,
        storyboardTaskId: taskId,
        storyboardPlanId,
        storyboardPreviousChunkId: previousChunkId || undefined,
        storyboardArtifact,
        storyboardStructured,
        chapter: historyChapter,
        materialChapter: historyChapter,
        source: 'novel_storyboard_structured_plan',
        storyboardGroupSize: groupSize,
        storyboardChunkIndex: chunkIndex,
        storyboardShotStart: shotStart,
        storyboardShotEnd: shotEnd,
        storyboardSelectionContext: chunkSelectionContext,
        imageUrl: primaryImageUrl || undefined,
        imagePrimaryIndex: primaryImageUrl ? 0 : undefined,
        imageResults,
        storyboardShotNo: primaryShotNo,
        storyboardPipelineStatus: 'succeeded',
        storyboardPipelineError: undefined,
      })
      setNodeStatus(storyboardNodeId, primaryImageUrl ? 'success' : 'queued', {
        progress: primaryImageUrl ? 100 : 0,
        storyboardPipelineStatus: 'succeeded',
      })
      appendLog(
        storyboardNodeId,
        `[${new Date().toLocaleTimeString()}] validated: plan=${storyboardPlanId}，已回填 ${storyboardShotPrompts.length} 镜；等待画面生成`,
      )
      const scriptGroupNodeIds = [...shotScriptNodeIds, anchorNodeId].filter(Boolean)
      const afterAdd = useRFStore.getState()
      const newNode = afterAdd.nodes.find((n) => String(n.id || '') === storyboardNodeId)
      if (!newNode) throw new Error('queued 占位节点在 pipeline 回填前已不存在')

      const sourceNode = afterAdd.nodes.find((n) => n.id === id)
      if (!sourceNode) throw new Error('分镜续写源节点在布局回填前已不存在')
      const targetGroupId = String(sourceNode?.parentId || '').trim()
      if (targetGroupId) {
        const siblings = afterAdd.nodes.filter((n) => !scriptGroupNodeIds.includes(String(n.id || '')) && String(n?.parentId || '') === targetGroupId)
        const baseX = Number(sourceNode?.position?.x || 0)
        const baseY = Number(sourceNode?.position?.y || 0)
        const maxY = siblings.reduce((max, n) => Math.max(max, Number(n?.position?.y || 0)), baseY)
        const startY = maxY + 150
        const replayPositions = new Map<string, { x: number; y: number }>()
        shotScriptNodeIds.forEach((nodeId, idx) => {
          const col = idx % 5
          const row = Math.floor(idx / 5)
          replayPositions.set(nodeId, { x: baseX + col * 260, y: startY + row * 120 })
        })
        const scriptRows = Math.max(1, Math.ceil(Math.max(1, shotScriptNodeIds.length) / 5))
        const anchorY = startY + scriptRows * 120 + 24
        if (anchorNodeId) replayPositions.set(anchorNodeId, { x: baseX, y: anchorY })
        useRFStore.setState((s) => ({
          ...s,
          nodes: s.nodes.map((n) => (
            replayPositions.has(String(n.id || ''))
              ? {
                  ...n,
                  position: replayPositions.get(String(n.id || ''))!,
                  parentId: targetGroupId,
                  extent: sourceNode.extent,
                  selected: n.id === storyboardNodeId,
                }
              : {
                  ...n,
                  selected: n.id === storyboardNodeId,
            }
          )),
        }))
        if (scriptGroupNodeIds.length >= 2) {
          afterAdd.arrangeGroupChildren(targetGroupId, 'grid', scriptGroupNodeIds)
        }
        const latest = useRFStore.getState().nodes
        const parentGroup = latest.find((n) => String(n?.id || '') === targetGroupId)
        const groupW = Math.max(980, Math.round(readCanvasNodeWidth(parentGroup)))
        useRFStore.setState((s) => ({
          ...s,
          nodes: s.nodes.map((n) => (
            String(n?.id || '') === storyboardNodeId
              ? {
                  ...n,
                  parentId: undefined,
                  extent: undefined,
                  position: { x: baseX + groupW + 32, y: baseY + 8 },
                }
              : n
          )),
        }))
      } else {
        const baseX = Number(sourceNode?.position?.x || 0) + 240
        const baseY = Number(sourceNode?.position?.y || 0)
        const posById = new Map<string, { x: number; y: number }>()
        shotScriptNodeIds.forEach((nodeId, idx) => {
          const col = idx % 5
          const row = Math.floor(idx / 5)
          posById.set(nodeId, { x: baseX + col * 260, y: baseY + row * 120 - 180 })
        })
        const scriptRows = Math.max(1, Math.ceil(Math.max(1, shotScriptNodeIds.length) / 5))
        const anchorY = baseY + scriptRows * 120 - 40
        if (anchorNodeId) posById.set(anchorNodeId, { x: baseX, y: anchorY })
        const changes = Array.from(posById.entries()).flatMap(([nodeId, position]) => ([
          { id: nodeId, type: 'position' as const, position, dragging: false },
          { id: nodeId, type: 'select' as const, selected: nodeId === storyboardNodeId },
        ]))
        afterAdd.onNodesChange(changes)
        const scriptAreaWidth = Math.max(980, Math.ceil(Math.max(1, shotScriptNodeIds.length) / 5) * 260)
        afterAdd.onNodesChange([
          {
            id: storyboardNodeId,
            type: 'position',
            position: { x: baseX + scriptAreaWidth + 32, y: baseY - 40 },
            dragging: false,
          },
          { id: storyboardNodeId, type: 'select', selected: true },
        ])
      }

      shotScriptNodeIds.forEach((nodeId, idx) => {
        if (idx === 0) return
        afterAdd.onConnect({
          source: shotScriptNodeIds[idx - 1],
          sourceHandle: 'out-text',
          target: nodeId,
          targetHandle: 'in-text',
        })
      })
      shotScriptNodeIds.forEach((nodeId) => {
        afterAdd.onConnect({
          source: nodeId,
          sourceHandle: 'out-text',
          target: storyboardNodeId,
          targetHandle: 'in-image-wide',
        })
      })
      if (anchorNodeId) {
        afterAdd.onConnect({
          source: anchorNodeId,
          sourceHandle: 'out-image-wide',
          target: storyboardNodeId,
          targetHandle: 'in-image-wide',
        })
      }
      toast(`已创建后续分镜节点（任务 ${taskId} · 镜头${shotStart}-${shotEnd}）`, 'success')
    } catch (err: unknown) {
      console.error(err)
      const message = err instanceof Error && err.message ? err.message : '生成后续分镜失败'
      if (storyboardPlaceholderNodeId) {
        setNodeStatus(storyboardPlaceholderNodeId, 'error', {
          progress: 0,
          storyboardPipelineStatus: 'failed',
          storyboardPipelineError: message,
          lastError: message,
        })
        appendLog(storyboardPlaceholderNodeId, `[${new Date().toLocaleTimeString()}] failed: ${message}`)
      }
      toast(message, 'error')
    }
}
