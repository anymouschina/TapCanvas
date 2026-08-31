import React, { useState } from 'react'
import { Group, Tooltip, ActionIcon, Text, Button } from '@mantine/core'
import { IconMovie } from '@tabler/icons-react'
import { toast } from '../../../ui/toast'
import { INTENT_ACTIONS } from './intentActions'
import type { ChapterCanvasIntent } from '@tapcanvas/chapter-canvas-intents'
import { dispatchIntent } from '../../dispatchIntent'
import { useRFStore } from '../../store'
import { resolveIntentChapterContext } from './intentChapterContext'
import { useIntentLifecycle } from '../../intentLifecycle'
import { IntentConfigModal } from './IntentConfigModal'
import { ChapterFilmSpecModal, type ChapterFilmSpec } from './ChapterFilmSpecModal'
import { useChatCommandStore } from '../../../ui/chat/chatCommandStore'
import { resolveTextNodePlainText, type TextNodeDisplaySource } from './textNodeContent'
import { API_BASE } from '../../../api/server'
import {
	buildChapterFilmExecutionToolPolicy,
  buildChapterFilmSpecDirective,
  buildPlainTextFilmChatText,
  CHAPTER_FILM_CHAT_DISPLAY_TEXT,
  CHAPTER_FILM_CHAT_TEXT,
  TEXT_NODE_FILM_CHAT_DISPLAY_TEXT,
} from '../../filmChatCommand'
import { VIDEO_PRODUCTION_WORKFLOW_KEY } from '@tapcanvas/video-orchestrator-protocol'

type Props = {
  nodeId: string
  kind: string
  semanticKind?: string
  nodeData?: Record<string, unknown>
  preset?: string
  isLastSegment?: boolean
}

type PendingConfig = {
  intent: ChapterCanvasIntent
  chapterContext: NonNullable<ReturnType<typeof resolveIntentChapterContext>>
  variantParams?: Record<string, unknown>
}

type IntentGenerationConfig = {
  imageModel: string
  imageSize: string
}

function mergeSceneReferenceVariantParams(
  intent: ChapterCanvasIntent,
  variantParams: Record<string, unknown> | undefined,
  rebuildSceneReferences: boolean | undefined,
): Record<string, unknown> | undefined {
  if (intent !== 'generate_scene_references' || rebuildSceneReferences !== true) return variantParams
  return {
    ...(variantParams ?? {}),
    rebuildSceneReferences: true,
  }
}

function stripHtmlToText(html: string): string {
  if (typeof document === 'undefined') return html.replace(/<[^>]+>/g, ' ').trim()
  const el = document.createElement('div')
  el.innerHTML = html
  return (el.textContent || el.innerText || '').trim()
}

// 与文本节点显示所用的同一套解析（prompt/content/text/textResults/logs），
// 保证「节点里看得见的文字，做成视频就读得到」；再兜底 textHtml 纯文本化。
function readPlainTextNodeContent(nodeData: Record<string, unknown> | undefined): string {
  if (!nodeData) return ''
  const textResults = Array.isArray(nodeData.textResults) ? nodeData.textResults : []
  const last = textResults.length ? (textResults[textResults.length - 1] as Record<string, unknown>) : null
  const latestTextResult = last && typeof last.text === 'string' ? last.text : ''
  const resolved = resolveTextNodePlainText({
    data: nodeData as TextNodeDisplaySource,
    latestTextResult,
  }).trim()
  if (resolved) return resolved
  const html = typeof nodeData.textHtml === 'string' ? nodeData.textHtml : ''
  return html ? stripHtmlToText(html) : ''
}

function mergeShotPlaceholderVariantParams(
  intent: ChapterCanvasIntent,
  variantParams: Record<string, unknown> | undefined,
  lineArtMode: boolean | undefined,
  shotDuration: number | undefined,
): Record<string, unknown> | undefined {
  if (intent !== 'generate_shot_placeholders') return variantParams
  const extra: Record<string, unknown> = {}
  if (lineArtMode) extra.lineArt = true
  if (typeof shotDuration === 'number') extra.shotDuration = shotDuration
  if (!Object.keys(extra).length) return variantParams
  return { ...(variantParams ?? {}), ...extra }
}

