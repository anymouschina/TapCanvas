import type { ComponentType } from 'react'
import type { IconProps } from '@tabler/icons-react'
import { createEmptyShotTable, serializeShotTable } from '@tapcanvas/shot-table-protocol'
import {
  IconPhoto,
  IconLayoutGrid,
  IconMusic,
  IconScissors,
  IconEye,
  IconBinaryTree,
  IconAlarm,
  IconTable,
  IconTypography,
  IconVideo,
  IconBrandOpenai,
} from '@tabler/icons-react'
import { Position } from '@xyflow/react'
import { WORKFLOW_ICON_NODE_SIZE } from '../workflowNodeGeometry'

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
  | 'characterMentions'
  | 'character'
  | 'audio'
  | 'subtitle'
  | 'subflow'
  | 'textResults'
  | 'storyboardEditor'
  | 'videoCompose'
  | 'videoAnalysis'
  | 'shotTable'
  | 'workflowStage'
  | 'workflowTrigger'
export type TaskNodeCategory =
  | 'document'
  | 'video'
  | 'image'
  | 'storyboard'
  | 'generic'

export type TaskNodeKind =
  | 'text'
  | 'codex'
  | 'video'
  | 'image'
  | 'imageEdit'
  | 'storyboard'
  | 'videoCompose'
  | 'audio'
  | 'videoAnalysis'
  | 'shotTable'
  | 'workflowStage'
  | 'workflowTrigger'

export type TaskNodeCoreType = 'text' | 'video' | 'image' | 'storyboard' | 'audio'

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

export interface TaskNodeData {
  /** 节点展示名称 */
  label?: string
  /** 节点业务类型；运行时允许读取尚未注册的新类型 */
  kind?: string
  /** 节点执行状态 */
  status?: 'idle' | 'queued' | 'running' | 'success' | 'error' | 'canceled'
  /** 节点执行进度 */
  progress?: number
  /** AI 画布计划的创建时间 */
  aiChatPlanCreatedAt?: string
  /** AI 画布计划是否仍需突出显示 */
  aiChatPlanIsNew?: boolean
  /** agent 种下、用户还没点 Run 的占位节点视觉标记 */
  draftByAgent?: boolean
  /** 节点位置可动但禁止删除；配合 chapter-info 种子节点 */
  locked?: boolean
  /** 节点 data 禁止从 UI 或 flowPatch set_param 修改 */
  readOnly?: boolean
  /** 图片转 3D 模型 URL */
  model3dUrl?: string
  /** 图片转 3D 任务状态 */
  model3dStatus?: 'idle' | 'running' | 'success' | 'error'
  /** 图片转 3D 异步任务 ID */
  model3dTaskId?: string
  /** 图片转 3D 提示词 */
  model3dPrompt?: string
  /** 是否显示 3D 预览（true=3D 视图，false=图片视图） */
  model3dView?: boolean
  /** 其他 ad-hoc 字段 — 各 feature renderer 自定义 */
  [key: string]: unknown
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
    targets: [{ id: 'in-image', type: 'image', position: TARGET }],
    sources: [{ id: 'out-text', type: 'text', position: SOURCE }],
  },
  label: '文本',
}

