import type { ComponentType } from 'react'
import type { IconProps } from '@tabler/icons-react'
import {
  IconPhoto,
  IconLayoutGrid,
  IconTypography,
  IconVideo,
} from '@tabler/icons-react'
import { Position } from '@xyflow/react'

export type TaskNodeFeature =
  | 'prompt'
  | 'storyboard'
  | 'anchorBinding'
  | 'image'
  | 'imageUpload'
  | 'imageResults'
  | 'imageSize'
  | 'reversePrompt'
  | 'video'
  | 'videoResults'
  | 'orientation'
  | 'duration'
  | 'sampleCount'
  | 'aspect'
  | 'modelSelect'
  | 'systemPrompt'
  | 'characterMentions'
  | 'character'
  | 'audio'
  | 'subtitle'
  | 'subflow'
  | 'textResults'
  | 'storyboardEditor'

export type TaskNodeCategory =
  | 'document'
  | 'video'
  | 'image'
  | 'storyboard'
  | 'generic'

export type TaskNodeKind = 'text' | 'video' | 'image' | 'imageEdit' | 'storyboard'

export type TaskNodeCoreType = 'text' | 'video' | 'image' | 'storyboard'

export type TaskNodeHandleConfig = {
  id: string
  type: string
  position?: Position
}

export type TaskNodeHandlesConfig =
  | {
      dynamic: true
    }
  | {
      dynamic?: false
      targets?: TaskNodeHandleConfig[]
      sources?: TaskNodeHandleConfig[]
    }

export interface TaskNodeSchema {
  kind: TaskNodeKind
  category: TaskNodeCategory
  icon: ComponentType<IconProps>
  features: TaskNodeFeature[]
  handles?: TaskNodeHandlesConfig
  label?: string
}

type TaskNodeSchemaDefinition = {
  coreType: TaskNodeCoreType
  schema: TaskNodeSchema
}

export type FeatureOverrideOptions = {
  enable?: TaskNodeFeature[]
  disable?: TaskNodeFeature[]
}

class TaskNodeSchemaKernel {
  private readonly kindIndex: Map<TaskNodeKind, TaskNodeSchemaDefinition>
  private readonly coreDefaults: Map<TaskNodeCoreType, TaskNodeSchema>

  constructor(
    private readonly definitions: TaskNodeSchemaDefinition[],
    private readonly fallback: TaskNodeSchema,
  ) {
    this.kindIndex = new Map(definitions.map((definition) => [definition.schema.kind, definition]))
    this.coreDefaults = new Map()
    definitions.forEach((definition) => {
      if (!this.coreDefaults.has(definition.coreType) && definition.schema.kind === definition.coreType) {
        this.coreDefaults.set(definition.coreType, definition.schema)
      }
    })
  }

  resolve(kind?: string | null): TaskNodeSchema {
    const normalized = normalizeTaskNodeKind(kind)
    if (!normalized) return this.fallback
    return this.kindIndex.get(normalized)?.schema ?? this.fallback
  }

  listSchemas(): TaskNodeSchema[] {
    return this.definitions.map((definition) => definition.schema)
  }

  getCoreType(kind?: string | null): TaskNodeCoreType {
    const normalized = normalizeTaskNodeKind(kind)
    if (!normalized) return 'text'
    return this.kindIndex.get(normalized)?.coreType ?? 'text'
  }

  listByCoreType(coreType: TaskNodeCoreType): TaskNodeSchema[] {
    return this.definitions
      .filter((definition) => definition.coreType === coreType)
      .map((definition) => definition.schema)
  }

  buildCoreSchema(coreType: TaskNodeCoreType, options?: FeatureOverrideOptions): TaskNodeSchema {
    const base = this.coreDefaults.get(coreType)
    if (!base) return this.fallback

    const featureSet = new Set<TaskNodeFeature>(base.features)
    ;(options?.enable || []).forEach((feature) => featureSet.add(feature))
    ;(options?.disable || []).forEach((feature) => featureSet.delete(feature))

    return {
      ...base,
      features: Array.from(featureSet),
    }
  }
}

const TARGET = Position.Left
const SOURCE = Position.Right

const DEFAULT_SCHEMA: TaskNodeSchema = {
  kind: 'text',
  category: 'generic',
  icon: IconTypography,
  features: ['prompt'],
  handles: {
    sources: [{ id: 'out-text', type: 'text', position: SOURCE }],
  },
  label: '文本',
}

