import { API_BASE, withAuth, apiFetch, throwApiError } from './server'

/**
 * 导演台工具中继的浏览器侧接口。
 *
 * 服务端把模型要调用的导演台工具排队，这里轮询认领、交给导演台自己的工具执行器运行、再回报结果。
 */

export type DirectorDeskPendingCall = { callId: string; tool: string; nodeId: string | null; arguments: unknown }

export async function listPendingDirectorDeskCalls(): Promise<DirectorDeskPendingCall[]> {
  const r = await apiFetch(`${API_BASE}/public/director-desk/tool-claim`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }))
  if (!r.ok) await throwApiError(r, '读取待执行导演台工具失败')
  const body = (await r.json()) as { ok?: boolean; pending?: DirectorDeskPendingCall[] }
  return Array.isArray(body.pending) ? body.pending : []
}

export async function claimDirectorDeskCall(callId: string): Promise<
  { ok: true; leaseToken: string; tool: string; arguments: unknown } | { ok: false }
> {
  const r = await apiFetch(`${API_BASE}/public/director-desk/tool-claim`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callId }),
  }))
  if (!r.ok) await throwApiError(r, '认领导演台工具失败')
  const body = (await r.json()) as { ok?: boolean; leaseToken?: string; call?: { tool?: string; arguments?: unknown } }
  if (body.ok !== true || !body.leaseToken) return { ok: false }
  return { ok: true, leaseToken: body.leaseToken, tool: String(body.call?.tool ?? ''), arguments: body.call?.arguments ?? {} }
}

export async function reportDirectorDeskCall(input: {
  callId: string
  leaseToken: string
  ok: boolean
  data?: unknown
  error?: string
}): Promise<void> {
  const r = await apiFetch(`${API_BASE}/public/director-desk/tool-report`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }))
  if (!r.ok) await throwApiError(r, '回报导演台工具结果失败')
}
