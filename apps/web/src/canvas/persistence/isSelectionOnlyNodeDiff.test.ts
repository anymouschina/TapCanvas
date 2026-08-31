import { describe, expect, it } from 'vitest'
import { isSelectionOnlyNodeDiff } from './isSelectionOnlyNodeDiff'

const node = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'taskNode',
  position: { x: 0, y: 0 },
  data: { kind: 'image' },
  ...extra,
})

describe('isSelectionOnlyNodeDiff', () => {
  it('treats the identical array as selection-only (nothing to save)', () => {
    const nodes = [node('a'), node('b')]
    expect(isSelectionOnlyNodeDiff(nodes, nodes)).toBe(true)
  })

  it('detects a pure selection flip', () => {
    const a = node('a')
    const b = node('b')
    expect(isSelectionOnlyNodeDiff([a, b], [{ ...a, selected: true }, b])).toBe(true)
  })

  it('detects deselect + select in one commit', () => {
    const a = node('a', { selected: true })
    const b = node('b')
    const next = [{ ...a, selected: false }, { ...b, selected: true }]
    expect(isSelectionOnlyNodeDiff([a, b], next)).toBe(true)
  })

  it('reports false when a node moved', () => {
    const a = node('a')
    const next = [{ ...a, position: { x: 10, y: 0 }, selected: true }]
    expect(isSelectionOnlyNodeDiff([a], next)).toBe(false)
  })

  it('reports false when node data changed alongside selection', () => {
    const a = node('a')
    const next = [{ ...a, data: { kind: 'image', prompt: 'x' }, selected: true }]
    expect(isSelectionOnlyNodeDiff([a], next)).toBe(false)
  })

  it('reports false when a node was added or removed', () => {
    const a = node('a')
    expect(isSelectionOnlyNodeDiff([a], [a, node('b')])).toBe(false)
    expect(isSelectionOnlyNodeDiff([a, node('b')], [a])).toBe(false)
  })

  it('reports false when order changed', () => {
    const a = node('a')
    const b = node('b')
    expect(isSelectionOnlyNodeDiff([a, b], [b, a])).toBe(false)
  })

  it('reports false when a new key appears with selection', () => {
    const a = node('a')
    const next = [{ ...a, selected: true, parentId: 'g1' }]
    expect(isSelectionOnlyNodeDiff([a], next)).toBe(false)
  })

  it('reports false for different arrays with no real difference', () => {
    // Distinct array wrappers over the same node references: nothing changed, so there is nothing to
    // save — but this is not a selection change either, and callers already handle the
    // reference-equal case. Returning false keeps the guard conservative.
    const a = node('a')
    expect(isSelectionOnlyNodeDiff([a], [a])).toBe(false)
  })
})
