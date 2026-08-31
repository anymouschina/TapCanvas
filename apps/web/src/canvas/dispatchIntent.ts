import type { ChapterCanvasIntent } from '@tapcanvas/chapter-canvas-intents'
import { generateBatchUlid } from '@tapcanvas/chapter-canvas-intents'
import { streamChapterIntent, type PendingUserInputRequest } from './streamChapterIntent'
import { useIntentLifecycle } from './intentLifecycle'
import { toast } from '../ui/toast'
import { useUIStore } from '../ui/uiStore'

function formatIntentFailure(err: { message?: string; code?: string }): string {
  const message = String(err.message || '').trim() || '未知错误'
  const code = String(err.code || '').trim()
  return code ? `Agent 执行未完成（${code}）：${message}` : `Agent 执行未完成：${message}`
}

export type DispatchIntentOptions = {
  chapterContext?: {
    projectId: string
    bookId: string | null
    chapterId: string
    flowSnapshot: {
      nodes: Array<{
        id: string
        kind: string
        preset?: string
        data: Record<string, unknown>
        position?: { x: number; y: number }
      }>
      edges: Array<{
        id: string
        source: string
        target: string
        sourceHandle?: string
        targetHandle?: string
      }>
    }
  }
  userHints?: string
  generationConfig?: {
    imageModel?: string
    imageSize?: string
  }
  variantParams?: Record<string, unknown>
  onPendingUserInput?: (req: PendingUserInputRequest) => void
  requestUserInputResponse?: {
    requestId: string
    answers: Array<{ id: string; value: string; optionLabel: string; optionIndex: number }>
  }
}

export async function dispatchIntent(
  intent: ChapterCanvasIntent,
  sourceNodeId: string,
  options: DispatchIntentOptions,
): Promise<void> {
  const batchUlid = generateBatchUlid()
  const abortController = new AbortController()
  let terminalObserved = false
  let failed = false
  let completedToolCount = 0
  let failedToolCount = 0
  useIntentLifecycle.getState().start(intent, batchUlid, abortController, sourceNodeId)

  try {
    const chapterContext = options.chapterContext
    if (!chapterContext?.projectId || !chapterContext.chapterId) {
      throw new Error('章节画布 Agent 执行缺少真实 projectId 或 chapterId')
    }
    const activeStyleBible = useUIStore.getState().activeStyleBible
    await streamChapterIntent({
      executionId: batchUlid,
      intent,
      sourceNodeId,
      chapterContext,
      userHints: options.userHints,
      generationConfig: options.generationConfig,
      variantParams: options.variantParams,
      styleGuide: activeStyleBible ?? undefined,
      abortSignal: abortController.signal,
      onTool: (tool) => {
        if (tool.phase !== 'completed') return
        completedToolCount += 1
        if (tool.status === 'failed') failedToolCount += 1
        useIntentLifecycle.getState().incrementCount(batchUlid)
        useIntentLifecycle.getState().applyProgress(batchUlid, {
          stage: 'tool_completed',
          bufferedToolCalls: completedToolCount,
          toolName: tool.toolName,
          upstreamErrors: failedToolCount,
        })
      },
      onProgress: (p) => {
        if (p.kind === 'stage') {
          useIntentLifecycle.getState().applyProgress(batchUlid, {
            stage: p.stage,
            bufferedToolCalls: p.bufferedToolCalls,
            toolName: p.toolName,
            upstreamErrors: p.upstreamErrors,
          })
        }
      },
      onTerminal: (terminal) => {
        if (terminal.status === 'active' || terminal.status === 'waiting_external') {
          useIntentLifecycle.getState().applyProgress(batchUlid, {
            stage: 'waiting_upstream',
            bufferedToolCalls: completedToolCount,
            upstreamErrors: failedToolCount,
          })
          return
        }
        terminalObserved = true
        if (terminal.status === 'failed') {
          failed = true
          toast(`Agent 执行失败：${terminal.text || terminal.reason}`, 'error')
          return
        }
        if (terminal.status === 'succeeded' && terminal.text) {
          toast(terminal.text, 'info')
        }
      },
      onError: (err) => {
        if (failed) return
        failed = true
        toast(formatIntentFailure(err), 'error')
      },
      onDone: (info) => {
        if (terminalObserved || failed || info.reason === 'physical_suspended') return
        failed = true
        toast(`Agent 执行结束但缺少结构化结果：${String(info.reason || 'unknown')}`, 'error')
      },
      onWorkflowChanged: (workflow) => {
        useUIStore.getState().setActiveWorkflow(workflow)
      },
      onPendingUserInput: (req) => {
        terminalObserved = true
        useIntentLifecycle.getState().setPendingUserInput({
          request: req,
          intent,
          sourceNodeId,
          chapterContext,
          generationConfig: options.generationConfig,
          variantParams: options.variantParams,
        })
        options.onPendingUserInput?.(req)
      },
      requestUserInputResponse: options.requestUserInputResponse,
    })
    if (!terminalObserved && !failed && !abortController.signal.aborted) {
      failed = true
      toast('Agent 执行结束但没有形成可验证终态', 'error')
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      toast('Agent 规划已取消', 'info')
    } else {
      const message = err instanceof Error ? err.message : String(err)
      toast(formatIntentFailure({ message }), 'error')
    }
  } finally {
    useIntentLifecycle.getState().finish(batchUlid)
  }
}
