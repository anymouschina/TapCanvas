// apps/web/src/canvas/scriptToAssetsOrchestrator.ts
//
// 「剧本 → 资产画布」单命令编排（对标小云雀短剧 Agent 2.0 的「资产创作画布」）。
//
// 小云雀 2.0 的招牌体验：上传剧本 → 画布自动长出角色卡 + 场景卡的结构化资产库，
// 用户在卡上精修参数面板（三视图 / 光影 / 场景一致性）后再进故事板。它把「资产库」
// 当成一等中间产物，而非视频流水线里一闪而过的临时步骤。
//
// TapCanvas 早已具备全部积木（intent: extract_roles / generate_scene_references），
// 资产库入口只产出角色与场景中间产物，不进入后端一键成片工作流。本编排把两步串成
// 单命令，只产出资产库即停手——把「精修再生成」的决定权
// 留给用户，忠实复刻小云雀的资产画布阶段。
//
// 刻意不阻塞等待每张卡渲染完成（extract_roles 的角色卡默认 draftByAgent，需用户点 Run；
// generate_scene_references 的场景图会 auto-run）——dispatchIntent 在节点铺到画布后即 resolve，
// 图像生成随后异步进行。这既是正确的粒度（「画布长出卡片」的时刻），也规避了对草稿节点
// 死等 success 的挂起风险。
import { create } from 'zustand'
import { dispatchIntent } from './dispatchIntent'
import { resolveIntentChapterContext } from './nodes/taskNode/intentChapterContext'
import { useRFStore } from './store'
import { toast } from '../ui/toast'

export type S2aPhase = 'roles' | 'scenes'

type S2aState = {
  isActive: boolean
  phase: S2aPhase | null
  phaseLabel: string
  error: string | null
  cancelled: boolean
  _setPhase: (p: S2aPhase, label: string) => void
  _setError: (msg: string) => void
  _reset: () => void
  _cancel: () => void
}

export const useScriptToAssets = create<S2aState>((set) => ({
  isActive: false,
  phase: null,
  phaseLabel: '',
  error: null,
  cancelled: false,
  _setPhase: (p, label) => set({ isActive: true, phase: p, phaseLabel: label, error: null }),
  _setError: (msg) => set({ error: msg, isActive: false }),
  _reset: () => set({ isActive: false, phase: null, phaseLabel: '', error: null, cancelled: false }),
  _cancel: () => set({ isActive: false, cancelled: true }),
}))

function resolveCtxFor(textNodeId: string) {
  return resolveIntentChapterContext({
    sourceNodeId: textNodeId,
    nodes: useRFStore.getState().nodes,
    edges: useRFStore.getState().edges,
  })
}

/**
 * 从一个剧本/章节文本节点，一键生成资产库（角色卡 → 场景卡）到画布。
 * 只铺资产、不进故事板/视频——用户可在卡上精修参数后再继续。
 */
export async function startScriptToAssets(textNodeId: string): Promise<void> {
  const store = useScriptToAssets.getState()
  if (store.isActive) return

  const ctx = resolveCtxFor(textNodeId)
  if (!ctx) {
    toast('无法获取章节上下文，请确保画布已关联项目章节', 'error')
    return
  }

  const { _setPhase, _setError, _reset } = useScriptToAssets.getState()

  try {
    // ── ① 拆解剧本 → 角色卡（结构化角色资产，带 character 身份锚点）──────────
    _setPhase('roles', '① 拆解剧本 · 生成角色卡')
    await dispatchIntent('extract_roles', textNodeId, { chapterContext: ctx })
    if (useScriptToAssets.getState().cancelled) return

    // ── ② 生成场景卡（场景参考图，供跨镜场景一致性锚定）──────────────────────
    // 重新解析上下文：上一步已往画布铺了角色卡节点，快照需刷新。
    const ctx2 = resolveCtxFor(textNodeId)
    if (!ctx2) {
      _setError('章节上下文丢失，请重试')
      return
    }
    _setPhase('scenes', '② 生成场景卡')
    await dispatchIntent('generate_scene_references', textNodeId, { chapterContext: ctx2 })
    if (useScriptToAssets.getState().cancelled) return

    _reset()
    toast(
      '资产画布已就绪：角色卡 + 场景卡已铺到画布，可逐张精修（三视图 / 光影 / 场景一致性）后再进故事板。',
      'success',
    )
  } catch (err: unknown) {
    _setError(err instanceof Error ? err.message : '资产生成失败，请重试')
  }
}
