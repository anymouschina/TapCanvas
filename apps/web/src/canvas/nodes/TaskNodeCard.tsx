import React from 'react'
import { Position, type NodeProps } from '@xyflow/react'
import { IconMusic, IconDownload } from '@tabler/icons-react'
import { getTaskNodeCoreType, getTaskNodeSchema, normalizeTaskNodeKind } from './taskNodeSchema'
import {
  normalizeStoryboardEditorGrid,
  normalizeStoryboardEditorCells,
  normalizeStoryboardEditorAspect,
} from './taskNode/storyboardEditor'
import { StoryboardEditorPreview } from './taskNode/components/StoryboardEditorPreview'
import {
  computeHandleLayout,
  isDynamicHandlesConfig,
  isStaticHandlesConfig,
  HANDLE_HORIZONTAL_OFFSET,
  getVisualNodeDefaults,
  getTextNodeSize,
  TEXT_NODE_DEFAULT_HEIGHT,
  TEXT_NODE_DEFAULT_WIDTH,
  clampVisualDimension,
} from './taskNodeHelpers'
import { buildTaskNodeFeatureFlags } from './taskNode/features'
import { resolveVideoInputPosterUrl, resolveVideoPosterUrl } from './taskNode/videoPosterUrl'
import { resolveImageNodePreviewUrl } from './taskNode/resolveImageNodePreviewUrl'
import { VideoNodePreview } from './taskNode/components/VideoNodePreview'
import { MediaEmptyState } from './taskNode/components/MediaEmptyState'
import { TaskNodeHandles } from './taskNode/components/TaskNodeHandles'
import { VideoClipCanvasMeta } from './taskNode/components/VideoClipCanvasMeta'
import { readVideoClipRunId } from '../videoClipCanvasFacts'
import { ManagedImage } from '../../domain/resource-runtime'
import { useIsNodeFocused } from '../focusStore'
import { useRFStore } from '../store'
import { CanvasLODContext } from '../CanvasLODContext'
import type { TaskNodeType } from './taskNode/taskNodeTypes'
import { areTaskNodePropsEqual } from './taskNode/taskNodePropsEqual'
import { readWorkflowCanvasPorts, workflowPortHandleId } from '../workflowCanvasPorts'
import { buildWorkflowAgentReferenceHandles } from '../workflowAgentReferenceHandles'
import {
  WORKFLOW_ICON_NODE_HANDLE_OFFSET,
  resolveWorkflowNodeCanvasSize,
} from '../workflowNodeGeometry'
import { useWorkflowNodeInspectorStore } from '../workflowNodeInspectorStore'
import { WorkflowNodeSkeleton } from './taskNode/components/WorkflowNodeSkeleton'
import { CodexTaskNode } from './codex/CodexTaskNode'
import { queueMediaEmptyAction } from './taskNode/mediaEmptyActionRuntime'
import { TextContentPreview } from './taskNode/components/TextContent'
import {
  resolveTextNodeDisplayHtml,
  resolveTextNodeLatestResult,
  withTextNodeAlpha,
  type TextNodeDisplaySource,
} from './taskNode/textNodeContent'
import {
  CANVAS_OVERVIEW_IMAGE_WIDTH,
  CANVAS_SHELL_IMAGE_WIDTH,
} from '../canvasPerformancePolicy'

// A fixed (deterministic) bar pattern for the audio shell's faux waveform. The unfocused shell never
// mounts WaveSurfer (that's the focused body's job), so this static strip just signals "音频已生成"
// without decoding the clip. Values are bar heights in %.
const SKELETON_WAVEFORM_BARS = [28, 52, 38, 70, 46, 84, 40, 62, 34, 76, 50, 66, 36, 80, 54, 44, 60, 30, 72, 48]

// mm:ss for the audio shell duration chip.
function formatSkeletonDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// TaskNodeCard is the EAGER node-type entry registered with React Flow. It is intentionally tiny so
// the canvas can parse/compile and paint instantly on open. The heavy interactive body — TaskNode.tsx
// (10k+ lines, ~358 hooks per instance) — is pulled in as a SEPARATE lazy chunk via React.lazy, so
// its first-time module compile (~750ms cold) happens off the first-paint critical path.
//
// SINGLE-FOCUS rendering (the perf model for copy-heavy canvases):
//   - Only the ONE focused node (the sole selected node, see focusStore) mounts the full heavy body.
//   - Every other node — however many hundreds of copies exist — renders only TaskNodeSkeleton: a
//     thumbnail + handles + (when generating) a status pill. No heavy hooks, no lazy chunk needed.
//   - Focus is reactive, not monotonic: deselecting a node reverts it to the lightweight shell and
//     unmounts its body, so the heavy-subtree count stays pinned at ≤1 no matter how the user pans
//     or how many nodes are on screen. This is what keeps a 500-node chapter smooth.
//   - <Suspense> shows the same skeleton while the lazy chunk loads on first focus, then swaps in the
//     real body. The chunk loads once and is shared by every subsequent focus.
const importTaskNodeInner = () => import('./TaskNode')
const TaskNodeInner = React.lazy(importTaskNodeInner)

