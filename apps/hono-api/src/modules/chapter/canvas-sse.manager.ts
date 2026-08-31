import { randomUUID } from "node:crypto"

import { getSharedRedis } from "../../platform/redis-shared"
import {
  VIDEO_RUN_STATUS_PROTOCOL_VERSION,
  parseVideoRunStatusEvent,
  type VideoRunStatusEvent,
} from "@tapcanvas/video-orchestrator-protocol";
import { projectWorkflowGraphPatchForViewer } from "@tapcanvas/workflow-kernel-protocol";

const enc = new TextEncoder()

type SseConn = {
  connId: string
  userId: string
  controller: ReadableStreamDefaultController
  canViewAdminWorkflow: boolean
}

// chapterId → Set of active SSE connections
const chapterConns = new Map<string, Set<SseConn>>()

let heartbeatTimer: ReturnType<typeof setInterval> | null = null

// ── 跨进程事件中继（Redis pub/sub）────────────────────────────────────────────
// 痛点：chapterConns 是进程内 Map。线上出片驱动住在 credit-finalizer-worker 独立
// 进程，api 若跑多副本时浏览器 SSE 与工具写入也可能落在不同实例——这些进程里的
// broadcast* 调用会发进一个没有订阅者的 Map，事件静默丢失，用户必须手动刷新画布。
// 方案：REDIS_URL 存在时，每次广播先投递本进程连接（零延迟），再 publish 到 Redis
// 频道；持有 SSE 连接的进程（首个连接建立时惰性订阅）回放来自其它进程的事件，按
// origin 跳过自己防重复投递。无 Redis（单测/裸本地）自动退化为纯本地，行为不变。
const CANVAS_EVENTS_CHANNEL = "tapcanvas-canvas-events"
const INSTANCE_ID = randomUUID()

type RelayMessage = {
  origin: string
  rooms: string[]
  frame: string
  senderConnId: string
}

let relaySubscriberStarted = false

function startRelaySubscriber(): void {
  if (relaySubscriberStarted) return
  const shared = getSharedRedis()
  if (!shared) return
  relaySubscriberStarted = true
  try {
    // 订阅态连接不能复用于普通命令，需要独立连接。
    const sub = shared.duplicate()
    sub.on("error", (err: unknown) => {
      console.warn(
        "[canvas-sse] relay subscriber error",
        (err as { message?: string })?.message || err,
      )
    })
    void sub.subscribe(CANVAS_EVENTS_CHANNEL).catch((err) => {
      console.warn("[canvas-sse] relay subscribe failed", err)
    })
    sub.on("message", (channel: string, raw: string) => {
      if (channel !== CANVAS_EVENTS_CHANNEL) return
      let msg: RelayMessage
      try {
        msg = JSON.parse(raw) as RelayMessage
      } catch {
        return
      }
      if (!msg || msg.origin === INSTANCE_ID) return
      if (!Array.isArray(msg.rooms) || typeof msg.frame !== "string") return
      deliverToRooms(msg.rooms, msg.frame, msg.senderConnId || "")
    })
  } catch (err) {
    console.warn("[canvas-sse] relay subscriber init failed", err)
    relaySubscriberStarted = false
  }
}

/** 只投递给本进程内指定房间的连接（跳过 senderConnId 防自回显）。 */
function deliverToRooms(rooms: string[], frame: string, senderConnId: string): void {
  const seen = new Set<string>()
  for (const room of rooms) {
    if (!room || seen.has(room)) continue
    seen.add(room)
    const conns = chapterConns.get(room)
    if (!conns?.size) continue
    for (const conn of conns) {
      if (senderConnId && conn.connId === senderConnId) continue
      try {
        conn.controller.enqueue(enc.encode(projectFrameForConnection(frame, conn.canViewAdminWorkflow)))
      } catch {
        conns.delete(conn)
      }
    }
  }
}

function projectFrameForConnection(frame: string, canViewAdminWorkflow: boolean): string {
  if (canViewAdminWorkflow) return frame
  const marker = "data: "
  const dataStart = frame.indexOf(marker)
  if (dataStart < 0) return frame
  const jsonStart = dataStart + marker.length
  const jsonEnd = frame.indexOf("\n", jsonStart)
  if (jsonEnd < 0) return frame
  try {
    const payload = JSON.parse(frame.slice(jsonStart, jsonEnd)) as unknown
    const projected = projectWorkflowGraphPatchForViewer(payload, false)
    if (projected === payload) return frame
    return `${frame.slice(0, jsonStart)}${JSON.stringify(projected)}${frame.slice(jsonEnd)}`
  } catch {
    // A malformed realtime graph patch must not cross a protected viewer boundary.
    return ""
  }
}

/** 本地投递 + 跨进程 publish。所有房间级 SSE 事件（patch/run-status/tool-progress/
 *  agent-activity）统一走这里，保证任何进程里的广播都能到达持有连接的进程。 */
