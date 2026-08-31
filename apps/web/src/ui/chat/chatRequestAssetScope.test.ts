import { describe, expect, it } from 'vitest'

import { shouldAttachSelectedCanvasAssets } from './chatRequestAssetScope'

describe('shouldAttachSelectedCanvasAssets', () => {
  it('isolates an explicit chapter/node command from a stale canvas selection', () => {
    expect(shouldAttachSelectedCanvasAssets({
      projectTextIsolation: false,
      explicitCanvasNodeId: 'chapter-seed-ch2',
    })).toBe(false)
  })

  it('keeps selected assets available to ordinary free-form chat', () => {
    expect(shouldAttachSelectedCanvasAssets({
      projectTextIsolation: false,
      explicitCanvasNodeId: '',
    })).toBe(true)
  })

  it('keeps project text isolation authoritative', () => {
    expect(shouldAttachSelectedCanvasAssets({
      projectTextIsolation: true,
      explicitCanvasNodeId: '',
    })).toBe(false)
  })
})
