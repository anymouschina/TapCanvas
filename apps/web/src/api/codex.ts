import type {
  CodexBridgeListResponse,
  CodexFallbackDecision,
  CodexPairingSession,
  CodexPreviewResolution,
  CodexTask,
  CodexTaskMessageListResponse,
  CodexTaskListResponse,
  CreateCodexTaskMessageRequest,
  CreateCodexTaskMessageResponse,
  CreateCodexTaskRequest,
  CreateCodexTaskResponse,
} from '@tapcanvas/codex-task-protocol'
import { API_BASE } from './server'

export class CodexApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(message: string, input: {
    status: number
    code: string
    details: unknown
  }) {
    super(message)
    this.name = 'CodexApiError'
    this.status = input.status
    this.code = input.code
    this.details = input.details
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new CodexApiError(
      `TapCanvas Codex 接口返回了非 JSON 响应（HTTP ${response.status}）`,
      {
        status: response.status,
        code: 'codex_invalid_json_response',
        details: null,
      },
    )
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  })
  const body = await parseBody(response)
  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.message === 'string' && body.message.trim()
        ? body.message.trim()
        : isRecord(body) && typeof body.error === 'string' && body.error.trim()
          ? body.error.trim()
          : `Codex 接口请求失败（HTTP ${response.status}）`
    throw new CodexApiError(message, {
      status: response.status,
      code:
        isRecord(body) && typeof body.code === 'string'
          ? body.code
          : 'codex_http_error',
      details: isRecord(body) ? body.details : null,
    })
  }
  return body as T
}

function jsonRequest(method: 'POST', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export function listCodexBridges(): Promise<CodexBridgeListResponse> {
  return request<CodexBridgeListResponse>('/codex/bridges')
}

export function createCodexPairing(): Promise<CodexPairingSession> {
  return request<CodexPairingSession>(
    '/codex/pairings',
    jsonRequest('POST', {}),
  )
}

export function listCodexTasks(limit = 20): Promise<CodexTaskListResponse> {
  return request<CodexTaskListResponse>(
    `/codex/tasks?limit=${encodeURIComponent(String(limit))}`,
  )
}

export function getCodexTask(taskId: string): Promise<CodexTask> {
  return request<CodexTask>(
    `/codex/tasks/${encodeURIComponent(taskId)}`,
  )
}

export function createCodexTask(
  input: CreateCodexTaskRequest,
): Promise<CreateCodexTaskResponse> {
  return request<CreateCodexTaskResponse>(
    '/codex/tasks',
    jsonRequest('POST', input),
  )
}

export function listCodexTaskMessages(
  taskId: string,
): Promise<CodexTaskMessageListResponse> {
  return request<CodexTaskMessageListResponse>(
    `/codex/tasks/${encodeURIComponent(taskId)}/messages`,
  )
}

export function createCodexTaskMessage(
  taskId: string,
  input: CreateCodexTaskMessageRequest,
): Promise<CreateCodexTaskMessageResponse> {
  return request<CreateCodexTaskMessageResponse>(
    `/codex/tasks/${encodeURIComponent(taskId)}/messages`,
    jsonRequest('POST', input),
  )
}

export function decideCodexFallback(
  taskId: string,
  input: CodexFallbackDecision,
): Promise<CodexTask> {
  return request<CodexTask>(
    `/codex/tasks/${encodeURIComponent(taskId)}/fallback`,
    jsonRequest('POST', input),
  )
}

export function resolveCodexPreview(
  previewId: string,
): Promise<CodexPreviewResolution> {
  return request<CodexPreviewResolution>(
    `/codex/previews/${encodeURIComponent(previewId)}`,
  )
}
