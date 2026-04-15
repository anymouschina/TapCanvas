import type { NanoComicShotItem } from './types'

export type WorkspaceAssetItem = {
  id: string
  title: string
  subtitle: string
  kindLabel: string
  statusLabel: string
  canGenerate?: boolean
  isGenerating?: boolean
  imageUrl?: string
  entityKey?: string
  note?: string
  chapterNo?: number | null
  isCurrentChapter?: boolean
}

export type AssetScopeFilter = 'all' | 'current'

export type PromptAssistState = {
  status: 'idle' | 'running' | 'success' | 'error'
  message: string
  updatedAtLabel: string
}

export type PromptMentionItem = {
  id: string
  mention: string
  title: string
  subtitle: string
  statusLabel: string
  imageUrl?: string
}

export const ASSET_PAGE_SIZE = 16
export const ASSET_PRELOAD_THRESHOLD_PX = 640
export const ASSET_ESTIMATED_CARD_HEIGHT_PX = 232
export const ASSET_GRID_COLUMNS = 2
export const EMPTY_PROMPT_DRAFT_KEY = '__empty__'

export function clipMultilineText(input: string, maxLength: number): string {
  const compact = input.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trim()}…`
}

function buildSeedanceReferenceMentions(shot: NanoComicShotItem): string[] {
  return [
    ...shot.castNames.map((item) => `@${item}`),
    shot.locationName ? `@${shot.locationName}` : '',
    ...shot.propNames.map((item) => `@${item}`),
  ].filter(Boolean)
}

export function buildSeedanceClipPrompt(shot: NanoComicShotItem): string {
  const references = buildSeedanceReferenceMentions(shot)
  const sections = [
    '当前章节镜头分镜提示词，保持角色、场景、道具和章节连续性，直接用于当前镜头出图。',
    '',
    `【镜头编号】${shot.sceneCode} / ${shot.shotCode}`,
    `【镜头目标】${shot.title || '推进当前剧情镜头'}`,
    `【镜头脚本】${shot.script || shot.note || '待补充镜头脚本'}`,
    `【调度要求】${shot.note || '突出主体动作、情绪变化与构图推进'}`,
    `【连续性】${shot.continuityHint || '承接上一片段的主体站位、视线和情绪状态。'}`,
  ]
  if (references.length > 0) {
    sections.push(`【参考】${references.join('，')}。优先将这些引用作为角色一致性、场景锚点和道具约束。`)
  }
  return sections.join('\n')
}

export function buildStoryboardStillPrompt(shot: NanoComicShotItem): string {
  const references = buildSeedanceReferenceMentions(shot)
  const sections = [
    '当前章节镜头分镜提示词，保持角色、场景、道具和章节连续性，直接用于当前镜头出图。',
    '',
    `【镜头编号】${shot.sceneCode} / ${shot.shotCode}`,
    `【镜头目标】${shot.title || '推进当前剧情镜头'}`,
    `【镜头脚本】${shot.script || shot.note || '待补充镜头脚本'}`,
    `【构图/动作】${shot.note || '突出主体动作、情绪变化与构图推进'}`,
    `【连续性】${shot.continuityHint || '承接上一镜头的主体站位、视线和情绪状态。'}`,
  ]
  if (references.length > 0) {
    sections.push(`【参考】${references.join('，')}。优先将这些引用作为角色一致性、场景锚点和道具约束。`)
  }
  return sections.join('\n')
}

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
