import type { SbaChoiceMetadata } from '@tapcanvas/storyboard-adventure-protocol'

// 聊天结构化内容块协议（与 apps/agents-cli/src/types/content-blocks.ts 字段一致）。

export type BlockBase = { id: string };
export type TextBlock = BlockBase & { type: 'text'; text: string; state?: 'streaming' | 'complete' };
export type MediaItem = {
  kind: 'image' | 'video' | 'audio';
  url: string;
  thumbnailUrl?: string;
  title?: string;
  assetId?: string;
  vendor?: string;
};
export type MediaBlock = BlockBase & { type: 'media'; layout?: 'single' | 'grid'; items: MediaItem[] };
export type ChoiceOption = { label: string; description?: string; imageUrl?: string; thumbnailUrl?: string };
export type ChoiceQuestion = { id: string; header: string; question: string; options: ChoiceOption[] };
export type ChoiceBlock = BlockBase & {
  type: 'choice';
  requestId: string;
  state?: 'pending' | 'answered';
  questions: ChoiceQuestion[];
};
export type DataBlock = BlockBase & { type: 'data'; name: string; payload: unknown; state?: 'streaming' | 'complete' };
export type ContentBlock = TextBlock | MediaBlock | ChoiceBlock | DataBlock;

// ── data 块已注册卡片 payload（与 agents-cli 同形）──
export type CharacterCardItem = {
  name: string
  imageUrl?: string
  thumbnailUrl?: string
  description?: string
  voiceUrl?: string
  nodeId?: string
}
export type CharacterCardsPayload = { title?: string; items: CharacterCardItem[] }

export type SceneListItem = {
  name: string
  summary?: string
  imageUrl?: string
  thumbnailUrl?: string
  nodeId?: string
}
export type SceneListPayload = { title?: string; items: SceneListItem[]; newSceneAction?: string }

export type ArtifactPayload = { title: string; summary?: string; markdown: string; timestamp?: string }

export type ActionBannerPayload = { title: string; description?: string; action: string; cost?: number }

export type SourceContractPayload = {
  title?: string
  source: string
  scope: string
  mode: string
  target?: string
  confirmed?: string[]
  assumptions?: string[]
  unresolved?: string[]
  nodeId?: string
}

export type GenerationTaskParameter = { label: string; value: string }
export type GenerationTaskPayload = {
  title: string
  kind: 'image' | 'video' | 'audio' | 'prompt'
  status: 'proposal' | 'queued' | 'running' | 'accepted_async' | 'succeeded' | 'partial' | 'failed' | 'cancelled'
  summary?: string
  prompt?: string
  model?: string
  parameters?: GenerationTaskParameter[]
  cost?: number
  action?: string
  nodeId?: string
  taskId?: string
  assetUrl?: string
  failureReason?: string
}

/** 轻量选项卡：普通选项发送 value/label；SBA 选项发送持久节点身份，label 只用于展示。 */
export type ChoicesCardPayload = {
  question?: string
  options: Array<{ label: string; description?: string; value?: string; metadata?: SbaChoiceMetadata }>
  /** 故事板冒险（[SBA] 前缀）样式 */
  sba?: boolean
  /** 前端收尾期标注（不进双端协议）：回合报错/中断时，提问后面已有后续正文（小T 没等回答
   *  就继续推进了）→ 标过期，渲染成灰态说明而非可点提问，根治「断链后残影提问」误导。 */
  superseded?: boolean
}

/** 角色介入评估卡：智能团某角色在某阶段留下的点评，进对话历史可回看 */
export type RoleNoteCardPayload = {
  role?: string
  roleName: string
  label?: string
  markdown: string
  nodeIds?: string[]
}

export type BlockStreamOp =
  | { op: 'start'; block: ContentBlock }
  | { op: 'delta'; id: string; textDelta: string }
  | { op: 'set'; block: ContentBlock }
  | { op: 'end'; id: string; state?: string };
