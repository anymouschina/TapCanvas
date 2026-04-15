import type { ChapterWorkbenchDto, ServerAssetDto, TaskAssetDto } from '../api/server'
import type { ProjectSetupProfile } from './projectSetupProfile'

export const PROJECT_SHOT_RENDER_ASSET_KIND = 'chapterShotRender'

export type ProjectShotRenderAssetData = {
  kind: typeof PROJECT_SHOT_RENDER_ASSET_KIND
  version: 1
  projectId: string
  chapterId: string
  shotId: string
  shotIndex: number
  shotTitle?: string
  shotSummary?: string
  prompt: string
  status: 'idle' | 'running' | 'succeeded' | 'failed'
  vendor?: string
  model?: string
  taskId?: string
  errorMessage?: string
  selectedImageUrl?: string
  selectedAssetIndex?: number
  images: Array<{
    url: string
    thumbnailUrl?: string | null
    createdAt: string
  }>
  updatedAt: string
}

export type ChapterBaseSceneAnchorVersionData = {
  imageUrl: string
  prompt: string
  chapterId: string
  chapterTitle: string
  sourceBookChapter: number | null
  anchorType: 'chapter_base_space'
  extractedFrom: 'chapterSpatialAnchor'
  sceneNames: string[]
  characterNames: string[]
  propNames: string[]
  styleHints: string[]
  semanticSpatialSummary?: string
  macroEnvironment?: string
  continuityConstraints?: string[]
  generatedAt: string
}

export function normalizeChapterBaseSceneAnchorVersionData(value: unknown): ChapterBaseSceneAnchorVersionData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const anchorType = typeof record.anchorType === 'string' ? record.anchorType.trim() : ''
  if (anchorType !== 'chapter_base_space') return null
  const imageUrl = typeof record.imageUrl === 'string' ? record.imageUrl.trim() : ''
  const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : ''
  const chapterId = typeof record.chapterId === 'string' ? record.chapterId.trim() : ''
  const chapterTitle = typeof record.chapterTitle === 'string' ? record.chapterTitle.trim() : ''
  const extractedFrom = typeof record.extractedFrom === 'string' ? record.extractedFrom.trim() : ''
  if (!imageUrl || !prompt || !chapterId || !chapterTitle || extractedFrom !== 'chapterSpatialAnchor') {
    return null
  }
  const toNames = (raw: unknown): string[] =>
    Array.isArray(raw)
      ? raw
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
      : []
  return {
    imageUrl,
    prompt,
    chapterId,
    chapterTitle,
    sourceBookChapter:
      typeof record.sourceBookChapter === 'number' && Number.isFinite(record.sourceBookChapter)
        ? record.sourceBookChapter
        : null,
    anchorType: 'chapter_base_space',
    extractedFrom: 'chapterSpatialAnchor',
    sceneNames: toNames(record.sceneNames),
    characterNames: toNames(record.characterNames),
    propNames: toNames(record.propNames),
    styleHints: toNames(record.styleHints),
    semanticSpatialSummary:
      typeof record.semanticSpatialSummary === 'string' && record.semanticSpatialSummary.trim()
        ? record.semanticSpatialSummary.trim()
        : undefined,
    macroEnvironment:
      typeof record.macroEnvironment === 'string' && record.macroEnvironment.trim()
        ? record.macroEnvironment.trim()
        : undefined,
    continuityConstraints: toNames(record.continuityConstraints),
    generatedAt:
      typeof record.generatedAt === 'string' && record.generatedAt.trim()
        ? record.generatedAt.trim()
        : new Date(0).toISOString(),
  }
}

export function buildChapterBaseSceneAnchorName(input: { chapterTitle: string }): string {
  const chapterTitle = String(input.chapterTitle || '').trim() || '当前章节'
  return `${chapterTitle} / 基础空间锚点`
}

