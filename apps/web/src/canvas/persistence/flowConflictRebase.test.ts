import { describe, expect, it } from 'vitest'
import { rebaseCanvasFlowOnConflict, rebaseValue } from './flowConflictRebase'

describe('rebaseValue', () => {
  it('merges independent nested edits without dropping either writer', () => {
    const base = { position: { x: 0, y: 0 }, data: { prompt: 'base', imageUrl: '' } }
    const local = { position: { x: 80, y: 0 }, data: { prompt: 'base', imageUrl: '' } }
    const server = { position: { x: 0, y: 0 }, data: { prompt: 'base', imageUrl: 'https://oss/result.png' } }

    expect(rebaseValue(base, local, server)).toEqual({
      position: { x: 80, y: 0 },
      data: { prompt: 'base', imageUrl: 'https://oss/result.png' },
    })
  })

  it('keeps the current local value for a true same-leaf conflict', () => {
    expect(rebaseValue('base', 'local', 'server')).toBe('local')
  })
})

describe('rebaseCanvasFlowOnConflict', () => {
  it('preserves server additions and local additions in one graph', () => {
    const result = rebaseCanvasFlowOnConflict({
      base: { nodes: [{ id: 'base' }], edges: [] },
      local: { nodes: [{ id: 'base' }, { id: 'local' }], edges: [] },
      server: { nodes: [{ id: 'base' }, { id: 'server' }], edges: [] },
    })
    expect(result.nodes.map((node) => node.id).sort()).toEqual(['base', 'local', 'server'])
  })

  it('does not resurrect a server-deleted item that local left unchanged', () => {
    const result = rebaseCanvasFlowOnConflict({
      base: { nodes: [{ id: 'keep' }, { id: 'removed' }], edges: [] },
      local: { nodes: [{ id: 'keep' }, { id: 'removed' }], edges: [] },
      server: { nodes: [{ id: 'keep' }], edges: [] },
    })
    expect(result.nodes).toEqual([{ id: 'keep' }])
  })

  it('honors a local deletion and removes newly dangling edges', () => {
    const result = rebaseCanvasFlowOnConflict({
      base: {
        nodes: [{ id: 'keep' }, { id: 'removed' }],
        edges: [{ id: 'edge', source: 'keep', target: 'removed' }],
      },
      local: { nodes: [{ id: 'keep' }], edges: [] },
      server: {
        nodes: [{ id: 'keep' }, { id: 'removed' }],
        edges: [{ id: 'edge', source: 'keep', target: 'removed' }],
      },
    })
    expect(result.nodes).toEqual([{ id: 'keep' }])
    expect(result.edges).toEqual([])
  })
})

