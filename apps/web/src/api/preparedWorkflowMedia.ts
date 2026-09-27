import { API_BASE, apiFetch, withAuth, throwApiError } from './server'

export type PreparedMediaScope = Readonly<{ projectId: string; chapterId?: string; flowId?: string }>
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export async function callPreparedMediaTool(scope: PreparedMediaScope, toolName: string, args: Record<string, unknown>) {
  const response = await apiFetch(`${API_BASE}/public/agents/tools/execute`, withAuth({
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolName, args, canvasProjectId: scope.projectId,
      ...(scope.chapterId ? { chapterId: scope.chapterId } : { canvasFlowId: scope.flowId }) }),
  }))
  if (!response.ok) await throwApiError(response, `媒体节点操作失败：${response.status}`)
  const body: unknown = await response.json()
  if (!record(body) || body.ok !== true || typeof body.content !== 'string') throw new Error('媒体节点接口缺少有效回执')
  const result: unknown = JSON.parse(body.content)
  if (!record(result)) throw new Error('媒体节点回执格式不正确')
  if (result.ok === false) throw new Error(typeof result.error === 'string' ? result.error : JSON.stringify(result))
  return result
}

export async function readPreparedMediaNode(scope: PreparedMediaScope, nodeId: string): Promise<Record<string, unknown>> {
  const path = scope.chapterId
    ? `/chapters/${encodeURIComponent(scope.chapterId)}/canvas-flow`
    : `/flows/${encodeURIComponent(scope.flowId ?? '')}`
  const response = await apiFetch(`${API_BASE}${path}`, withAuth())
  if (!response.ok) await throwApiError(response, `读取媒体节点失败：${response.status}`)
  const body: unknown = await response.json()
  if (!record(body)) throw new Error('画布回读格式不正确')
  const rawFlow = scope.chapterId ? body.flow : body.data
  const flow: unknown = typeof rawFlow === 'string' ? JSON.parse(rawFlow) : rawFlow
  const node = record(flow) && Array.isArray(flow.nodes)
    ? flow.nodes.find(candidate => record(candidate) && candidate.id === nodeId) : undefined
  if (!record(node) || !record(node.data)) throw new Error(`画布中找不到媒体节点 ${nodeId}`)
  return node.data
}
