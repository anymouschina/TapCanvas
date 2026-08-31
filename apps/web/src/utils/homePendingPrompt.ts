/**
 * 首页发起对话 → 画布自动发送的挂起 prompt。
 *
 * 必须携带目标 projectId：首页→画布是 SPA 导航，uiStore.currentProject 在
 * CanvasApp 挂载瞬间还是上次打开的旧项目（listProjects 异步回填才更新），
 * 消费端若只判"有无 projectId"会被旧项目抢跑消费，消息落进旧项目会话。
 */
const KEY = 'tapcanvas.homepage.pendingPrompts.v2'

/** 超过该时长未被消费视为过期残留（如导航中途离开），直接丢弃。 */
const MAX_AGE_MS = 10 * 60 * 1000

interface PendingPromptEntry {
  projectId: string
  text: string
  requiredSkills: string[]
  createdAt: number
}

type PendingPromptEntries = Record<string, PendingPromptEntry>

function readPendingPromptEntries(): PendingPromptEntries {
  const raw = sessionStorage.getItem(KEY)
  if (!raw) return {}
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('挂起创作请求存储格式无效')
  }

  const entries: PendingPromptEntries = {}
  for (const [projectId, value] of Object.entries(parsed)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`项目 ${projectId} 的挂起创作请求格式无效`)
    }
    const record = value as Record<string, unknown>
    const requiredSkillsValue = record.requiredSkills
    const requiredSkills = Array.isArray(requiredSkillsValue)
      && requiredSkillsValue.every((item: unknown): item is string => typeof item === 'string')
      ? requiredSkillsValue
      : null
    if (
      typeof record.projectId !== 'string'
      || record.projectId.trim() !== projectId
      || typeof record.text !== 'string'
      || !record.text.trim()
      || !requiredSkills
      || typeof record.createdAt !== 'number'
      || !Number.isFinite(record.createdAt)
      || record.createdAt <= 0
    ) {
      throw new Error(`项目 ${projectId} 的挂起创作请求字段无效`)
    }
    entries[projectId] = {
      projectId,
      text: record.text.trim(),
      requiredSkills: Array.from(new Set(requiredSkills.map((item) => item.trim()).filter(Boolean))),
      createdAt: record.createdAt,
    }
  }
  return entries
}

function persistPendingPromptEntries(entries: PendingPromptEntries): void {
  if (Object.keys(entries).length === 0) {
    sessionStorage.removeItem(KEY)
    return
  }
  sessionStorage.setItem(KEY, JSON.stringify(entries))
}

export function writeHomePendingPrompt(projectId: string, text: string, requiredSkills: string[] = []): void {
  const normalizedProjectId = projectId.trim()
  const normalizedText = text.trim()
  if (!normalizedProjectId || !normalizedText) {
    throw new Error('创作请求缺少目标画布或创意内容')
  }
  const entry: PendingPromptEntry = {
    projectId: normalizedProjectId,
    text: normalizedText,
    requiredSkills: Array.from(new Set(requiredSkills.map((item) => item.trim()).filter(Boolean))),
    createdAt: Date.now(),
  }
  const entries = readPendingPromptEntries()
  persistPendingPromptEntries({ ...entries, [normalizedProjectId]: entry })
}

/**
 * 仅当挂起请求的目标项目与当前项目一致时取走并返回；
 * 不一致则原样保留（等 currentProject 对齐后由下一次 effect 消费）。
 */
export function takeHomePendingPrompt(currentProjectId: string): Pick<PendingPromptEntry, 'text' | 'requiredSkills'> | null {
  try {
    const normalizedProjectId = currentProjectId.trim()
    if (!normalizedProjectId) return null
    const now = Date.now()
    const entries = readPendingPromptEntries()
    const freshEntries = Object.fromEntries(
      Object.entries(entries).filter(([, candidate]) => now - candidate.createdAt <= MAX_AGE_MS),
    )
    const entry = freshEntries[normalizedProjectId]
    if (!entry) {
      persistPendingPromptEntries(freshEntries)
      return null
    }
    delete freshEntries[normalizedProjectId]
    persistPendingPromptEntries(freshEntries)
    return { text: entry.text, requiredSkills: entry.requiredSkills }
  } catch (error: unknown) {
    console.error('failed to consume home pending request', error)
    sessionStorage.removeItem(KEY)
    return null
  }
}
