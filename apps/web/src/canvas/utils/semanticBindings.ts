import {
  mergePublicFlowAnchorBindings,
  normalizePublicFlowAnchorBinding,
  normalizePublicFlowAnchorBindings,
  type PublicFlowAnchorBinding,
  type PublicFlowAnchorBindingKind,
  type PublicFlowAnchorReferenceView,
} from '@tapcanvas/flow-anchor-bindings'

export type SemanticReferenceView = PublicFlowAnchorReferenceView
export type SemanticNodeAnchorBinding = PublicFlowAnchorBinding

export type SemanticNodeRoleBinding = {
  roleName: string | null
  roleCardId: string | null
  roleId: string | null
  sourceBookId: string | null
  referenceView: SemanticReferenceView | null
}

export type SemanticNodeVisualReferenceBinding = {
  refId: string | null
  refName: string | null
  category: 'scene_prop' | 'spell_fx' | null
  sourceBookId: string | null
}

type AnchorBindingInput = {
  kind: PublicFlowAnchorBindingKind
  refId?: string | null
  entityId?: string | null
  label?: string | null
  sourceBookId?: string | null
  sourceNodeId?: string | null
  assetId?: string | null
  assetRefId?: string | null
  imageUrl?: string | null
  referenceView?: SemanticReferenceView | null
  category?: string | null
  note?: string | null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readRemoteUrl(value: unknown): string {
  const trimmed = readTrimmedString(value)
  return /^https?:\/\//i.test(trimmed) ? trimmed : ''
}

function normalizeReferenceView(value: unknown): SemanticReferenceView | null {
  const normalized = readTrimmedString(value).toLowerCase()
  if (normalized === 'three_view') return 'three_view'
  if (normalized === 'role_card') return 'role_card'
  return null
}

function readCharacterAssetInputs(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .filter((item) => readTrimmedString(item.role).toLowerCase() === 'character')
}

function readVisualAssetInputs(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .filter((item) => {
      const role = readTrimmedString(item.role).toLowerCase()
      return role === 'scene' || role === 'prop'
    })
}

function parseRoleNameFromNote(note: string): string {
  const prefix = note.split('|')[0]?.trim() || ''
  if (!prefix) return ''
  if (prefix.startsWith('@')) return prefix.slice(1).trim()
  if (prefix.startsWith('chapter-role:')) return prefix.slice('chapter-role:'.length).trim()
  return ''
}

function parseVisualNameFromNote(note: string): { name: string; kind: 'scene' | 'prop' | null } {
  const prefix = note.split('|')[0]?.trim() || ''
  if (!prefix) return { name: '', kind: null }
  if (prefix.startsWith('chapter-scene:')) {
    return {
      name: prefix.slice('chapter-scene:'.length).trim(),
      kind: 'scene',
    }
  }
  if (prefix.startsWith('chapter-prop:')) {
    return {
      name: prefix.slice('chapter-prop:'.length).trim(),
      kind: 'prop',
    }
  }
  return { name: '', kind: null }
}

function parseReferenceViewFromNote(note: string): SemanticReferenceView | null {
  if (note.includes('reference=three_view')) return 'three_view'
  if (note.includes('reference=role_card')) return 'role_card'
  return null
}

function inferRoleReferenceViewFromSource(data: Record<string, unknown>): SemanticReferenceView | null {
  const source = readTrimmedString(data.source)
  if (!source) return null
  if (
    source === 'role_card_library' ||
    source === 'novel_upload_autoflow' ||
    source === 'novel_character_meta'
  ) {
    return 'three_view'
  }
  if (source === 'chapter_assets_confirm' && readTrimmedString(data.roleName)) {
    return 'three_view'
  }
  return null
}

function normalizeCategory(value: unknown): 'scene_prop' | 'spell_fx' | null {
  const normalized = readTrimmedString(value).toLowerCase()
  if (normalized === 'scene_prop') return 'scene_prop'
  if (normalized === 'spell_fx') return 'spell_fx'
  return null
}

function createSemanticAnchorBinding(input: AnchorBindingInput): SemanticNodeAnchorBinding | null {
  return normalizePublicFlowAnchorBinding({
    kind: input.kind,
    ...(input.refId ? { refId: input.refId } : null),
    ...(input.entityId ? { entityId: input.entityId } : null),
    ...(input.label ? { label: input.label } : null),
    ...(input.sourceBookId ? { sourceBookId: input.sourceBookId } : null),
    ...(input.sourceNodeId ? { sourceNodeId: input.sourceNodeId } : null),
    ...(input.assetId ? { assetId: input.assetId } : null),
    ...(input.assetRefId ? { assetRefId: input.assetRefId } : null),
    ...(input.imageUrl ? { imageUrl: input.imageUrl } : null),
    ...(input.referenceView ? { referenceView: input.referenceView } : null),
    ...(input.category ? { category: input.category } : null),
    ...(input.note ? { note: input.note } : null),
  })
}

function buildLegacyCharacterAnchorBindings(record: Record<string, unknown>): SemanticNodeAnchorBinding[] {
  const explicitSourceBookId =
    readTrimmedString(record.sourceBookId) ||
    readTrimmedString(record.bookId)
  const explicitReferenceView = normalizeReferenceView(record.referenceView)
  const explicitRoleBinding = createSemanticAnchorBinding({
    kind: 'character',
    refId: readTrimmedString(record.roleCardId),
    entityId: readTrimmedString(record.roleId),
    label: readTrimmedString(record.roleName),
    sourceBookId: explicitSourceBookId || null,
    sourceNodeId: readTrimmedString(record.nodeId) || null,
    imageUrl:
      readRemoteUrl(record.imageUrl) ||
      (Array.isArray(record.roleCardReferenceImages)
        ? readRemoteUrl(record.roleCardReferenceImages[0])
        : ''),
    referenceView: explicitReferenceView || inferRoleReferenceViewFromSource(record),
  })

  const assetBindings = readCharacterAssetInputs(record.assetInputs)
    .map((item) => createSemanticAnchorBinding({
      kind: 'character',
      label: readTrimmedString(item.name) || parseRoleNameFromNote(readTrimmedString(item.note)),
      sourceBookId: explicitSourceBookId || null,
      assetId: readTrimmedString(item.assetId),
      assetRefId: readTrimmedString(item.assetRefId),
      imageUrl: readRemoteUrl(item.url),
      referenceView: parseReferenceViewFromNote(readTrimmedString(item.note)) || explicitReferenceView || inferRoleReferenceViewFromSource(record),
      note: readTrimmedString(item.note),
    }))
    .filter((item): item is SemanticNodeAnchorBinding => Boolean(item))

  return mergePublicFlowAnchorBindings(
    explicitRoleBinding ? [explicitRoleBinding] : [],
    assetBindings,
  )
}

function buildLegacyVisualAnchorBindings(record: Record<string, unknown>): SemanticNodeAnchorBinding[] {
  const explicitSourceBookId =
    readTrimmedString(record.sourceBookId) ||
    readTrimmedString(record.bookId)
  const explicitRefId = readTrimmedString(record.scenePropRefId) || readTrimmedString(record.visualRefId)
  const explicitRefName = readTrimmedString(record.scenePropRefName) || readTrimmedString(record.visualRefName)
  const explicitCategory = normalizeCategory(record.visualRefCategory)
  const explicitVisualKind = (() => {
    if (readTrimmedString(record.scenePropRefId) || readTrimmedString(record.scenePropRefName)) {
      return 'scene' as const
    }
    return 'prop' as const
  })()
  const explicitVisualBinding =
    explicitRefId || explicitRefName || explicitCategory
      ? createSemanticAnchorBinding({
          kind: explicitVisualKind,
          refId: explicitRefId,
          label: explicitRefName,
          sourceBookId: explicitSourceBookId || null,
          sourceNodeId: readTrimmedString(record.nodeId) || null,
          imageUrl: readRemoteUrl(record.imageUrl),
          category: explicitCategory,
        })
      : null

  const assetBindings = readVisualAssetInputs(record.assetInputs)
    .map((item) => {
      const inferred = parseVisualNameFromNote(readTrimmedString(item.note))
      const assetRole = readTrimmedString(item.role).toLowerCase()
      const kind =
        assetRole === 'scene'
          ? 'scene'
          : assetRole === 'prop'
            ? 'prop'
            : inferred.kind
      if (!kind) return null
      return createSemanticAnchorBinding({
        kind,
        label: readTrimmedString(item.name) || inferred.name,
        sourceBookId: explicitSourceBookId || null,
        assetId: readTrimmedString(item.assetId),
        assetRefId: readTrimmedString(item.assetRefId),
        imageUrl: readRemoteUrl(item.url),
        category: 'scene_prop',
        note: readTrimmedString(item.note),
      })
    })
    .filter((item): item is SemanticNodeAnchorBinding => Boolean(item))

  return mergePublicFlowAnchorBindings(
    explicitVisualBinding ? [explicitVisualBinding] : [],
    assetBindings,
  )
}

function scoreAnchorBinding(binding: SemanticNodeAnchorBinding): number {
  return (
    (binding.label ? 8 : 0) +
    (binding.refId ? 4 : 0) +
    (binding.entityId ? 2 : 0) +
    (binding.imageUrl ? 1 : 0)
  )
}

function pickBestAnchorBinding(
  bindings: SemanticNodeAnchorBinding[],
  kinds: readonly PublicFlowAnchorBindingKind[],
): SemanticNodeAnchorBinding | null {
  for (const kind of kinds) {
    const matches = bindings
      .filter((binding) => binding.kind === kind)
      .sort((left, right) => scoreAnchorBinding(right) - scoreAnchorBinding(left))
    if (matches[0]) return matches[0]
  }
  return null
}

function normalizeKey(value: string | null | undefined): string {
  return readTrimmedString(value).toLowerCase()
}

export function resolveSemanticNodeAnchorBindings(data: unknown): SemanticNodeAnchorBinding[] {
  const record = asRecord(data)
  return mergePublicFlowAnchorBindings(
    normalizePublicFlowAnchorBindings(record.anchorBindings),
    buildLegacyCharacterAnchorBindings(record),
    buildLegacyVisualAnchorBindings(record),
  )
}

export function resolvePrimarySemanticAnchorBinding(data: unknown): SemanticNodeAnchorBinding | null {
  return pickBestAnchorBinding(resolveSemanticNodeAnchorBindings(data), [
    'character',
    'scene',
    'prop',
    'shot',
    'story',
    'asset',
    'context',
    'authority_base_frame',
  ])
}

export function upsertSemanticNodeAnchorBinding(input: {
  existing: unknown
  next: AnchorBindingInput
  replaceKinds?: PublicFlowAnchorBindingKind[]
}): SemanticNodeAnchorBinding[] {
  const nextBinding = createSemanticAnchorBinding(input.next)
  if (!nextBinding) return normalizePublicFlowAnchorBindings(input.existing)

  const replaceKinds = new Set<PublicFlowAnchorBindingKind>(input.replaceKinds || [nextBinding.kind])
  const nextRefIdKey = normalizeKey(nextBinding.refId)
  const nextEntityIdKey = normalizeKey(nextBinding.entityId)
  const nextLabelKey = normalizeKey(nextBinding.label)

  const filtered = normalizePublicFlowAnchorBindings(input.existing).filter((binding) => {
    if (!replaceKinds.has(binding.kind)) return true
    if (nextRefIdKey && normalizeKey(binding.refId) === nextRefIdKey) return false
    if (nextEntityIdKey && normalizeKey(binding.entityId) === nextEntityIdKey) return false
    if (nextLabelKey && normalizeKey(binding.label) === nextLabelKey) return false
    if (!nextRefIdKey && !nextEntityIdKey && !nextLabelKey) return false
    return true
  })

  return mergePublicFlowAnchorBindings(filtered, [nextBinding])
}

export function resolveSemanticNodeRoleBinding(data: unknown): SemanticNodeRoleBinding {
  const binding = pickBestAnchorBinding(resolveSemanticNodeAnchorBindings(data), ['character'])
  return {
    roleName: binding?.label || null,
    roleCardId: binding?.refId || null,
    roleId: binding?.entityId || null,
    sourceBookId: binding?.sourceBookId || null,
    referenceView: binding?.referenceView || null,
  }
}

export function resolveSemanticNodeVisualReferenceBinding(data: unknown): SemanticNodeVisualReferenceBinding {
  const binding = pickBestAnchorBinding(resolveSemanticNodeAnchorBindings(data), ['scene', 'prop'])
  const category = normalizeCategory(binding?.category)
  return {
    refId: binding?.refId || null,
    refName: binding?.label || null,
    category,
    sourceBookId: binding?.sourceBookId || null,
  }
}