export function buildChapterBaseSceneAnchorPrompt(input: {
  chapterTitle: string
  chapterSummary?: string | null
  chapterConflict?: string | null
  chapterContent?: string | null
  sceneNames?: string[]
  characterNames?: string[]
  propNames?: string[]
  artStyleName?: string | null
  styleDirectives?: string | null
  directorManual?: string | null
  styleBible?: {
    styleName?: string
    visualDirectives?: string[]
    consistencyRules?: string[]
  } | null
}): string {
  const chapterTitle = String(input.chapterTitle || '').trim() || '当前章节'
  const chapterSummary = String(input.chapterSummary || '').trim()
  const chapterConflict = String(input.chapterConflict || '').trim()
  const chapterContent = String(input.chapterContent || '').replace(/\s+/g, ' ').trim().slice(0, 220)
  const sceneNames = (input.sceneNames || []).filter(Boolean).slice(0, 6)
  const characterNames = (input.characterNames || []).filter(Boolean).slice(0, 6)
  const propNames = (input.propNames || []).filter(Boolean).slice(0, 6)
  const visualDirectives = (input.styleBible?.visualDirectives || []).filter(Boolean).slice(0, 4)
  const consistencyRules = (input.styleBible?.consistencyRules || []).filter(Boolean).slice(0, 4)
  const lines = [
    '为漫剧章节生成一张“基础空间锚点图”，它是后续镜头复用的稳定场景参考，不是剧情海报，也不是单一事件瞬间。',
    `章节：${chapterTitle}`,
    chapterSummary ? `章节摘要：${chapterSummary}` : '',
    chapterConflict ? `核心冲突：${chapterConflict}` : '',
    sceneNames.length ? `场景线索：${sceneNames.join('、')}` : '',
    characterNames.length ? `相关人物：${characterNames.join('、')}` : '',
    propNames.length ? `稳定道具：${propNames.join('、')}` : '',
    input.artStyleName ? `画风：${input.artStyleName}` : '',
    input.styleDirectives ? `视觉规则：${input.styleDirectives}` : '',
    input.directorManual ? `导演手册：${input.directorManual}` : '',
    input.styleBible?.styleName ? `风格圣经：${input.styleBible.styleName}` : '',
    visualDirectives.length ? `风格视觉规则：${visualDirectives.join('；')}` : '',
    consistencyRules.length ? `风格一致性规则：${consistencyRules.join('；')}` : '',
    chapterContent ? `原文片段：${chapterContent}` : '',
    '目标：固定本章主要空间的建筑布局、前中后景层次、出入口、道路/桌案/墙体/器物等稳定陈设、光线方向、时间气候与整体氛围。',
    '构图要求：空间关系清楚，镜头语言克制，适合后续多个镜头在同一空间内反复取景。',
    '禁止：强剧情动作、爆炸瞬间、人物对打、海报式拼贴、标题字、书页可读文字、夸张特写、漂移的空间结构。',
    '允许少量人物作为空间尺度参照，但不要让人物成为画面主体；优先表现环境本身的稳定结构。',
  ].filter(Boolean)
  return lines.join('\n')
}

