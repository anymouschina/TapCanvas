import type { ShotTableColumn, ShotTableColumnScope } from './types'

export const SHOT_TABLE_TEXT_REVIEW_MODE = 'text_storyboard' as const
export const STORYBOARD_EXPERT_SKILL_KEY = 'tapcanvas-storyboard-expert' as const

export type ShotTableTextReviewSourceKind = 'script' | 'video_evidence'

export type ShotTableTextReviewContract = {
  version: 1
  reviewMode: typeof SHOT_TABLE_TEXT_REVIEW_MODE
  skillKey: typeof STORYBOARD_EXPERT_SKILL_KEY
  sourceKind: ShotTableTextReviewSourceKind
  columns: ShotTableColumn[]
  sourceLocks: {
    plot: 'locked'
    dialogueTextAndOrder: 'locked'
    existingShotStructure: 'preserve_when_present'
    observedVideoCutsAndTiming: 'locked' | 'not_applicable'
  }
  pacingLimits: {
    targetBeatSeconds: 15
    maximumTimelineSegmentSeconds: 3
    maximumChineseDialogueCharactersPerSegment: 8
    maximumEnglishWordsPerSecond: 3
  }
  delivery: {
    music: 'disabled'
    subtitles: 'disabled'
  }
}

export type ShotTableTextReviewContractResult =
  | { ok: true; contract: ShotTableTextReviewContract }
  | { ok: false; issues: string[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const readExactString = <T extends string>(value: unknown, expected: T): value is T =>
  value === expected

const readColumnScope = (value: unknown): ShotTableColumnScope | null =>
  value === 'shot' || value === 'timeline' ? value : null

const normalizeColumns = (value: unknown): { columns: ShotTableColumn[]; issues: string[] } => {
  if (!Array.isArray(value) || value.length === 0) {
    return { columns: [], issues: ['columns 必须是非空数组'] }
  }
  const columns: ShotTableColumn[] = []
  const issues: string[] = []
  const keys = new Set<string>()
  const labels = new Set<string>()
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      issues.push(`columns[${index}] 必须是对象`)
      return
    }
    const key = typeof entry.key === 'string' ? entry.key.trim() : ''
    const label = typeof entry.label === 'string' ? entry.label.trim() : ''
    const scope = readColumnScope(entry.scope)
    if (!key) issues.push(`columns[${index}].key 不能为空`)
    if (!label) issues.push(`columns[${index}].label 不能为空`)
    if (!scope) issues.push(`columns[${index}].scope 必须是 shot 或 timeline`)
    if (key && keys.has(key)) issues.push(`columns 存在重复 key：${key}`)
    if (label && labels.has(label)) issues.push(`columns 存在重复 label：${label}`)
    if (!key || !label || !scope || keys.has(key) || labels.has(label)) return
    keys.add(key)
    labels.add(label)
    columns.push({ key, label, scope })
  })
  if (!columns.some((column) => column.scope === 'timeline' && column.label === '时间段')) {
    issues.push('columns 缺少 timeline 范围的“时间段”列')
  }
  return { columns, issues }
}

export const buildShotTableTextReviewContract = (
  sourceKind: ShotTableTextReviewSourceKind,
  columns: readonly ShotTableColumn[],
): ShotTableTextReviewContract => ({
  version: 1,
  reviewMode: SHOT_TABLE_TEXT_REVIEW_MODE,
  skillKey: STORYBOARD_EXPERT_SKILL_KEY,
  sourceKind,
  columns: columns.map((column) => ({ ...column })),
  sourceLocks: {
    plot: 'locked',
    dialogueTextAndOrder: 'locked',
    existingShotStructure: 'preserve_when_present',
    observedVideoCutsAndTiming: sourceKind === 'video_evidence' ? 'locked' : 'not_applicable',
  },
  pacingLimits: {
    targetBeatSeconds: 15,
    maximumTimelineSegmentSeconds: 3,
    maximumChineseDialogueCharactersPerSegment: 8,
    maximumEnglishWordsPerSecond: 3,
  },
  delivery: {
    music: 'disabled',
    subtitles: 'disabled',
  },
})

