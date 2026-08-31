import { create } from 'zustand'

export type GenerationProposalContext = {
  version: 1
  proposalId: string
  kind: 'image' | 'video' | 'audio' | 'prompt'
  title: string
  prompt: string
  model?: string
  parameters?: Array<{ label: string; value: string }>
  action?: string
  nodeId?: string
}

// 让画布等同级组件把内部执行正文交给 agent，并在主 AI 对话中只投影用户可理解的动作摘要。
// AiChatDialog 订阅本 store，收到 pending 命令即调用其内部 send()。
export type ChatSendCommand = {
  /** 要发送的消息正文（即给 agent 的指令） */
  text: string
  /** 聊天气泡、持久会话和恢复状态使用的用户友好文案；内部 text 不会被替换。 */
  displayText?: string
  /** 强制加载的 skills（如 ['tapcanvas-video-workflow']） */
  requiredSkills?: string[]
  /** 是否附加画布上下文，默认 true */
  attachCanvasContext?: boolean
  /** 生产型入口必须隔离历史对话，避免复用旧 run、旧模型或旧 BeatSheet。 */
  freshConversation?: boolean
  /** 明确入口绑定的运行工作流身份；禁止根据 prompt 文案在本地推断。 */
  workflowKey?: string
	/** 用户入口已确定的视频工作流交付变体；后端据此只暴露同变体的已装配工作流。 */
	requestedWorkflowExecutionVariant?: 'full_video' | 'first_video'
	/** 明确入口的结构能力边界；只缩小工具面，不规定 agents 的语义路线或调用顺序。 */
	executionToolPolicy?: {
		mode: 'restricted'
		allowedTools: string[]
	}
	/** 入口源节点的权威锚点，避免被画布当前选中态替换。 */
	canvasNodeId?: string
  /** 工作流节点显式绑定的 agents-cli agent type；优先于聊天面板的临时角色选择。 */
  forcedAgentRole?: string
  /** 多 Agent 工作流允许委派的精确 agent type 集合。 */
  allowedSubagentTypes?: string[]
  /** 要求本轮产生真实子 Agent 执行证据，不能由主 Agent 单独声称完成。 */
  requireAgentsTeamExecution?: boolean
  /** 用户从生成提案卡明确点击的结构化提案；随请求传递，禁止退化成仅凭按钮文案重解释。 */
  generationProposal?: GenerationProposalContext
  /** 去重/触发用，单调递增 */
  nonce: number
}

type ChatCommandState = {
  pending: ChatSendCommand | null
  /** 主对话回合是否在飞（AiChatDialog 回写）：选项卡等组件据此提示"点选后排队发送"。 */
  busy: boolean
  /** 派发一条发送命令（画布侧调用）。回合在飞时不会丢：AiChatDialog 侧排队、回合结束补发。 */
  dispatchSend: (cmd: Omit<ChatSendCommand, 'nonce'>) => void
  /** 取出并清空当前命令（AiChatDialog 消费） */
  consume: () => ChatSendCommand | null
  setBusy: (busy: boolean) => void
}

let seq = 0

export const useChatCommandStore = create<ChatCommandState>((set, get) => ({
  pending: null,
  busy: false,
  dispatchSend: (cmd) => {
    seq += 1
    set({ pending: { attachCanvasContext: true, ...cmd, nonce: seq } })
  },
  consume: () => {
    const p = get().pending
    if (p) set({ pending: null })
    return p
  },
  setBusy: (busy) => {
    if (get().busy !== busy) set({ busy })
  },
}))
