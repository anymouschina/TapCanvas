import type { Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerCanvasTidyExecutor, useRFStore } from './store'

const makeNode = (id: string, x = 0): Node => ({
  id,
  type: 'taskNode',
  position: { x, y: 0 },
  data: {},
})

describe('canvas tidy executor', () => {
  let unregister: (() => void) | null = null

  beforeEach(() => {
    useRFStore.setState({
      nodes: [makeNode('node-1')],
      edges: [],
      historyPast: [],
      historyFuture: [],
      userMovedNodeIds: new Set<string>(),
    })
  })

  afterEach(() => {
    unregister?.()
    unregister = null
  })

  it('delegates tidy execution to the registered canvas executor', () => {
    const run = vi.fn()
    unregister = registerCanvasTidyExecutor({ run, cancel: vi.fn() })

    useRFStore.getState().tidyByCategory()

    expect(run).toHaveBeenCalledOnce()
  })

  it('forwards the explicit workflow-group arrangement request from the one-click action', () => {
    const run = vi.fn()
    unregister = registerCanvasTidyExecutor({ run, cancel: vi.fn() })

    useRFStore.getState().tidyByCategory({ arrangeWorkflowGroups: true })

    expect(run).toHaveBeenCalledWith({ arrangeWorkflowGroups: true })
  })

  it('fails explicitly after the canvas executor is unregistered', () => {
    unregister = registerCanvasTidyExecutor({ run: vi.fn(), cancel: vi.fn() })
    unregister()
    unregister = null

    expect(() => useRFStore.getState().tidyByCategory()).toThrow('canvas_tidy_executor_unavailable')
  })

  it('commits the final node references with one undo snapshot', () => {
    const before = useRFStore.getState().nodes
    const finalNodes = [makeNode('node-1', 320)]

    useRFStore.getState().commitTidyNodes(finalNodes, ['node-1'])

    const state = useRFStore.getState()
    expect(state.nodes).toBe(finalNodes)
    expect(state.historyPast).toHaveLength(1)
    expect(state.historyPast[0].nodes).toBe(before)
    expect(state.userMovedNodeIds.has('node-1')).toBe(true)
  })

  it('cancels an in-flight tidy before undo restores history', () => {
    const cancel = vi.fn()
    unregister = registerCanvasTidyExecutor({ run: vi.fn(), cancel })
    const originalNodes = useRFStore.getState().nodes
    useRFStore.getState().commitTidyNodes([makeNode('node-1', 320)], ['node-1'])

    useRFStore.getState().undo()

    expect(cancel).toHaveBeenCalledOnce()
    expect(useRFStore.getState().nodes).toBe(originalNodes)
  })
})
