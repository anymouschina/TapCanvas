import { Injectable, Logger, MessageEvent } from '@nestjs/common'
import { Observable, Subject } from 'rxjs'
import { filter, map } from 'rxjs/operators'
import type { TaskProgressEvent } from './task.types'

interface TaskProgressEnvelope {
  userId: string
  event: TaskProgressEvent
}

interface StoredProgressKey {
  vendor: string | undefined
  nodeId: string | undefined
  taskId: string | undefined
}

function makeStoredKey(key: StoredProgressKey): string {
  const vendor = (key.vendor || '').trim()
  const node = (key.nodeId || '').trim()
  const task = (key.taskId || '').trim()
  // 保证 key 稳定且不会与其他用户混淆（userId 由上层 Map 区分）
  return [vendor || '*', node || '*', task || '*'].join('|')
}

@Injectable()
export class TaskProgressService {
  private readonly logger = new Logger(TaskProgressService.name)
  private readonly emitter = new Subject<TaskProgressEnvelope>()
  // 仅用于「轮询 pending」场景的内存态快照：按 userId 维护最近一次进度事件
  private readonly latestByUser = new Map<string, Map<string, TaskProgressEvent>>()

  emit(userId: string, event: TaskProgressEvent) {
    this.storeLatest(userId, event)
    if (!userId || !event) return
    const payload: TaskProgressEvent = {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
    }
    this.logger.debug('task progress emit', {
      userId,
      nodeId: payload.nodeId,
      status: payload.status,
      progress: payload.progress,
    })
    this.emitter.next({ userId, event: payload })
  }

  /**
   * 仅写入内存快照，不推送 SSE。
   * 主要用于 Sora2API 这类改为前端轮询 pending 的厂商，避免再维持一条前端 SSE 长连接。
   */
  emitStoreOnly(userId: string, event: TaskProgressEvent) {
    this.storeLatest(userId, event)
  }

  /**
   * 返回当前用户下仍处于 queued / running 状态的任务快照，
   * 可按 vendor 过滤，用于前端轮询 pending。
   */
  getPending(userId: string, vendor?: string): TaskProgressEvent[] {
    const store = this.latestByUser.get(userId)
    if (!store) return []
    const targetVendor = (vendor || '').trim().toLowerCase()
    const result: TaskProgressEvent[] = []
    for (const ev of store.values()) {
      if (!ev || !ev.status) continue
      if (ev.status !== 'queued' && ev.status !== 'running') continue
      if (targetVendor && (ev.vendor || '').toLowerCase() !== targetVendor) continue
      result.push(ev)
    }
    return result
  }

  private storeLatest(userId: string, event: TaskProgressEvent) {
    if (!userId || !event) return
    const payload: TaskProgressEvent = {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
    }
    const key = makeStoredKey({
      vendor: payload.vendor,
      nodeId: payload.nodeId,
      taskId: payload.taskId,
    })
    let store = this.latestByUser.get(userId)
    if (!store) {
      store = new Map<string, TaskProgressEvent>()
      this.latestByUser.set(userId, store)
    }
    // 对于已结束的任务，直接从 pending 快照中删除，避免泄漏
    if (payload.status === 'succeeded' || payload.status === 'failed') {
      store.delete(key)
      return
    }
    store.set(key, payload)
  }

  stream(userId: string): Observable<MessageEvent> {
    return this.emitter.asObservable().pipe(
      filter((message) => message.userId === userId),
      map((message) => ({ data: message.event })),
    )
  }
}