export function normalizeProjectShotRenderAssetData(value: unknown): ProjectShotRenderAssetData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const kind = typeof record.kind === 'string' ? record.kind.trim() : ''
  if (kind !== PROJECT_SHOT_RENDER_ASSET_KIND) return null
  const imagesRaw = Array.isArray(record.images) ? record.images : []
  const images = imagesRaw
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const imageRecord = item as Record<string, unknown>
      const url = typeof imageRecord.url === 'string' ? imageRecord.url.trim() : ''
      if (!url) return null
      return {
        url,
        thumbnailUrl:
          typeof imageRecord.thumbnailUrl === 'string' && imageRecord.thumbnailUrl.trim()
            ? imageRecord.thumbnailUrl.trim()
            : null,
        createdAt:
          typeof imageRecord.createdAt === 'string' && imageRecord.createdAt.trim()
            ? imageRecord.createdAt.trim()
            : new Date(0).toISOString(),
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
  const statusRaw = typeof record.status === 'string' ? record.status.trim() : ''
  const status =
    statusRaw === 'running' || statusRaw === 'succeeded' || statusRaw === 'failed'
      ? statusRaw
      : 'idle'
  return {
    kind: PROJECT_SHOT_RENDER_ASSET_KIND,
    version: 1,
    projectId: typeof record.projectId === 'string' ? record.projectId : '',
    chapterId: typeof record.chapterId === 'string' ? record.chapterId : '',
    shotId: typeof record.shotId === 'string' ? record.shotId : '',
    shotIndex:
      typeof record.shotIndex === 'number' && Number.isFinite(record.shotIndex)
        ? Math.max(0, Math.trunc(record.shotIndex))
        : 0,
    shotTitle: typeof record.shotTitle === 'string' && record.shotTitle.trim() ? record.shotTitle : undefined,
    shotSummary: typeof record.shotSummary === 'string' && record.shotSummary.trim() ? record.shotSummary : undefined,
    prompt: typeof record.prompt === 'string' ? record.prompt : '',
    status,
    vendor: typeof record.vendor === 'string' && record.vendor.trim() ? record.vendor.trim() : undefined,
    model: typeof record.model === 'string' && record.model.trim() ? record.model.trim() : undefined,
    taskId: typeof record.taskId === 'string' && record.taskId.trim() ? record.taskId.trim() : undefined,
    errorMessage:
      typeof record.errorMessage === 'string' && record.errorMessage.trim()
        ? record.errorMessage.trim()
        : undefined,
    selectedImageUrl:
      typeof record.selectedImageUrl === 'string' && record.selectedImageUrl.trim()
        ? record.selectedImageUrl.trim()
        : undefined,
    selectedAssetIndex:
      typeof record.selectedAssetIndex === 'number' && Number.isFinite(record.selectedAssetIndex)
        ? Math.max(0, Math.trunc(record.selectedAssetIndex))
        : undefined,
    images,
    updatedAt:
      typeof record.updatedAt === 'string' && record.updatedAt.trim()
        ? record.updatedAt.trim()
        : new Date(0).toISOString(),
  }
}

