import {
  createImageOperationSpec,
  type ImageOperationExecution,
  type ImageOperationKind,
  type ImageOperationParameters,
  type ImageOperationSpec,
} from '@tapcanvas/image-operation-protocol'
import type { LibTvImagePresetKey } from './libTvImagePresets'

type PresetOperationDefinition = Readonly<{
  kind: ImageOperationKind
  execution: ImageOperationExecution
  parameters: ImageOperationParameters
  output: ImageOperationSpec['output']
}>

const PRESET_OPERATION_DEFINITIONS: Readonly<Partial<Record<LibTvImagePresetKey, PresetOperationDefinition>>> = {
  'blocking-storyboard': {
    kind: 'blocking_storyboard',
    execution: 'image-edit',
    parameters: { grid: { rows: 3, cols: 3 }, showBlockingArrows: true, preserveContinuity: true },
    output: { mediaType: 'image', count: 1, grid: { rows: 3, cols: 3 } },
  },
  storyboard: {
    kind: 'storyboard',
    execution: 'image-edit',
    parameters: { grid: { rows: 3, cols: 3 }, narrativeArc: true, preserveContinuity: true },
    output: { mediaType: 'image', count: 1, grid: { rows: 3, cols: 3 } },
  },
  'storyboard-25': {
    kind: 'storyboard_25',
    execution: 'image-edit',
    parameters: { grid: { rows: 5, cols: 5 }, preserveContinuity: true, forbidDuplicateFrames: true },
    output: { mediaType: 'image', count: 1, grid: { rows: 5, cols: 5 } },
  },
  'plot-4': {
    kind: 'plot_4',
    execution: 'image-edit',
    parameters: { grid: { rows: 2, cols: 2 }, narrativeMoments: 4, preserveContinuity: true },
    output: { mediaType: 'image', count: 1, grid: { rows: 2, cols: 2 } },
  },
  'evolution-3s-after': {
    kind: 'timeline_after',
    execution: 'image-edit',
    parameters: { offsetSeconds: 3, direction: 'after', preserveContinuity: true },
    output: { mediaType: 'image', count: 1 },
  },
  'evolution-5s-before': {
    kind: 'timeline_before',
    execution: 'image-edit',
    parameters: { offsetSeconds: 5, direction: 'before', preserveContinuity: true },
    output: { mediaType: 'image', count: 1 },
  },
  'panorama-720': {
    kind: 'panorama_720',
    execution: 'image-edit',
    parameters: { projection: 'equirectangular', horizontalDegrees: 360, verticalDegrees: 180, seamless: true },
    output: { mediaType: 'image', count: 1, panoramicProjection: 'equirectangular-2:1' },
  },
  'multi-camera-9': {
    kind: 'multi_camera_9',
    execution: 'image-edit',
    parameters: { grid: { rows: 3, cols: 3 }, cameraCount: 9, preserveSpatialLayout: true },
    output: { mediaType: 'image', count: 1, grid: { rows: 3, cols: 3 } },
  },
  'character-face-3view': {
    kind: 'character_face_3view',
    execution: 'image-edit',
    parameters: { views: ['front', 'left-profile', 'right-profile'], crop: 'face-closeup', neutralExpression: true },
    output: { mediaType: 'image', count: 1, grid: { rows: 1, cols: 3 } },
  },
  'character-setting': {
    kind: 'character_setting',
    execution: 'image-edit',
    parameters: { include: ['hero-view', 'full-body', 'wardrobe', 'accessories', 'materials', 'palette'] },
    output: { mediaType: 'image', count: 1 },
  },
  'character-3view': {
    kind: 'character_3view',
    execution: 'image-edit',
    parameters: { views: ['front', 'side', 'back'], includeFaceCloseup: true, neutralPose: true },
    output: { mediaType: 'image', count: 1, grid: { rows: 1, cols: 3 } },
  },
  'scene-setting': {
    kind: 'scene_setting',
    execution: 'image-edit',
    parameters: { include: ['hero-view', 'spatial-layout', 'zones', 'props', 'materials', 'lighting', 'palette'] },
    output: { mediaType: 'image', count: 1 },
  },
  'product-setting': {
    kind: 'product_setting',
    execution: 'image-edit',
    parameters: { views: ['hero', 'front', 'side', 'back'], include: ['details', 'materials', 'colors', 'functions'] },
    output: { mediaType: 'image', count: 1 },
  },
  'lighting-correction': {
    kind: 'lighting_correction',
    execution: 'image-edit',
    parameters: { preserveLayout: true, preserveIdentity: true, cinematicGrade: true },
    output: { mediaType: 'image', count: 1 },
  },
}

export function createImageOperationForSource(input: {
  kind: ImageOperationKind
  execution: ImageOperationExecution
  sourceNodeId: string
  sourceUrl: string
  sourceRevision?: number
  sourceAssetId?: string | null
  parameters?: ImageOperationParameters
  additionalInputs?: ImageOperationSpec['inputs']
  output?: ImageOperationSpec['output']
}): ImageOperationSpec {
  return createImageOperationSpec({
    kind: input.kind,
    execution: input.execution,
    sourceNodeId: input.sourceNodeId,
    sourceRevision: input.sourceRevision,
    parameters: input.parameters,
    inputs: [
      {
        role: 'source',
        url: input.sourceUrl,
        nodeId: input.sourceNodeId,
        ...(input.sourceAssetId ? { assetId: input.sourceAssetId } : {}),
      },
      ...(input.additionalInputs ?? []),
    ],
    output: input.output,
  })
}

export function createPresetImageOperation(input: {
  presetKey: LibTvImagePresetKey
  sourceNodeId: string
  sourceUrl: string
  sourceRevision?: number
}): ImageOperationSpec {
  const definition = PRESET_OPERATION_DEFINITIONS[input.presetKey]
  if (!definition) throw new Error(`预设 ${input.presetKey} 没有独立图片操作合同`)
  return createImageOperationForSource({
    kind: definition.kind,
    execution: definition.execution,
    sourceNodeId: input.sourceNodeId,
    sourceUrl: input.sourceUrl,
    sourceRevision: input.sourceRevision,
    parameters: definition.parameters,
    output: definition.output,
  })
}

export function readImageOperationSourceRevision(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.trunc(value)
    : 1
}