export function IntentActionGroup(props: Props) {
  const activeIntent = useIntentLifecycle((s) => s.activeIntent)
  const [pendingConfig, setPendingConfig] = useState<PendingConfig | null>(null)
  const [filmSpecOpened, setFilmSpecOpened] = useState(false)

  const actions = INTENT_ACTIONS.filter((a) =>
    a.applicableTo({
      kind: props.kind,
      semanticKind: props.semanticKind,
      nodeData: props.nodeData,
      preset: props.preset,
      isLastSegment: props.isLastSegment,
    }),
  )
  // 文本节点「做成视频」：经主对话面板派发给小T，走完整角色流水线
  // （分镜师→生成师→剪辑师→后期），无需用户手写长提示词。
  // - chapter-info 预设 → 按整章剧情成片；
  // - 普通文本节点 → 按该节点自身正文成片（编排相同，作用域=本节点文本）。
  const isChapterScriptNode = props.kind === 'text' && props.preset === 'chapter-info'
  const isTextFilmNode = props.kind === 'text'
  if (actions.length === 0 && !isTextFilmNode) return null

  function handleMakeVideoClick() {
    if (isChapterScriptNode) {
      // 这里只确认章级交付范围与改编模式；模型/比例/分辨率继承 AI 对话生成偏好。
      setFilmSpecOpened(true)
      return
    }
    // 读实时节点数据（避免闭包里 props.nodeData 陈旧），再回退到 props
    const liveNode = useRFStore.getState().nodes.find((n) => n.id === props.nodeId)
    const liveData =
      (liveNode?.data && typeof liveNode.data === 'object'
        ? (liveNode.data as Record<string, unknown>)
        : undefined) ?? props.nodeData
    const text = readPlainTextNodeContent(liveData)
    if (!text) {
      toast('文本节点内容为空，请先在节点里输入要成片的正文', 'error')
      return
    }
    useChatCommandStore.getState().dispatchSend({
      text: buildPlainTextFilmChatText(props.nodeId, text),
      displayText: TEXT_NODE_FILM_CHAT_DISPLAY_TEXT,
      requiredSkills: ['tapcanvas-video-workflow'],
      workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
    })
    toast('已派发给小T：文本节点成片，真实进度与终态见右侧对话面板', 'success')
  }

  async function handleFilmSpecConfirm(spec: ChapterFilmSpec) {
    setFilmSpecOpened(false)
    // 章级交付范围落 chapters.film_spec；忠实原文是单一生产合同，生成规格不在这里重复持久化。
    const specChapter = resolveContext()
    if (!specChapter?.chapterId) {
      toast('无法确认当前章节作用域，未派发成片任务', 'error')
      return
    }
    try {
      const response = await fetch(
        `${API_BASE}/chapters/${encodeURIComponent(specChapter.chapterId)}/film-spec`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify(spec),
        },
      )
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
    } catch (error) {
      toast(`成片规格保存失败，未派发成片任务：${String((error as Error).message || error)}`, 'error')
      return
    }
    useChatCommandStore.getState().dispatchSend({
      text: CHAPTER_FILM_CHAT_TEXT + buildChapterFilmSpecDirective(spec),
      displayText: CHAPTER_FILM_CHAT_DISPLAY_TEXT,
      requiredSkills: ['tapcanvas-video-workflow'],
		executionToolPolicy: buildChapterFilmExecutionToolPolicy(),
		canvasNodeId: props.nodeId,
      freshConversation: true,
      workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
		requestedWorkflowExecutionVariant: 'full_video',
    })
    toast(
      `已派发给小T：本章成片 · ${spec.adaptationMode === 'creative' ? '创意改编' : '忠实原文'} · 生成规格继承 AI 对话偏好${spec.notes ? ' · 含备注' : ''}（进度看右侧对话面板）`,
      'success',
    )
  }

  function resolveContext() {
    const state = useRFStore.getState()
    return resolveIntentChapterContext({
      sourceNodeId: props.nodeId,
      nodes: state.nodes,
      edges: state.edges,
    })
  }

  function doDispatch(
    intent: ChapterCanvasIntent,
    chapterContext: NonNullable<ReturnType<typeof resolveIntentChapterContext>>,
    variantParams?: Record<string, unknown>,
    generationConfig?: IntentGenerationConfig,
    userHints?: string,
  ) {
    void dispatchIntent(intent, props.nodeId, { chapterContext, variantParams, generationConfig, userHints })
  }

  function renderActionButton(a: (typeof actions)[number]) {
    const Icon = a.icon
    const isThisLoading = activeIntent === a.intent
    const isAnyLoading = activeIntent !== null
    const actionLabel = a.resolveLabel?.({
      kind: props.kind,
      semanticKind: props.semanticKind,
      nodeData: props.nodeData,
      preset: props.preset,
      isLastSegment: props.isLastSegment,
    }) ?? a.label
    return (
      <Tooltip key={a.key} label={actionLabel} withArrow>
        <ActionIcon
          variant="subtle"
          loading={isThisLoading}
          disabled={isAnyLoading && !isThisLoading}
          onClick={() => {
            if (isAnyLoading) return
            const chapterContext = resolveContext()
            if (!chapterContext) {
              console.warn('[IntentActionGroup] no current chapter context', { nodeId: props.nodeId })
              toast('当前画布上下文未就绪，请稍后重试', 'error')
              return
            }
            if (a.defaultGenerationConfig) {
              doDispatch(a.intent, chapterContext, a.variantParams, a.defaultGenerationConfig)
            } else if (a.requiresConfig) {
              setPendingConfig({ intent: a.intent, chapterContext, variantParams: a.variantParams })
            } else {
              doDispatch(a.intent, chapterContext, a.variantParams)
            }
          }}
        >
          <Icon size={14} />
        </ActionIcon>
      </Tooltip>
    )
  }

  // Split actions into uncategorized (flat) and categorized groups
  const uncategorized = actions.filter((a) => !a.category)
  const categoryMap = new Map<string, typeof actions>()
  for (const a of actions) {
    if (!a.category) continue
    const group = categoryMap.get(a.category) ?? []
    group.push(a)
    categoryMap.set(a.category, group)
  }

  return (
    <>
      {/* 工具统一贴在节点上方一行、不换行：成片按钮 + 各 intent 图标横向排列 */}
      <Group gap={6} wrap="nowrap" align="center">
        {isTextFilmNode ? (
          // 一键成片按钮只提交当前真实作用域，由已装配 Workflow IR 决定可观察的分段、资产、
          // 生成与合成节点；chapter-info 以整章为源，普通文本节点以本节点正文为源。
          <Button
            size="compact-xs"
            variant="gradient"
            gradient={{ from: 'indigo', to: 'grape', deg: 110 }}
            leftSection={<IconMovie size={13} />}
            styles={{ root: { fontWeight: 600 } }}
            onClick={handleMakeVideoClick}
          >
            {isChapterScriptNode ? '本章做成视频' : '做成视频'}
          </Button>
        ) : null}
        {uncategorized.map(renderActionButton)}
        {Array.from(categoryMap.entries()).map(([category, categoryActions]) => (
          <React.Fragment key={category}>
            <Text size="xs" c="dimmed" style={{ userSelect: 'none', pointerEvents: 'none', lineHeight: 1 }}>
              {category}
            </Text>
            {categoryActions.map(renderActionButton)}
          </React.Fragment>
        ))}
      </Group>

      <ChapterFilmSpecModal
        opened={filmSpecOpened}
        onCancel={() => setFilmSpecOpened(false)}
        onConfirm={handleFilmSpecConfirm}
      />

      <IntentConfigModal
        intent={pendingConfig?.intent}
        opened={pendingConfig !== null}
        onCancel={() => setPendingConfig(null)}
        onConfirm={({ imageModel, imageSize, rebuildSceneReferences, userHints, lineArtMode, shotDuration }) => {
          if (!pendingConfig) return
          const variantParams = mergeShotPlaceholderVariantParams(
            pendingConfig.intent,
            mergeSceneReferenceVariantParams(pendingConfig.intent, pendingConfig.variantParams, rebuildSceneReferences),
            lineArtMode,
            shotDuration,
          )
          doDispatch(
            pendingConfig.intent,
            pendingConfig.chapterContext,
            variantParams,
            { imageModel, imageSize },
            userHints,
          )
          setPendingConfig(null)
        }}
      />
    </>
  )
}
