import type { Node, Edge } from '@xyflow/react'

export type Port = { id: string; label: string; type: 'image'|'audio'|'subtitle'|'video'|'any' }
export type FlowIO = { inputs: Port[]; outputs: Port[] }
export type FlowRecord = { id: string; name: string; nodes: Node[]; edges: Edge[]; updatedAt: number; io?: FlowIO }
const KEY = 'tapcanvas-flows'

function readAll(): FlowRecord[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}
function writeAll(list: FlowRecord[]) { localStorage.setItem(KEY, JSON.stringify(list)) }

export function listFlows(): FlowRecord[] { return readAll().sort((a,b)=>b.updatedAt-a.updatedAt) }
export function getFlow(id: string): FlowRecord | undefined { return readAll().find(f => f.id === id) }
export function saveFlow(rec: Omit<FlowRecord, 'id' | 'updatedAt'> & { id?: string }): FlowRecord {
  const list = readAll()
  const id = rec.id || `flow_${Math.random().toString(36).slice(2,8)}`
  const existing = list.findIndex(f => f.id === id)
  const full: FlowRecord = { id, name: rec.name, nodes: rec.nodes, edges: rec.edges, updatedAt: Date.now(), io: rec.io }
  if (existing >= 0) list[existing] = full; else list.push(full)
  writeAll(list)
  return full
}
export function deleteFlow(id: string) { writeAll(readAll().filter(f => f.id !== id)) }
export function renameFlow(id: string, name: string) { const list = readAll(); const i=list.findIndex(f=>f.id===id); if(i>=0){ list[i]={...list[i], name, updatedAt: Date.now()}; writeAll(list) } }

export function setFlowIO(id: string, io: FlowIO) { const list = readAll(); const i=list.findIndex(f=>f.id===id); if(i>=0){ list[i]={...list[i], io, updatedAt: Date.now()}; writeAll(list) } }

// ---- Reference graph helpers ----
export function refsOf(flow: FlowRecord): string[] {
  const out: string[] = []
  for (const n of flow.nodes || []) {
    const ref = (n.data as any)?.subflowRef as string | undefined
    if (ref) out.push(ref)
  }
  return Array.from(new Set(out))
}

export function wouldCreateCycle(fromId: string, toId: string): boolean {
  // check if adding fromId -> toId creates a cycle (i.e., toId reaches fromId)
  const seen = new Set<string>()
  const stack = [toId]
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === fromId) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    const rec = getFlow(cur)
    if (rec) refsOf(rec).forEach(r => stack.push(r))
  }
  return false
}

export function validateNoCycle(flowId: string): { ok: boolean; reason?: string } {
  const all = listFlows()
  const idToRefs = new Map<string, string[]>(all.map(f => [f.id, refsOf(f)]))
  const visited = new Set<string>()
  const onstack = new Set<string>()
  let bad = false
  function dfs(u: string) {
    if (onstack.has(u)) { bad = true; return }
    if (visited.has(u)) return
    visited.add(u); onstack.add(u)
    const refs = idToRefs.get(u) || []
    refs.forEach(v => dfs(v))
    onstack.delete(u)
  }
  dfs(flowId)
  return bad ? { ok: false, reason: '检测到引用环' } : { ok: true }
}

export function scanCycles(): string[] {
  const all = listFlows()
  const idToRefs = new Map<string, string[]>(all.map(f => [f.id, refsOf(f)]))
  const visited = new Set<string>()
  const onstack = new Set<string>()
  const inCycle = new Set<string>()
  function dfs(u: string) {
    if (onstack.has(u)) { inCycle.add(u); return }
    if (visited.has(u)) return
    visited.add(u); onstack.add(u)
    const refs = idToRefs.get(u) || []
    refs.forEach(v => dfs(v))
    onstack.delete(u)
  }
  for (const f of all) dfs(f.id)
  return Array.from(inCycle)
}
