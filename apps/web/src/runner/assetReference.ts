export type AssetResultItem = {
  url: string
  title?: string | null
  assetId?: string | null
  assetRefId?: string | null
  assetName?: string | null
  thumbnailUrl?: string | null
  duration?: number
}

export type NamedReferenceEntry = {
  url: string
  label: string
  assetId?: string | null
  note?: string | null
}

export type ReferenceAliasSlotBinding = {
  slot: string
  alias: string
}

export type RuntimeReferenceAssetInput = {
  assetId?: string | null
  assetRefId?: string | null
  url: string
  role?: string | null
  note?: string | null
  name?: string | null
}

function readRemoteUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : ''
}

function uniqueUrls(items: string[], limit: number): string[] {
  const maxItems = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0
  if (maxItems === 0) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const normalized = readRemoteUrl(item)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
    if (out.length >= maxItems) break
  }
  return out
}

function normalizeLabelToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/@+/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function buildAssetRefId(input: {
  assetId?: string | null
  name?: string | null
  title?: string | null
  fallbackPrefix?: string
  index?: number
}): string {
  const fromName = normalizeLabelToken(String(input.name || ''))
  if (fromName) return fromName
  const fromTitle = normalizeLabelToken(String(input.title || ''))
  if (fromTitle) return fromTitle
  const fromAssetId = normalizeLabelToken(String(input.assetId || ''))
  if (fromAssetId) return fromAssetId
  const fallbackPrefix = normalizeLabelToken(String(input.fallbackPrefix || 'asset')) || 'asset'
  const fallbackIndex =
    typeof input.index === 'number' && Number.isFinite(input.index) && input.index >= 0
      ? Math.trunc(input.index) + 1
      : 1
  return `${fallbackPrefix}_${fallbackIndex}`
}

export function buildImageAssetResultItem(input: {
  url: string
  title?: string | null
  assetId?: string | null
  assetName?: string | null
  assetRefId?: string | null
}): AssetResultItem {
  const url = String(input.url || '').trim()
  const title = String(input.title || '').trim() || null
  const assetId = String(input.assetId || '').trim() || null
  const assetName = String(input.assetName || '').trim() || title
  const assetRefId =
    String(input.assetRefId || '').trim() ||
    buildAssetRefId({
      assetId,
      name: assetName,
      title,
      fallbackPrefix: 'img',
    })
  return {
    url,
    ...(title ? { title } : null),
    ...(assetId ? { assetId } : null),
    ...(assetName ? { assetName } : null),
    ...(assetRefId ? { assetRefId } : null),
  }
}

export function buildVideoAssetResultItem(input: {
  url: string
  thumbnailUrl?: string | null
  title?: string | null
  assetId?: string | null
  assetName?: string | null
  assetRefId?: string | null
  duration?: number
}): AssetResultItem {
  const url = String(input.url || '').trim()
  const thumbnailUrl = String(input.thumbnailUrl || '').trim() || null
  const title = String(input.title || '').trim() || null
  const assetId = String(input.assetId || '').trim() || null
  const assetName = String(input.assetName || '').trim() || title
  const assetRefId =
    String(input.assetRefId || '').trim() ||
    buildAssetRefId({
      assetId,
      name: assetName,
      title,
      fallbackPrefix: 'video',
    })
  const duration =
    typeof input.duration === 'number' && Number.isFinite(input.duration) && input.duration > 0
      ? input.duration
      : undefined
  return {
    url,
    ...(thumbnailUrl ? { thumbnailUrl } : null),
    ...(title ? { title } : null),
    ...(assetId ? { assetId } : null),
    ...(assetName ? { assetName } : null),
    ...(assetRefId ? { assetRefId } : null),
    ...(typeof duration === 'number' ? { duration } : null),
  }
}

