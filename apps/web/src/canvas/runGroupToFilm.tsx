import { useRFStore } from './store'
import { buildGroupVideoNodesChatText, GROUP_FILM_VIDEO_NODES_DISPLAY_TEXT } from './oneClickFilmChatCommand'
import { useChatCommandStore } from '../ui/chat/chatCommandStore'
import { toast } from '../ui/toast'

type GroupFilmNodeData = {
  sourceRecipeId?: unknown
  targetDurationSeconds?: unknown
  videoAspect?: unknown
  videoModel?: unknown
  videoProfileId?: unknown
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readOptionalDuration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * 组节点「按字长创建视频节点」入口。
 *
 * 组节点不再扫描子节点、估算积分、创建本地 compose 或直连供应商。AiChatDialog
 * 会在消费命令前持久化当前画布并附加 canonical canvas context，随后由
 * agents-cli 根据装载的工作流契约执行。
 */
export function runGroupToFilm(groupId: string): void {
  const normalizedGroupId = groupId.trim()
  if (!normalizedGroupId) {
    toast('缺少组节点身份，无法发起一键成片', 'error')
    return
  }

  const groupNode = useRFStore.getState().nodes.find((node) => node.id === normalizedGroupId)
  if (!groupNode) {
    toast('当前组节点不存在，无法发起一键成片', 'error')
    return
  }

  const data = (groupNode.data ?? {}) as GroupFilmNodeData
  const facts = {
    groupId: normalizedGroupId,
    sourceRecipeId: readOptionalString(data.sourceRecipeId),
    targetDurationSeconds: readOptionalDuration(data.targetDurationSeconds),
    videoAspect: readOptionalString(data.videoAspect),
    videoModel: readOptionalString(data.videoModel),
    videoProfileId: readOptionalString(data.videoProfileId),
  }

  useChatCommandStore.getState().dispatchSend({
    text: buildGroupVideoNodesChatText(facts),
    displayText: GROUP_FILM_VIDEO_NODES_DISPLAY_TEXT,
    attachCanvasContext: true,
    freshConversation: true,
  })
  toast('已发送视频节点拆分请求', 'info')
}
