import { create } from 'zustand'

// 后台 agent 回合活动（"running 状态栏"数据源）。由 canvas-events SSE 的 `agent-activity` 事件驱动，
// 服务端在 /chat 流生命周期内广播 + 握手回放，所以断开/重连/重载后仍能恢复显示。
// 见 hono canvas-sse.manager.ts 的 markChatTurnActive/touchChatTurn/markChatTurnEnded。

export type ChatActivity = {
  // 当前 project 房间是否有后台 agent 回合在跑
  active: boolean
  // 最近活跃的团队角色名（分镜师/生成师…），用于状态栏标签
  roleName: string | null
  // 该活动所属 projectId（房间 key）
  projectId: string | null
  // 最近一次更新时间戳（ISO）
  at: string | null
}

type ChatActivityState = ChatActivity & {
  setActivity: (next: { projectId: string; active: boolean; roleName: string | null; at: string }) => void
  reset: () => void
  resetForProject: (projectId: string) => void
}

export const useChatActivityStore = create<ChatActivityState>((set) => ({
  active: false,
  roleName: null,
  projectId: null,
  at: null,
  setActivity: (next) =>
    set({ active: next.active, roleName: next.roleName, projectId: next.projectId, at: next.at }),
  reset: () => set({ active: false, roleName: null, projectId: null, at: null }),
  resetForProject: (projectId) =>
    set((current) => current.projectId === projectId
      ? { active: false, roleName: null, projectId: null, at: null }
      : current),
}))
