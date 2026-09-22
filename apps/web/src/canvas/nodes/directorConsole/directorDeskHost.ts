import type { AgentsChatStreamEvent } from '../../../api/server'
import { claimDirectorDeskCall, listPendingDirectorDeskCalls, reportDirectorDeskCall } from '../../../api/directorDeskRelay'
import { addDirectorDeskVideoNode, uploadDirectorDeskVideo } from './directorDeskCanvasExport'

/**
 * 导演台 AI 面板的宿主实现。
 *
 * 导演台（apps/director-desk）桌面版把 AI 运行交给 Electron 主进程；被 TapCanvas 以同源 iframe
 * 嵌入时改由本模块承担同一份 `window.directorDesktop` 合同，把导演台 AI 面板接到 TapCanvas
 * 自己的 AI 对话链路上：渠道列表来自系统模型目录，一轮对话走 `/public/agents/chat` 流式返回，
 * 事件按导演台自己的 AgentEvent 形状回灌到它的面板。
 *
 * 不伪造桌面能力：软件更新与 MCP 服务在网页嵌入中不存在，对应入口由导演台按能力存在性
 * 自行降级（apps/director-desk/src/ui/update-panel.ts、ai-mcp.ts）。
 */

/** 与导演台 src/automation/desktop-types.ts 的 Channel 对齐。 */
export type DirectorDeskChannel = {
  id: string
  name: string
  protocol: 'chat' | 'responses' | 'anthropic'
  baseUrl: string
  model: string
  hasKey: boolean
  remembered: boolean
  stream: boolean
  maxTokens: number
  maxRounds: number
}

export type DirectorDeskConversation = { sessionId: string; profileId: string; transcript: string }

export type DirectorDeskHostDeps = {
  /** 系统模型目录里的可选文本模型（id 即渠道 id）。 */
  channels: readonly DirectorDeskChannel[]
  /** 取指定渠道对应的对话请求字段；返回 null 表示该渠道已不在当前目录中。 */
  resolveModelRequest: (channelId: string) => { field: 'modelKey' | 'modelAlias'; model: string } | null
  /** 发起一轮对话；返回中断函数。 */
  runChat: (input: {
    prompt: string
    modelRequest: { field: 'modelKey' | 'modelAlias'; model: string }
    sessionId: string
    onEvent: (event: AgentsChatStreamEvent) => void
    onSettled: (error?: Error) => void
  }) => () => void
  canvasNodeId: string
  /** 成片上传时归属的项目；缺省则只挂到当前节点。 */
  currentProjectId?: string
}

export type DirectorDeskHost = {
  /** iframe 挂载后调用，开始服务桥接请求。 */
  attach: (frame: HTMLIFrameElement) => void
  detach: () => void
  /** 关闭再打开时恢复的对话快照。 */
  conversation: () => DirectorDeskConversation
}