// PREHEAT is interaction-driven. Parsing the 1MB+ full editor during a nominal
// idle callback can overlap the user's first pan on a large canvas and produce
// a visible long task. Pointer-enter/down still starts the work before focus,
// without charging every canvas open for an editor the user may never invoke.
let taskNodeInnerPreheated = false
export function preheatTaskNodeInner(): void {
  if (taskNodeInnerPreheated) return
  taskNodeInnerPreheated = true
  void importTaskNodeInner().catch(() => {
    // A failed preheat must not poison the real focus-time import: reset so React.lazy can retry.
    taskNodeInnerPreheated = false
  })
}

type TaskNodeRenameControlProps = {
  nodeId: string
  label: string
  fallbackLabel: string
  readOnly?: boolean
  className?: string
  slotClassName?: string
}

function TaskNodeRenameControl({
  nodeId,
  label,
  fallbackLabel,
  readOnly = false,
  className,
  slotClassName,
}: TaskNodeRenameControlProps): JSX.Element {
  const updateNodeLabel = useRFStore.getState().updateNodeLabel
  const currentLabel = label.trim() || fallbackLabel.trim()
  const [editing, setEditing] = React.useState(false)
  const [draftLabel, setDraftLabel] = React.useState(currentLabel)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (!editing) setDraftLabel(currentLabel)
  }, [currentLabel, editing])

  React.useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const commitRename = React.useCallback(() => {
    const nextLabel = draftLabel.trim() || currentLabel
    if (!readOnly && nextLabel !== currentLabel) updateNodeLabel(nodeId, nextLabel)
    setEditing(false)
  }, [currentLabel, draftLabel, nodeId, readOnly, updateNodeLabel])

  const cancelRename = React.useCallback(() => {
    setDraftLabel(currentLabel)
    setEditing(false)
  }, [currentLabel])

  if (editing) {
    return (
      <span className={['tc-task-node__rename-slot', slotClassName].filter(Boolean).join(' ')}>
        <input
          ref={inputRef}
          className="tc-task-node__rename-input nodrag nopan"
          value={draftLabel}
          aria-label="节点名称"
          autoComplete="off"
          onChange={(event) => setDraftLabel(event.currentTarget.value)}
          onBlur={commitRename}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitRename()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              cancelRename()
            }
          }}
        />
      </span>
    )
  }

  return (
    <span className={['tc-task-node__rename-slot', slotClassName].filter(Boolean).join(' ')}>
      <button
        type="button"
        className={['tc-task-node__rename-trigger nodrag nopan', className].filter(Boolean).join(' ')}
        title={readOnly ? currentLabel : '点击重命名'}
        aria-label={readOnly ? currentLabel : `重命名${currentLabel}`}
        disabled={readOnly}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          if (!readOnly) setEditing(true)
        }}
      >
        {currentLabel}
      </button>
    </span>
  )
}

