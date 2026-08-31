export const IMAGE_OPERATION_SCHEMA_VERSION = 1 as const

export type ImageOperationKind =
  | 'portrait_adjust'
  | 'emotion_adjust'
  | 'panorama_720'
  | 'multi_angle'
  | 'relight'
  | 'blocking_storyboard'
  | 'storyboard'
  | 'storyboard_25'
  | 'plot_4'
  | 'timeline_after'
  | 'timeline_before'
  | 'multi_camera_9'
  | 'character_face_3view'
  | 'character_setting'
  | 'character_3view'
  | 'character_fission'
  | 'scene_setting'
  | 'product_setting'
  | 'lighting_correction'
  | 'upscale'
  | 'outpaint'
  | 'inpaint'
  | 'erase'
  | 'cutout'
  | 'crop'
  | 'element_edit'
  | 'layer_decompose'
  | 'layer_recompose'
  | 'grid_split'
  | 'annotate'
  | 'rotate'

export type ImageOperationExecution =
  | 'image-edit'
  | 'image-generation'
  | 'remove-background'
  | 'layer-decompose'
  | 'local-transform'

export type ImageOperationAssetRole =
  | 'source'
  | 'mask'
  | 'reference'
  | 'annotation'
  | 'depth'
  | 'result'
  | 'layer'
  | 'cell'

export type ImageOperationAsset = Readonly<{
  role: ImageOperationAssetRole
  url: string
  assetId?: string | null
  nodeId?: string | null
  mimeType?: string | null
  width?: number | null
  height?: number | null
}>

export type ImageOperationCamera = Readonly<{
  azimuthDeg: number
  elevationDeg: number
  fovDeg: number
  distance: number
  presetKey?: string
}>

export type ImageOperationLight = Readonly<{
  enabled: boolean
  azimuthDeg: number
  elevationDeg: number
  intensity: number
  softness: number
  colorHex: string
  presetKey?: string
}>

export type ImageOperationParameters = Readonly<Record<string, unknown>>

export type ImageOperationSpec = Readonly<{
  schemaVersion: typeof IMAGE_OPERATION_SCHEMA_VERSION
  operationId: string
  kind: ImageOperationKind
  execution: ImageOperationExecution
  sourceNodeId: string
  sourceRevision: number
  createdAt: string
  parameters: ImageOperationParameters
  inputs: readonly ImageOperationAsset[]
  output: Readonly<{
    mediaType: 'image'
    count: number
    format?: 'png' | 'jpeg' | 'webp'
    transparent?: boolean
    grid?: Readonly<{ rows: number; cols: number }>
    panoramicProjection?: 'equirectangular-2:1'
  }>
}>

export type ImageOperationPhase =
  | 'draft'
  | 'ready'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'

export type ImageOperationState = Readonly<{
  schemaVersion: typeof IMAGE_OPERATION_SCHEMA_VERSION
  operationId: string
  phase: ImageOperationPhase
  attempt: number
  progress: number
  queuedAt?: string
  startedAt?: string
  finishedAt?: string
  error?: Readonly<{ code: string; message: string; retryable: boolean }>
  resultAssets?: readonly ImageOperationAsset[]
}>

export type CreateImageOperationInput = Readonly<{
  kind: ImageOperationKind
  execution: ImageOperationExecution
  sourceNodeId: string
  sourceRevision?: number
  parameters?: ImageOperationParameters
  inputs: readonly ImageOperationAsset[]
  output?: ImageOperationSpec['output']
  now?: string
  operationId?: string
}>

const IMAGE_OPERATION_KINDS = new Set<ImageOperationKind>([
  'portrait_adjust',
  'emotion_adjust',
  'panorama_720',
  'multi_angle',
  'relight',
  'blocking_storyboard',
  'storyboard',
  'storyboard_25',
  'plot_4',
  'timeline_after',
  'timeline_before',
  'multi_camera_9',
  'character_face_3view',
  'character_setting',
  'character_3view',
  'character_fission',
  'scene_setting',
  'product_setting',
  'lighting_correction',
  'upscale',
  'outpaint',
  'inpaint',
  'erase',
  'cutout',
  'crop',
  'element_edit',
  'layer_decompose',
  'layer_recompose',
  'grid_split',
  'annotate',
  'rotate',
])

const IMAGE_OPERATION_EXECUTIONS = new Set<ImageOperationExecution>([
  'image-edit',
  'image-generation',
  'remove-background',
  'layer-decompose',
  'local-transform',
])

const IMAGE_OPERATION_ASSET_ROLES = new Set<ImageOperationAssetRole>([
  'source',
  'mask',
  'reference',
  'annotation',
  'depth',
  'result',
  'layer',
  'cell',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`图片操作合同缺少 ${field}`)
  }
  return value.trim()
}

function readFiniteNumber(value: unknown, field: string, min: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new Error(`图片操作合同 ${field} 无效`)
  }
  return value
}

function createOperationId(kind: ImageOperationKind): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `image-op-${kind}-${Date.now().toString(36)}-${random}`
}

export function createImageOperationSpec(input: CreateImageOperationInput): ImageOperationSpec {
  if (!IMAGE_OPERATION_KINDS.has(input.kind)) throw new Error(`不支持的图片操作：${input.kind}`)
  if (!IMAGE_OPERATION_EXECUTIONS.has(input.execution)) {
    throw new Error(`不支持的图片执行链：${input.execution}`)
  }
  const sourceNodeId = readNonEmptyString(input.sourceNodeId, 'sourceNodeId')
  const sourceAssets = input.inputs.filter((asset) => asset.role === 'source')
  if (input.execution !== 'image-generation' && sourceAssets.length !== 1) {
    throw new Error('图片操作必须且只能包含一个 source 输入资产')
  }
  const spec: ImageOperationSpec = {
    schemaVersion: IMAGE_OPERATION_SCHEMA_VERSION,
    operationId: input.operationId?.trim() || createOperationId(input.kind),
    kind: input.kind,
    execution: input.execution,
    sourceNodeId,
    sourceRevision: Math.max(1, Math.trunc(input.sourceRevision ?? 1)),
    createdAt: input.now ?? new Date().toISOString(),
    parameters: { ...(input.parameters ?? {}) },
    inputs: input.inputs.map((asset) => ({ ...asset, url: readNonEmptyString(asset.url, `${asset.role}.url`) })),
    output: input.output ?? { mediaType: 'image', count: 1 },
  }
  return parseImageOperationSpec(spec)
}

