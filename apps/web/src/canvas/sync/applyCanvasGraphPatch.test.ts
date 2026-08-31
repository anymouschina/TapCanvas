import { describe, expect, it } from 'vitest'
import { applyCanvasGraphPatch, removeDanglingCanvasEdges } from './applyCanvasGraphPatch'

describe('applyCanvasGraphPatch', () => {
  it('removes incident edges when a node is removed without explicit edge removals', () => {
    const result = applyCanvasGraphPatch({
      nodes: [{ id: 'source' }, { id: 'removed' }, { id: 'target' }],
      edges: [
        { id: 'incident', source: 'source', target: 'removed' },
        { id: 'surviving', source: 'source', target: 'target' },
      ],
      patch: { removeNodeIds: ['removed'] },
    })

    expect(result.nodes.map((node) => node.id)).toEqual(['source', 'target'])
    expect(result.edges.map((edge) => edge.id)).toEqual(['surviving'])
  })

  it('rejects upserted edges whose endpoint nodes do not exist', () => {
    const result = applyCanvasGraphPatch({
      nodes: [{ id: 'source' }],
      edges: [],
      patch: {
        upsertEdges: [{ id: 'dangling', source: 'source', target: 'missing' }],
      },
    })

    expect(result.edges).toEqual([])
  })

  it('keeps valid upserts and replaces matching ids without duplicates', () => {
    const result = applyCanvasGraphPatch({
      nodes: [{ id: 'source', value: 'old' }],
      edges: [],
      patch: {
        upsertNodes: [
          { id: 'source', value: 'new' },
          { id: 'target', value: 'added' },
        ],
        upsertEdges: [{ id: 'edge', source: 'source', target: 'target' }],
      },
    })

    expect(result.nodes).toEqual([
      { id: 'source', value: 'new' },
      { id: 'target', value: 'added' },
    ])
    expect(result.edges).toEqual([{ id: 'edge', source: 'source', target: 'target' }])
  })
})

describe('removeDanglingCanvasEdges', () => {
  it('does not mutate the input arrays', () => {
    const nodes = [{ id: 'node' }]
    const edges = [{ id: 'edge', source: 'node', target: 'missing' }]

    expect(removeDanglingCanvasEdges(nodes, edges)).toEqual([])
    expect(nodes).toEqual([{ id: 'node' }])
    expect(edges).toEqual([{ id: 'edge', source: 'node', target: 'missing' }])
  })
})