// TaskNodeSkeleton: zero store subscriptions, rendered while TaskNodeInner is deferred.
// Provides correct dimensions + handles so edges stay anchored during the skeleton phase, plus a
// faithful preview (thumbnail + title) so the staggered hydration reads as "card loading its
// controls", not a blank flash.
//
// readOnly（data.readOnly === true）时它也是只读快照/投影的标准渲染器：画布同款卡片外观，
// 但禁用重命名、媒体自然尺寸回写、空态聚焦与工作流检查器打开等所有 live 画布副作用。
export const TaskNodeSkeleton = React.forwardRef<HTMLDivElement, { id: string; data: TaskNodeType['data']; overview?: boolean; focused?: boolean }>(
  function TaskNodeSkeleton({ id, data, overview = false, focused = false }, ref) {
    const kind = normalizeTaskNodeKind(typeof (data as any)?.kind === 'string' ? (data as any).kind : null) || 'text'
    const schema = getTaskNodeSchema(kind)
    const coreKind = getTaskNodeCoreType(kind)
    const isWorkflowNode = kind === 'workflowStage' || kind === 'workflowTrigger'
    const isStructuredWorkflowNode = kind === 'videoAnalysis' || kind === 'shotTable' || isWorkflowNode
    const isResizableVisualNode = coreKind === 'image'
      || coreKind === 'video'
      || (isStructuredWorkflowNode && !isWorkflowNode)
    const isPlainTextNode = coreKind === 'text' && !isStructuredWorkflowNode
    // 分镜编辑 node: the focused body treats it as a resizable visual node (TaskNode.tsx, isResizableVisualNode)
    // sized via getVisualNodeDefaults (560×470). The shell mirrors that — same size, same look (it renders the
    // shared StoryboardEditorPreview below) — so focusing causes no resize/reflow.
    const isStoryboardShell = coreKind === 'storyboard'
    const usesVisualDefaults = isResizableVisualNode || isStoryboardShell
    // Resolve dimensions through the SAME source of truth the focused body uses (getVisualNodeDefaults
    // + clampVisualDimension over data.nodeWidth/nodeHeight) so the shell→body LOD swap is pixel-identical.
    // For resizable visual nodes the height is ALWAYS a number (matching the body), never the old null→160 path.
    const visualDefaults = usesVisualDefaults
      ? getVisualNodeDefaults(kind, coreKind, buildTaskNodeFeatureFlags(schema, kind).hasStoryboardEditor)
      : null
    const dataRecord = data as Record<string, unknown>
    const textNodeSize = isPlainTextNode ? getTextNodeSize(dataRecord) : null
    // Render at the node's PERSISTED dimensions (clamped) — the same values React Flow uses for the
    // node's wrapper (style/measured). The shell must NOT compute a larger fitted size of its own:
    // it can't write back to RF, so a shell taller than the wrapper would overflow and break
    // auto-layout spacing (nodes overlap). Size normalization is owned by creation defaults + the
    // focused body's on-load fit (handleMediaNaturalSize), which update data AND the RF style together.
    // Card-style nodes (音频 / 任意非视觉非文本非分镜类型): the lightweight shell is LOCKED to a fixed
    // default footprint = the text node's default size (380×360). Without this lock the footprint is
    // content-driven and can balloon. Inside this fixed box the content scales/clips to fit. (分镜 is
    // excluded — it sizes via visual defaults like the focused body, see isStoryboardShell.)
    const isCardNode = !usesVisualDefaults && !isPlainTextNode && !isWorkflowNode
    // 音频卡是特例：聚焦体的 AudioContent 固定 16:9（width 360 → 高 202，shellPadding=0），
    // 不是文本卡的 380×360。壳必须用相同 16:9 footprint，否则聚焦前后从方形 snap 成宽矩形。
    // 宽度镜像聚焦体的非视觉默认（data.nodeWidth 有则 clamp 320-720，否则 360）。
    const isAudioCard = coreKind === 'audio'
    const CARD_SHELL_WIDTH = TEXT_NODE_DEFAULT_WIDTH
    const CARD_SHELL_HEIGHT = TEXT_NODE_DEFAULT_HEIGHT
    const audioCardWidth = typeof (data as any)?.nodeWidth === 'number' && Number.isFinite((data as any)?.nodeWidth)
      ? Math.max(320, Math.min(720, Number((data as any)?.nodeWidth)))
      : 360
    const audioCardHeight = Math.round((audioCardWidth * 9) / 16)
    const workflowNodeSize = isWorkflowNode ? resolveWorkflowNodeCanvasSize(dataRecord) : null
    const nodeW = isWorkflowNode
      ? workflowNodeSize?.width ?? 56
      : visualDefaults
      ? clampVisualDimension((data as any)?.nodeWidth, visualDefaults.minWidth, visualDefaults.maxWidth, visualDefaults.width)
      : isAudioCard
        ? audioCardWidth
        : isCardNode
          ? CARD_SHELL_WIDTH
          : (textNodeSize?.width ?? TEXT_NODE_DEFAULT_WIDTH)
    const nodeH: number | null = isWorkflowNode
      ? workflowNodeSize?.height ?? 56
      : visualDefaults
      ? clampVisualDimension((data as any)?.nodeHeight, visualDefaults.minHeight, visualDefaults.maxHeight, visualDefaults.height)
      : null
    const cardH: number | null = isAudioCard ? audioCardHeight : isCardNode ? CARD_SHELL_HEIGHT : null
    const textH: number | null = textNodeSize?.height ?? TEXT_NODE_DEFAULT_HEIGHT

    // Minimal visual contract — derive the same primary thumbnail the hydrated card will show, so
    // the swap is seamless (the image is already in the ManagedImage cache by then).
    const dataAny = data as any
    const label: string = typeof dataAny?.label === 'string' ? dataAny.label : ''
    const readOnly = dataRecord.readOnly === true
    // Identity fallback for the unfocused shell. The canvas-first principle requires every shell to be
    // recognizable WITHOUT focusing it, so we always have a title + icon to show: the instance label if
    // set, else the kind's display label ('分镜编辑' / '音频' / '视频合成' …), else the raw kind. The
    // schema icon is the same glyph the focused header uses, so it reads as the same node type.
    const SchemaIcon = schema.icon
    const displayTitle: string = label || (typeof schema.label === 'string' && schema.label ? schema.label : kind)
    const textDisplaySource = dataRecord as TextNodeDisplaySource
    const textDisplayHtml = isPlainTextNode
      ? resolveTextNodeDisplayHtml({
          data: textDisplaySource,
          latestTextResult: resolveTextNodeLatestResult(textDisplaySource),
        })
      : ''
    const rawTextColor = typeof dataRecord.textColor === 'string' ? dataRecord.textColor.trim() : ''
    const rawTextBackgroundColor = typeof dataRecord.textBackgroundColor === 'string'
      ? dataRecord.textBackgroundColor.trim()
      : ''
    const textPreviewColor = rawTextColor || 'var(--tc-text-node-color)'
    const textPreviewBackground = rawTextBackgroundColor
      ? withTextNodeAlpha(rawTextBackgroundColor, 0.125)
      : 'var(--tc-text-node-background)'
    const rawTextFontSize = Number(dataRecord.textFontSize)
    const textPreviewFontSize = Number.isFinite(rawTextFontSize)
      ? Math.max(12, Math.min(48, rawTextFontSize))
      : 16
    const rawTextFontWeight = Number(dataRecord.textFontWeight)
    const textPreviewFontWeight = Number.isFinite(rawTextFontWeight)
      ? Math.max(300, Math.min(800, rawTextFontWeight))
      : 500
    // Overview shells use a persisted thumbnail when one exists. Focused nodes still mount the full
    // body and original result, so this reduces decoded image memory without lowering edit fidelity.
    const thumbUrl = resolveImageNodePreviewUrl(data as Record<string, unknown>)
    const shellImageWidth = overview ? CANVAS_OVERVIEW_IMAGE_WIDTH : CANVAS_SHELL_IMAGE_WIDTH
    // Video first frame: prefer a static poster (videoResults[].thumbnailUrl → videoThumbnailUrl).
    // Keep poster and playable URL separate: untouched shells stay source-free; once activated, the
    // retained media surface pauses on its decoded frame. Overview shells remain strictly static.
    let videoSrc: string | null = null
    let videoPoster: string | null = null
    if (coreKind === 'video') {
      const videoResults: any[] = Array.isArray(dataAny?.videoResults) ? dataAny.videoResults : []
      const vIdx = typeof dataAny?.videoPrimaryIndex === 'number' && dataAny.videoPrimaryIndex >= 0 ? dataAny.videoPrimaryIndex : 0
      const primaryVideo = videoResults[vIdx] || videoResults.find((r) => r && (r.thumbnailUrl || r.url)) || null
      // poster 统一走 resolveVideoPosterUrl：posterInline 优先，远程图由 ManagedImage
      // 按当前壳层 LOD 请求 TOS 变体，避免全尺寸 poster 常驻解码。
      const inputPoster = resolveVideoInputPosterUrl(dataAny)
      videoPoster = resolveVideoPosterUrl(
        primaryVideo,
        typeof dataAny?.videoThumbnailUrl === 'string' ? dataAny.videoThumbnailUrl : inputPoster,
      )
      videoSrc = (typeof primaryVideo?.url === 'string' && primaryVideo.url.trim() ? primaryVideo.url : null)
        || (typeof dataAny?.videoUrl === 'string' && dataAny.videoUrl.trim() ? dataAny.videoUrl : null)
    }

    // Storyboard (分镜编辑): the shell renders the SHARED StoryboardEditorPreview (same component the
    // focused body uses) so it looks identical — just without the toolbar / drop targets / 切换镜头 controls.
    // Resolve the same props the focused body derives from data.* so the static preview is faithful.
    const isStoryboard = coreKind === 'storyboard'
    const storyboardGrid = isStoryboard ? normalizeStoryboardEditorGrid(dataAny?.storyboardEditorGrid) : null
    const storyboardCells = isStoryboard ? normalizeStoryboardEditorCells(dataAny?.storyboardEditorCells, storyboardGrid!) : []
    const storyboardAspect = isStoryboard ? normalizeStoryboardEditorAspect(dataAny?.storyboardEditorAspect) : null

    // Audio (音频) artifact = the generated clip (data.audioUrl). The shell shows a static "音频已生成"
    // strip (icon + faux waveform + duration) WITHOUT mounting WaveSurfer — the heavy waveform belongs
    // to the focused body; the shell only needs to signal "there's a finished clip here".
    const isAudioNode = coreKind === 'audio'
    const audioUrl = isAudioNode && typeof dataAny?.audioUrl === 'string' && dataAny.audioUrl.trim() ? (dataAny.audioUrl as string) : null
    const audioDurationSec = typeof dataAny?.audioDurationSec === 'number' && dataAny.audioDurationSec > 0 ? dataAny.audioDurationSec as number : null

    // Generation status — surfaced on the lightweight shell so batch progress is visible without
    // focusing each node. Only running/queued/error get a pill; idle/success rely on the thumbnail.
    // Overview (重画布降级) 不渲染状态条——拉远到这个尺度状态文字已不可读，省一层 DOM。
    const status = typeof dataAny?.status === 'string' ? dataAny.status : 'idle'
    const hasOrchestratedVideoFacts = coreKind === 'video' && Boolean(readVideoClipRunId(data))
    const statusPill: { text: string; bg: string; dot: boolean } | null = overview ? null :
      status === 'running' ? { text: kind === 'videoAnalysis' ? '分析中' : '生成中', bg: 'rgba(34,139,230,0.92)', dot: true }
      : status === 'queued' ? { text: '排队中', bg: 'rgba(120,120,130,0.92)', dot: true }
      : status === 'error' ? { text: '失败', bg: 'rgba(224,49,49,0.92)', dot: false }
      : null

    const focusMediaNode = () => {
      if (readOnly) return
      preheatTaskNodeInner()
      const state = useRFStore.getState()
      const changes = state.nodes
        .filter((node) => node.selected && node.id !== id)
        .map((node) => ({ id: node.id, type: 'select' as const, selected: false }))
      changes.push({ id, type: 'select' as const, selected: true })
      state.onNodesChange(changes)
    }

    const targets: { id: string; type: string; pos: Position; label?: string }[] = []
    const sources: { id: string; type: string; pos: Position; label?: string }[] = []
    const schemaHandles = schema.handles
    const workflowPorts = isWorkflowNode ? readWorkflowCanvasPorts(data as Record<string, unknown>) : null
    if (workflowPorts) {
      workflowPorts.inputs.forEach((portId) => targets.push({
        id: workflowPortHandleId('input', portId),
        type: 'workflow',
        pos: Position.Left,
      }))
      workflowPorts.outputs.forEach((portId) => sources.push({
        id: workflowPortHandleId('output', portId),
        type: 'workflow',
        pos: Position.Right,
      }))
    } else if (isStaticHandlesConfig(schemaHandles)) {
      schemaHandles.targets?.forEach(h => targets.push({ id: h.id, type: h.type, pos: h.position ?? Position.Left }))
      schemaHandles.sources?.forEach(h => sources.push({ id: h.id, type: h.type, pos: h.position ?? Position.Right }))
    } else if (!isDynamicHandlesConfig(schemaHandles)) {
      targets.push({ id: 'in-any', type: 'any', pos: Position.Left })
      sources.push({ id: 'out-any', type: 'any', pos: Position.Right })
    }
    const referenceHandles = buildWorkflowAgentReferenceHandles(dataRecord)
    targets.push(...referenceHandles.targets)
    sources.push(...referenceHandles.sources)
    const handleLayoutMap = computeHandleLayout([...targets, ...sources])
    const defaultInputType = targets[0]?.type || 'any'
    const defaultOutputType = sources[0]?.type || 'any'
    const wideHandleBase: React.CSSProperties = {
      position: 'absolute', pointerEvents: 'none', width: 16,
      height: 'calc(100% - 12px)', top: '50%',
      transform: 'translate(-50%, -50%)',
      border: '1px dashed rgba(255,255,255,0.12)',
      background: 'transparent', opacity: 0, boxShadow: 'none',
    }
    return (
      <div
        ref={ref}
        className={[
          'tc-task-node',
          'tc-task-node--offscreen',
          isWorkflowNode ? 'tc-task-node--workflow' : '',
          isPlainTextNode ? 'tc-task-node--plain-text' : '',
        ].filter(Boolean).join(' ')}
        data-workflow-selected={isWorkflowNode ? focused : undefined}
        // Hover escalates the heavy-body preheat: the pointer reaching a shell is the earliest
        // reliable signal that a click is coming, and it buys us the ~100ms+ before pointerdown.
        // No-op after the first call / after the idle preheat already ran.
        onPointerEnter={isWorkflowNode ? undefined : preheatTaskNodeInner}
        onPointerDown={isWorkflowNode ? undefined : preheatTaskNodeInner}
        onClick={isWorkflowNode
          ? () => {
              if (readOnly) return
              useWorkflowNodeInspectorStore.getState().openNode(id)
            }
          : undefined}
        style={{
          position: 'relative',
          boxSizing: 'border-box',
          width: isWorkflowNode
            ? nodeW
            : usesVisualDefaults
              ? nodeW
              : nodeW + 2 * HANDLE_HORIZONTAL_OFFSET,
          paddingLeft: usesVisualDefaults || isWorkflowNode ? 0 : HANDLE_HORIZONTAL_OFFSET,
          paddingRight: usesVisualDefaults || isWorkflowNode ? 0 : HANDLE_HORIZONTAL_OFFSET,
          ...(isPlainTextNode && textH ? { height: textH } : undefined),
          ...((usesVisualDefaults || isWorkflowNode) && nodeH ? { height: nodeH } : undefined),
          ...(isCardNode && cardH ? { height: cardH } : undefined),
        } as React.CSSProperties}
      >
        {/* 外置标题（对齐 Neowow ai-node-external-title）：卡片上方小字，absolute 不占节点 bbox。 */}
        {!isStructuredWorkflowNode && (coreKind === 'video' || isResizableVisualNode) && (label || displayTitle) ? (
          <div className="tc-task-node__external-title">
            <SchemaIcon className="tc-task-node__external-title-icon" size={13} stroke={1.8} />
            {overview ? (
              <span className="tc-task-node__overview-title">{displayTitle}</span>
            ) : (
              <TaskNodeRenameControl
                nodeId={id}
                label={label}
                fallbackLabel={displayTitle}
                readOnly={readOnly}
                className="tc-task-node__rename-trigger--external"
                slotClassName="tc-task-node__rename-slot--external"
              />
            )}
          </div>
        ) : null}
        <div
          className={`tc-task-node__card tc-task-node__card--skeleton${isWorkflowNode ? ' tc-task-node__card--workflow' : ''}`}
          style={{
            position: 'relative', overflow: isWorkflowNode ? 'visible' : 'hidden',
            borderRadius: isWorkflowNode ? 0 : 12, boxSizing: 'border-box', width: '100%', height: '100%',
            minHeight: isWorkflowNode ? (nodeH ?? 56) : usesVisualDefaults ? (nodeH ?? 160) : 80,
            // 分镜 owns its own visual (.tc-storyboard-editor) just like the focused card (which in dark UI
            // is transparent/borderless/zero-padding) — so the shell card must not add chrome over it.
            // 与聚焦态完整卡片（.tc-task-node__card / TaskNode.tsx shellBackground）同色：
            // 暗色用科技灰渐变（左侧抽屉同款），变量按主题在 styles.css 切换，壳保持零订阅。
            background: isStoryboard || isWorkflowNode || isPlainTextNode ? 'transparent' : 'var(--tc-node-shell-bg)',
            border: isStoryboard || isWorkflowNode || isPlainTextNode ? 'none' : '1px solid var(--tc-node-shell-border-color)',
            display: isPlainTextNode ? 'flex' : undefined,
            flexDirection: isPlainTextNode ? 'column' : undefined,
          }}
        >
          {overview && isStoryboard ? (
            thumbUrl ? (
              <ManagedImage
                className="tc-task-node__skeleton-thumb"
                src={thumbUrl}
                alt={displayTitle}
                priority="prefetch"
                ownerNodeId={id}
                ownerSurface="task-node-skeleton"
                ownerRequestKey={`task-node-overview:${id}`}
                requestedSize={{ width: shellImageWidth }}
                draggable={false}
                decoding="async"
                referrerPolicy="no-referrer"
                style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
              />
            ) : (
              <div className="tc-task-node__overview-identity">
                <SchemaIcon size={28} stroke={1.4} />
                <span className="tc-task-node__overview-title">{displayTitle}</span>
              </div>
            )
          ) : isStoryboard ? (
            // 分镜编辑: identical visual to the focused body via the shared presentational component —
            // no toolbar / drop targets / 切换镜头 controls (那些是功能交互，壳里不需要).
            <StoryboardEditorPreview
              label={typeof dataAny?.label === 'string' ? dataAny.label : ''}
              aspect={storyboardAspect!}
              grid={storyboardGrid!}
              cells={storyboardCells}
              selectedIndex={typeof dataAny?.storyboardEditorSelectedIndex === 'number' ? dataAny.storyboardEditorSelectedIndex : 0}
              nodeWidth={nodeW}
              nodeHeight={nodeH ?? 470}
              editMode={false}
              collapsed={Boolean(dataAny?.storyboardEditorCollapsed)}
              composedImageUrl={typeof dataAny?.imageUrl === 'string' ? dataAny.imageUrl : null}
              imageRequestedWidth={shellImageWidth}
            />
          ) : overview && coreKind === 'video' ? (
            videoPoster ? (
              <ManagedImage
                className="tc-task-node__skeleton-thumb"
                src={videoPoster}
                alt={displayTitle}
                priority="prefetch"
                ownerNodeId={id}
                ownerSurface="task-node-skeleton"
                ownerRequestKey={`task-node-overview:${id}`}
                requestedSize={{ width: shellImageWidth }}
                draggable={false}
                decoding="async"
                referrerPolicy="no-referrer"
                style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
              />
            ) : (
              <div className="tc-task-node__overview-identity">
                <SchemaIcon size={28} stroke={1.4} />
                <span className="tc-task-node__overview-title">{displayTitle}</span>
              </div>
            )
          ) : coreKind === 'video' ? (
            // 媒体即卡片（对齐 Neowow，2026-07-14 用户拍板）：零内边距、无头部行，视频/占位
            // 撑满整卡；标题外置卡片上方（tc-task-node__external-title，absolute 不占 bbox）。
            // 聚焦态 VideoContent 同为满幅布局（header 是顶部悬浮层），视频框聚焦不跳。
            <VideoNodePreview
              src={videoSrc ?? ''}
              poster={videoPoster}
              nodeId={id}
              focused={focused}
              label={label}
              overview={overview}
              posterRequestedWidth={shellImageWidth}
              onEmptyAction={overview ? undefined : focusMediaNode}
            />
          ) : isWorkflowNode ? (
            <WorkflowNodeSkeleton
              nodeId={id}
              data={data as Record<string, unknown>}
              overview={overview}
              label={displayTitle}
            />
          ) : isStructuredWorkflowNode ? (
            <div className="tc-task-node__structured-skeleton">
              <SchemaIcon className="tc-task-node__structured-skeleton-icon" size={overview ? 34 : 28} stroke={1.5} />
              {overview ? (
                <span className="tc-task-node__overview-title">{displayTitle}</span>
              ) : (
                <>
                  <TaskNodeRenameControl
                    nodeId={id}
                    label={label}
                    fallbackLabel={displayTitle}
                    readOnly={readOnly}
                    className="tc-task-node__rename-trigger--structured"
                    slotClassName="tc-task-node__rename-slot--structured"
                  />
                  <div className="tc-task-node__structured-skeleton-meta">
                    {kind === 'shotTable'
                      ? `${Array.isArray(dataAny?.shotTable?.rows) ? dataAny.shotTable.rows.length : 0} 行分镜数据`
                      : dataAny?.sourceVideoUrl ? '已连接视频，可执行分析' : '等待连接视频'}
                  </div>
                </>
              )}
            </div>
          ) : isResizableVisualNode ? (
            <>
              {thumbUrl ? (
                <ManagedImage
                  className="tc-task-node__skeleton-thumb"
                  src={thumbUrl}
                  alt={label || '预览'}
                  priority={overview ? 'prefetch' : 'visible'}
                  ownerNodeId={id}
                  ownerSurface="task-node-skeleton"
                  ownerRequestKey={`task-node-skeleton:${id}`}
                  requestedSize={{ width: shellImageWidth }}
                  crossOrigin="anonymous"
                  draggable={false}
                  decoding="async"
                  referrerPolicy="no-referrer"
                  // Eagerly fit the node to the image's true aspect on load — without waiting for focus.
                  // The shell can't compute a fitted size of its own (it can't write back to RF), so we
                  // hand the measured natural size to the store, which writes data + style + records
                  // mediaNaturalSize (idempotent, ratio-based). Fixes the "wrong size until focused" jump.
                  onLoad={(ev) => {
                    if (readOnly) return
                    const img = ev.currentTarget
                    const w = img?.naturalWidth || 0
                    const h = img?.naturalHeight || 0
                    if (w > 0 && h > 0 && thumbUrl) {
                      useRFStore.getState().applyMediaNaturalSize(id, {
                        width: w,
                        height: h,
                        url: thumbUrl,
                        // The shell loaded a width-limited variant. Its aspect
                        // is authoritative for layout, but its pixel dimensions
                        // are not the original asset's metadata.
                        persistDimensions: false,
                      })
                    }
                  }}
                  style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
                />
              ) : (
                <MediaEmptyState
                  kind="image"
                  overview={overview}
                  stopNodePropagation={overview}
                  onAction={overview
                    ? undefined
                    : (action) => queueMediaEmptyAction(id, action)}
                />
              )}
              {/* 标题已外置（tc-task-node__external-title，对齐 Neowow）——不再叠内嵌底部渐变字幕，
                  少一层 overlay DOM，媒体保持纯净贴边。 */}
            </>
          ) : isPlainTextNode ? (
            <>
              <div className="task-node-header task-node-header--compact tc-task-node__text-preview-header">
                <div
                  className="task-node-header-icon task-node-header-icon--compact tc-task-node__text-preview-icon"
                  title={displayTitle}
                >
                  <SchemaIcon className="task-node-header-icon-svg" size={13} />
                </div>
                <div className="task-node-header-compact-title-slot tc-task-node__text-preview-title-slot">
                  {overview ? (
                    <span className="tc-task-node__overview-title">{displayTitle}</span>
                  ) : (
                    <TaskNodeRenameControl
                      nodeId={id}
                      label={label}
                      fallbackLabel={displayTitle}
                      readOnly={readOnly}
                      className="tc-task-node__rename-trigger--text-preview"
                      slotClassName="tc-task-node__rename-slot--text-preview"
                    />
                  )}
                </div>
              </div>
              <TextContentPreview
                html={textDisplayHtml}
                textBackgroundTint={textPreviewBackground}
                textColor={textPreviewColor}
                textFontSize={textPreviewFontSize}
                textFontWeight={textPreviewFontWeight}
              />
            </>
          ) : isAudioNode && audioUrl ? (
            // 音频产物 = 已生成的音轨。固定壳内居中竖排「音乐图标 + 名称 + 假波形 + 时长」，标明此处有成品
            // 音频，但不挂 WaveSurfer（解码留给聚焦态），保持轻量。
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 12, padding: '0 22px', pointerEvents: 'none',
            }}>
              <IconMusic size={40} stroke={1.4} color="rgba(120,180,255,0.9)" />
              <div style={{
                fontSize: 12, fontWeight: 600, lineHeight: 1, color: 'rgba(255,255,255,0.82)', textAlign: 'center',
                maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {overview ? (
                  <span className="tc-task-node__overview-title">{displayTitle}</span>
                ) : (
                  <TaskNodeRenameControl
                    nodeId={id}
                    label={label}
                    fallbackLabel={displayTitle}
                    readOnly={readOnly}
                    className="tc-task-node__rename-trigger--center tc-task-node__rename-trigger--audio"
                    slotClassName="tc-task-node__rename-slot--center tc-task-node__rename-slot--audio"
                  />
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 30, width: '78%' }}>
                {SKELETON_WAVEFORM_BARS.map((h, i) => (
                  <span key={i} style={{ flex: 1, height: `${h}%`, background: 'rgba(120,180,255,0.4)', borderRadius: 1 }} />
                ))}
              </div>
              {audioDurationSec != null ? (
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatSkeletonDuration(audioDurationSec)}
                </span>
              ) : null}
            </div>
          ) : (
            // Generic identity card — the fallback when no artifact exists yet (empty 分镜 grid, audio
            // before generation, 视频合成 with no clip) or for any other core kind. Without this the shell
            // was an empty rounded rectangle — unrecognizable until focused, which breaks 画布优先.
            // 固定壳内居中竖排「图标 + 名称」，一眼可辨识节点类型。
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 12, padding: '0 22px', pointerEvents: 'none',
            }}>
              <SchemaIcon size={40} stroke={1.4} color="rgba(255,255,255,0.4)" />
              <div style={{
                fontSize: 14, fontWeight: 600, lineHeight: 1.3, textAlign: 'center',
                color: 'rgba(255,255,255,0.82)', maxWidth: '100%',
                overflow: 'hidden', textOverflow: 'ellipsis',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              }}>
                {overview ? (
                  <span className="tc-task-node__overview-title">{displayTitle}</span>
                ) : (
                  <TaskNodeRenameControl
                    nodeId={id}
                    label={label}
                    fallbackLabel={displayTitle}
                    readOnly={readOnly}
                    className={[
                      'tc-task-node__rename-trigger--center',
                      isAudioNode ? 'tc-task-node__rename-trigger--audio' : '',
                    ].filter(Boolean).join(' ')}
                    slotClassName={[
                      'tc-task-node__rename-slot--center',
                      isAudioNode ? 'tc-task-node__rename-slot--audio' : '',
                    ].filter(Boolean).join(' ')}
                  />
                )}
              </div>
            </div>
          )}
          {hasOrchestratedVideoFacts ? (
            <VideoClipCanvasMeta nodeId={id} data={data} overview={overview} />
          ) : statusPill && !isWorkflowNode ? (
            <div style={{
              position: 'absolute', top: 6, left: 6, zIndex: 2,
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
              color: '#fff', background: statusPill.bg, pointerEvents: 'none',
              boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
            }}>
              {statusPill.dot ? (
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', background: '#fff',
                  animation: 'tc-skeleton-pulse 1s ease-in-out infinite',
                }} />
              ) : null}
              {statusPill.text}
            </div>
          ) : null}
        </div>
        {/* 聚焦操作区（表现层/编辑层分离，用户拍板 2026-07-14）：顶部悬浮工具条（tooltip
            形态，对齐原聚焦工具条），底部是播放控件条——编辑功能不进卡片内部。 */}
        {focused && (kind === 'video' || kind === 'videoCompose') && typeof dataAny?.videoUrl === 'string' && dataAny.videoUrl ? (
          <div className="tc-task-node__focus-toolbar nodrag nopan">
            <a
              className="tc-task-node__focus-toolbar-btn"
              href={dataAny.videoUrl as string}
              download
              target="_blank"
              rel="noreferrer"
              title={kind === 'videoCompose' ? '下载成片' : '下载视频'}
              onClick={(e) => e.stopPropagation()}
            >
              <IconDownload size={16} stroke={1.8} />
            </a>
          </div>
        ) : null}
        <TaskNodeHandles
          targets={targets} sources={sources} layout={handleLayoutMap}
          defaultInputType={defaultInputType} defaultOutputType={defaultOutputType}
          wideHandleBase={wideHandleBase}
          showHandles={!overview}
          showWideHandles={!overview && !isWorkflowNode}
          handleOffsets={isWorkflowNode
            ? {
                horizontal: WORKFLOW_ICON_NODE_HANDLE_OFFSET,
                vertical: WORKFLOW_ICON_NODE_HANDLE_OFFSET,
              }
            : undefined}
        />
      </div>
    )
  }
)

