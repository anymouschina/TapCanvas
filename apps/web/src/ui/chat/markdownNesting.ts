// react-markdown 会把单独成段的图片包进 <p>，而我们的 <img> 渲染成 ManagedImage(<div>)。
// <div> 不能是 <p> 的后代：浏览器会自动闭合 <p>，导致 React 虚拟 DOM 与真实 DOM 永远对不齐、
// ManagedImage 反复重挂载 → 资源 store 抖动 → 死循环刷新。
// 解决：段落含 <img> 时改用 <div> 容器（flow content，合法）。本函数判定一个 markdown 段落节点是否含图片。

type HastNodeLike = { type?: string; tagName?: string; children?: HastNodeLike[] }

export function markdownNodeHasImage(node: unknown): boolean {
  const children = (node as HastNodeLike | null | undefined)?.children
  if (!Array.isArray(children)) return false
  return children.some((c) => c?.type === 'element' && c?.tagName === 'img')
}
