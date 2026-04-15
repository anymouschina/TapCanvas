import type {
  ProjectBookIndexDto,
  ProjectBookListItemDto,
  ProjectChatArtifactSessionDto,
  ProjectBookStoryboardHistoryDto,
  ProjectRoleCardAssetDto,
} from '../../api/server'
import type {
  NanoComicActivityItem,
  NanoComicConversationArtifactItem,
  NanoComicEpisodeItem,
  NanoComicMetricCard,
  NanoComicReviewItem,
  NanoComicRiskItem,
  NanoComicShotItem,
} from './types'

type ProjectBookRoleCardDto = NonNullable<NonNullable<ProjectBookIndexDto['assets']>['roleCards']>[number]

function formatCountValue(value: number): string {
  return String(Math.max(0, Math.trunc(value)))
}

function formatTimeLabel(input?: string | null): string {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) return '刚刚'
  const ts = Date.parse(raw)
  if (!Number.isFinite(ts)) return raw
  const diffMs = Date.now() - ts
  const diffMinutes = Math.max(0, Math.trunc(diffMs / 60000))
  if (diffMinutes < 1) return '刚刚'
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`
  const diffHours = Math.trunc(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} 小时前`
  const diffDays = Math.trunc(diffHours / 24)
  if (diffDays < 7) return `${diffDays} 天前`
  return raw.slice(0, 10)
}

function trimText(input: string, maxLength: number): string {
  const raw = input.trim()
  if (raw.length <= maxLength) return raw
  return `${raw.slice(0, Math.max(0, maxLength - 1)).trim()}…`
}

function getConversationLaneLabel(lane: string): string {
  if (lane === 'scene') return '场景对话'
  if (lane === 'single_video') return '单视频对话'
  return '通用对话'
}

function getConversationSkillLabel(skillId: string): string {
  const raw = String(skillId || '').trim()
  if (!raw || raw === 'default') return '默认技能'
  return raw
}

function formatConversationAssetCountLabel(assetCount: number): string {
  const normalized = Math.max(0, Math.trunc(assetCount))
  return normalized > 0 ? `${normalized} 个产物` : '无产物'
}

function buildChapterCode(chapterNo: number): string {
  return `CH${String(Math.max(1, Math.trunc(chapterNo))).padStart(2, '0')}`
}

function buildShotCode(shotNo: number): string {
  return String(Math.max(1, Math.trunc(shotNo))).padStart(3, '0')
}

function inferProductionStatus(item: ProjectBookStoryboardHistoryDto['items'][number]): string {
  const candidateCount = Array.isArray(item.imageCandidates) ? item.imageCandidates.length : 0
  if (candidateCount > 1) return '候选已出'
  if (String(item.selectedImageUrl || item.imageUrl || '').trim()) return '已产出'
  return '待生成'
}

function inferReviewStatus(item: ProjectBookStoryboardHistoryDto['items'][number]): string {
  if (String(item.selectedImageUrl || '').trim() || String(item.selectedCandidateId || '').trim()) return '待审核'
  if (Array.isArray(item.imageCandidates) && item.imageCandidates.length > 0) return '待选择'
  return '未提交'
}

function inferRiskLabel(item: ProjectBookStoryboardHistoryDto['items'][number]): string {
  if (!Array.isArray(item.roleCardAnchors) || item.roleCardAnchors.length === 0) return '缺少角色锚点'
  if (!Array.isArray(item.references) || item.references.length === 0) return '缺少参考图'
  return '可提交审核'
}

function getChapterMeta(
  index: ProjectBookIndexDto | null,
  chapterNo: number | undefined,
): ProjectBookIndexDto['chapters'][number] | null {
  if (!index || !Array.isArray(index.chapters) || !Number.isFinite(Number(chapterNo))) return null
  const normalizedChapter = Math.max(1, Math.trunc(Number(chapterNo)))
  return index.chapters.find((chapter) => chapter.chapter === normalizedChapter) ?? null
}