// TaskNodeShell: thin outer wrapper that renders the full heavy body ONLY while this node is focused
// (the sole selected node — see focusStore). Every other node renders the lightweight skeleton.
//
// Focus is reactive: useIsNodeFocused subscribes to the focus store and re-renders THIS shell the
// instant focus flips (it bypasses the React.memo prop comparator, which only gates parent-driven
// re-renders). So selecting a node mounts its body and deselecting unmounts it — the heavy-subtree
// count never exceeds 1, regardless of node count or panning. The first focus pays the lazy-chunk
// load once (skeleton fills the Suspense gap); every focus after that is instant from cache.
function TaskNodeShell(props: NodeProps<TaskNodeType>): JSX.Element {
  const isFocused = useIsNodeFocused(props.id)
  // 重画布降级：拉远到 overview 尺度时，非焦点节点渲染更轻的总览卡（缩略图+标题+端口，
  // 无状态条/面板/输入）。焦点（选中）节点不受影响，始终渲染完整 body。
  const lodOverview = React.useContext(CanvasLODContext)

  // Workflow nodes share the text core only for schema compatibility, but remain icon-only at every
  // focus state. Their configuration, run controls, history and diagnostics live in the inspector.
  const rawKind = normalizeTaskNodeKind(
    typeof (props.data as any)?.kind === 'string' ? (props.data as any).kind : null,
  ) || 'text'
  const readOnly = (props.data as { readOnly?: unknown } | undefined)?.readOnly === true
  // `readOnly` protects the node's persisted content; it must not erase the
  // node's non-editing actions. Chapter source nodes are intentionally
  // read-only, but their focused full body owns "本章做成视频" and the other
  // chapter production entrypoints. Keep the lightweight shell while they are
  // unfocused, then mount the full body on an explicit user focus just like
  // every other task node. TaskNodeInner still enforces read-only editing.
  if (readOnly && !isFocused) {
    return <TaskNodeSkeleton id={props.id} data={props.data} overview={lodOverview} />
  }
  const isWorkflowNode = rawKind === 'workflowStage' || rawKind === 'workflowTrigger'
  if (rawKind === 'codex') {
    return <CodexTaskNode {...props} overview={lodOverview} focused={isFocused} />
  }
  if (isWorkflowNode) {
    return <TaskNodeSkeleton id={props.id} data={props.data} overview={lodOverview} focused={isFocused} />
  }
  // 视频/成片节点聚焦仍挂完整 body（2026-07-14 二次拍板回撤：曾试过聚焦不换树的
  // "永远壳"方案，但提示词面板/操作栏/生成入口都在完整 body 里，砍掉=没法生成视频）。
  // 无缝感由两侧配合达成：壳与聚焦态媒体区同为满幅布局，retainedVideoSurface 在切换时
  // 移交播放进度与状态，并为新宿主重建原生画面层，避免 Chromium 只剩音频的合成层故障。
  if (!isFocused) {
    return <TaskNodeSkeleton id={props.id} data={props.data} overview={lodOverview} />
  }
  return (
    <React.Suspense fallback={<TaskNodeSkeleton id={props.id} data={props.data} focused />}>
      <TaskNodeInner {...props} />
    </React.Suspense>
  )
}

export default React.memo(TaskNodeShell, areTaskNodePropsEqual)
