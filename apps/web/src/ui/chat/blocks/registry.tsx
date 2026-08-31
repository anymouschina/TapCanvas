import type { ComponentType } from 'react'
import type { ContentBlock, DataBlock, MediaBlock } from './types'
import { MediaBlockView } from './MediaBlockView'
import {
  ActionBannerView,
  ArtifactCardView,
  CharacterCardsView,
  ChoicesCardView,
  RoleNoteView,
  SceneListView,
} from './DataCardViews'
import { GenerationTaskView, SourceContractView } from './WorkflowCardViews'

export type BlockViewProps<B extends ContentBlock = ContentBlock> = { block: B }

function BlockFallback({ block }: BlockViewProps) {
  return (
    <pre style={{ fontSize: 12, opacity: 0.6, whiteSpace: 'pre-wrap' }}>
      [未支持的内容块: {block.type}]
    </pre>
  )
}

function DataFallback({ block }: BlockViewProps<DataBlock>) {
  return (
    <pre style={{ fontSize: 12, opacity: 0.6, whiteSpace: 'pre-wrap' }}>
      [未注册卡片: {block.name}] {JSON.stringify(block.payload)}
    </pre>
  )
}

// data 块按 name 二级分发；后续往这里加 brief/compare/form…
const DATA_REGISTRY: Record<string, ComponentType<BlockViewProps<DataBlock>>> = {
  character_cards: CharacterCardsView,
  scene_list: SceneListView,
  artifact: ArtifactCardView,
  action_banner: ActionBannerView,
  source_contract: SourceContractView,
  generation_task: GenerationTaskView,
  choices: ChoicesCardView,
  role_note: RoleNoteView,
}

const BLOCK_REGISTRY: Partial<Record<ContentBlock['type'], ComponentType<BlockViewProps<any>>>> = {
  media: MediaBlockView as ComponentType<BlockViewProps<MediaBlock>>,
  // text / choice 在 ChatBubble 内用既有组件适配（Task 9），不在此注册。
}

export function resolveBlockView(block: ContentBlock): ComponentType<BlockViewProps<any>> {
  if (block.type === 'data') {
    return DATA_REGISTRY[(block as DataBlock).name] ?? (DataFallback as ComponentType<BlockViewProps<any>>)
  }
  return BLOCK_REGISTRY[block.type] ?? (BlockFallback as ComponentType<BlockViewProps<any>>)
}