function publishToRooms(rooms: string[], frame: string, senderConnId = ""): void {
  deliverToRooms(rooms, frame, senderConnId)
  const redis = getSharedRedis()
  if (!redis) return
  const msg: RelayMessage = { origin: INSTANCE_ID, rooms, frame, senderConnId }
  void redis
    .publish(CANVAS_EVENTS_CHANNEL, JSON.stringify(msg))
    .catch((err) => console.warn("[canvas-sse] relay publish failed", err))
}

// ── 后台 agent 回合活动注册表（"running 状态栏"数据源）────────────────────────
// 痛点：聊天驱动的 agent 团跑在服务端，但前台 turn 结束/浏览器断开后前端没有任何"进行中"
// 指示，用户无法判断任务是否中断。这里用内存记录每个 project 房间的"活跃回合"，由 /chat 流
// 生命周期喂养（markChatTurnActive→开始、touchChatTurn→每次 SSE 活动续期并记最近角色、
// markChatTurnEnded→流结束），通过同一条 canvas-events SSE 房间广播 + 握手回放，**重连也能看到**。
// 60s 无活动自动判定结束（= 诚实地告诉用户"后台已停/可能中断"）。
// 注意：turnByKey 仍是进程本地（回合活在处理 /chat 的进程里，emit 时快照随事件跨进程
// 广播出去）；仅"握手回放"在多副本下可能看不到别的进程的活跃回合，属可接受降级。
const AGENT_TURN_TTL_MS = 60_000

export type AgentActivityEvent = {
  projectId: string
  active: boolean
  roleName: string | null
  label: string | null
  at: string
}

type TurnState = { lastMs: number; roleName: string | null; label: string | null; ended: boolean }
const turnByKey = new Map<string, TurnState>()

function agentActivitySnapshot(key: string, nowMs: number): AgentActivityEvent {
  const t = turnByKey.get(key)
  const active = !!t && !t.ended && nowMs - t.lastMs <= AGENT_TURN_TTL_MS
  return {
    projectId: key,
    active,
    roleName: active ? (t?.roleName ?? null) : null,
    label: active ? (t?.label ?? null) : null,
    at: new Date(nowMs).toISOString(),
  }
}

function emitAgentActivity(key: string): void {
  const frame = `event: agent-activity\ndata: ${JSON.stringify(agentActivitySnapshot(key, Date.now()))}\n\n`
  publishToRooms([key], frame)
}

/** /chat 回合开始：标记该 project 房间有后台 agent 在跑。 */
export function markChatTurnActive(projectId: string, label?: string | null): void {
  if (!projectId) return
  turnByKey.set(projectId, { lastMs: Date.now(), roleName: null, label: label ?? null, ended: false })
  emitAgentActivity(projectId)
}

/** /chat 每次 SSE 活动续期；roleName 变化（团队角色切换）时重新广播。 */
export function touchChatTurn(projectId: string, roleName?: string | null): void {
  if (!projectId) return
  const t = turnByKey.get(projectId)
  const now = Date.now()
  if (!t) {
    turnByKey.set(projectId, { lastMs: now, roleName: roleName ?? null, label: null, ended: false })
    emitAgentActivity(projectId)
    return
  }
  const roleChanged = !!roleName && roleName !== t.roleName
  const wasInactive = t.ended || now - t.lastMs > AGENT_TURN_TTL_MS
  t.lastMs = now
  t.ended = false
  if (roleName) t.roleName = roleName
  if (roleChanged || wasInactive) emitAgentActivity(projectId)
}

/** /chat 流结束（正常/异常/断连）：标记结束、广播一次。 */
export function markChatTurnEnded(projectId: string): void {
  if (!projectId) return
  const t = turnByKey.get(projectId)
  if (t) t.ended = true
  emitAgentActivity(projectId)
}

function sweepAgentTurns() {
  const now = Date.now()
  for (const [key, t] of turnByKey) {
    if (!t.ended && now - t.lastMs > AGENT_TURN_TTL_MS) {
      t.ended = true
      emitAgentActivity(key)
    }
    // 结束满 5 分钟的条目清理，防内存泄漏。
    if (t.ended && now - t.lastMs > 300_000) turnByKey.delete(key)
  }
}

function startHeartbeat() {
  if (heartbeatTimer) return
  heartbeatTimer = setInterval(() => {
    sweepAgentTurns()
    const ping = enc.encode(': keepalive\n\n')
    for (const conns of chapterConns.values()) {
      for (const conn of conns) {
        try {
          conn.controller.enqueue(ping)
        } catch {
          conns.delete(conn)
        }
      }
    }
  }, 20_000)
}

