import type { Edge, Node } from '@xyflow/react'

export type NodeIntentMode = 'recommend' | 'operate'

function shortId(id: string) {
  const s = String(id || '')
  if (s.length <= 8) return s
  return `${s.slice(0, 6)}…`
}

function getNodeDesc(node: Node) {
  const kind = ((node.data as any)?.kind as string | undefined) || 'unknown'
  const label = ((node.data as any)?.label as string | undefined) || node.id
  return `${kind}-${label}`
}

function nodeRef(node: Node) {
  const id = String(node.id)
  const desc = getNodeDesc(node)
  // Cursor-like compact reference token: machine-readable id + human label.
  return `[[tap.node:${id}|${desc}#${shortId(id)}]]`
}

export function buildNodeRefTokenFromNode(node: Node) {
  return nodeRef(node)
}

export function buildNodeRefToken(args: { nodeId: string; nodes: Node[]; draftData?: any }) {
  const { nodeId, nodes, draftData } = args
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return ''
  const focusNode = { ...node, data: { ...(node.data || {}), ...(draftData || {}) } } as any
  return nodeRef(focusNode)
}

export function buildNodeIntentPrompt(args: {
  mode: NodeIntentMode
  nodeId: string
  nodes: Node[]
  edges: Edge[]
  draftData?: any
}) {
  const { mode, nodeId, nodes, edges, draftData } = args
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return ''

  const incoming = (edges || []).filter((e) => e?.target === nodeId)
  const outgoing = (edges || []).filter((e) => e?.source === nodeId)

  const incomingLines = incoming.slice(0, 8).map((e) => {
    const src = nodes.find((nn) => nn.id === e.source)
    const srcRef = src ? nodeRef(src) : `[[tap.node:${String(e.source)}|unknown-${shortId(String(e.source))}]]`
    const handle = e?.targetHandle ? ` -> ${String(e.targetHandle)}` : ''
    return `- ${srcRef}${handle}`
  })

  const outgoingLines = outgoing.slice(0, 8).map((e) => {
    const dst = nodes.find((nn) => nn.id === e.target)
    const dstRef = dst ? nodeRef(dst) : `[[tap.node:${String(e.target)}|unknown-${shortId(String(e.target))}]]`
    const handle = e?.sourceHandle ? `${String(e.sourceHandle)} -> ` : ''
    return `- ${handle}${dstRef}`
  })

  const focusNode = { ...node, data: { ...(node.data || {}), ...(draftData || {}) } } as any

  return [
    // Cursor-like reference token for internal linking (render as a chip in chat UI if supported).
    nodeRef(focusNode),
    incomingLines.length ? `上游引用：\n${incomingLines.join('\n')}` : '上游引用：无',
    outgoingLines.length ? `下游引用：\n${outgoingLines.join('\n')}` : '下游引用：无',
    '',
    '你是 TapCanvas 的“小T”。请基于画布上下文（canvas_context）理解这个节点在做什么，并给用户下一步建议。',
    '用户不懂代码：请用白话说明，不要输出 JSON/字段名/参数键名。',
    '如果需要调整参数，只说“要调什么目的”（例如：时长/风格/镜头/速度/一致性），不要暴露具体字段或细碎数值。',
    mode === 'recommend'
      ? '请按顺序输出 3-6 步：每一步一句话，包含“要新增/选择哪个节点”“怎么连接”“做完后该看什么结果”。'
      : '请直接操作画布完成你认为必要的新增/连接/调整；最后用 3-6 条清单说明你做了什么，以及接下来我该检查什么。',
  ].join('\n')
}