export function buildNamedReferenceEntries(input: {
  assetInputs?: unknown
  referenceImages: string[]
  fallbackPrefix: string
  limit: number
}): NamedReferenceEntry[] {
  const out: NamedReferenceEntry[] = []
  const seen = new Set<string>()
  const assetInputByUrl = new Map<
    string,
    { assetId: string | null; name: string | null; assetRefId: string | null; note: string | null }
  >()

  if (Array.isArray(input.assetInputs)) {
    for (const item of input.assetInputs) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const record = item as Record<string, unknown>
      const url = typeof record.url === 'string' ? record.url.trim() : ''
      if (!url || assetInputByUrl.has(url)) continue
      const assetId = typeof record.assetId === 'string' ? record.assetId.trim() : ''
      const name = typeof record.name === 'string' ? record.name.trim() : ''
      const assetRefId = typeof record.assetRefId === 'string' ? record.assetRefId.trim() : ''
      const note = typeof record.note === 'string' ? record.note.trim() : ''
      assetInputByUrl.set(url, {
        assetId: assetId || null,
        name: name || null,
        assetRefId: assetRefId || null,
        note: note || null,
      })
    }
  }

  for (let index = 0; index < input.referenceImages.length; index += 1) {
    const url = String(input.referenceImages[index] || '').trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    const matched = assetInputByUrl.get(url) || null
    const label =
      String(matched?.assetRefId || '').trim() ||
      buildAssetRefId({
        assetId: matched?.assetId || null,
        name: matched?.name || null,
        fallbackPrefix: input.fallbackPrefix,
        index,
      })
    out.push({
      url,
      label,
      ...(matched?.assetId ? { assetId: matched.assetId } : null),
      ...(matched?.note ? { note: matched.note } : null),
    })
    if (out.length >= input.limit) break
  }

  return out
}

function normalizeAliasForPrompt(value: unknown): string {
  const trimmed = String(value || '')
    .trim()
    .replace(/^@+/, '')
  if (!trimmed) return ''
  if (/\s/.test(trimmed)) return ''
  return trimmed
}

function collectAssetInputAliasByUrl(assetInputs: unknown): Map<string, string> {
  const aliasByUrl = new Map<string, string>()
  if (!Array.isArray(assetInputs)) return aliasByUrl
  for (const item of assetInputs) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const url = typeof record.url === 'string' ? record.url.trim() : ''
    if (!url || aliasByUrl.has(url)) continue
    const aliasFromAssetRefId = normalizeAliasForPrompt(record.assetRefId)
    const aliasFromName = normalizeAliasForPrompt(record.name)
    const alias = aliasFromAssetRefId || aliasFromName
    if (!alias) continue
    aliasByUrl.set(url, alias)
  }
  return aliasByUrl
}

function collectAssetInputRoleByUrl(assetInputs: unknown): Map<string, string> {
  const roleByUrl = new Map<string, string>()
  if (!Array.isArray(assetInputs)) return roleByUrl
  for (const item of assetInputs) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const url = typeof record.url === 'string' ? record.url.trim() : ''
    if (!url || roleByUrl.has(url)) continue
    const role = typeof record.role === 'string' ? record.role.trim().toLowerCase() : ''
    if (!role) continue
    roleByUrl.set(url, role)
  }
  return roleByUrl
}

function normalizeRuntimeReferenceAssetInputs(value: unknown, limit: number): RuntimeReferenceAssetInput[] {
  if (!Array.isArray(value)) return []
  const out: RuntimeReferenceAssetInput[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const url = typeof record.url === 'string' ? record.url.trim() : ''
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({
      url,
      assetId: typeof record.assetId === 'string' ? record.assetId.trim() || null : null,
      assetRefId: typeof record.assetRefId === 'string' ? record.assetRefId.trim() || null : null,
      role: typeof record.role === 'string' ? record.role.trim() || null : null,
      note: typeof record.note === 'string' ? record.note.trim() || null : null,
      name: typeof record.name === 'string' ? record.name.trim() || null : null,
    })
    if (out.length >= limit) break
  }
  return out
}

