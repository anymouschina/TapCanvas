import { Injectable, Logger, MessageEvent } from '@nestjs/common'
import { Observable, Subject } from 'rxjs'
import { filter, map } from 'rxjs/operators'

export type ToolEvent =
  | {
      type: 'tool-call'
      toolCallId: string
      toolName: string
      input?: Record<string, any>
      providerExecuted?: boolean
      metadata?: Record<string, any>
    }
  | {
      type: 'tool-result'
      toolCallId: string
      toolName: string
      output?: unknown
      errorText?: string
    }

interface ToolEventEnvelope {
  userId: string
  event: ToolEvent
}

@Injectable()
export class ToolEventsService {
  private readonly logger = new Logger(ToolEventsService.name)
  private readonly emitter = new Subject<ToolEventEnvelope>()

  emit(userId: string, event: ToolEvent) {
    this.logger.debug('Emit tool event', { userId, type: event.type, tool: event.toolName })
    this.emitter.next({ userId, event })
  }

  stream(userId: string): Observable<MessageEvent> {
    return this.emitter.asObservable().pipe(
      filter(message => message.userId === userId),
      map(message => ({ data: message.event })),
    )
  }
}