export const normalizeShotTableTextReviewContract = (
  value: unknown,
): ShotTableTextReviewContractResult => {
  if (!isRecord(value)) return { ok: false, issues: ['reviewContract 必须是对象'] }
  const issues: string[] = []
  if (value.version !== 1) issues.push('reviewContract.version 必须为 1')
  if (!readExactString(value.reviewMode, SHOT_TABLE_TEXT_REVIEW_MODE)) {
    issues.push(`reviewContract.reviewMode 必须为 ${SHOT_TABLE_TEXT_REVIEW_MODE}`)
  }
  if (!readExactString(value.skillKey, STORYBOARD_EXPERT_SKILL_KEY)) {
    issues.push(`reviewContract.skillKey 必须为 ${STORYBOARD_EXPERT_SKILL_KEY}`)
  }
  const sourceKind = value.sourceKind === 'script' || value.sourceKind === 'video_evidence'
    ? value.sourceKind
    : null
  if (!sourceKind) issues.push('reviewContract.sourceKind 必须为 script 或 video_evidence')

  const normalizedColumns = normalizeColumns(value.columns)
  issues.push(...normalizedColumns.issues)

  const sourceLocks = isRecord(value.sourceLocks) ? value.sourceLocks : null
  if (!sourceLocks) {
    issues.push('reviewContract.sourceLocks 必须是对象')
  } else {
    if (sourceLocks.plot !== 'locked') issues.push('reviewContract.sourceLocks.plot 必须为 locked')
    if (sourceLocks.dialogueTextAndOrder !== 'locked') {
      issues.push('reviewContract.sourceLocks.dialogueTextAndOrder 必须为 locked')
    }
    if (sourceLocks.existingShotStructure !== 'preserve_when_present') {
      issues.push('reviewContract.sourceLocks.existingShotStructure 必须为 preserve_when_present')
    }
    const expectedObservedLock = sourceKind === 'video_evidence' ? 'locked' : 'not_applicable'
    if (sourceLocks.observedVideoCutsAndTiming !== expectedObservedLock) {
      issues.push(`reviewContract.sourceLocks.observedVideoCutsAndTiming 必须为 ${expectedObservedLock}`)
    }
  }

  const pacingLimits = isRecord(value.pacingLimits) ? value.pacingLimits : null
  if (!pacingLimits) {
    issues.push('reviewContract.pacingLimits 必须是对象')
  } else {
    if (pacingLimits.targetBeatSeconds !== 15) {
      issues.push('reviewContract.pacingLimits.targetBeatSeconds 必须为 15')
    }
    if (pacingLimits.maximumTimelineSegmentSeconds !== 3) {
      issues.push('reviewContract.pacingLimits.maximumTimelineSegmentSeconds 必须为 3')
    }
    if (pacingLimits.maximumChineseDialogueCharactersPerSegment !== 8) {
      issues.push('reviewContract.pacingLimits.maximumChineseDialogueCharactersPerSegment 必须为 8')
    }
    if (pacingLimits.maximumEnglishWordsPerSecond !== 3) {
      issues.push('reviewContract.pacingLimits.maximumEnglishWordsPerSecond 必须为 3')
    }
  }

  const delivery = isRecord(value.delivery) ? value.delivery : null
  if (!delivery) {
    issues.push('reviewContract.delivery 必须是对象')
  } else {
    if (delivery.music !== 'disabled') issues.push('reviewContract.delivery.music 必须为 disabled')
    if (delivery.subtitles !== 'disabled') issues.push('reviewContract.delivery.subtitles 必须为 disabled')
  }

  if (issues.length > 0 || !sourceKind) return { ok: false, issues }
  return {
    ok: true,
    contract: buildShotTableTextReviewContract(sourceKind, normalizedColumns.columns),
  }
}
