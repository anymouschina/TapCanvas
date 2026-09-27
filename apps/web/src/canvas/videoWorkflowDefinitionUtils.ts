import type { Node } from '@xyflow/react'

export function createIdentity(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('当前浏览器不支持安全 UUID，无法创建可追踪的工作流实例')
  }
  return `${prefix}-${globalThis.crypto.randomUUID()}`
}

export function nodeData(node: Node): Record<string, unknown> {
  return node.data && typeof node.data === 'object' ? node.data as Record<string, unknown> : {}
}

export function isSourceGroup(node: Node): boolean {
  const data = nodeData(node)
  return node.type === 'groupNode' && data.adminWorkflow !== true
}

export function listWorkflowSourceGroups(nodes: readonly Node[]): readonly Readonly<{ value: string; label: string }>[] {
  return nodes.filter(isSourceGroup).map((node) => {
    const data = nodeData(node)
    const label = typeof data.label === 'string' && data.label.trim() ? data.label.trim() : node.id
    return { value: node.id, label }
  })
}

export function selectedSourceGroup(nodes: readonly Node[]): Node | null {
  const selected = nodes.filter((node) => node.selected)
  const directGroups = selected.filter(isSourceGroup)
  if (directGroups.length === 1) return directGroups[0]
  if (directGroups.length > 1) return null
  const parentIds = new Set(selected
    .map((node) => typeof node.parentId === 'string' ? node.parentId.trim() : '')
    .filter(Boolean))
  if (parentIds.size !== 1) return null
  const [parentId] = Array.from(parentIds)
  return nodes.find((node) => node.id === parentId && isSourceGroup(node)) ?? null
}