const SHARED_IMAGE_FEATURES: TaskNodeFeature[] = [
  'prompt',
  'systemPrompt',
  'anchorBinding',
  'image',
  'imageResults',
  'imageUpload',
  'reversePrompt',
  'aspect',
  'imageSize',
  'sampleCount',
  'modelSelect',
]

const TASK_NODE_SCHEMAS: Record<TaskNodeKind, TaskNodeSchema> = {
  text: {
    kind: 'text',
    category: 'document',
    icon: IconTypography,
    label: '文本',
    features: ['prompt'],
    handles: {
      sources: [{ id: 'out-text', type: 'text', position: SOURCE }],
    },
  },
  image: {
    kind: 'image',
    category: 'image',
    icon: IconPhoto,
    label: '图片',
    features: SHARED_IMAGE_FEATURES,
    handles: {
      targets: [{ id: 'in-image', type: 'image', position: TARGET }],
      sources: [{ id: 'out-image', type: 'image', position: SOURCE }],
    },
  },
  imageEdit: {
    kind: 'imageEdit',
    category: 'image',
    icon: IconPhoto,
    label: '图片编辑',
    features: SHARED_IMAGE_FEATURES,
    handles: {
      targets: [{ id: 'in-image', type: 'image', position: TARGET }],
      sources: [{ id: 'out-image', type: 'image', position: SOURCE }],
    },
  },
  video: {
    kind: 'video',
    category: 'video',
    icon: IconVideo,
    label: '视频',
    features: [
      'prompt',
      'systemPrompt',
      'video',
      'videoResults',
      'orientation',
      'duration',
      'sampleCount',
      'aspect',
      'modelSelect',
      'characterMentions',
    ],
    handles: {
      targets: [{ id: 'in-any', type: 'any', position: TARGET }],
      sources: [{ id: 'out-video', type: 'video', position: SOURCE }],
    },
  },
  storyboard: {
    kind: 'storyboard',
    category: 'storyboard',
    icon: IconLayoutGrid,
    label: '分镜编辑',
    features: ['storyboardEditor'],
    handles: {
      targets: [{ id: 'in-image', type: 'image', position: TARGET }],
      sources: [{ id: 'out-image', type: 'image', position: SOURCE }],
    },
  },
}

const LEGACY_TASK_NODE_KIND_ALIASES: Record<string, TaskNodeKind> = {
  text: 'text',
  noveldoc: 'text',
  scriptdoc: 'text',
  storyboardscript: 'text',
  workflowinput: 'text',
  workflowoutput: 'text',
  cameraref: 'text',
  tts: 'text',
  subtitlealign: 'text',
  subflow: 'text',

  image: 'image',
  imageedit: 'imageEdit',
  texttoimage: 'image',
  text_to_image: 'image',
  storyboardimage: 'image',
  novelstoryboard: 'image',
  storyboardshot: 'image',
  imagefission: 'image',
  mosaic: 'image',

  video: 'video',
  composevideo: 'video',

  storyboard: 'storyboard',
  storyboardedit: 'storyboard',
  storyboardeditor: 'storyboard',
}

export const normalizeTaskNodeKind = (kind?: string | null): TaskNodeKind | undefined => {
  const normalized = String(kind || '').trim()
  if (!normalized) return undefined
  return LEGACY_TASK_NODE_KIND_ALIASES[normalized.toLowerCase()]
}

const TASK_NODE_DEFINITIONS: TaskNodeSchemaDefinition[] = Object.values(TASK_NODE_SCHEMAS).map((schema) => ({
  coreType: schema.kind === 'imageEdit' ? 'image' : schema.kind,
  schema,
}))

export const taskNodeSchemaKernel = new TaskNodeSchemaKernel(TASK_NODE_DEFINITIONS, DEFAULT_SCHEMA)

export const getTaskNodeSchema = (kind?: string | null): TaskNodeSchema => taskNodeSchemaKernel.resolve(kind)

export const getTaskNodeCoreType = (kind?: string | null): TaskNodeCoreType => taskNodeSchemaKernel.getCoreType(kind)

export const buildUnifiedTaskNodeSchema = (
  coreType: TaskNodeCoreType,
  options?: FeatureOverrideOptions,
): TaskNodeSchema => taskNodeSchemaKernel.buildCoreSchema(coreType, options)

export const listTaskNodeSchemas = (): TaskNodeSchema[] => taskNodeSchemaKernel.listSchemas()

export const listTaskNodeSchemasByCoreType = (coreType: TaskNodeCoreType): TaskNodeSchema[] =>
  taskNodeSchemaKernel.listByCoreType(coreType)
