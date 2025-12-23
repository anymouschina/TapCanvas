import type { Node, Edge } from '@xyflow/react'

export type AssetRecord = { id: string; name: string; nodes: Node[]; edges: Edge[]; updatedAt: number }
const KEY = 'tapcanvas-assets'

function readAll(): AssetRecord[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}
function writeAll(list: AssetRecord[]) { localStorage.setItem(KEY, JSON.stringify(list)) }

export function listAssets(): AssetRecord[] { return readAll().sort((a,b)=>b.updatedAt-a.updatedAt) }
export function getAsset(id: string): AssetRecord | undefined { return readAll().find(f => f.id === id) }
export function saveAsset(rec: Omit<AssetRecord, 'id' | 'updatedAt'> & { id?: string }): AssetRecord {
  const list = readAll()
  const id = rec.id || `asset_${Math.random().toString(36).slice(2,8)}`
  const existing = list.findIndex(f => f.id === id)
  const full: AssetRecord = { id, name: rec.name, nodes: rec.nodes, edges: rec.edges, updatedAt: Date.now() }
  if (existing >= 0) list[existing] = full; else list.push(full)
  writeAll(list)
  return full
}
export function deleteAsset(id: string) { writeAll(readAll().filter(f => f.id !== id)) }
export function renameAsset(id: string, name: string) { const list = readAll(); const i=list.findIndex(f=>f.id===id); if(i>=0){ list[i]={...list[i], name, updatedAt: Date.now()}; writeAll(list) } }