function buildPromptPreviewMaps(input: {
  index: ProjectBookIndexDto | null
  chapterNo: number | null
}): {
  promptByShotNo: Map<number, string>
  previewByShotNo: Map<number, string>
} {
  const promptByShotNo = new Map<number, string>()
  const previewByShotNo = new Map<number, string>()
  const storyboardChunks = Array.isArray(input.index?.assets?.storyboardChunks)
    ? input.index.assets.storyboardChunks
    : []

  for (const chunk of storyboardChunks) {
    const chunkChapterNo = Number(chunk.chapter)
    if (input.chapterNo && Number.isFinite(chunkChapterNo) && Math.trunc(chunkChapterNo) !== input.chapterNo) continue
    const prompts = Array.isArray(chunk.shotPrompts) ? chunk.shotPrompts : []
    const frameUrls = Array.isArray(chunk.frameUrls) ? chunk.frameUrls : []
    const shotStart = Math.max(1, Math.trunc(Number(chunk.shotStart || 1)))
    for (let index = 0; index < prompts.length; index += 1) {
      const shotNo = shotStart + index
      const promptText = String(prompts[index] || '').trim()
      if (promptText && !promptByShotNo.has(shotNo)) {
        promptByShotNo.set(shotNo, promptText)
      }
      const frameUrl = String(frameUrls[index] || '').trim()
      if (frameUrl && !previewByShotNo.has(shotNo)) {
        previewByShotNo.set(shotNo, frameUrl)
      }
    }
  }

  const storyboardPlans = Array.isArray(input.index?.assets?.storyboardPlans)
    ? input.index.assets.storyboardPlans
    : []
  const latestPlan = storyboardPlans
    .filter((plan) => {
      const chapter = Number(plan.chapter)
      return !input.chapterNo || (Number.isFinite(chapter) && Math.trunc(chapter) === input.chapterNo)
    })
    .sort((left, right) => Date.parse(String(right.updatedAt || '')) - Date.parse(String(left.updatedAt || '')))[0] ?? null

  if (latestPlan) {
    const prompts = Array.isArray(latestPlan.shotPrompts) ? latestPlan.shotPrompts : []
    for (const [index, rawPrompt] of prompts.entries()) {
      const shotNo = index + 1
      const promptText = String(rawPrompt || '').trim()
      if (!promptText || promptByShotNo.has(shotNo)) continue
      promptByShotNo.set(shotNo, promptText)
    }
  }

  return {
    promptByShotNo,
    previewByShotNo,
  }
}

export function buildOverviewMetrics(input: {
  books: readonly ProjectBookListItemDto[]
  index: ProjectBookIndexDto | null
  roleCards: readonly ProjectRoleCardAssetDto[]
  history: ProjectBookStoryboardHistoryDto | null
}): NanoComicMetricCard[] {
  const chapterCount = input.index?.chapterCount ?? 0
  const shotCount = Array.isArray(input.history?.items) ? input.history.items.length : 0
  const pendingRoleCards = input.roleCards.filter((item) => !String(item.data.confirmedAt || '').trim()).length
  const nextTask = input.history?.progress?.next

  return [
    {
      id: 'books',
      title: '源书数量',
      value: formatCountValue(input.books.length),
      detail: input.books.length > 0 ? '当前项目已导入源书' : '当前项目尚未导入源书',
      tone: 'sky',
    },
    {
      id: 'chapters',
      title: '章节数',
      value: formatCountValue(chapterCount),
      detail: chapterCount > 0 ? '来自当前选中源书' : '等待章节解析',
      tone: 'amber',
    },
    {
      id: 'role-cards',
      title: '角色卡',
      value: formatCountValue(input.roleCards.length),
      detail: pendingRoleCards > 0 ? `${pendingRoleCards} 张尚未确认` : '当前项目角色卡已同步',
      tone: 'rose',
    },
    {
      id: 'shots',
      title: '已产出镜头',
      value: formatCountValue(shotCount),
      detail: nextTask ? `下一批待续写：镜头 ${nextTask.nextShotStart}-${nextTask.nextShotEnd}` : '当前分镜历史已读入',
      tone: 'mint',
    },
  ]
}

export function buildOverviewRows(input: {
  index: ProjectBookIndexDto | null
  history: ProjectBookStoryboardHistoryDto | null
}): NanoComicEpisodeItem[] {
  if (!input.index) return []
  const items = Array.isArray(input.history?.items) ? input.history.items : []
  return input.index.chapters.slice(0, 6).map((chapter) => {
    const chapterShots = items.filter((item) => Math.trunc(Number(item.chapter || 0)) === chapter.chapter)
    return {
      id: `chapter-${chapter.chapter}`,
      chapterNo: chapter.chapter,
      code: buildChapterCode(chapter.chapter),
      title: chapter.title || `第 ${chapter.chapter} 章`,
      stage: chapterShots.length > 0 ? '已产出分镜' : '待产出分镜',
      storyboardProgress: chapterShots.length > 0 ? 100 : 0,
      videoProgress: 0,
      reviewCount: 0,
      ownerName: String(input.index?.processedBy || '系统'),
    }
  })
}

