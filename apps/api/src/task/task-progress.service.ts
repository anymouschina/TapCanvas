import { Injectable, Logger, MessageEvent } from '@nestjs/common'
import { Observable, Subject } from 'rxjs'
import { filter, map } from 'rxjs/operators'
import type { TaskProgressEvent } from './task.types'

interface TaskProgressEnvelope {
  userId: string
  event: TaskProgressEvent
}

@Injectable()
export class TaskProgressService {
  private readonly logger = new Logger(TaskProgressService.name)
  private readonly emitter = new Subject<TaskProgressEnvelope>()

  emit(userId: string, event: TaskProgressEvent) {
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

  stream(userId: string): Observable<MessageEvent> {
    return this.emitter.asObservable().pipe(
      filter((message) => message.userId === userId),
      map((message) => ({ data: message.event })),
    )
  }
}
