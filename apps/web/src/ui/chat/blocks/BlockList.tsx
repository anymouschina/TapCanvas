import { Stack } from '@mantine/core'
import type { ContentBlock } from './types'
import { resolveBlockView } from './registry'

// BlockList 只渲染「既有 ChatBubble 尚未覆盖」的块类型：media / data。
// text 仍由既有 markdown 管线渲染、choice 仍由既有 pendingUserInput 选项卡渲染，
// 避免重写高精调的 markdown/选项卡逻辑，同时让协议端到端打通、新块走注册表。
export function BlockList({ blocks, streaming = false }: { blocks: ContentBlock[]; streaming?: boolean }) {
  // streaming 期间跳过 media（图/视频）渲染，避免每个 block delta 重挂载 ManagedImage 造成闪烁；
  // data 卡片无重挂载问题，流式期间照常渲染。media 等 phase==='final' 后由父组件传 streaming=false 一次性渲染。
  const renderable = blocks.filter((b) => b.type === 'data' || (b.type === 'media' && !streaming))
  if (!renderable.length) return null
  return (
    <Stack gap="sm">
      {renderable.map((block) => {
        const View = resolveBlockView(block)
        return <View key={block.id} block={block} />
      })}
    </Stack>
  )
}

export function blocksHaveMedia(blocks?: ContentBlock[]): boolean {
  return Array.isArray(blocks) && blocks.some((b) => b.type === 'media')
}
