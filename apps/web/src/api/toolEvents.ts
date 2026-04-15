import type { ThinkingEvent, PlanUpdatePayload, QaGuardrailPayload } from '../types/canvas-intelligence'
import { API_BASE } from './server'
import { createSseEventParser } from './sse'

export interface ToolEventMessage {
  type: 'tool-call' | 'tool-result'
  toolCallId: string
  toolName: string
  input?: Record<string, any>
  output?: any
  errorText?: string
}

interface SubscribeOptions {
  url: string
  token?: string | null
  onEvent: (event: ToolEventMessage) => void
  onOpen?: () => void
  onError?: (error: Error) => void
}

/**
 * Minimal SSE client using fetch so we can attach Authorization headers.
 * Returns a function that aborts the stream.
 */
function resolveEventsUrl(url?: string) {
  const trimmed = (url || '').trim()
  if (!trimmed) {
    return `${API_BASE.replace(/\/$/, '')}/ai/tool-events`
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }
  if (trimmed.startsWith('/')) {
    return `${API_BASE.replace(/\/$/, '')}${trimmed}`
  }
  return `${API_BASE.replace(/\/$/, '')}/${trimmed}`
}

export function subscribeToolEvents({ url, token, onEvent, onOpen, onError }: SubscribeOptions) {
  if (!token) {
    return () => {}
  }

  const resolvedUrl = resolveEventsUrl(url)
  const controller = new AbortController()
  const connect = async () => {
    const response = await fetch(resolvedUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    })

    if (!response.body) {
      throw new Error('No response body for tool-events stream')
    }

    if (!response.ok) {
      throw new Error(`Failed to subscribe tool-events: ${response.status}`)
    }

    onOpen?.()

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const parser = createSseEventParser()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const events = parser.push(decoder.decode(value, { stream: true }))
        for (const event of events) {
          const payload = String(event.data || '').trim()
          if (!payload) continue
          try {
            onEvent(JSON.parse(payload) as ToolEventMessage)
          } catch (err) {
            console.warn('[toolEvents] invalid payload', err, payload.slice(0, 200))
          }
        }
      }
      for (const event of parser.finish()) {
        const payload = String(event.data || '').trim()
        if (!payload) continue
        try {
          onEvent(JSON.parse(payload) as ToolEventMessage)
        } catch (err) {
          console.warn('[toolEvents] invalid payload', err, payload.slice(0, 200))
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  connect().catch(err => {
    if (!controller.signal.aborted) {
      console.warn('[toolEvents] stream failed', err)
      onError?.(err instanceof Error ? err : new Error('tool-events stream error'))
    }
  })

  return () => controller.abort()
}

const TOOL_NAME_TO_EVENT: Record<string, string> = {
  canvas_node_operation: 'canvas_node.operation',
  canvas_layout_apply: 'canvas.layout.apply',
  canvas_reflow_layout: 'canvas.layout.apply',
  canvas_optimization_analyze: 'canvas.optimization.analyze',
  canvas_view_navigate: 'canvas.view.navigate',
  canvas_connection_operation: 'canvas.connection.operation',
  project_operation: 'project.operation',
  reflowLayout: 'canvas.layout.apply',
  // legacy dotted tool names
  'canvas.node.operation': 'canvas_node.operation',
  'canvas.layout.apply': 'canvas_layout.apply',
  'canvas.optimization.analyze': 'canvas_optimization.analyze',
  'canvas.view.navigate': 'canvas_view.navigate',
  'canvas.connection.operation': 'canvas_connection.operation',
  'project.operation': 'project.operation'
}

export function mapToolEventToCanvasOperation(event: ToolEventMessage) {
  if (event.type !== 'tool-call') {
    return null
  }

  const mappedType = TOOL_NAME_TO_EVENT[event.toolName]
  if (!mappedType) {
    return null
  }

  return {
    type: mappedType,
    payload: event.input || {}
  }
}

export function extractThinkingEvent(event: ToolEventMessage): ThinkingEvent | null {
  if (event.type === 'tool-result' && event.toolName === 'ai.thinking.process' && event.output) {
    return event.output as ThinkingEvent
  }
  return null
}

export function extractPlanUpdate(event: ToolEventMessage): PlanUpdatePayload | null {
  if (event.type === 'tool-result' && event.toolName === 'ai.plan.update' && event.output) {
    return event.output as PlanUpdatePayload
  }
  return null
}

export function extractQaGuardrails(event: ToolEventMessage): QaGuardrailPayload | null {
  if (event.type === 'tool-result' && event.toolName === 'ai.qa.guardrails' && event.output) {
    return event.output as QaGuardrailPayload
  }
  return null
}

export function isWebSearchEvent(event: ToolEventMessage): boolean {
  return event.toolName === 'webSearch'
}
