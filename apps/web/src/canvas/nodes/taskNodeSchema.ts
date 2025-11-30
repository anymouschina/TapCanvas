import type { TablerIconsProps } from '@tabler/icons-react'
import {
  IconMovie,
  IconVideo,
  IconPhoto,
  IconPhotoEdit,
  IconMessages,
  IconVolume,
  IconVocabulary,
  IconUsers,
  IconBox,
} from '@tabler/icons-react'
import { Position } from 'reactflow'

export type TaskNodeFeature =
  | 'prompt'
  | 'storyboard'
  | 'image'
  | 'imageUpload'
  | 'imageResults'
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

export type TaskNodeCategory =
  | 'composer'
  | 'storyboard'
  | 'video'
  | 'image'
  | 'audio'
  | 'subtitle'
  | 'character'
  | 'subflow'
  | 'generic'

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
  kind: string
  category: TaskNodeCategory
  icon: (props: TablerIconsProps) => JSX.Element
  features: TaskNodeFeature[]
  handles?: TaskNodeHandlesConfig
  label?: string
}

const TARGET = Position.Left
const SOURCE = Position.Right

const DEFAULT_SCHEMA: TaskNodeSchema = {
  kind: 'default',
  category: 'generic',
  icon: IconBox,
  features: ['prompt'],
  handles: {
    targets: [{ id: 'in-any', type: 'any', position: TARGET }],
    sources: [{ id: 'out-any', type: 'any', position: SOURCE }],
  },
  label: '节点',
}

const makeComposerHandles = (): TaskNodeHandlesConfig => ({
  targets: [
    { id: 'in-image', type: 'image', position: TARGET },
    { id: 'in-video', type: 'video', position: TARGET },
    { id: 'in-audio', type: 'audio', position: TARGET },
    { id: 'in-subtitle', type: 'subtitle', position: TARGET },
    { id: 'in-character', type: 'character', position: TARGET },
  ],
  sources: [{ id: 'out-video', type: 'video', position: SOURCE }],
})

const TASK_NODE_SCHEMAS: Record<string, TaskNodeSchema> = {
  composeVideo: {
    kind: 'composeVideo',
    category: 'composer',
    icon: IconMovie,
    label: '文生视频',
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
    handles: makeComposerHandles(),
  },
  storyboard: {
    kind: 'storyboard',
    category: 'storyboard',
    icon: IconMovie,
    label: '分镜',
    features: [
      'prompt',
      'storyboard',
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
    handles: makeComposerHandles(),
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
      'aspect',
      'modelSelect',
      'characterMentions',
    ],
    handles: {
      targets: [
        { id: 'in-image', type: 'image', position: TARGET },
        { id: 'in-video', type: 'video', position: TARGET },
        { id: 'in-character', type: 'character', position: TARGET },
      ],
      sources: [{ id: 'out-video', type: 'video', position: SOURCE }],
    },
  },
  textToImage:{
    kind: 'textToImage',
    category: 'image',
    icon: IconPhoto,
    label: '图像',
    features: ['prompt', 'systemPrompt', 'image', 'imageResults', 'imageUpload', 'reversePrompt', 'aspect', 'sampleCount', 'modelSelect'],
    handles: {
      targets: [{ id: 'in-image', type: 'image', position: TARGET }],
      sources: [{ id: 'out-image', type: 'image', position: SOURCE }],
    },
  },
  image: {
    kind: 'image',
    category: 'image',
    icon: IconPhoto,
    label: '图像',
    features: ['prompt', 'systemPrompt', 'image', 'imageResults', 'imageUpload', 'reversePrompt', 'aspect', 'sampleCount', 'modelSelect'],
    handles: {
      targets: [{ id: 'in-image', type: 'image', position: TARGET }],
      sources: [{ id: 'out-image', type: 'image', position: SOURCE }],
    },
  },
  tts: {
    kind: 'tts',
    category: 'audio',
    icon: IconVolume,
    label: '语音',
    features: ['prompt', 'audio'],
    handles: {
      sources: [{ id: 'out-audio', type: 'audio', position: SOURCE }],
    },
  },
  subtitleAlign: {
    kind: 'subtitleAlign',
    category: 'subtitle',
    icon: IconVocabulary,
    label: '字幕',
    features: ['prompt', 'subtitle'],
    handles: {
      sources: [{ id: 'out-subtitle', type: 'subtitle', position: SOURCE }],
    },
  },
  character: {
    kind: 'character',
    category: 'character',
    icon: IconUsers,
    label: '角色',
    features: ['character'],
    handles: {
      sources: [{ id: 'out-character', type: 'character', position: SOURCE }],
    },
  },
  subflow: {
    kind: 'subflow',
    category: 'subflow',
    icon: IconBox,
    features: ['subflow'],
    handles: {
      dynamic: true,
    },
  },
}

export const getTaskNodeSchema = (kind?: string | null): TaskNodeSchema => {
  if (!kind) return DEFAULT_SCHEMA
  return TASK_NODE_SCHEMAS[kind] ?? DEFAULT_SCHEMA
}

export const listTaskNodeSchemas = (): TaskNodeSchema[] => Object.values(TASK_NODE_SCHEMAS)