export function parseImageOperationSpec(value: unknown): ImageOperationSpec {
  if (!isRecord(value)) throw new Error('图片操作合同必须是对象')
  if (value.schemaVersion !== IMAGE_OPERATION_SCHEMA_VERSION) {
    throw new Error(`不支持的图片操作合同版本：${String(value.schemaVersion)}`)
  }
  const kind = readNonEmptyString(value.kind, 'kind') as ImageOperationKind
  if (!IMAGE_OPERATION_KINDS.has(kind)) throw new Error(`不支持的图片操作：${kind}`)
  const execution = readNonEmptyString(value.execution, 'execution') as ImageOperationExecution
  if (!IMAGE_OPERATION_EXECUTIONS.has(execution)) throw new Error(`不支持的图片执行链：${execution}`)
  if (!isRecord(value.parameters)) throw new Error('图片操作合同 parameters 必须是对象')
  if (!Array.isArray(value.inputs)) throw new Error('图片操作合同 inputs 必须是数组')
  const inputs = value.inputs.map((item, index): ImageOperationAsset => {
    if (!isRecord(item)) throw new Error(`图片操作输入 ${index + 1} 无效`)
    const role = readNonEmptyString(item.role, `inputs[${index}].role`) as ImageOperationAssetRole
    if (!IMAGE_OPERATION_ASSET_ROLES.has(role)) throw new Error(`图片操作输入角色无效：${role}`)
    return {
      role,
      url: readNonEmptyString(item.url, `inputs[${index}].url`),
      ...(typeof item.assetId === 'string' ? { assetId: item.assetId } : {}),
      ...(typeof item.nodeId === 'string' ? { nodeId: item.nodeId } : {}),
      ...(typeof item.mimeType === 'string' ? { mimeType: item.mimeType } : {}),
      ...(typeof item.width === 'number' ? { width: item.width } : {}),
      ...(typeof item.height === 'number' ? { height: item.height } : {}),
    }
  })
  const sourceCount = inputs.filter((asset) => asset.role === 'source').length
  if (execution !== 'image-generation' && sourceCount !== 1) {
    throw new Error('图片操作必须且只能包含一个 source 输入资产')
  }
  if (
    (kind === 'inpaint' || kind === 'erase' || kind === 'portrait_adjust' || kind === 'element_edit' || kind === 'outpaint')
    && !inputs.some((asset) => asset.role === 'mask')
  ) {
    throw new Error(`${kind} 操作缺少独立 mask 输入资产`)
  }
  if (!isRecord(value.output) || value.output.mediaType !== 'image') {
    throw new Error('图片操作合同 output 无效')
  }
  const count = readFiniteNumber(value.output.count, 'output.count', 1)
  const output: ImageOperationSpec['output'] = {
    mediaType: 'image',
    count: Math.trunc(count),
    ...(value.output.format === 'png' || value.output.format === 'jpeg' || value.output.format === 'webp'
      ? { format: value.output.format }
      : {}),
    ...(typeof value.output.transparent === 'boolean' ? { transparent: value.output.transparent } : {}),
    ...(isRecord(value.output.grid)
      ? {
          grid: {
            rows: Math.trunc(readFiniteNumber(value.output.grid.rows, 'output.grid.rows', 1)),
            cols: Math.trunc(readFiniteNumber(value.output.grid.cols, 'output.grid.cols', 1)),
          },
        }
      : {}),
    ...(value.output.panoramicProjection === 'equirectangular-2:1'
      ? { panoramicProjection: value.output.panoramicProjection }
      : {}),
  }
  return {
    schemaVersion: IMAGE_OPERATION_SCHEMA_VERSION,
    operationId: readNonEmptyString(value.operationId, 'operationId'),
    kind,
    execution,
    sourceNodeId: readNonEmptyString(value.sourceNodeId, 'sourceNodeId'),
    sourceRevision: Math.trunc(readFiniteNumber(value.sourceRevision, 'sourceRevision', 1)),
    createdAt: readNonEmptyString(value.createdAt, 'createdAt'),
    parameters: { ...value.parameters },
    inputs,
    output,
  }
}

export function createImageOperationState(
  spec: ImageOperationSpec,
  phase: ImageOperationPhase = 'ready',
): ImageOperationState {
  return {
    schemaVersion: IMAGE_OPERATION_SCHEMA_VERSION,
    operationId: spec.operationId,
    phase,
    attempt: 0,
    progress: 0,
  }
}

export function updateImageOperationParameters(
  value: unknown,
  patch: ImageOperationParameters,
): ImageOperationSpec {
  const spec = parseImageOperationSpec(value)
  return parseImageOperationSpec({
    ...spec,
    parameters: {
      ...spec.parameters,
      ...patch,
    },
  })
}

export function imageOperationMaskUrl(spec: ImageOperationSpec): string | null {
  return spec.inputs.find((asset) => asset.role === 'mask')?.url ?? null
}

export function imageOperationSourceUrl(spec: ImageOperationSpec): string | null {
  return spec.inputs.find((asset) => asset.role === 'source')?.url ?? null
}
