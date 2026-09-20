import { dispatchIntent } from './dispatchIntent'
import { resolveIntentChapterContext } from './nodes/taskNode/intentChapterContext'
import { useRFStore } from './store'
import { toast } from '../ui/toast'

/** The agent owns asset planning; the browser only submits the user's goal. */
export function startScriptToAssets(textNodeId: string): void {
  const state = useRFStore.getState()
  const chapterContext = resolveIntentChapterContext({
    sourceNodeId: textNodeId,
    nodes: state.nodes,
    edges: state.edges,
  })
  if (!chapterContext) {
    toast('无法获取章节上下文，请确保画布已关联项目章节', 'error')
    return
  }
  dispatchIntent('generate_scene_references', textNodeId, {
    chapterContext,
    userHints: '生成当前剧本的资产库：角色卡、场景卡及对应参考图，交付到当前画布。',
  })
}
