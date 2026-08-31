import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VideoCompareSelectionAction } from './VideoCompareSelectionAction'
import type { VideoCompareSelectionResolution } from './videoCompareSelection'

const readyResolution: Extract<VideoCompareSelectionResolution, { kind: 'ready' }> = {
  kind: 'ready',
  source: {
    nodeId: 'video-a',
    label: '原片',
    url: 'https://assets.example/video-a.mp4',
    durationSeconds: 8,
  },
  target: {
    nodeId: 'video-b',
    label: '还原片',
    url: 'https://assets.example/video-b.mp4',
    durationSeconds: 8,
  },
}

function renderAction(
  resolution: VideoCompareSelectionResolution,
  onCompare = vi.fn(),
  onMissingAssets = vi.fn(),
): { onCompare: ReturnType<typeof vi.fn>; onMissingAssets: ReturnType<typeof vi.fn> } {
  render(
    <MantineProvider>
      <VideoCompareSelectionAction
        className="video-compare-selection-action-under-test"
        resolution={resolution}
        onCompare={onCompare}
        onMissingAssets={onMissingAssets}
      />
    </MantineProvider>,
  )
  return { onCompare, onMissingAssets }
}

afterEach(() => cleanup())

describe('VideoCompareSelectionAction', () => {
  it('stays hidden unless exactly two video nodes are selected', () => {
    renderAction({ kind: 'not-video-pair' })
    expect(screen.queryByRole('button', { name: '对比还原度' })).toBeNull()
  })

  it('shows a visible entry and opens a ready comparison', () => {
    const { onCompare } = renderAction(readyResolution)
    fireEvent.click(screen.getByRole('button', { name: '对比还原度' }))
    expect(onCompare).toHaveBeenCalledWith(readyResolution)
  })

  it('keeps the entry visible and reports missing video assets on click', () => {
    const { onMissingAssets } = renderAction({ kind: 'missing-assets', nodeIds: ['video-b'] })
    fireEvent.click(screen.getByRole('button', { name: '对比还原度' }))
    expect(onMissingAssets).toHaveBeenCalledWith(['video-b'])
  })
})
