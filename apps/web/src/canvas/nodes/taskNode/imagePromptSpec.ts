import imagePromptSpecModule, { type ImagePromptSpecV2 } from '@tapcanvas/image-prompt-spec'

const { compileImagePromptSpecV2, parseImagePromptSpecV2 } = imagePromptSpecModule

type UnknownRecord = Record<string, unknown>

export type PromptEditorMode = 'text' | 'structured'

type ResolvedImagePromptExecution = {
  prompt: string
  structuredPrompt: ImagePromptSpecV2 | null
  normalizedFromLegacy: boolean
  mode: PromptEditorMode
}

const LEGACY_STRUCTURED_PROMPT_KEYS = [
  'structuredPrompt',
  'imagePromptSpec',
  'promptSpec',
  'imagePromptSpecV2',
] as const

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as UnknownRecord
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function appendUnique(target: string[], value: unknown, prefix?: string): void {
  const normalized = readTrimmedString(value)
  if (!normalized) return
  const nextValue = prefix ? `${prefix}：${normalized}` : normalized
  if (!target.includes(nextValue)) target.push(nextValue)
}

function readStringList(value: unknown): string[] {
  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized ? [normalized] : []
  }
  if (!Array.isArray(value)) return []
  const out: string[] = []
  value.forEach((item) => {
    appendUnique(out, item)
  })
  return out
}

