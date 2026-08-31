import { useChatCommandStore } from '../ui/chat/chatCommandStore'
import { toast } from '../ui/toast'
import {
  buildVideoClipAgentActionText,
  type VideoClipAgentAction,
} from './filmChatCommand'

type VideoClipAgentActionInput = {
  nodeId: string
  action: VideoClipAgentAction
  runId: string | null
  clipIndex: number | null
}

const ACTION_LABELS: Record<VideoClipAgentAction, string> = {
  revise_clip: '已把本镜修订请求交给小T',
  repair_clip: '已把本镜引用修复请求交给小T',
  resume_clip: '已把本镜恢复请求交给小T',
}

const ACTION_DISPLAY_TEXTS: Record<VideoClipAgentAction, string> = {
  revise_clip: '修订当前镜头',
  repair_clip: '修复当前镜头的资产引用',
  resume_clip: '恢复当前镜头任务',
}

/**
 * 画布只把镜头动作作为用户意图投递给 agents；任何修订、恢复、引用修复
 * 以及是否再次生成，都必须由当前 agents 执行链读取事实后决定。
 */
export function requestVideoClipAgentAction(input: VideoClipAgentActionInput): void {
  useChatCommandStore.getState().dispatchSend({
    text: buildVideoClipAgentActionText(input.nodeId, input.action, input.runId, input.clipIndex),
    displayText: ACTION_DISPLAY_TEXTS[input.action],
    requiredSkills: ['tapcanvas-video-workflow'],
    attachCanvasContext: true,
    freshConversation: true,
  })
  toast(ACTION_LABELS[input.action], 'info')
}