export function buildOverviewRisks(input: {
  index: ProjectBookIndexDto | null
  roleCards: readonly ProjectRoleCardAssetDto[]
  history: ProjectBookStoryboardHistoryDto | null
}): NanoComicRiskItem[] {
  const risks: NanoComicRiskItem[] = []
  if (!input.index) {
    risks.push({
      id: 'no-book',
      title: '当前项目尚未导入源书',
      level: 'blocked',
      detail: '没有源书就无法展开章节与分镜工作台。',
      impact: '先去资产面板上传小说或剧本文档',
    })
    return risks
  }

  if (input.roleCards.length === 0) {
    risks.push({
      id: 'no-role-card',
      title: '角色卡尚未生成',
      level: 'warning',
      detail: '当前项目还没有项目级角色卡资产。',
      impact: '会影响镜头锚点与人物一致性',
    })
  }

  if (!Array.isArray(input.history?.items) || input.history.items.length === 0) {
    risks.push({
      id: 'no-storyboard-history',
      title: '还没有任何分镜历史',
      level: 'blocked',
      detail: '当前源书尚未产出可复用的镜头结果。',
      impact: '分镜页只能展示空状态',
    })
  }

  const nextTask = input.history?.progress?.next
  if (nextTask) {
    risks.push({
      id: 'next-shot-pending',
      title: '仍有镜头待续写',
      level: 'stale',
      detail: `任务 ${nextTask.taskId} 还需要继续产出镜头 ${nextTask.nextShotStart}-${nextTask.nextShotEnd}。`,
      impact: '当前章节尚未形成完整连续片段',
    })
  }

  return risks.slice(0, 4)
}

export function buildOverviewActivities(input: {
  roleCards: readonly ProjectRoleCardAssetDto[]
  history: ProjectBookStoryboardHistoryDto | null
}): NanoComicActivityItem[] {
  const next: NanoComicActivityItem[] = []
  const sortedRoleCards = [...input.roleCards].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  for (const card of sortedRoleCards.slice(0, 2)) {
    next.push({
      id: `role-${card.id}`,
      actorName: String(card.data.confirmedBy || card.data.updatedAt || '系统'),
      action: String(card.data.confirmedAt || '').trim() ? '确认角色卡' : '更新角色卡',
      target: card.data.roleName,
      timeLabel: formatTimeLabel(card.updatedAt),
    })
  }

  const historyItems = Array.isArray(input.history?.items) ? [...input.history.items] : []
  historyItems.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  for (const item of historyItems.slice(0, 3)) {
    next.push({
      id: `shot-${item.chunkId}-${item.shotNo}`,
      actorName: item.updatedBy || '系统',
      action: '更新镜头',
      target: `镜头 ${buildShotCode(item.shotNo)}`,
      timeLabel: formatTimeLabel(item.updatedAt || item.createdAt),
    })
  }

  return next.slice(0, 5)
}

export function buildConversationArtifacts(input: {
  sessions: readonly ProjectChatArtifactSessionDto[]
}): NanoComicConversationArtifactItem[] {
  const rows = input.sessions.flatMap((session) => {
    const sessionLabel = `${getConversationLaneLabel(session.lane)} / ${getConversationSkillLabel(session.skillId)}`
    return session.turns.map((turn) => {
      const previewAsset = turn.assets.find((asset) => String(asset.thumbnailUrl || asset.url || '').trim())
      const promptPreview = trimText(String(turn.userText || '').trim() || '当前对话未记录用户提示词。', 56)
      const responsePreview = trimText(String(turn.assistantText || '').trim() || '当前产物未记录说明文本。', 72)
      return {
        id: `${session.sessionId}:${turn.assistantMessageId}`,
        sessionKey: session.sessionKey,
        sessionLabel,
        promptPreview,
        responsePreview,
        assetCountLabel: formatConversationAssetCountLabel(turn.assets.length),
        updatedAtLabel: formatTimeLabel(turn.createdAt || session.updatedAt),
        previewImageUrl: String(previewAsset?.thumbnailUrl || previewAsset?.url || '').trim() || undefined,
        createdAtTs: Date.parse(turn.createdAt || session.updatedAt || ''),
      }
    })
  })

  return rows
    .sort((left, right) => {
      const rightTs = Number.isFinite(right.createdAtTs) ? right.createdAtTs : 0
      const leftTs = Number.isFinite(left.createdAtTs) ? left.createdAtTs : 0
      return rightTs - leftTs
    })
    .slice(0, 12)
    .map(({ createdAtTs: _createdAtTs, ...item }) => item)
}

