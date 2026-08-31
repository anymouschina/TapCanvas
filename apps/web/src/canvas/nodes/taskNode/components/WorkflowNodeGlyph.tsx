import React from 'react'
import type { IconProps } from '@tabler/icons-react'
import {
  IconAlarm,
  IconApiApp,
  IconArrowsJoin,
  IconBinaryTree,
  IconBook,
  IconBoxMultiple,
  IconBrain,
  IconBraces,
  IconCalculator,
  IconChecklist,
  IconCirclesRelation,
  IconClock,
  IconCloudUpload,
  IconCode,
  IconDatabase,
  IconFileCertificate,
  IconFlag,
  IconGitBranch,
  IconHierarchy,
  IconInputSpark,
  IconMovie,
  IconPackage,
  IconPhotoSpark,
  IconPlayerPlay,
  IconScan,
  IconSearch,
  IconShieldCheck,
  IconSparkles,
  IconTimeline,
  IconTool,
  IconTransfer,
  IconTypography,
  IconUserCheck,
  IconVideo,
  IconVideoPlus,
  IconWriting,
} from '@tabler/icons-react'
import { ManagedImage } from '../../../../domain/resource-runtime'
import type { WorkflowNodePresentation } from '../../../workflowNodePresentation'
import './WorkflowNodeGlyph.css'

type WorkflowNodeGlyphProps = Readonly<{
  presentation: WorkflowNodePresentation
  className: string
  size?: number
  nodeId?: string
}>

export function workflowNodeGlyphComponent(
  presentation: WorkflowNodePresentation,
): React.ComponentType<IconProps> {
  if (presentation.variant === 'trigger') {
    if (presentation.triggerKind === 'manual') return IconPlayerPlay
    if (presentation.triggerKind === 'schedule') return IconClock
    return IconAlarm
  }
  if (presentation.operation === 'workflow_input') return IconInputSpark
  if (presentation.operation === 'canvas_source') return IconDatabase
  if (presentation.operation === 'delivery_contract') return IconFileCertificate
  if (presentation.operation === 'beat_sheet') return IconTimeline
  if (presentation.operation === 'asset_coverage') return IconScan
  if (presentation.operation === 'asset_fan_out') return IconHierarchy
  if (presentation.operation === 'fan_out') return IconBoxMultiple
  if (presentation.operation === 'clip_writer') return IconWriting
  if (presentation.operation === 'prompt_package') return IconPackage
  if (presentation.operation === 'estimate') return IconCalculator
  if (presentation.operation === 'production_handoff') return IconTransfer
  if (presentation.operation === 'video_submission') return IconCloudUpload
  if (presentation.operation === 'video_result') return IconMovie
  if (presentation.operation === 'concat') return IconArrowsJoin
  if (presentation.operation === 'delivery_verify') return IconShieldCheck
  if (presentation.operation === 'text_input') return IconTypography
  if (presentation.operation === 'javascript') return IconCode
  if (presentation.operation === 'collection_split') return IconBoxMultiple
  if (presentation.operation === 'image_generate') return IconPhotoSpark
  if (presentation.operation === 'video_generate') return IconVideoPlus
  if (presentation.operation === 'knowledge_search') return IconSearch
  if (presentation.operation === 'knowledge_read') return IconBook
  if (presentation.operation === 'skill_reference') return IconSparkles
  if (presentation.operation === 'knowledge_reference') return IconBook
  if (presentation.operation === 'human_approval') return IconUserCheck
  if (presentation.operation === 'condition') return IconGitBranch
  if (presentation.operation === 'terminal') return IconFlag
  if (presentation.operation === 'subworkflow') return IconBinaryTree
  if (presentation.operation === 'join') return IconArrowsJoin
  if (presentation.operation === 'artifact_contract') return IconFileCertificate
  if (presentation.category === 'source') return IconApiApp
  if (presentation.category === 'agent') return IconBrain
  if (presentation.category === 'media') return IconVideo
  if (presentation.category === 'skill') return IconSparkles
  if (presentation.category === 'tool') return IconTool
  if (presentation.category === 'control') return IconCirclesRelation
  if (presentation.category === 'artifact') return IconBraces
  if (presentation.category === 'delivery') return IconChecklist
  return IconBinaryTree
}

export function WorkflowNodeGlyph({ presentation, className, size = 16, nodeId }: WorkflowNodeGlyphProps): React.JSX.Element {
  const [failedIconUrl, setFailedIconUrl] = React.useState<string | null>(null)
  if (presentation.iconUrl && failedIconUrl !== presentation.iconUrl) {
    return (
      <ManagedImage
        className={`${className} workflow-node-glyph--remote`}
        src={presentation.iconUrl}
        alt=""
        priority="visible"
        ownerNodeId={nodeId ?? null}
        ownerSurface="task-node-skeleton"
        ownerRequestKey={`workflow-icon:${nodeId ?? 'unbound'}:${presentation.iconUrl}`}
        draggable={false}
        decoding="async"
        referrerPolicy="no-referrer"
        style={{ position: 'relative', width: size, height: size, objectFit: 'contain' }}
        onError={() => setFailedIconUrl(presentation.iconUrl)}
      />
    )
  }
  const Glyph = workflowNodeGlyphComponent(presentation)
  return <Glyph className={className} size={size} stroke={1.7} aria-hidden="true" />
}
