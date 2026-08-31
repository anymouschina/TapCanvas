import type { AgentDiagnosticsTraceDto } from '../../api/server'

export type ExecutionRunOption = {
  value: string
  label: string
}

type TraceWithDepth = {
  trace: AgentDiagnosticsTraceDto
  depth: number
}

function newestFirst(left: AgentDiagnosticsTraceDto, right: AgentDiagnosticsTraceDto): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt)
}

export function orderExecutionRunTree(traces: AgentDiagnosticsTraceDto[]): TraceWithDepth[] {
  const byId = new Map(traces.map((trace) => [trace.id, trace]))
  const children = new Map<string, AgentDiagnosticsTraceDto[]>()
  const roots: AgentDiagnosticsTraceDto[] = []

  for (const trace of traces) {
    const parentId = trace.parentTraceId
    if (!parentId || parentId === trace.id || !byId.has(parentId)) {
      roots.push(trace)
      continue
    }
    const siblings = children.get(parentId) ?? []
    siblings.push(trace)
    children.set(parentId, siblings)
  }

  roots.sort(newestFirst)
  for (const siblings of children.values()) siblings.sort(newestFirst)

  const ordered: TraceWithDepth[] = []
  const visited = new Set<string>()
  const visit = (trace: AgentDiagnosticsTraceDto, depth: number): void => {
    if (visited.has(trace.id)) return
    visited.add(trace.id)
    ordered.push({ trace, depth })
    for (const child of children.get(trace.id) ?? []) visit(child, depth + 1)
  }
  for (const root of roots) visit(root, 0)
  for (const trace of [...traces].sort(newestFirst)) visit(trace, 0)
  return ordered
}

export function buildExecutionRunOptions(traces: AgentDiagnosticsTraceDto[]): ExecutionRunOption[] {
  return orderExecutionRunTree(traces).map(({ trace, depth }) => ({
    value: `trace:${trace.id}`,
    label: `${depth > 0 ? `${'↳ '.repeat(depth)}` : ''}${trace.requestKind} · ${new Date(trace.createdAt).toLocaleString('zh-CN')}`,
  }))
}