export function buildStoryboardShots(input: {
  index: ProjectBookIndexDto | null
  history: ProjectBookStoryboardHistoryDto | null
  chapterNo: number | null
}): NanoComicShotItem[] {
  const { promptByShotNo, previewByShotNo } = buildPromptPreviewMaps({
    index: input.index,
    chapterNo: input.chapterNo,
  })

  const items = Array.isArray(input.history?.items) ? input.history.items : []
  const filteredItems = input.chapterNo
    ? items.filter((item) => Math.trunc(Number(item.chapter || 0)) === input.chapterNo)
    : items
  const historyByShotNo = new Map<number, typeof filteredItems[number]>()
  for (const item of filteredItems) {
    const shotNo = Math.max(1, Math.trunc(Number(item.shotNo || 1)))
    if (!historyByShotNo.has(shotNo)) {
      historyByShotNo.set(shotNo, item)
    }
  }

  const shotNos = Array.from(new Set([
    ...Array.from(promptByShotNo.keys()),
    ...Array.from(historyByShotNo.keys()),
  ])).sort((left, right) => left - right)

  return shotNos.slice(0, 40).map((shotNo) => {
    const historyItem = historyByShotNo.get(shotNo) ?? null
    const chapterMeta = getChapterMeta(input.index, historyItem?.chapter ?? input.chapterNo ?? undefined)
    const roleNames = historyItem?.roleCardAnchors.map((anchor) => anchor.roleName).filter(Boolean) ?? []
    const propNames = Array.isArray(chapterMeta?.props) ? chapterMeta.props.map((prop) => prop.name).filter(Boolean).slice(0, 3) : []
    const locationName =
      (Array.isArray(chapterMeta?.locations) && chapterMeta.locations[0]?.name) ||
      (Array.isArray(chapterMeta?.scenes) && chapterMeta.scenes[0]?.name) ||
      '未识别场景'
    const promptText = promptByShotNo.get(shotNo) || ''
    const script = String(historyItem?.script || promptText).trim()
    const previewImageUrl = String(historyItem?.selectedImageUrl || historyItem?.imageUrl || previewByShotNo.get(shotNo) || '').trim()
    if (!historyItem) {
      return {
        id: `plan-${input.chapterNo || 1}-${shotNo}`,
        chapterNo: Math.trunc(Number(input.chapterNo || 1)),
        shotNo,
        sceneCode: buildChapterCode(Math.trunc(Number(input.chapterNo || 1))),
        shotCode: buildShotCode(shotNo),
        title: trimText(script || `镜头 ${shotNo}`, 24),
        script,
        productionStatus: previewImageUrl ? '已产出' : '待生成',
        reviewStatus: previewImageUrl ? '待审核' : '未提交',
        riskLabel: '可继续生成',
        continuityHint: trimText(script || '当前章节剧本已生成，等待继续补图与视频片段。', 56),
        prevShotCode: buildShotCode(Math.max(1, shotNo - 1)),
        nextShotCode: buildShotCode(shotNo + 1),
        castNames: roleNames.length > 0 ? roleNames.slice(0, 4) : ['待补角色锚点'],
        locationName,
        propNames: propNames.length > 0 ? propNames : ['待补固定道具'],
        note: trimText(script || '当前镜头仅存在章节剧本，尚未生成历史记录。', 120),
        commentPreview: '章节剧本已落盘',
        previewImageUrl,
        promptJson: promptText,
        referenceImageUrls: [],
        anchorImageUrls: [],
        isActionRequired: true,
        isHighRisk: false,
      }
    }
    return {
      id: `${historyItem.taskId}-${historyItem.shotNo}`,
      chapterNo: Math.trunc(Number(historyItem.chapter || input.chapterNo || 1)),
      shotNo: Math.max(1, Math.trunc(Number(historyItem.shotNo || 1))),
      sceneCode: buildChapterCode(Math.trunc(Number(historyItem.chapter || input.chapterNo || 1))),
      shotCode: buildShotCode(historyItem.shotNo),
      title: trimText(historyItem.script || `镜头 ${historyItem.shotNo}`, 24),
      script: String(historyItem.script || '').trim(),
      productionStatus: inferProductionStatus(historyItem),
      reviewStatus: inferReviewStatus(historyItem),
      riskLabel: inferRiskLabel(historyItem),
      continuityHint: trimText(historyItem.worldEvolutionThinking || historyItem.script || '等待补充镜头上下文。', 56),
      prevShotCode: buildShotCode(Math.max(1, historyItem.shotNo - 1)),
      nextShotCode: buildShotCode(historyItem.shotNo + 1),
      castNames: roleNames.length > 0 ? roleNames.slice(0, 4) : ['待补角色锚点'],
      locationName,
      propNames: propNames.length > 0 ? propNames : ['待补固定道具'],
      note: trimText(historyItem.script || '暂无镜头脚本摘要。', 120),
      commentPreview: `任务 ${historyItem.taskId} · ${formatTimeLabel(historyItem.updatedAt || historyItem.createdAt)}`,
      previewImageUrl,
      promptJson: promptText,
      referenceImageUrls: Array.isArray(historyItem.references)
        ? historyItem.references
          .map((reference) => String(reference.url || '').trim())
          .filter((url) => url.length > 0)
        : [],
      anchorImageUrls: Array.isArray(historyItem.roleCardAnchors)
        ? historyItem.roleCardAnchors
          .map((anchor) => String(anchor.imageUrl || '').trim())
          .filter((url) => url.length > 0)
        : [],
      isActionRequired: inferReviewStatus(historyItem) !== '未提交',
      isHighRisk: inferRiskLabel(historyItem) !== '可提交审核',
    }
  })
}

