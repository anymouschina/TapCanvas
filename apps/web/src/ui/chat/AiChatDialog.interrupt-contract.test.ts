import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('AiChatDialog interrupt contract', () => {
  it('用户显式中断会终止本轮逻辑任务及其持久化工作流', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/ui/chat/AiChatDialog.tsx'), 'utf8')
    const interruptStart = source.indexOf('const interruptActiveChat')
    const interruptEnd = source.indexOf('const normalizedDraft', interruptStart)
    const interruptSource = source.slice(interruptStart, interruptEnd)

    expect(interruptStart).toBeGreaterThanOrEqual(0)
    expect(interruptEnd).toBeGreaterThan(interruptStart)
    expect(interruptSource).toContain('interruptAgentsChatTurn')
		expect(interruptSource).toContain("cancellationScope: 'logical_task'")
    expect(interruptSource).not.toContain('cancelProjectVideoRuns')
    expect(interruptSource).not.toContain('cancelCurrentCanvasVideoProduction')
    expect(interruptSource).toContain('reconcileLiveChatTurnStatus(receipt.status)')
    expect(interruptSource).toContain('resolveChatInterruptPresentation(receipt)')
    expect(interruptSource).toContain("presentation.liveRunAction === 'cancel'")
    expect(interruptSource).toContain("presentation.liveRunAction === 'mark_inactive'")
    expect(interruptSource).toContain("kind: 'progress'")
    expect(interruptSource).toContain('content: presentation.message')
    expect(interruptSource).toContain('cancelLiveChatRun(CHAT_ABORTED_MESSAGE, turnId)')
    expect(interruptSource).toContain("failLiveChatRun('当前任务已不在运行', turnId)")
    expect(interruptSource).not.toContain("receipt.interrupted ? '已确认中断当前任务'")
  })

  it('只有显式停止视频生产入口会调用媒体取消接口', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/ui/chat/AiChatDialog.tsx'), 'utf8')
    const cancellationCalls = source.match(/cancelProjectVideoRuns\(/g) ?? []
    const stopStart = source.indexOf('const stopVideoProduction')
    const stopEnd = source.indexOf('const headerSubtitle', stopStart)
    const stopSource = source.slice(stopStart, stopEnd)

    expect(source).not.toContain('terminateProductionForChatFailure')
    expect(source).not.toContain("mode: 'automatic' | 'manual'")
    expect(cancellationCalls).toHaveLength(1)
    expect(stopStart).toBeGreaterThanOrEqual(0)
    expect(stopEnd).toBeGreaterThan(stopStart)
    expect(stopSource).toContain('cancelCurrentCanvasVideoProduction()')
  })
})
