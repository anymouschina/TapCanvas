import { useRFStore } from './store'
import { buildGroupSkillOnlyFilmChatText, GROUP_FILM_SKILL_ONLY_DISPLAY_TEXT } from './oneClickFilmChatCommand'
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
 * 组节点「Beat 规划」入口。
 *
 * 组节点不再扫描子节点、估算积分、创建本地 compose 或直连供应商。AiChatDialog
 * 会在消费命令前持久化当前画布并附加 canonical canvas context，随后只由
 * agents-cli 召回轻量 Skill 输出 Beat 规划。
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
    text: buildGroupSkillOnlyFilmChatText(facts),
    displayText: GROUP_FILM_SKILL_ONLY_DISPLAY_TEXT,
    requiredSkills: ['tapcanvas-one-click-skill-only'],
    attachCanvasContext: true,
    freshConversation: true,
  })
  toast('已把组节点 Beat 拆分任务交给小T，结果会回到画布', 'info')
}
