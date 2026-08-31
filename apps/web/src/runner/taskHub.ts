import { create } from 'zustand'
import type { TaskKind, TaskResultDto, TaskStatus } from '../api/server'

export type { TaskStatus }

export type TaskEntry = {
  taskId: string
  kind: TaskKind
  prompt: string
  status: TaskStatus
  progress: number
  result?: TaskResultDto
  error?: string
  nodeId?: string
  flowId?: string
  createdAt: number
  startedAt?: number
  updatedAt: number
  timeoutAt: number
  attemptCount: number
  lastError?: string
  nextPollAt: number
  subscriberCount: number
}

type TaskHubState = {
  tasksById: Record<string, TaskEntry>
  taskIds: string[]
}

type TaskHubInternals = {
  _setTask: (entry: TaskEntry) => void
  _removeTask: (taskId: string) => void
  _reset: () => void
}

export const useTaskHubStore = create<TaskHubState & TaskHubInternals>((set) => ({
  tasksById: {},
  taskIds: [],
  _setTask: (entry) =>
    set((s) => ({
      tasksById: { ...s.tasksById, [entry.taskId]: entry },
      taskIds: s.taskIds.includes(entry.taskId)
        ? s.taskIds
        : [...s.taskIds, entry.taskId],
    })),
  _removeTask: (taskId) =>
    set((s) => {
      const { [taskId]: _removed, ...rest } = s.tasksById
      return {
        tasksById: rest,
        taskIds: s.taskIds.filter((id) => id !== taskId),
      }
    }),
  _reset: () => set({ tasksById: {}, taskIds: [] }),
}))

// ─── taskHubRuntime ───────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2500
const HIDDEN_INTERVAL_MS = 10_000
const MAX_INTERVAL_MS = 30_000
const MAX_CONCURRENT = 4
const TERMINAL_TTL_MS = 60_000
const DEFAULT_TIMEOUT_MS = 600_000

type RegisterOptions = {
  taskId: string
  kind: TaskKind
  prompt: string
  nodeId?: string
  flowId?: string
  timeoutMs?: number
  isCanceled?: () => boolean
}

type Resolver = {
  resolve: (r: TaskResultDto) => void
  reject: (e: Error) => void
}

// fetch 函数由 remoteRunner.ts 通过 configureTaskHub 注入，避免循环依赖
type FetchTaskFn = (taskId: string, kind: TaskKind, prompt: string) => Promise<TaskResultDto>
let _fetchTask: FetchTaskFn | null = null

export function configureTaskHub(opts: { fetch: FetchTaskFn }): void {
  _fetchTask = opts.fetch
}

const resolvers = new Map<string, Resolver[]>()
const cancelChecks = new Map<string, (() => boolean)[]>()
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()
let tickTimer: ReturnType<typeof setInterval> | null = null
let isTickRunning = false

function startTick() {
  if (tickTimer !== null) return
  tickTimer = setInterval(runTick, POLL_INTERVAL_MS)
  document.addEventListener('visibilitychange', onVisibilityChange)
}

function stopTick() {
  if (tickTimer !== null) {
    clearInterval(tickTimer)
    tickTimer = null
  }
  document.removeEventListener('visibilitychange', onVisibilityChange)
}

function onVisibilityChange() {
  if (tickTimer !== null) clearInterval(tickTimer)
  tickTimer = setInterval(runTick, document.hidden ? HIDDEN_INTERVAL_MS : POLL_INTERVAL_MS)
}

function resolveTask(taskId: string, result: TaskResultDto) {
  const list = resolvers.get(taskId) ?? []
  resolvers.delete(taskId)
  for (const r of list) r.resolve(result)
  scheduleCleanup(taskId)
}

function rejectTask(taskId: string, error: Error) {
  const list = resolvers.get(taskId) ?? []
  resolvers.delete(taskId)
  for (const r of list) r.reject(error)
  scheduleCleanup(taskId)
}

function scheduleCleanup(taskId: string) {
  const t = setTimeout(() => {
    useTaskHubStore.getState()._removeTask(taskId)
    cancelChecks.delete(taskId)
    cleanupTimers.delete(taskId)
    const { taskIds, tasksById } = useTaskHubStore.getState()
    const activeTasks = taskIds.filter(
      (id) => ['queued', 'running'].includes(tasksById[id]?.status ?? ''),
    )
    if (activeTasks.length === 0) stopTick()
  }, TERMINAL_TTL_MS)
  cleanupTimers.set(taskId, t)
}