const SHARED_IMAGE_FEATURES: TaskNodeFeature[] = [
  'prompt',
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
      targets: [{ id: 'in-image', type: 'image', position: TARGET }],
      sources: [{ id: 'out-text', type: 'text', position: SOURCE }],
    },
  },
  codex: {
    kind: 'codex',
    category: 'generic',
    icon: IconBrandOpenai,
    label: 'Codex',
    features: [],
    handles: {
      targets: [{ id: 'in-any', type: 'any', position: TARGET }],
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
  videoCompose: {
    kind: 'videoCompose',
    category: 'video',
    icon: IconScissors,
    label: '视频合成',
    features: ['videoCompose'],
    handles: {
      targets: [{ id: 'in-any', type: 'any', position: TARGET }],
      sources: [{ id: 'out-video', type: 'video', position: SOURCE }],
    },
  },
  audio: {
    kind: 'audio',
    category: 'generic',
    icon: IconMusic,
    label: '音频',
    // prompt：文案/曲风描述沉到底部输入条（与图片节点同构，节点主体只承载资产）
    features: ['audio', 'prompt'],
    // in-audio / in-image：豆包语音音色克隆参考（连上游音频/图片节点；图优先互斥）
    handles: {
      targets: [
        { id: 'in-text', type: 'text', position: TARGET },
        { id: 'in-audio', type: 'audio', position: TARGET },
        { id: 'in-image', type: 'image', position: TARGET },
      ],
      sources: [{ id: 'out-audio', type: 'audio', position: SOURCE }],
    },
  },
  videoAnalysis: {
    kind: 'videoAnalysis',
    category: 'document',
    icon: IconEye,
    label: '视频分析',
    features: ['videoAnalysis'],
    handles: {
      targets: [{ id: 'in-video', type: 'video', position: TARGET }],
      sources: [{ id: 'out-text', type: 'text', position: SOURCE }],
    },
  },
  shotTable: {
    kind: 'shotTable',
    category: 'document',
    icon: IconTable,
    label: '分镜表',
    features: ['shotTable'],
    handles: {
      targets: [{ id: 'in-text', type: 'text', position: TARGET }],
      sources: [{ id: 'out-text', type: 'text', position: SOURCE }],
    },
  },
  workflowStage: {
    kind: 'workflowStage',
    category: 'generic',
    icon: IconBinaryTree,
    label: '工作流阶段',
    features: ['workflowStage'],
    handles: {
      targets: [{ id: 'in-workflow', type: 'workflow', position: TARGET }],
      sources: [{ id: 'out-workflow', type: 'workflow', position: SOURCE }],
    },
  },
  workflowTrigger: {
    kind: 'workflowTrigger',
    category: 'generic',
    icon: IconAlarm,
    label: '工作流触发器',
    features: ['workflowTrigger'],
    handles: {
      sources: [{ id: 'out-workflow', type: 'workflow', position: SOURCE }],
    },
  },
}

const LEGACY_TASK_NODE_KIND_ALIASES: Record<string, TaskNodeKind> = {
  text: 'text',
  codex: 'codex',
  noveldoc: 'text',
  scriptdoc: 'text',
  storyboardscript: 'text',
  workflowinput: 'text',
  workflowoutput: 'text',
  cameraref: 'text',
  subtitlealign: 'text',
  subflow: 'text',

  audio: 'audio',
  tts: 'audio',
  speech: 'audio',

  image: 'image',
  imageedit: 'imageEdit',
  texttoimage: 'image',
  text_to_image: 'image',
  storyboardimage: 'image',
  novelstoryboard: 'image',
  storyboardshot: 'image',
  imagefission: 'image',

  video: 'video',
  composevideo: 'videoCompose',
  videocompose: 'videoCompose',
  videoanalysis: 'videoAnalysis',
  shottable: 'shotTable',
  workflowstage: 'workflowStage',
  workflowtrigger: 'workflowTrigger',

  storyboard: 'storyboard',
  storyboardedit: 'storyboard',
  storyboardeditor: 'storyboard',
}

export const normalizeTaskNodeKind = (kind?: string | null): TaskNodeKind | undefined => {
  const normalized = String(kind || '').trim()
  if (!normalized) return undefined
  return LEGACY_TASK_NODE_KIND_ALIASES[normalized.toLowerCase()]
}

const TASK_NODE_DEFINITIONS: TaskNodeSchemaDefinition[] = Object.values(TASK_NODE_SCHEMAS).map((schema) => {
  const coreType: TaskNodeCoreType = schema.kind === 'imageEdit'
    ? 'image'
    : schema.kind === 'videoCompose'
      ? 'video'
      : schema.kind === 'codex' || schema.kind === 'videoAnalysis' || schema.kind === 'shotTable' || schema.kind === 'workflowStage' || schema.kind === 'workflowTrigger'
        ? 'text'
        : schema.kind
  return { coreType, schema }
})

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

export const createTaskNodeInitialData = (kind: TaskNodeKind): TaskNodeData => {
  if (kind === 'codex') {
    return {
      kind,
      label: 'Codex',
      nodeWidth: 460,
      nodeHeight: 520,
      codexDraft: '',
      codexSessionId: '',
      codexTaskId: '',
      codexState: '',
      codexSummary: '',
      codexUpdatedAt: '',
      status: 'idle',
      textResults: [],
    }
  }
  if (kind === 'videoAnalysis') {
    return {
      kind,
      nodeWidth: 520,
      nodeHeight: 520,
      videoAnalysisFps: 1,
      videoAnalysisFocus: '',
      videoAnalysisRuns: [],
      videoAnalysisUndeliveredResults: [],
      status: 'idle',
    }
  }
  if (kind === 'shotTable') {
    const shotTable = createEmptyShotTable()
    const rawText = serializeShotTable(shotTable)
    return {
      kind,
      nodeWidth: 920,
      nodeHeight: 620,
      shotTable,
      shotTableRawText: rawText,
      shotTableViewMode: 'table',
      shotTableCurrentSource: '手动创建',
      shotTableCurrentNote: '',
      shotTableHistory: [],
      shotTableAssetBindings: [],
      prompt: rawText,
      status: 'idle',
    }
  }
  if (kind === 'workflowStage') {
    return {
      kind,
      nodeWidth: WORKFLOW_ICON_NODE_SIZE,
      nodeHeight: WORKFLOW_ICON_NODE_SIZE,
      workflowStatus: 'queued',
      status: 'idle',
    }
  }
  if (kind === 'workflowTrigger') {
    return {
      kind,
      nodeWidth: WORKFLOW_ICON_NODE_SIZE,
      nodeHeight: WORKFLOW_ICON_NODE_SIZE,
      triggerStatus: 'idle',
      status: 'idle',
    }
  }
  return { kind }
}