export function buildDefaultShotPrompt(input: {
  workbench: ChapterWorkbenchDto
  shotId: string
  projectSetup: ProjectSetupProfile
  sourceChapterDetail?: {
    title?: string
    summary?: string
    coreConflict?: string
    content?: string
    characters?: Array<{ name?: string }>
    scenes?: Array<{ name?: string }>
    locations?: Array<{ name?: string }>
    props?: Array<{ name?: string }>
  } | null
  sharedMemory?: {
    characterAssets?: Array<{ name: string }>
    sceneAssets?: Array<{
      name: string
      anchorType?: 'chapter_base_space' | 'shot_result_scene' | 'generic_scene'
      semanticSpatialSummary?: string
      macroEnvironment?: string
      continuityConstraints?: string[]
    }>
    propAssets?: Array<{ name: string }>
    styleAssets?: Array<{ name: string }>
  } | null
  styleBible?: {
    styleName?: string
    visualDirectives?: string[]
    consistencyRules?: string[]
  } | null
}): string {
  const shot = input.workbench.shots.find((item) => item.id === input.shotId) || null
  if (!shot) return ''
  const chapter = input.workbench.chapter
  const detail = input.sourceChapterDetail
  const characterNames = (detail?.characters || []).map((item) => item?.name || '').filter(Boolean).slice(0, 8)
  const sceneNames = ((detail?.scenes || detail?.locations || []) as Array<{ name?: string }>)
    .map((item) => item?.name || '')
    .filter(Boolean)
    .slice(0, 6)
  const propNames = (detail?.props || []).map((item) => item?.name || '').filter(Boolean).slice(0, 6)
  const sharedCharacterNames = (input.sharedMemory?.characterAssets || []).map((item) => item.name).filter(Boolean).slice(0, 6)
  const chapterBaseSceneAnchorNames = (input.sharedMemory?.sceneAssets || [])
    .filter((item) => item.anchorType === 'chapter_base_space')
    .map((item) => item.name)
    .filter(Boolean)
    .slice(0, 3)
  const chapterBaseSceneAnchorSummaries = (input.sharedMemory?.sceneAssets || [])
    .filter((item) => item.anchorType === 'chapter_base_space')
    .map((item) => item.semanticSpatialSummary || item.macroEnvironment || '')
    .filter(Boolean)
    .slice(0, 2)
  const chapterBaseContinuityConstraints = (input.sharedMemory?.sceneAssets || [])
    .filter((item) => item.anchorType === 'chapter_base_space')
    .flatMap((item) => item.continuityConstraints || [])
    .filter(Boolean)
    .slice(0, 4)
  const sharedSceneNames = (input.sharedMemory?.sceneAssets || []).map((item) => item.name).filter(Boolean).slice(0, 4)
  const sharedPropNames = (input.sharedMemory?.propAssets || []).map((item) => item.name).filter(Boolean).slice(0, 6)
  const sharedStyleNames = (input.sharedMemory?.styleAssets || []).map((item) => item.name).filter(Boolean).slice(0, 4)
  const styleBibleVisualRules = (input.styleBible?.visualDirectives || []).filter(Boolean).slice(0, 4)
  const styleBibleConsistencyRules = (input.styleBible?.consistencyRules || []).filter(Boolean).slice(0, 4)
  const contentPreview = String(detail?.content || '').replace(/\s+/g, ' ').trim().slice(0, 280)
  const lines = [
    `为漫剧项目生成单张镜头概念图，重点表现 Shot ${shot.shotIndex + 1}。`,
    `项目：${input.workbench.project.name}`,
    `章节：${chapter.title || `Chapter ${chapter.index}`}`,
    shot.title ? `镜头标题：${shot.title}` : '',
    shot.summary ? `镜头摘要：${shot.summary}` : '',
    input.projectSetup.intro ? `项目简介：${input.projectSetup.intro}` : '',
    input.projectSetup.artStyleName ? `画风：${input.projectSetup.artStyleName}` : '',
    input.projectSetup.styleDirectives ? `视觉规则：${input.projectSetup.styleDirectives}` : '',
    input.projectSetup.directorManual ? `导演手册：${input.projectSetup.directorManual}` : '',
    input.styleBible?.styleName ? `风格圣经：${input.styleBible.styleName}` : '',
    styleBibleVisualRules.length ? `风格圣经视觉规则：${styleBibleVisualRules.join('；')}` : '',
    styleBibleConsistencyRules.length ? `风格圣经一致性规则：${styleBibleConsistencyRules.join('；')}` : '',
    detail?.title ? `原文章节：${detail.title}` : '',
    detail?.summary || detail?.coreConflict ? `章节冲突：${detail?.summary || detail?.coreConflict}` : '',
    characterNames.length ? `涉及人物：${characterNames.join('、')}` : '',
    sceneNames.length ? `场景线索：${sceneNames.join('、')}` : '',
    propNames.length ? `道具线索：${propNames.join('、')}` : '',
    sharedCharacterNames.length ? `优先复用角色资产：${sharedCharacterNames.join('、')}` : '',
    chapterBaseSceneAnchorNames.length ? `章节基础空间锚点：${chapterBaseSceneAnchorNames.join('、')}` : '',
    chapterBaseSceneAnchorSummaries.length ? `章节空间摘要：${chapterBaseSceneAnchorSummaries.join('；')}` : '',
    chapterBaseContinuityConstraints.length ? `章节连续性约束：${chapterBaseContinuityConstraints.join('；')}` : '',
    sharedSceneNames.length ? `优先复用场景资产：${sharedSceneNames.join('、')}` : '',
    sharedPropNames.length ? `优先复用道具资产：${sharedPropNames.join('、')}` : '',
    sharedStyleNames.length ? `优先继承风格锚点：${sharedStyleNames.join('、')}` : '',
    contentPreview ? `原文片段：${contentPreview}` : '',
    '执行原则：这是同一章节空间里的一个具体镜头，不是重新设计新场景；若已提供章节基础空间锚点，必须严格继承其建筑结构、道路朝向、门窗位置、主要陈设、光线方向与时间气候。',
    '必须同时继承参考锚点图的宏观环境类型，例如乡村/城郊/老宅/山地/田野/巷道等，不要把低层开阔环境改造成高密城市楼群，也不要把室内外关系改写。',
    '镜头变化只允许落在本镜头真正需要强调的人物、动作或局部道具上，环境部分保持写实、克制、连续。',
    '要求：主体明确，构图可直接用于后续分镜或视频首帧，保证角色一致性、空间关系清楚、情绪集中，避免过度概念化、海报感或宣传画气质。',
    '严格禁止：任何清晰可读的招牌字、横幅字、书页字、标题字、UI 字、水印；若场景中天然存在文字元素，也必须模糊成不可读。',
    '不要出现拼贴感、错误肢体、额外建筑替换、突兀新机位，或与章节空间锚点冲突的建筑/机位。',
  ].filter(Boolean)
  return lines.join('\n')
}