type BridgeCall = { id: number; method: string; args?: unknown }
type DeskToolResult = { ok: boolean; data?: unknown; error?: string }
type ToolReply = { id: number; result?: { ok?: boolean; data?: unknown; error?: string } }

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createDirectorDeskHost(deps: DirectorDeskHostDeps): DirectorDeskHost {
  let frame: HTMLIFrameElement | null = null
  let abortRun: (() => void) | null = null
  let sessionId = ''
  let transcript = ''
  let profileId = deps.channels[0]?.id ?? ''
  let toolSeq = 0
  const toolWaiters = new Map<number, (reply: ToolReply) => void>()

  const conversation = (): DirectorDeskConversation => ({ sessionId, profileId, transcript })

  function post(message: Record<string, unknown>): void {
    frame?.contentWindow?.postMessage({ __tcDirectorDesk: true, ...message }, window.location.origin)
  }

  function emitEvent(event: Record<string, unknown>): void {
    post({ kind: 'event', data: { sessionId, channel: profileId, ...event } })
  }

  /**
   * 调用导演台自己的工具（父 → 子）。
   *
   * 导演台在初始化时通过 onTool 注册它的工具执行器；宿主用同一条通道执行工具，
   * 例如读取它内置的技能文本。工具参数与返回都由导演台自己校验。
   */
  function callDeskTool(name: string, args: Record<string, unknown> = {}): Promise<DeskToolResult> {
    if (!frame?.contentWindow) return Promise.resolve({ ok: false, error: '导演台尚未打开' })
    const id = ++toolSeq
    return new Promise<DeskToolResult>((resolve) => {
      const timer = window.setTimeout(() => {
        toolWaiters.delete(id)
        resolve({ ok: false, error: `导演台工具 ${name} 超时未返回` })
      }, 30_000)
      toolWaiters.set(id, (reply) => {
        window.clearTimeout(timer)
        const result = reply.result
        resolve(result
          ? { ok: result.ok === true, ...(result.data === undefined ? {} : { data: result.data }), ...(result.error ? { error: result.error } : {}) }
          : { ok: false, error: '导演台工具未返回结果' })
      })
      post({ kind: 'tool', data: { id, name, args } })
    })
  }

  function emitDone(): void {
    abortRun = null
    emitEvent({ type: 'done' })
  }

  /** 服务端排队的导演台工具调用：认领 → 交给导演台执行 → 回报真实结果。 */
  const RELAY_POLL_INTERVAL_MS = 1200
  let relayTimer: number | null = null
  let relayBusy = false

  async function drainRelayQueue(): Promise<void> {
    if (relayBusy || !frame?.contentWindow) return
    relayBusy = true
    try {
      for (const call of await listPendingDirectorDeskCalls()) {
        const claimed = await claimDirectorDeskCall(call.callId)
        if (!claimed.ok) continue
        const result = await callDeskTool(claimed.tool, (claimed.arguments ?? {}) as Record<string, unknown>)
        await reportDirectorDeskCall({
          callId: call.callId,
          leaseToken: claimed.leaseToken,
          ok: result.ok,
          ...(result.ok ? { data: result.data } : { error: result.error || '导演台执行失败' }),
        })
      }
    } catch (error) {
      // 轮询本身失败（网络、未登录）只记录诊断，不打断导演台使用；真正的工具调用会由服务端超时显式失败。
      console.error('[director-desk-relay] 轮询待执行工具失败', error)
    } finally {
      relayBusy = false
    }
  }

  function startRelayPolling(): void {
    if (relayTimer !== null) return
    relayTimer = window.setInterval(() => { void drainRelayQueue() }, RELAY_POLL_INTERVAL_MS)
    void drainRelayQueue()
  }

  function stopRelayPolling(): void {
    if (relayTimer === null) return
    window.clearInterval(relayTimer)
    relayTimer = null
  }

  function mapStreamEvent(event: AgentsChatStreamEvent): void {
    switch (event.event) {
      case 'session':
        sessionId = event.data.sessionId || sessionId
        return
      case 'content': {
        const delta = event.data.delta || ''
        if (!delta) return
        transcript += delta
        emitEvent({ type: 'text', text: delta })
        return
      }
      case 'tool': {
        const payload = event.data
        emitEvent({
          type: 'tool',
          name: payload.toolName,
          status: payload.phase === 'started' ? 'running' : payload.status === 'succeeded' ? 'succeeded' : 'failed',
          ...(payload.outputPreview ? { summary: payload.outputPreview } : {}),
        })
        return
      }
      case 'result': {
        const usage = (event.data.response as { usage?: unknown } | undefined)?.usage
        if (usage) emitEvent({ type: 'usage', usage })
        emitDone()
        return
      }
      case 'error':
        emitEvent({ type: 'error', text: event.data.message || '对话失败' })
        emitDone()
        return
      default:
        return
    }
  }

  function startRun(prompt: string, channelId: string): { ok: boolean; error?: string } {
    const modelRequest = deps.resolveModelRequest(channelId)
    if (!modelRequest) return { ok: false, error: '系统模型目录里找不到该渠道，请重新选择' }
    abortRun?.()
    abortRun = null
    profileId = channelId
    transcript += `\n你：${prompt}\nAI：`
    emitEvent({ type: 'status', text: '已提交给 TapCanvas AI' })
    abortRun = deps.runChat({
      prompt,
      modelRequest,
      sessionId,
      onEvent: mapStreamEvent,
      onSettled: (error) => {
        if (error) {
          emitEvent({ type: 'error', text: asErrorMessage(error) })
          emitDone()
          return
        }
        // 流结束时若已收到 result/error 事件，emitDone 已执行；这里只兜底尚未收口的轮次。
        if (abortRun) emitDone()
      },
    })
    return { ok: true }
  }

  async function handleCall(call: BridgeCall): Promise<Record<string, unknown>> {
    switch (call.method) {
      case 'profiles':
        return { ok: true, data: deps.channels }

      case 'conversation':
        return { ok: true, data: conversation() }

      case 'newConversation':
        abortRun?.()
        abortRun = null
        transcript = ''
        sessionId = `director-${deps.canvasNodeId}-${Date.now().toString(36)}`
        return { ok: true, data: conversation() }

      case 'run': {
        const args = (call.args ?? {}) as { prompt?: unknown; profileId?: unknown }
        const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
        if (!prompt) return { ok: false, error: '任务内容为空' }
        const channelId = typeof args.profileId === 'string' && args.profileId ? args.profileId : profileId
        const started = startRun(prompt, channelId)
        return started.ok ? { ok: true } : { ok: false, error: started.error }
      }

      case 'stop':
        abortRun?.()
        abortRun = null
        emitDone()
        return { ok: true }

      case 'skills': {
        const skill = await callDeskTool('director_skill', {})
        if (!skill.ok) return { ok: false, error: skill.error || '读取导演台技能失败' }
        const data = (skill.data ?? {}) as { instructions?: string; version?: string }
        const instructions = typeof data.instructions === 'string' ? data.instructions : ''
        return {
          ok: true,
          data: {
            version: data.version ?? '',
            instructions,
            files: ['SKILL.md'],
            skills: [{
              id: 'director-desk',
              name: '导演台内置技能',
              description: '导演台自身的场景/运镜/导出契约，随版本读取。',
              version: data.version ?? '',
              enabled: true,
              builtin: true,
              source: 'director-desk',
              files: ['SKILL.md'],
            }],
          },
        }
      }

      case 'copyText': {
        const text = typeof call.args === 'string' ? call.args : ''
        try {
          await navigator.clipboard.writeText(text)
          return { ok: true }
        } catch (error) {
          return { ok: false, error: asErrorMessage(error) }
        }
      }

      /**
       * 交付：导演台桌面版把成片/工程写到本机目录；嵌入 TapCanvas 后，
       * 成片改为上传到 TapCanvas 资产并落成画布视频节点，工程文件仍走浏览器下载。
       */
      case 'files': {
        const payload = (call.args ?? {}) as { action?: unknown; data?: unknown }
        const action = typeof payload.action === 'string' ? payload.action : ''
        const data = (payload.data ?? {}) as { name?: unknown; bytes?: unknown; content?: unknown }
        const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : '导演台导出'

        if (action === 'save-export') {
          if (!(data.bytes instanceof ArrayBuffer)) return { ok: false, error: '导出内容缺失，无法上传' }
          try {
            const blob = new Blob([data.bytes], { type: name.endsWith('.webm') ? 'video/webm' : 'video/mp4' })
            const hosted = await uploadDirectorDeskVideo({
              blob,
              label: name,
              ownerNodeId: deps.canvasNodeId,
              ...(deps.currentProjectId ? { projectId: deps.currentProjectId } : {}),
            })
            addDirectorDeskVideoNode({ url: hosted.url, assetId: hosted.assetId, name, directorNodeId: deps.canvasNodeId })
            return { ok: true, data: { saved: true, filename: name } }
          } catch (error) {
            return { ok: false, error: asErrorMessage(error) }
          }
        }

        if (action === 'save-project') {
          if (typeof data.content !== 'string') return { ok: false, error: '工程内容缺失' }
          const url = URL.createObjectURL(new Blob([data.content], { type: 'application/json' }))
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = name
          anchor.click()
          window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
          // 浏览器无法确认落盘结果，如实返回未确认，由导演台提示用户核对文件。
          return { ok: true, data: { saved: false } }
        }

        return { ok: false, error: `不支持的交付动作：${action}` }
      }

      // 渠道由 TapCanvas 模型管理统一维护，导演台不再自建渠道：保存/连通测试都按当前目录回答。
      case 'configure':
        return { ok: true, data: deps.channels }

      case 'test':
        return deps.channels.length
          ? { ok: true }
          : { ok: false, error: '系统模型目录为空，请先在 TapCanvas 配置可用模型' }

      default:
        return { ok: false, error: `宿主未实现该方法：${call.method}` }
    }
  }

  function onMessage(event: MessageEvent): void {
    if (event.source !== frame?.contentWindow || event.origin !== window.location.origin) return
    const data = event.data as (BridgeCall & { __tcDirectorDesk?: boolean; kind?: string }) | null
    if (!data || data.__tcDirectorDesk !== true) return

    if (data.kind === 'toolResult') {
      const waiter = toolWaiters.get(data.id)
      if (!waiter) return
      toolWaiters.delete(data.id)
      waiter(data as ToolReply)
      return
    }

    if (data.kind !== 'call') return
    void handleCall(data).then(
      (result) => post({ kind: 'result', id: data.id, result }),
      (error: unknown) => post({ kind: 'result', id: data.id, error: asErrorMessage(error) }),
    )
  }

  return {
    attach: (next) => {
      frame = next
      window.addEventListener('message', onMessage)
      startRelayPolling()
    },
    detach: () => {
      window.removeEventListener('message', onMessage)
      stopRelayPolling()
      abortRun?.()
      abortRun = null
      for (const [, waiter] of toolWaiters) waiter({ id: 0, result: { ok: false, error: '导演台已关闭' } })
      toolWaiters.clear()
      frame = null
    },
    conversation,
  }
}
