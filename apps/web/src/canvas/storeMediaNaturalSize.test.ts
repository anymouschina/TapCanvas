import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import { useRFStore } from './store'
import { derivedApplyGuard } from './sync/remoteApplyGuard'

function imageNode(id: string): Node<Record<string, unknown>> {
  return {
    id,
    type: 'taskNode',
    position: { x: 0, y: 0 },
    data: { kind: 'image', label: id, imageUrl: `https://cdn.example.com/${id}.webp` },
  }
}

describe('media natural-size hydration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useRFStore.getState().reset()
    useRFStore.setState({
      nodes: [imageNode('first'), imageNode('second')],
      edges: [],
      graphProvenanceKey: 'flow:large-canvas',
    })
  })

  afterEach(() => {
    useRFStore.getState().reset()
    vi.useRealTimers()
  })

  it('batches same-frame measurements into one derived graph mutation', () => {
    const mutationOrigins: boolean[] = []
    const unsubscribe = useRFStore.subscribe((state, previous) => {
      if (state.nodes !== previous.nodes) mutationOrigins.push(derivedApplyGuard.active)
    })

    useRFStore.getState().applyMediaNaturalSize('first', {
      width: 1600,
      height: 900,
      url: 'https://cdn.example.com/first.webp',
    })
    useRFStore.getState().applyMediaNaturalSize('second', {
      width: 1200,
      height: 1200,
      url: 'https://cdn.example.com/second.webp',
    })

    expect(mutationOrigins).toEqual([])
    vi.runOnlyPendingTimers()

    expect(mutationOrigins).toEqual([true])
    expect(useRFStore.getState().nodes.map((node) => node.data.mediaNaturalSize)).toEqual([
      { width: 1600, height: 900, url: 'https://cdn.example.com/first.webp' },
      { width: 1200, height: 1200, url: 'https://cdn.example.com/second.webp' },
    ])
    unsubscribe()
  })

  it('cancels queued measurements when the active graph resets', () => {
    useRFStore.getState().applyMediaNaturalSize('first', {
      width: 1600,
      height: 900,
      url: 'https://cdn.example.com/first.webp',
    })

    useRFStore.getState().reset()
    vi.runOnlyPendingTimers()

    expect(useRFStore.getState().nodes).toEqual([])
  })

  it('uses a shell variant for aspect fitting without persisting its reduced dimensions', () => {
    useRFStore.setState((state) => ({
      nodes: state.nodes.map((node) => node.id === 'first'
        ? { ...node, data: { ...node.data, nodeWidth: 400, nodeHeight: 400 } }
        : node),
    }))
    useRFStore.getState().applyMediaNaturalSize('first', {
      width: 750,
      height: 422,
      url: 'https://cdn.example.com/first.webp',
      persistDimensions: false,
    })

    vi.runOnlyPendingTimers()

    const node = useRFStore.getState().nodes.find((candidate) => candidate.id === 'first')
    expect(node?.data.mediaNaturalSize).toBeUndefined()
    expect(Number(node?.data.nodeWidth) / Number(node?.data.nodeHeight)).toBeCloseTo(750 / 422, 2)
  })
})