export function buildShotRenderAssetName(input: {
  shotIndex: number
  shotTitle?: string
}): string {
  const label = input.shotTitle && input.shotTitle.trim() ? input.shotTitle.trim() : `Shot ${input.shotIndex + 1}`
  return `镜头概念图 · ${label}`
}

export function toShotRenderAssetPayload(input: {
  existing?: ProjectShotRenderAssetData | null
  projectId: string
  chapterId: string
  shotId: string
  shotIndex: number
  shotTitle?: string
  shotSummary?: string
  prompt: string
  status: ProjectShotRenderAssetData['status']
  vendor?: string
  model?: string
  taskId?: string
  errorMessage?: string
  images?: TaskAssetDto[]
  selectedAssetIndex?: number
}): ProjectShotRenderAssetData {
  const nowIso = new Date().toISOString()
  const nextImages = input.images && input.images.length > 0
    ? input.images
      .filter((item) => item.type === 'image' && typeof item.url === 'string' && item.url.trim())
      .map((item) => ({
        url: item.url.trim(),
        thumbnailUrl: typeof item.thumbnailUrl === 'string' && item.thumbnailUrl.trim() ? item.thumbnailUrl.trim() : null,
        createdAt: nowIso,
      }))
    : input.existing?.images || []
  const selectedIndex =
    typeof input.selectedAssetIndex === 'number' && Number.isFinite(input.selectedAssetIndex)
      ? Math.max(0, Math.min(nextImages.length - 1, Math.trunc(input.selectedAssetIndex)))
      : input.existing?.selectedAssetIndex ?? 0
  return {
    kind: PROJECT_SHOT_RENDER_ASSET_KIND,
    version: 1,
    projectId: input.projectId,
    chapterId: input.chapterId,
    shotId: input.shotId,
    shotIndex: input.shotIndex,
    shotTitle: input.shotTitle,
    shotSummary: input.shotSummary,
    prompt: input.prompt,
    status: input.status,
    vendor: input.vendor || input.existing?.vendor,
    model: input.model || input.existing?.model,
    taskId: input.taskId || input.existing?.taskId,
    errorMessage: input.errorMessage,
    selectedAssetIndex: nextImages.length > 0 ? selectedIndex : undefined,
    selectedImageUrl: nextImages[selectedIndex]?.url || nextImages[0]?.url || undefined,
    images: nextImages,
    updatedAt: nowIso,
  }
}

