export type FlowPatchToolCall =
  | {
      name: 'add_node'
      args: {
        id: string
        kind: string
        preset?: string
        position?: { x: number; y: number }
        content?: Record<string, unknown>
        data?: Record<string, unknown>
      }
    }
  | {
      name: 'connect_edge'
      args: {
        source: string
        target: string
        sourceHandle?: string
        targetHandle?: string
      }
    }
  | {
      name: 'set_param'
      args: { nodeId: string; patch: Record<string, unknown> }
    }
  | {
      name: 'link_existing_asset'
      args: { targetNodeId: string; existingNodeId: string; role: string }
    }
  | {
      name: 'add_director_console'
      args: {
        id: string
        position?: { x: number; y: number }
      }
    }

export type BatchSink = {
  applyToolCall: (call: FlowPatchToolCall) => void
  commitBatch: (info: { batchUlid: string; focusNodeId?: string; summary?: string }) => void
  discardBatch: (info: { batchUlid: string; reason: string }) => void
}

export type BatchBuffer = {
  readonly batchUlid: string
  readonly isClosed: boolean
  enqueue: (call: FlowPatchToolCall) => void
  commit: (finalize: { focusNodeId?: string; summary?: string }) => void
  discard: (reason: string) => void
}

export function createBatchBuffer(params: {
  batchUlid: string
  sink: BatchSink
}): BatchBuffer {
  const { batchUlid, sink } = params
  const queue: FlowPatchToolCall[] = []
  let closed = false

  return {
    get batchUlid() {
      return batchUlid
    },
    get isClosed() {
      return closed
    },
    enqueue(call) {
      if (closed) {
        throw new Error(`BatchBuffer ${batchUlid} already closed`)
      }
      queue.push(call)
    },
    commit(finalize) {
      if (closed) return
      closed = true
      for (const call of queue) sink.applyToolCall(call)
      sink.commitBatch({ batchUlid, ...finalize })
    },
    discard(reason) {
      if (closed) return
      closed = true
      sink.discardBatch({ batchUlid, reason })
    },
  }
}