export function buildReviewMetrics(input: {
  roleCards: readonly ProjectBookRoleCardDto[]
  storyboardShots: readonly NanoComicShotItem[]
  history: ProjectBookStoryboardHistoryDto | null
}): NanoComicMetricCard[] {
  const unconfirmedRoleCards = input.roleCards.filter((item) => !String(item.confirmedAt || '').trim()).length
  const nextTask = input.history?.progress?.next
  return [
    {
      id: 'review-pending',
      title: '待处理对象',
      value: formatCountValue(unconfirmedRoleCards + input.storyboardShots.length),
      detail: '基于当前项目书和分镜历史推导',
      tone: 'sky',
    },
    {
      id: 'review-role-card',
      title: '未确认角色卡',
      value: formatCountValue(unconfirmedRoleCards),
      detail: unconfirmedRoleCards > 0 ? '建议先处理角色卡确认' : '当前角色卡已确认',
      tone: 'amber',
    },
    {
      id: 'review-shot',
      title: '镜头产出',
      value: formatCountValue(input.storyboardShots.length),
      detail: '来自当前章节或当前源书',
      tone: 'rose',
    },
    {
      id: 'review-next',
      title: '待续写批次',
      value: nextTask ? '1' : '0',
      detail: nextTask ? `镜头 ${nextTask.nextShotStart}-${nextTask.nextShotEnd}` : '当前无待续写批次',
      tone: 'mint',
    },
  ]
}

export function buildReviewItems(input: {
  roleCards: readonly ProjectBookRoleCardDto[]
  shots: readonly NanoComicShotItem[]
  projectLabel: string
  episodeLabel: string
}): NanoComicReviewItem[] {
  const roleItems: NanoComicReviewItem[] = input.roleCards.slice(0, 4).map((card) => ({
    id: `role-${card.cardId}`,
    entityType: 'asset',
    title: `${card.roleName} 角色卡`,
    summary: String(card.confirmedAt || '').trim()
      ? '角色卡已确认，可继续作为锚点复用。'
      : '角色卡尚未确认，建议先完成确认后再批量生成镜头。',
    riskLevel: String(card.confirmedAt || '').trim() ? 'pending' : 'warning',
    projectLabel: input.projectLabel,
    episodeLabel: input.episodeLabel,
    assigneeName: '项目成员',
    reviewerName: String(card.confirmedBy || '待确认'),
    updatedAtLabel: formatTimeLabel(card.updatedAt),
    impactLabel: String(card.confirmedAt || '').trim() ? '可继续复用' : '影响后续镜头一致性',
    canvasKind: 'image',
    previewImageUrl: String(card.imageUrl || '').trim() || undefined,
    isConfirmed: !!String(card.confirmedAt || '').trim(),
    isActionRequired: !String(card.confirmedAt || '').trim(),
    isHighRisk: !String(card.confirmedAt || '').trim(),
  }))

  const shotItems: NanoComicReviewItem[] = input.shots.slice(0, 6).map((shot) => ({
    id: shot.id,
    entityType: 'shot',
    title: `${shot.sceneCode} / 镜头 ${shot.shotCode} / ${shot.title}`,
    summary: `当前状态：${shot.reviewStatus}。${shot.note}`,
    riskLevel: shot.riskLabel === '可提交审核' ? 'pending' : 'warning',
    projectLabel: input.projectLabel,
    episodeLabel: input.episodeLabel,
    assigneeName: '分镜工作台',
    reviewerName: '待审核',
    updatedAtLabel: shot.commentPreview,
    impactLabel: shot.riskLabel,
    canvasKind: 'image',
    previewImageUrl: shot.previewImageUrl,
    isConfirmed: false,
    isActionRequired: shot.isActionRequired,
    isHighRisk: shot.isHighRisk,
  }))

  return [...roleItems, ...shotItems]
}