function readDelimitedStringList(value: unknown): string[] {
  const raw = readTrimmedString(value)
  if (!raw) return []
  return raw
    .split(/[，,、；;]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
}

function readPromptEditorMode(record: UnknownRecord): PromptEditorMode | null {
  const mode = readTrimmedString(record.promptEditorMode)
  if (mode === 'structured') return 'structured'
  if (mode === 'text') return 'text'
  return null
}

function joinUniqueSegments(values: string[]): string {
  const out: string[] = []
  values.forEach((value) => appendUnique(out, value))
  return out.join('，')
}

function readLegacyStructuredPromptRecord(record: UnknownRecord): UnknownRecord | null {
  for (const key of LEGACY_STRUCTURED_PROMPT_KEYS) {
    const candidate = asRecord(record[key])
    if (candidate) return candidate
  }
  return null
}

function buildLegacyShotIntent(legacySpec: UnknownRecord): string {
  const direct = readTrimmedString(legacySpec.shotIntent)
  if (direct) return direct
  const cameraPlan = asRecord(legacySpec.cameraPlan)
  const spatialLayout = asRecord(legacySpec.spatialLayout)
  return joinUniqueSegments([
    readTrimmedString(legacySpec.subject),
    readTrimmedString(legacySpec.scene),
    readTrimmedString(cameraPlan?.focus),
    readTrimmedString(spatialLayout?.subjectRelation),
  ])
}

function buildLegacySpatialLayout(legacySpec: UnknownRecord): string[] {
  const direct = readStringList(legacySpec.spatialLayout)
  if (direct.length > 0) return direct

  const spatialLayout = asRecord(legacySpec.spatialLayout)
  const out: string[] = []
  if (spatialLayout) {
    appendUnique(out, spatialLayout.foreground, '前景')
    appendUnique(out, spatialLayout.midground, '中景')
    appendUnique(out, spatialLayout.background, '背景')
  }
  return out
}

function buildLegacySubjectRelations(legacySpec: UnknownRecord): string[] {
  const direct = readStringList(legacySpec.subjectRelations)
  if (direct.length > 0) return direct

  const spatialLayout = asRecord(legacySpec.spatialLayout)
  return readStringList(spatialLayout?.subjectRelation)
}

function buildLegacyEnvironmentObjects(legacySpec: UnknownRecord): string[] {
  const direct = readStringList(legacySpec.environmentObjects)
  if (direct.length > 0) return direct
  return readStringList(legacySpec.props)
}

function buildLegacyCameraPlan(legacySpec: UnknownRecord): string[] {
  const direct = readStringList(legacySpec.cameraPlan)
  if (direct.length > 0) return direct

  const cameraPlan = asRecord(legacySpec.cameraPlan)
  const out: string[] = []
  if (cameraPlan) {
    appendUnique(out, cameraPlan.aspect, '画幅')
    appendUnique(out, cameraPlan.framing, '景别')
    appendUnique(out, cameraPlan.angle, '机位')
    appendUnique(out, cameraPlan.focus, '视觉焦点')
  }
  if (out.length > 0) return out

  appendUnique(out, legacySpec.shotType, '景别')
  appendUnique(out, legacySpec.cameraAngle, '机位')
  return out
}

function buildLegacyLightingPlan(legacySpec: UnknownRecord): string[] {
  const direct = readStringList(legacySpec.lightingPlan)
  if (direct.length > 0) return direct

  const lightingPlan = asRecord(legacySpec.lightingPlan)
  const lighting = asRecord(legacySpec.lighting)
  const out: string[] = []

  if (lightingPlan) {
    appendUnique(out, lightingPlan.time, '时间')
    appendUnique(out, lightingPlan.key, '主光')
    appendUnique(out, lightingPlan.fill, '补光')
    appendUnique(out, lightingPlan.consistency, '一致性')
    appendUnique(out, lightingPlan.style, '光线风格')
  }

  if (lighting) {
    appendUnique(out, lighting.time, '时间')
    appendUnique(out, lighting.style, '光线风格')
    appendUnique(out, lighting.key, '主光')
    appendUnique(out, lighting.fill, '补光')
  }

  return out
}

function buildLegacyStyleConstraints(legacySpec: UnknownRecord): string[] {
  const direct = readStringList(legacySpec.styleConstraints)
  if (direct.length > 0) return direct

  const out: string[] = []
  const lighting = asRecord(legacySpec.lighting)
  if (lighting) appendUnique(out, lighting.style)
  return out
}

function buildLegacyContinuityConstraints(legacySpec: UnknownRecord): string[] {
  const direct = readStringList(legacySpec.continuityConstraints)
  if (direct.length > 0) return direct

  const continuityConstraints = asRecord(legacySpec.continuityConstraints)
  const out: string[] = []
  if (continuityConstraints) {
    appendUnique(out, continuityConstraints.character)
    appendUnique(out, continuityConstraints.scene)
    appendUnique(out, continuityConstraints.blocking)
    appendUnique(out, continuityConstraints.logic)
  }

  readStringList(legacySpec.continuity).forEach((item) => appendUnique(out, item))
  readStringList(legacySpec.physicalRules).forEach((item) => appendUnique(out, item))
  return out
}

function buildLegacyNegativeConstraints(record: UnknownRecord, legacySpec: UnknownRecord): string[] {
  const direct = readStringList(legacySpec.negativeConstraints)
  if (direct.length > 0) return direct

  const out: string[] = []
  readDelimitedStringList(record.negativePrompt).forEach((item) => appendUnique(out, item))
  return out
}

function buildLegacyStructuredPrompt(record: UnknownRecord): ImagePromptSpecV2 | null {
  const legacySpec = readLegacyStructuredPromptRecord(record)
  if (!legacySpec) return null

  const shotIntent = buildLegacyShotIntent(legacySpec)
  const spatialLayout = buildLegacySpatialLayout(legacySpec)
  const cameraPlan = buildLegacyCameraPlan(legacySpec)
  const lightingPlan = buildLegacyLightingPlan(legacySpec)

  if (!shotIntent || spatialLayout.length === 0 || cameraPlan.length === 0 || lightingPlan.length === 0) {
    return null
  }

  return {
    version: 'v2',
    shotIntent,
    spatialLayout,
    subjectRelations: buildLegacySubjectRelations(legacySpec),
    referenceBindings: [],
    identityConstraints: [],
    environmentObjects: buildLegacyEnvironmentObjects(legacySpec),
    cameraPlan,
    lightingPlan,
    styleConstraints: buildLegacyStyleConstraints(legacySpec),
    continuityConstraints: buildLegacyContinuityConstraints(legacySpec),
    negativeConstraints: buildLegacyNegativeConstraints(record, legacySpec),
  }
}

function resolveStructuredPrompt(record: UnknownRecord): {
  structuredPrompt: ImagePromptSpecV2
  normalizedFromLegacy: boolean
} | null {
  const candidates: Array<{ key: string; value: unknown }> = [
    { key: 'structuredPrompt', value: record.structuredPrompt },
    { key: 'imagePromptSpecV2', value: record.imagePromptSpecV2 },
    { key: 'imagePromptSpec', value: record.imagePromptSpec },
    { key: 'promptSpec', value: record.promptSpec },
  ]

  let sawCandidate = false
  let firstError: string | null = null

  for (const candidate of candidates) {
    if (typeof candidate.value === 'undefined') continue
    sawCandidate = true
    const parsed = parseImagePromptSpecV2(candidate.value)
    if (parsed.ok && parsed.value) {
      return {
        structuredPrompt: parsed.value,
        normalizedFromLegacy: candidate.key !== 'structuredPrompt',
      }
    }
    if (!parsed.ok && !firstError) firstError = parsed.error
  }

  const legacyStructuredPrompt = buildLegacyStructuredPrompt(record)
  if (legacyStructuredPrompt) {
    return {
      structuredPrompt: legacyStructuredPrompt,
      normalizedFromLegacy: true,
    }
  }

  if (sawCandidate) {
    throw new Error(`structuredPrompt 非法：${firstError || '缺少有效结构化内容'}`)
  }

  return null
}

export function hasPotentialImagePromptExecution(data: unknown): boolean {
  try {
    return Boolean(resolveImagePromptExecution(data).prompt)
  } catch {
    const record = asRecord(data)
    return Boolean(record && readTrimmedString(record.prompt))
  }
}

export function resolveImagePromptExecution(data: unknown): ResolvedImagePromptExecution {
  const record = asRecord(data)
  if (!record) {
    return {
      prompt: '',
      structuredPrompt: null,
      normalizedFromLegacy: false,
      mode: 'text',
    }
  }

  const explicitMode = readPromptEditorMode(record)
  const resolvedStructuredPrompt = resolveStructuredPrompt(record)

  if (explicitMode === 'structured') {
    if (!resolvedStructuredPrompt?.structuredPrompt) {
      throw new Error('structuredPrompt 模式缺少有效的 structuredPrompt')
    }
    return {
      prompt: compileImagePromptSpecV2(resolvedStructuredPrompt.structuredPrompt).trim(),
      structuredPrompt: resolvedStructuredPrompt.structuredPrompt,
      normalizedFromLegacy: resolvedStructuredPrompt.normalizedFromLegacy,
      mode: 'structured',
    }
  }

  if (!explicitMode && resolvedStructuredPrompt?.structuredPrompt) {
    return {
      prompt: compileImagePromptSpecV2(resolvedStructuredPrompt.structuredPrompt).trim(),
      structuredPrompt: resolvedStructuredPrompt.structuredPrompt,
      normalizedFromLegacy: resolvedStructuredPrompt.normalizedFromLegacy,
      mode: 'structured',
    }
  }

  return {
    prompt: readTrimmedString(record.prompt),
    structuredPrompt: resolvedStructuredPrompt?.structuredPrompt ?? null,
    normalizedFromLegacy: resolvedStructuredPrompt?.normalizedFromLegacy ?? false,
    mode: 'text',
  }
}

export function resolveCompiledImagePrompt(data: unknown): string {
  return resolveImagePromptExecution(data).prompt
}

export function normalizeImagePromptExecutionConfig(config: UnknownRecord): UnknownRecord {
  const {
    imagePromptSpecV2: _imagePromptSpecV2,
    imagePromptSpec: _imagePromptSpec,
    promptSpec: _promptSpec,
    ...restConfig
  } = config
  const resolved = resolveImagePromptExecution(config)

  return {
    ...restConfig,
    ...(resolved.structuredPrompt ? { structuredPrompt: resolved.structuredPrompt } : null),
    ...(resolved.prompt ? { prompt: resolved.prompt } : null),
    ...(resolved.mode === 'structured'
      ? { promptEditorMode: 'structured' as const }
      : readPromptEditorMode(config) === 'text'
        ? { promptEditorMode: 'text' as const }
        : null),
  }
}

export function reconcileImagePromptExecutionConfig(config: UnknownRecord): UnknownRecord {
  return normalizeImagePromptExecutionConfig(config)
}