export function pickShotRenderAsset(
  items: readonly ServerAssetDto[],
  shotId: string,
): { asset: ServerAssetDto; data: ProjectShotRenderAssetData } | null {
  const matched = items
    .map((asset) => {
      const data = normalizeProjectShotRenderAssetData(asset.data)
      if (!data || data.shotId !== shotId) return null
      return { asset, data }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => Date.parse(right.data.updatedAt) - Date.parse(left.data.updatedAt))
  return matched[0] || null
}

function pickDemoCanvasSize(aspectRatio?: string): { width: number; height: number } {
  if (aspectRatio === '16:9') return { width: 1600, height: 900 }
  if (aspectRatio === '1:1') return { width: 1200, height: 1200 }
  if (aspectRatio === '4:3') return { width: 1440, height: 1080 }
  return { width: 900, height: 1600 }
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function wrapDemoText(value: string, limit: number): string[] {
  const compact = String(value || '').replace(/\s+/g, ' ').trim()
  if (!compact) return []
  const lines: string[] = []
  for (let index = 0; index < compact.length; index += limit) {
    lines.push(compact.slice(index, index + limit))
    if (lines.length >= 3) break
  }
  return lines
}

export function buildLocalDemoShotRenderAssets(input: {
  chapterTitle: string
  shotTitle?: string
  shotSummary?: string
  artStyleName?: string
  aspectRatio?: string
}): TaskAssetDto[] {
  const { width, height } = pickDemoCanvasSize(input.aspectRatio)
  const chapterTitle = String(input.chapterTitle || '当前章节').trim() || '当前章节'
  const shotTitle = String(input.shotTitle || '当前镜头').trim() || '当前镜头'
  const shotSummary = String(input.shotSummary || '本地演示模式下生成的镜头结果，用于验证链路与资产沉淀。').trim()
  const artStyleName = String(input.artStyleName || '未指定画风').trim() || '未指定画风'
  const palette = [
    { bgA: '#0b132b', bgB: '#1c2541', accent: '#5bc0be', accentSoft: 'rgba(91,192,190,0.18)', panel: 'rgba(255,255,255,0.10)' },
    { bgA: '#1b1f3b', bgB: '#53354a', accent: '#f08a5d', accentSoft: 'rgba(240,138,93,0.18)', panel: 'rgba(255,255,255,0.10)' },
    { bgA: '#16213e', bgB: '#0f3460', accent: '#e94560', accentSoft: 'rgba(233,69,96,0.18)', panel: 'rgba(255,255,255,0.10)' },
  ]
  const summaryLines = wrapDemoText(shotSummary, 18)
  return palette.map((item, index) => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <defs>
          <linearGradient id="bg-${index}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${item.bgA}" />
            <stop offset="100%" stop-color="${item.bgB}" />
          </linearGradient>
          <linearGradient id="beam-${index}" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="${item.accent}" stop-opacity="0.85" />
            <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
          </linearGradient>
        </defs>
        <rect width="${width}" height="${height}" rx="44" fill="url(#bg-${index})" />
        <circle cx="${Math.round(width * 0.76)}" cy="${Math.round(height * 0.22)}" r="${Math.round(Math.min(width, height) * 0.16)}" fill="${item.accentSoft}" />
        <rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.11)}" width="${Math.round(width * 0.84)}" height="${Math.round(height * 0.78)}" rx="34" fill="${item.panel}" stroke="rgba(255,255,255,0.18)" />
        <rect x="${Math.round(width * 0.16)}" y="${Math.round(height * 0.24)}" width="${Math.round(width * 0.48)}" height="${Math.round(height * 0.36)}" rx="28" fill="rgba(255,255,255,0.08)" />
        <path d="M ${Math.round(width * 0.18)} ${Math.round(height * 0.57)} Q ${Math.round(width * 0.35)} ${Math.round(height * 0.46)} ${Math.round(width * 0.54)} ${Math.round(height * 0.56)}" stroke="${item.accent}" stroke-width="14" fill="none" stroke-linecap="round" />
        <path d="M ${Math.round(width * 0.58)} ${Math.round(height * 0.34)} Q ${Math.round(width * 0.68)} ${Math.round(height * 0.24)} ${Math.round(width * 0.82)} ${Math.round(height * 0.30)}" stroke="rgba(255,255,255,0.62)" stroke-width="10" fill="none" stroke-linecap="round" />
        <rect x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.14)}" width="${Math.round(width * 0.58)}" height="10" rx="5" fill="url(#beam-${index})" />
        <text x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.70)}" fill="#ffffff" font-size="${Math.round(height * 0.035)}" font-family="Arial, PingFang SC, sans-serif" font-weight="700">${escapeSvgText(chapterTitle)}</text>
        <text x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.755)}" fill="#ffffff" font-size="${Math.round(height * 0.046)}" font-family="Arial, PingFang SC, sans-serif" font-weight="700">${escapeSvgText(shotTitle)}</text>
        <text x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.81)}" fill="${item.accent}" font-size="${Math.round(height * 0.023)}" font-family="Arial, PingFang SC, sans-serif" font-weight="700">LOCAL DEMO FRAME · ${escapeSvgText(artStyleName)}</text>
        ${summaryLines.map((line, lineIndex) => `<text x="${Math.round(width * 0.12)}" y="${Math.round(height * (0.86 + lineIndex * 0.035))}" fill="rgba(255,255,255,0.82)" font-size="${Math.round(height * 0.022)}" font-family="Arial, PingFang SC, sans-serif">${escapeSvgText(line)}</text>`).join('')}
      </svg>
    `.trim()
    const dataUrl = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
    return {
      type: 'image' as const,
      url: dataUrl,
      thumbnailUrl: dataUrl,
      assetName: `${shotTitle} · Demo ${index + 1}`,
    }
  })
}
