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
  /** 页面正在创建项目 Flow 时暂存的用户需求，不应被消费为临时会话。 */
  queuedUntilFlow?: boolean
  /** 暂存队列中对应的本地气泡，用于 Flow 就绪时去重。 */
  queuedMessageId?: string
  /** 暂存需求的项目/章节作用域，防止导航后投递到另一个项目。 */
  queuedProjectId?: string
  queuedChapterId?: string
}

type ChatCommandState = {
  pending: ChatSendCommand | null
  pendingQueue: ChatSendCommand[]
  deferredUntilFlow: ChatSendCommand[]
  /** 主对话回合是否在飞（AiChatDialog 回写）：选项卡等组件据此提示"点选后排队发送"。 */
  busy: boolean
  /** 派发一条发送命令（画布侧调用）。回合在飞时不会丢：AiChatDialog 侧排队、回合结束补发。 */
  dispatchSend: (cmd: Omit<ChatSendCommand, 'nonce'>) => void
  enqueueUntilFlow: (cmd: Omit<ChatSendCommand, 'nonce' | 'queuedUntilFlow'>) => ChatSendCommand
  peekDeferredUntilFlow: (scope: { projectId: string; chapterId: string }) => ChatSendCommand | null
  consumeDeferredUntilFlow: (scope?: { projectId: string; chapterId: string }) => ChatSendCommand | null
  ackDeferredUntilFlow: (queuedMessageId: string) => void
  /** 取出并清空当前命令（AiChatDialog 消费） */
  consume: () => ChatSendCommand | null
  setBusy: (busy: boolean) => void
}

let seq = 0

const DEFERRED_CHAT_COMMANDS_STORAGE_KEY = 'tapcanvas.aiChat.deferredUntilFlow.v1'

function readDeferredCommands(): ChatSendCommand[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.sessionStorage.getItem(DEFERRED_CHAT_COMMANDS_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('deferred_queue_not_array')
    const valid = parsed.filter((item): item is ChatSendCommand => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false
      const record = item as Record<string, unknown>
      return typeof record.text === 'string' && record.text.trim().length > 0
        && typeof record.nonce === 'number' && Number.isSafeInteger(record.nonce) && record.nonce >= 0
        && typeof record.queuedProjectId === 'string' && record.queuedProjectId.trim().length > 0
        && (record.queuedChapterId === undefined || typeof record.queuedChapterId === 'string')
        && typeof record.queuedMessageId === 'string' && record.queuedMessageId.trim().length > 0
    })
    if (valid.length !== parsed.length) {
      console.warn('[ai-chat][deferred-queue] invalid stored commands', { rejectedCount: parsed.length - valid.length })
    }
    return valid
  } catch (error: unknown) {
    console.warn('[ai-chat][deferred-queue] storage restore failed', { errorType: error instanceof Error ? error.name : typeof error })
    return []
  }
}

function persistDeferredCommands(commands: ChatSendCommand[]): void {
  if (typeof window === 'undefined') return
  try {
    if (commands.length === 0) {
      window.sessionStorage.removeItem(DEFERRED_CHAT_COMMANDS_STORAGE_KEY)
    } else {
      window.sessionStorage.setItem(DEFERRED_CHAT_COMMANDS_STORAGE_KEY, JSON.stringify(commands))
    }
  } catch (error: unknown) {
    // The in-memory queue remains authoritative; expose lost restart persistence.
    console.warn('[ai-chat][deferred-queue] storage persist failed', { errorType: error instanceof Error ? error.name : typeof error })
  }
}

const restoredDeferredCommands = readDeferredCommands()
seq = restoredDeferredCommands.reduce((maximum, command) => Math.max(maximum, command.nonce), seq)

export const useChatCommandStore = create<ChatCommandState>((set, get) => ({
  pending: null,
  pendingQueue: [],
  deferredUntilFlow: restoredDeferredCommands,
  busy: false,
  dispatchSend: (cmd) => {
    seq += 1
    const next = { attachCanvasContext: true, ...cmd, nonce: seq }
    const current = get()
    if (current.pending) {
      set({ pendingQueue: [...current.pendingQueue, next] })
    } else {
      set({ pending: next })
    }
  },
  enqueueUntilFlow: (cmd) => {
    seq += 1
    const next = {
      attachCanvasContext: true,
      ...cmd,
      queuedUntilFlow: true,
      nonce: seq,
    }
    set((state) => {
      const deferredUntilFlow = [...state.deferredUntilFlow, next]
      persistDeferredCommands(deferredUntilFlow)
      return { deferredUntilFlow }
    })
    return next
  },
  peekDeferredUntilFlow: (scope) => {
    return get().deferredUntilFlow.find((command) => (
      command.queuedProjectId === scope.projectId
      && (command.queuedChapterId || '') === scope.chapterId
    )) ?? null
  },
  consumeDeferredUntilFlow: (scope) => {
    const deferred = get().deferredUntilFlow
    const index = scope
      ? deferred.findIndex((command) => (
          command.queuedProjectId === scope.projectId
          && (command.queuedChapterId || '') === scope.chapterId
        ))
      : 0
    const next = index >= 0 ? deferred[index] ?? null : null
    if (next) {
      const deferredUntilFlow = deferred.filter((_, itemIndex) => itemIndex !== index)
      persistDeferredCommands(deferredUntilFlow)
      set({ deferredUntilFlow })
    }
    return next
  },
  ackDeferredUntilFlow: (queuedMessageId) => {
    const id = queuedMessageId.trim()
    if (!id) return
    const deferredUntilFlow = get().deferredUntilFlow.filter((command) => command.queuedMessageId !== id)
    if (deferredUntilFlow.length === get().deferredUntilFlow.length) return
    persistDeferredCommands(deferredUntilFlow)
    set({ deferredUntilFlow })
  },
  consume: () => {
    const state = get()
    const p = state.pending
    if (p) {
      set({
        pending: state.pendingQueue[0] ?? null,
        pendingQueue: state.pendingQueue.slice(1),
      })
    }
    return p
  },
  setBusy: (busy) => {
    if (get().busy !== busy) set({ busy })
  },
}))