export function mergeReferenceAssetInputs(input: {
  assetInputs?: unknown
  dynamicEntries?: Array<{
    url: string
    label: string
    assetId?: string | null
    note?: string | null
    name?: string | null
  }>
  referenceImages: string[]
  limit?: number
}): RuntimeReferenceAssetInput[] {
  const limit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.max(1, Math.trunc(input.limit))
      : 12
  const orderedUrls = uniqueUrls(input.referenceImages, limit)
  if (!orderedUrls.length) return []

  const explicitByUrl = new Map(
    normalizeRuntimeReferenceAssetInputs(input.assetInputs, limit).map((item) => [item.url, item] as const),
  )
  const dynamicByUrl = new Map<string, RuntimeReferenceAssetInput>()
  for (const item of input.dynamicEntries ?? []) {
    const url = readRemoteUrl(item.url)
    if (!url) continue
    const label = String(item.label || '').trim()
    const name = String(item.name || '').trim()
    dynamicByUrl.set(url, {
      url,
      assetId: String(item.assetId || '').trim() || null,
      assetRefId: label || null,
      role: 'reference',
      note: String(item.note || '').trim() || null,
      name: name || label || null,
    })
  }

  const out: RuntimeReferenceAssetInput[] = []
  for (const url of orderedUrls) {
    const explicit = explicitByUrl.get(url)
    if (explicit) {
      out.push({
        ...explicit,
        role: explicit.role || 'reference',
      })
      continue
    }
    const dynamic = dynamicByUrl.get(url)
    if (!dynamic) continue
    out.push(dynamic)
    if (out.length >= limit) break
  }
  return out
}

export function buildReferenceAliasSlotBindings(input: {
  assetInputs?: unknown
  referenceImages: string[]
  limit?: number
}): ReferenceAliasSlotBinding[] {
  const limit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.max(1, Math.trunc(input.limit))
      : 12
  const aliasByUrl = collectAssetInputAliasByUrl(input.assetInputs)
  const out: ReferenceAliasSlotBinding[] = []
  for (let index = 0; index < input.referenceImages.length; index += 1) {
    const url = String(input.referenceImages[index] || '').trim()
    if (!url) continue
    const alias = aliasByUrl.get(url)
    if (!alias) continue
    out.push({
      slot: `图${index + 1}`,
      alias,
    })
    if (out.length >= limit) break
  }
  return out
}

const REFERENCE_ANCHOR_SUFFIX = '（仅作角色/风格参考锚点，禁止直接编辑或原样返回）'
const EDIT_TARGET_SUFFIX = '（待编辑目标图：在其基础上按指令修改，输出仍是这张图）'

const EDIT_TARGET_ROLES = new Set(['edit_target', 'edit', 'target'])

