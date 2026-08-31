/**
 * 聊天发送瞬间的画布绑定（canvasProjectId/canvasFlowId）解析。
 *
 * 必须用「发送时现读的 store 快照」而不是渲染闭包值：首页 pending prompt 经
 * setTimeout 触发、排队消息跨回合重发时，闭包里可能还是 SPA 导航前上一个画布的
 * flowId（currentProject 已切新项目、currentFlow 未重置）。把这个残留 flowId 发给
 * 服务端，agents bridge 按 project 归属校验必拒 flow_not_found（首条消息报错、
 * 第二条才好）。
 */

export interface LiveCanvasBindingInput {
  currentChapter?: { projectId?: string | null; chapterId?: string | null } | null
  currentProject?: { id?: string | null } | null
  currentFlow?: {
    id?: string | null
    ownerType?: 'project' | 'chapter' | 'shot' | null
    ownerId?: string | null
  } | null
}

export interface LiveCanvasBinding {
  projectId: string
  flowId: string
}

export function resolveLiveCanvasBinding(state: LiveCanvasBindingInput): LiveCanvasBinding {
  const chapterId = String(state.currentChapter?.chapterId || '').trim()
  // 章节画布用权威 project（currentChapter.projectId）；非章节回退 currentProject。
  const projectId =
    (chapterId ? String(state.currentChapter?.projectId || '').trim() : '') ||
    String(state.currentProject?.id || '').trim()
  // 章节会话以 chapterId 为准，不落 flow 维度。
  const rawFlowId = chapterId ? '' : String(state.currentFlow?.id || '').trim()
  // flow 归属与当前项目不符（项目切换窗口期的残留）时宁可不带 flowId，
  // 交给服务端按项目自动解析/创建。
  const flowOwnerId = String(state.currentFlow?.ownerId || '').trim()
  const flowId =
    rawFlowId &&
    state.currentFlow?.ownerType === 'project' &&
    flowOwnerId &&
    flowOwnerId !== projectId
      ? ''
      : rawFlowId
  return { projectId, flowId }
}
