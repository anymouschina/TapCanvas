import type React from 'react'
import { IconLayoutGrid, IconPhoto, IconVideo } from '@tabler/icons-react'
import type { ChapterCanvasIntent } from '@tapcanvas/chapter-canvas-intents'

export type IntentActionApplicability = (ctx: {
  kind: string
  semanticKind?: string
  preset?: string
  isLastSegment?: boolean
  nodeData?: Record<string, unknown>
}) => boolean

export type IntentActionContext = Parameters<IntentActionApplicability>[0]

export type IntentActionDef = {
  key: string
  intent: ChapterCanvasIntent
  icon: React.ComponentType<{ size?: number }>
  label: string
  resolveLabel?: (ctx: IntentActionContext) => string
  applicableTo: IntentActionApplicability
  variantParams?: Record<string, unknown>
  /** 点击后先弹出参数配置弹窗（模型/分辨率），确认后再 dispatch */
  requiresConfig?: boolean
  /** 直接用固定默认值 dispatch，不弹弹窗 */
  defaultGenerationConfig?: { imageModel: string; imageSize: string }
  /** UI 分组标签，相同 category 的 action 归在一个带标题的区块里 */
  category?: string
}

function isTextIntentSource(ctx: IntentActionContext): boolean {
  return ctx.kind === 'text'
}

function isImageIntentSource(ctx: IntentActionContext): boolean {
  return ctx.kind === 'image'
}

export const INTENT_ACTIONS: IntentActionDef[] = [
  {
    key: 'generate_scene_references',
    intent: 'generate_scene_references',
    icon: IconPhoto as React.ComponentType<{ size?: number }>,
    label: '生成场景/人物参考图',
    applicableTo: isTextIntentSource,
    requiresConfig: true,
  },
  {
    key: 'generate_shot_placeholders',
    intent: 'generate_shot_placeholders',
    icon: IconLayoutGrid as React.ComponentType<{ size?: number }>,
    label: '镜头设计板',
    resolveLabel: ({ preset, semanticKind }) =>
      preset === 'chapter-info' || semanticKind === 'storyboardScript'
        ? '自动拆分设计板'
        : '镜头设计板',
    applicableTo: isTextIntentSource,
    requiresConfig: true,
  },
  {
    key: 'generate_video_nodes.quick',
    intent: 'generate_video_nodes',
    icon: IconVideo as React.ComponentType<{ size?: number }>,
    label: '衍生视频',
    applicableTo: isImageIntentSource,
    category: '文本创作',
  },
  {
    key: 'generate_video_nodes.story',
    intent: 'generate_video_nodes',
    icon: IconVideo as React.ComponentType<{ size?: number }>,
    label: '衍生视频（带剧情）',
    applicableTo: isImageIntentSource,
    variantParams: { videoPromptMode: 'story' },
    category: '文本创作',
  },
]