export function appendReferenceAliasSlotPrompt(input: {
  prompt: string
  assetInputs?: unknown
  referenceImages: string[]
  enabled: boolean
  /**
   * 当本次确实是「编辑现有图片」（修复/放大/局部改）而非纯生成时置 true。
   * 此时会显式点名待编辑目标图，防止模型把编辑指令误施加到风格参考图上
   * （见 assetReference.test.ts 复现用例）。
   */
  markEditTarget?: boolean
}): string {
  const basePrompt = String(input.prompt || '').trim()
  if (!input.enabled) return basePrompt
  const bindings = buildReferenceAliasSlotBindings({
    assetInputs: input.assetInputs,
    referenceImages: input.referenceImages,
  })
  if (bindings.length === 0) return basePrompt

  // 图像角色按确定性规则分类（禁猜）：
  // 1. role=style（全局画风锚定按约定固定排在最后的图位）→ 永远是画风锚点，绝不当编辑目标；
  // 2. role=edit_target/edit/target → 显式待编辑目标；
  // 3. 无别名的裸图 → 待编辑目标（编辑流程里的兜底约定）；
  // 4. 带别名的非 style 图默认是角色/资产锚点；但编辑流程下若完全没有裸图目标、
  //    且非 style 候选恰好只有一张，则该图就是待编辑目标（修复「编辑目标本身是注册资产时被误标为
  //    禁编辑锚点、用户指令被系统注入约束压死」的问题）。
  const roleByUrl = collectAssetInputRoleByUrl(input.assetInputs)
  const aliasSlots = new Set(bindings.map((item) => item.slot))
  const slotUrls: Array<{ slot: string; url: string }> = []
  for (let index = 0; index < input.referenceImages.length; index += 1) {
    const url = String(input.referenceImages[index] || '').trim()
    if (!url) continue
    slotUrls.push({ slot: `图${index + 1}`, url })
  }
  const styleSlots = new Set(
    slotUrls.filter((item) => roleByUrl.get(item.url) === 'style').map((item) => item.slot),
  )
  const explicitTargetSlots = slotUrls
    .filter((item) => EDIT_TARGET_ROLES.has(roleByUrl.get(item.url) || ''))
    .map((item) => item.slot)
  const bareTargetSlots = slotUrls
    .filter((item) => !aliasSlots.has(item.slot) && !styleSlots.has(item.slot))
    .map((item) => item.slot)
  let targetSlots = Array.from(new Set([...explicitTargetSlots, ...bareTargetSlots]))
  if (Boolean(input.markEditTarget) && targetSlots.length === 0) {
    const nonStyleAliased = slotUrls.filter(
      (item) => aliasSlots.has(item.slot) && !styleSlots.has(item.slot),
    )
    if (nonStyleAliased.length === 1) targetSlots = [nonStyleAliased[0].slot]
  }
  const targetSlotSet = new Set(targetSlots)
  const anchorBindings = bindings.filter((item) => !targetSlotSet.has(item.slot))
  // 只有真正存在参考锚点（画风锚定/角色/资产锚点）时才值得拼接映射块；
  // 纯编辑场景（所有图都是待编辑目标、无任何锚点）不注入任何系统文案，保持用户指令干净。
  if (anchorBindings.length === 0 && styleSlots.size === 0) return basePrompt
  const showRoleBlock = Boolean(input.markEditTarget) && targetSlots.length > 0

  const lines = [
    '非拼图参考图别名映射（图位与别名必须一一对应）：',
    ...bindings.map(
      (item) =>
        `- ${item.slot} -> @${item.alias}${
          showRoleBlock && targetSlotSet.has(item.slot) ? EDIT_TARGET_SUFFIX : REFERENCE_ANCHOR_SUFFIX
        }`,
    ),
  ]
  if (showRoleBlock) {
    lines.push(
      '图像角色说明：',
      `- 待编辑目标图：${targetSlots.join('、')}（在其基础上修改/修复/放大，输出仍是这张图，禁止改成参考锚点图的主体）`,
    )
    if (anchorBindings.length > 0) {
      lines.push(`- 参考锚点图：${anchorBindings.map((item) => item.slot).join('、')}`)
    }
    if (styleSlots.size > 0) {
      lines.push(
        `- 画风锚定图：${Array.from(styleSlots).join('、')}（仅锁定整体画风/色调/质感，禁止编辑、原样返回或把其主体带入画面）`,
      )
    }
  }
  lines.push(
    '约束：',
    '- 在最终执行提示词中使用 @别名 时，必须与上述图位映射保持一致，禁止互换。',
    '- 未出现在上述映射里的图位，禁止臆造新的 @别名。',
  )
  if (showRoleBlock) {
    lines.push('- 编辑/修复/放大只作用于「待编辑目标图」，参考锚点图仅用于风格与角色一致性，禁止直接编辑或原样输出参考锚点图。')
  }
  return [basePrompt, lines.join('\n')].filter(Boolean).join('\n\n')
}
