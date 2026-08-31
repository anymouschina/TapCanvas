import { create } from 'zustand'

// 批量出图（image_generate_to_canvas 的 nodes[] 并发出图）逐张进度。
// 数据源：hono-api 每张决议时经画布 SSE 频道广播 `event: tool-progress`，
// useCanvasSync 收帧写入此 store，聊天对话框（ChatTaskPlan）按 toolCallId 关联展示"3/8 张"。
// 独立于 agents 聊天流——聊天流本身仍只发 tool.started/tool.completed。

export type ToolProgressEntry = {
  toolCallId: string
  toolName: string
  completed: number
  total: number
  failed: number
  updatedAt: number
}

export type ToolProgressInput = Omit<ToolProgressEntry, 'updatedAt'>

const TTL_MS = 5 * 60_000

type ToolProgressState = {
  byCallId: Map<string, ToolProgressEntry>
  setToolProgress: (p: ToolProgressInput) => void
  clearToolProgress: (toolCallId: string) => void
  clearAll: () => void
}

export const useToolProgressStore = create<ToolProgressState>((set) => ({
  byCallId: new Map(),
  setToolProgress: (p) =>
    set((st) => {
      const m = new Map(st.byCallId)
      m.set(p.toolCallId, { ...p, updatedAt: Date.now() })
      return { byCallId: m }
    }),
  clearToolProgress: (toolCallId) =>
    set((st) => {
      if (!st.byCallId.has(toolCallId)) return st
      const m = new Map(st.byCallId)
      m.delete(toolCallId)
      return { byCallId: m }
    }),
  clearAll: () => set({ byCallId: new Map() }),
}))

/** 关联选择器：命中且未过期（TTL 兜底 tool.completed 漏达时的残留）才返回。 */
export function selectToolProgress(
  toolCallId: string,
  state: { byCallId: Map<string, ToolProgressEntry> },
): ToolProgressEntry | undefined {
  const e = state.byCallId.get(toolCallId)
  if (!e) return undefined
  if (Date.now() - e.updatedAt > TTL_MS) return undefined
  return e
}

/** 纯展示：已完成 N/总数 张（M 失败）。失败为 0 时不带后缀。 */
export function formatBatchProgressLabel(p: {
  completed: number
  total: number
  failed: number
}): string {
  const base = `已完成 ${p.completed}/${p.total} 张`
  return p.failed > 0 ? `${base}（${p.failed} 失败）` : base
}
