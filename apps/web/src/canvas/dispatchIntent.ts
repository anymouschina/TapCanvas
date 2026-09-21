import type { ChapterCanvasIntent } from '@tapcanvas/chapter-canvas-intents'
import { useChatCommandStore, type ChatSendCommand } from '../ui/chat/chatCommandStore'
import { toast } from '../ui/toast'
import { useUIStore } from '../ui/uiStore'
import type { IntentChapterContext } from './nodes/taskNode/intentChapterContext'

export type DispatchIntentOptions = {
  chapterContext?: IntentChapterContext
  userHints?: string
  generationConfig?: { imageModel?: string; imageSize?: string }
  variantParams?: Record<string, unknown>
}

// These are the actions explicitly selected by the user, not inferred routes or
// execution plans. Evidence gathering, skills and tool order belong to the agent.
const INTENT_GOALS: Record<ChapterCanvasIntent, string> = {
  extract_roles: '从指定源节点提取角色并在当前画布创建角色卡',
  expand_video_script: '根据指定源节点扩写视频剧本并写回当前画布',
  generate_scene_references: '根据指定源节点生成场景和人物参考图，并将真实图片资产写回当前画布',
  generate_shot_placeholders: '根据指定源节点生成镜头设计板及设计板图片，并写回当前画布',
  generate_video_nodes: '根据指定源节点及用户参数生成视频，并将真实视频资产写回当前画布',
  generate_group_storyboard: '根据指定源节点生成分组分镜及分镜图片，并写回当前画布',
}

export function buildIntentChatCommand(
  intent: ChapterCanvasIntent,
  sourceNodeId: string,
  options: DispatchIntentOptions,
  styleGuide?: { styleName?: string; referenceImages?: string[] },
): Omit<ChatSendCommand, 'nonce'> {
  const context = options.chapterContext
  if (!context?.projectId || !context.chapterId) {
    throw new Error('章节画布操作缺少真实 projectId 或 chapterId')
  }
  const sourceNode = context.flowSnapshot.nodes.find((node) => node.id === sourceNodeId)
  if (!sourceNode) throw new Error('当前画布中找不到指定源节点，请重新选择')
  const goal = INTENT_GOALS[intent]
  return {
    displayText: goal,
    canvasNodeId: sourceNodeId,
    queuedProjectId: context.projectId,
    queuedChapterId: context.chapterId,
    attachCanvasContext: true,
    text: [
      goal,
      '以下是用户点击入口时的真实作用域、源节点和明确选择的生成参数。请结合当前项目事实自主决定执行步骤；完成状态以真实交付结果为准。',
      JSON.stringify({
        intent,
        projectId: context.projectId,
        bookId: context.bookId,
        chapterId: context.chapterId,
        sourceNode,
        generationConfig: options.generationConfig,
        variantParams: options.variantParams,
        styleGuide,
      }),
      ...(options.userHints?.trim() ? [`用户补充要求：${options.userHints.trim()}`] : []),
    ].join('\n'),
  }
}

/** Submit to the main chat; submission is not evidence of completed generation. */
export function dispatchIntent(
  intent: ChapterCanvasIntent,
  sourceNodeId: string,
  options: DispatchIntentOptions,
): void {
  try {
    const ui = useUIStore.getState()
    const command = buildIntentChatCommand(intent, sourceNodeId, options, ui.activeStyleBible ?? undefined)
    ui.setAiChatOpen(true)
    useChatCommandStore.getState().dispatchSend(command)
  } catch (error: unknown) {
    toast(error instanceof Error ? error.message : String(error), 'error')
  }
}
