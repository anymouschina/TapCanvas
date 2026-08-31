import type { AgentsChatStreamEvent } from '../../api/server'

type AgentsStreamErrorPayload = Extract<AgentsChatStreamEvent, { event: 'error' }>['data']

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function formatUnknown(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function extractDetailsSummary(details: unknown): string {
  if (typeof details === 'undefined' || details === null) return ''
  if (typeof details === 'string') return details.trim()
  if (typeof details !== 'object' || Array.isArray(details)) return formatUnknown(details)
  const record = details as Record<string, unknown>
  const reason = trimString(record.reason)
  const payloadPreview = trimString(record.payloadPreview)
  if (reason && payloadPreview) return `${reason} | payload=${payloadPreview}`
  if (reason) return reason
  if (payloadPreview) return `payload=${payloadPreview}`
  return formatUnknown(details)
}

/**
 * 这些错误的 message 本身就是给用户看的完整说明，附加 code=/details 只会变成噪音。
 * chat_turn_protected_inflight：成片回合在飞、本条消息未发送（见 chat-turn-inflight.ts）。
 */
const SELF_EXPLANATORY_ERROR_CODES = new Set(['chat_turn_protected_inflight'])

export function formatAgentsStreamErrorMessage(payload: AgentsStreamErrorPayload): string {
  const message = trimString(payload.message) || '对话流失败'
  const code = trimString(payload.code)
  if (code && SELF_EXPLANATORY_ERROR_CODES.has(code)) return message
  const detailSummary = extractDetailsSummary(payload.details)
  return [
    message,
    code ? `code=${code}` : '',
    detailSummary && detailSummary !== message ? detailSummary : '',
  ].filter(Boolean).join('\n')
}
