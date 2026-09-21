// 用户全局生成偏好的前端缓存：模块级单例 + 变更事件。
// 消费方：① 画布在动态模型目录加载完成后校验并采用偏好 ② 节点“设为偏好”开关回显。
// 服务端真相源 = users.generation_prefs（小T 上下文注入走服务端，不依赖本缓存）。
import { getGenerationPreferences, putGenerationPreferences, type UserGenerationPrefsDto } from '../api/server'

export const GENERATION_PREFS_EVENT = 'tapcanvas-generation-prefs-changed'

export const DEFAULT_GENERATION_PREFS: Readonly<Required<Pick<UserGenerationPrefsDto, 'imageModel' | 'imageSize' | 'videoModel' | 'videoResolution' | 'videoAspect'>>> = {
  imageModel: 'gpt-image-2',
  imageSize: '1K',
  videoModel: 'minimax-h3',
  videoResolution: '768p',
  videoAspect: '16:9',
}

let cachedPrefs: UserGenerationPrefsDto | null = null
let loaded = false
let inflight: Promise<UserGenerationPrefsDto | null> | null = null
let updateQueue: Promise<void> = Promise.resolve()
let preferenceRevision = 0

/** 同步读缓存（未加载过返回 null；消费方仍须用动态目录校验模型是否可用）。 */
export function getCachedGenerationPrefs(): UserGenerationPrefsDto | null {
  return cachedPrefs
}

let lastSourceNodeId: string | undefined
export function getGenerationPrefsSourceNodeId(): string | undefined { return lastSourceNodeId }
export function subscribeGenerationPrefs(listener: () => void): () => void {
  window.addEventListener(GENERATION_PREFS_EVENT, listener)
  return () => window.removeEventListener(GENERATION_PREFS_EVENT, listener)
}

function emitChanged() {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(GENERATION_PREFS_EVENT, { detail: cachedPrefs }))
  }
}

/** 拉取并缓存（幂等去重）；读取失败向调用方暴露，禁止伪装成“新账号无偏好”。 */
export async function loadGenerationPrefs(force = false): Promise<UserGenerationPrefsDto | null> {
  if (loaded && !force) return cachedPrefs
  if (inflight) return inflight
  inflight = (async () => {
    try {
      // A read started before a user save must never publish its stale response.
      // Wait for queued writes, then retry only when a newer user operation intervened.
      while (true) {
        const revision = preferenceRevision
        await updateQueue
        const prefs = await getGenerationPreferences()
        if (revision !== preferenceRevision) continue
        cachedPrefs = prefs
        loaded = true
        lastSourceNodeId = undefined
        emitChanged()
        return cachedPrefs
      }
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** 保存到服务端并更新缓存。 */
async function persistGenerationPrefs(prefs: UserGenerationPrefsDto, sourceNodeId?: string): Promise<UserGenerationPrefsDto | null> {
  const savedPrefs = await putGenerationPreferences(prefs)
  if (!savedPrefs || Object.entries(prefs).some(([key, value]) => savedPrefs[key as keyof UserGenerationPrefsDto] !== value)) {
    throw new Error('服务端未保存所选生成偏好，请确认后端已更新。')
  }
  lastSourceNodeId = sourceNodeId
  cachedPrefs = savedPrefs
  loaded = true
  emitChanged()
  return cachedPrefs
}

/** Serialize every save entry point, including direct saves and preference toggles. */
export function saveGenerationPrefs(
  prefs: UserGenerationPrefsDto,
  sourceNodeId?: string,
): Promise<UserGenerationPrefsDto | null> {
  preferenceRevision += 1
  const snapshot = { ...prefs }
  const operation = updateQueue.then(() => persistGenerationPrefs(snapshot, sourceNodeId))
  updateQueue = operation.then(() => undefined, () => undefined)
  return operation
}

/** Save the user's explicit group selection in operation order. */
export function updateRecentGenerationPrefs(
  patch: UserGenerationPrefsDto,
  sourceNodeId?: string,
): Promise<UserGenerationPrefsDto | null> {
  return saveGenerationPrefs(patch, sourceNodeId)
}