export function subscribeToChapter(
  chapterId: string,
  userId: string,
  controller: ReadableStreamDefaultController,
  options: Readonly<{ canViewAdminWorkflow?: boolean }> = {},
): { unsubscribe: () => void; connId: string } {
  startHeartbeat()
  // 惰性起跨进程中继订阅：只有真正持有 SSE 连接的进程才需要回放远端事件
  //（credit-finalizer-worker 等纯生产者进程永远不会走到这里，只 publish 不订阅）。
  startRelaySubscriber()
  if (!chapterConns.has(chapterId)) chapterConns.set(chapterId, new Set())
  const connId = randomUUID()
  const conn: SseConn = {
    connId,
    userId,
    controller,
    canViewAdminWorkflow: options.canViewAdminWorkflow === true,
  }
  chapterConns.get(chapterId)!.add(conn)
  // 握手回放：新连接（含重连/重载）立刻拿到当前后台 agent 活动快照，让 running 状态栏在
  // 断开后也能恢复显示。仅在确有活跃回合时发，避免噪音。
  const snap = agentActivitySnapshot(chapterId, Date.now())
  if (snap.active) {
    try {
      conn.controller.enqueue(
        enc.encode(`event: agent-activity\ndata: ${JSON.stringify(snap)}\n\n`),
      )
    } catch {
      /* ignore */
    }
  }
  return {
    connId,
    unsubscribe: () => {
      const set = chapterConns.get(chapterId)
      if (!set) return
      set.delete(conn)
      if (set.size === 0) chapterConns.delete(chapterId)
    },
  }
}

export function broadcastPatch(
  chapterId: string,
  patch: unknown,
  senderConnId: string,
): void {
  if (!chapterId) return
  publishToRooms([chapterId], `data: ${JSON.stringify(patch)}\n\n`, senderConnId)
}

/** 当前房间(chapterId/projectId)的活跃 SSE 连接数；presence 检查用。
 *  注意：只统计本进程连接，多副本部署下是每实例视角（现有调用方均可接受）。 */
export function countChapterConns(chapterId: string): number {
	return chapterConns.get(chapterId)?.size ?? 0;
}

export type RunStatusEvent = Omit<
  VideoRunStatusEvent,
  "protocolVersion" | "state" | "authoringState"
> & {
  state: unknown;
  authoringState: unknown;
};

export type ToolProgressEvent = {
  toolCallId: string;
  toolName: string;
  completed: number;
  total: number;
  failed: number;
  chapterId: string | null;
};

/** 把批量出图/工具的"已完成 N/总数"进度广播到 project 房间；有 chapterId 时一并发 chapter 房间。
 *  复用画布 SSE 频道（独立于 agents 聊天流），供聊天对话框按 toolCallId 关联展示"3/8 张"。
 *  无订阅者静默返回。 */
export function broadcastToolProgress(projectId: string, payload: ToolProgressEvent): void {
  const frame = `event: tool-progress\ndata: ${JSON.stringify({ ...payload, at: new Date().toISOString() })}\n\n`;
  const rooms = [projectId];
  if (payload.chapterId && payload.chapterId !== projectId) rooms.push(payload.chapterId);
  publishToRooms(rooms, frame);
}

/** 把 video_runs 的 run 级状态广播到 project 房间，并在有 chapterId 时一并发到 chapterId 房间。
 *  章节画布订阅的是 chapterId 房间（见 chapter.routes 的 /:id/canvas-events），而主项目画布订阅
 *  projectId 房间——只发 projectId 房间会让章节画布收不到进度/终止入口。无订阅者时静默。 */
export function broadcastRunStatus(projectId: string, payload: RunStatusEvent): void {
  const parsed = parseVideoRunStatusEvent({
    protocolVersion: VIDEO_RUN_STATUS_PROTOCOL_VERSION,
    ...payload,
  });
  if (!parsed.success) {
    throw new Error(`run-status broadcast violates canonical contract: ${parsed.error.message}`);
  }
  const frame = `event: run-status\ndata: ${JSON.stringify(parsed.data)}\n\n`;
  const rooms = [projectId];
  if (payload.chapterId && payload.chapterId !== projectId) rooms.push(payload.chapterId);
  publishToRooms(rooms, frame);
}

/**
 * 工作流执行事件推送（对齐 DeepSeek Harness 的事件驱动投影：每个 committed 执行事件
 * 实时推给订阅者，前端按 seq 水印增量折叠到画布，非轮询）。小T 触发的执行
 * （tapcanvas_equipped_workflow_run）不经前端手动运行路径，画布需靠本事件回显节点
 * 状态与资产回填。payload 只带轻量身份 + 单调递增 seq，前端收到后增量拉取 node_runs。
 */
export function broadcastWorkflowExecutionEvent(projectId: string, payload: {
  executionId: string;
  seq: number;
  eventType: string;
  status?: string;
}): void {
  if (!projectId.trim() || !payload.executionId.trim()) return;
  const frame = `event: workflow-execution-event\ndata: ${JSON.stringify(payload)}\n\n`;
  publishToRooms([projectId], frame);
}
