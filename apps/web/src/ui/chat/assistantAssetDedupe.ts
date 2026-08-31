import type { Node } from '@xyflow/react'

/**
 * 小T回复资产自动落画布前的查重索引。
 *
 * 病根：聊天面板会把回复里出现的所有图/视频自动落画布，多图还会自动打一组
 * 「AI多图-N张」——但小T回复常常回显画布上已有的资产卡图（角色卡/场景卡/章节封面），
 * 结果同一批资产被原样复制成一组"生成图-N"，用户看到的就是"资产已经有了还要
 * 打组再添加一次"。落画布前先用这里的索引查重，已有的一律不再添加。
 */

// 一个 URL 产出两个键：去 hash 的完整串（精确匹配）+ origin+pathname
// （容忍签名/缓存 query 差异——同一对象路径即同一资产）。
function urlKeys(value: unknown): string[] {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || !/^https?:\/\//i.test(raw)) return []
  try {
    const parsed = new URL(raw)
    parsed.hash = ''
    return [parsed.toString(), `${parsed.origin}${parsed.pathname}`]
  } catch {
    return [raw]
  }
}

const MEDIA_LIST_FIELDS = ['imageResults', 'videoResults', 'assets', 'outputs'] as const

export function collectCanvasMediaUrlKeys(nodes: Node[]): Set<string> {
  const keys = new Set<string>()
  const push = (value: unknown) => {
    for (const key of urlKeys(value)) keys.add(key)
  }
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const data = (node?.data ?? {}) as Record<string, unknown>
    push(data.imageUrl)
    push(data.videoUrl)
    push(data.videoThumbnailUrl)
    for (const field of MEDIA_LIST_FIELDS) {
      const list = data[field]
      if (!Array.isArray(list)) continue
      for (const item of list) {
        if (!item || typeof item !== 'object') continue
        push((item as Record<string, unknown>).url)
        push((item as Record<string, unknown>).thumbnailUrl)
      }
    }
  }
  return keys
}

export function isMediaUrlOnCanvas(url: string, keys: Set<string>): boolean {
  for (const key of urlKeys(url)) {
    if (keys.has(key)) return true
  }
  return false
}