async function fetchOne(entry: TaskEntry): Promise<void> {
  if (!_fetchTask) throw new Error('TaskHub not configured: call configureTaskHub first')
  const store = useTaskHubStore.getState()
  let snapshot: TaskResultDto
  try {
    snapshot = await _fetchTask(entry.taskId, entry.kind, entry.prompt)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '查询任务进度失败'
    const current = store.tasksById[entry.taskId]
    if (!current) return
    const backoffMs = Math.min(MAX_INTERVAL_MS, POLL_INTERVAL_MS * Math.pow(2, Math.min(current.attemptCount, 3)))
    store._setTask({
      ...current,
      attemptCount: current.attemptCount + 1,
      lastError: msg,
      updatedAt: Date.now(),
      nextPollAt: Date.now() + backoffMs,
    })
    return
  }

  const current = store.tasksById[entry.taskId]
  if (!current) return

  if (snapshot.status === 'succeeded') {
    store._setTask({ ...current, status: 'succeeded', result: snapshot, progress: 100, updatedAt: Date.now() })
    resolveTask(entry.taskId, snapshot)
    return
  }

  if (snapshot.status === 'failed') {
    const raw = snapshot.raw as Record<string, unknown>
    const msg =
      (typeof raw['failureReason'] === 'string' && raw['failureReason'].trim()) ||
      (typeof raw['response'] === 'object' && raw['response'] !== null &&
        typeof (raw['response'] as Record<string, unknown>)['error'] === 'string' &&
        ((raw['response'] as Record<string, unknown>)['error'] as string).trim()) ||
      '任务失败'
    store._setTask({ ...current, status: 'failed', error: msg, updatedAt: Date.now() })
    rejectTask(entry.taskId, new Error(msg))
    return
  }

  // still running/queued — update progress
  const raw = snapshot.raw as Record<string, unknown>
  const rawPct =
    typeof raw['progress'] === 'number' ? raw['progress'] :
    typeof (raw['response'] as Record<string, unknown> | undefined)?.['progress'] === 'number'
      ? (raw['response'] as Record<string, unknown>)['progress'] as number
      : null
  const pct = typeof rawPct === 'number' ? Math.max(0, Math.min(100, rawPct <= 1 ? rawPct * 100 : rawPct)) : current.progress

  store._setTask({
    ...current,
    status: snapshot.status as TaskStatus,
    progress: Math.max(current.progress, pct),
    attemptCount: 0,
    updatedAt: Date.now(),
    nextPollAt: Date.now() + POLL_INTERVAL_MS,
  })
}

async function runTick() {
  if (isTickRunning) return
  isTickRunning = true
  try {
    const store = useTaskHubStore.getState()
    const active = store.taskIds
      .map((id) => store.tasksById[id])
      .filter((e): e is TaskEntry => !!e && (e.status === 'queued' || e.status === 'running'))

    for (const entry of active) {
      // cancel check
      const checks = cancelChecks.get(entry.taskId) ?? []
      if (checks.some((fn) => fn())) {
        rejectTask(entry.taskId, new Error('任务已取消'))
        continue
      }
      // timeout check
      if (Date.now() > entry.timeoutAt) {
        rejectTask(entry.taskId, new Error('任务轮询超时'))
        continue
      }
    }

    const toFetch = useTaskHubStore.getState().taskIds
      .map((id) => useTaskHubStore.getState().tasksById[id])
      .filter((e): e is TaskEntry => !!e && (e.status === 'queued' || e.status === 'running') && Date.now() >= e.nextPollAt)

    // concurrency limit: slice into chunks of MAX_CONCURRENT
    for (let i = 0; i < toFetch.length; i += MAX_CONCURRENT) {
      await Promise.allSettled(toFetch.slice(i, i + MAX_CONCURRENT).map(fetchOne))
    }
  } finally {
    isTickRunning = false
  }
}

export const taskHubRuntime = {
  registerTask(opts: RegisterOptions): void {
    const store = useTaskHubStore.getState()
    const existing = store.tasksById[opts.taskId]
    if (existing) {
      // Already tracked — just add cancel check if provided
      if (opts.isCanceled) {
        const list = cancelChecks.get(opts.taskId) ?? []
        list.push(opts.isCanceled)
        cancelChecks.set(opts.taskId, list)
      }
      return
    }
    const now = Date.now()
    const entry: TaskEntry = {
      taskId: opts.taskId,
      kind: opts.kind,
      prompt: opts.prompt,
      status: 'queued',
      progress: 0,
      nodeId: opts.nodeId,
      flowId: opts.flowId,
      createdAt: now,
      updatedAt: now,
      timeoutAt: now + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      attemptCount: 0,
      nextPollAt: now,
      subscriberCount: 0,
    }
    store._setTask(entry)
    if (opts.isCanceled) {
      cancelChecks.set(opts.taskId, [opts.isCanceled])
    }
    startTick()
  },

  waitForTask(taskId: string): Promise<TaskResultDto> {
    const store = useTaskHubStore.getState()
    if (!store.tasksById[taskId]) {
      return Promise.reject(new Error(`taskId not registered: ${taskId}`))
    }
    const entry = store.tasksById[taskId]!
    if (entry.status === 'succeeded' && entry.result) return Promise.resolve(entry.result)
    if (entry.status === 'failed') return Promise.reject(new Error(entry.error ?? '任务失败'))

    const p = new Promise<TaskResultDto>((resolve, reject) => {
      const list = resolvers.get(taskId) ?? []
      list.push({ resolve, reject })
      resolvers.set(taskId, list)
    })
    // Attach a no-op catch to prevent "UnhandledPromiseRejection" when the rejection
    // happens inside a timer callback before the caller attaches its own .catch handler.
    p.catch(() => {})
    return p
  },

  stopWatching(taskId: string): void {
    cancelChecks.delete(taskId)
    const list = resolvers.get(taskId) ?? []
    resolvers.delete(taskId)
    for (const r of list) r.reject(new Error('stopWatching called'))
  },

  clear(): void {
    stopTick()
    resolvers.clear()
    cancelChecks.clear()
    for (const t of cleanupTimers.values()) clearTimeout(t)
    cleanupTimers.clear()
    isTickRunning = false
    useTaskHubStore.getState()._reset()
  },
}
