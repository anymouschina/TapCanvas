import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VideoCompareModal } from './VideoCompareModal'
import { useVideoCompareStore } from './videoCompareStore'
import type { VideoCompareSource } from './videoCompareSource'

const source = (nodeId: string, label: string): VideoCompareSource => ({
  nodeId,
  label,
  url: `https://assets.example/${nodeId}.mp4`,
  durationSeconds: 6,
})

function openComparison(): void {
  useVideoCompareStore.getState().openComparison(
    source('video-a', '原片'),
    source('video-b', '还原片'),
  )
}

beforeEach(() => {
  useVideoCompareStore.getState().close()
})

afterEach(() => {
  cleanup()
  useVideoCompareStore.getState().close()
})

describe('VideoCompareModal', () => {
  it('renders both real videos and switches between horizontal and vertical layouts', () => {
    openComparison()
    render(
      <MantineProvider>
        <VideoCompareModal className="video-compare-modal-under-test" />
      </MantineProvider>,
    )

    expect(screen.getByLabelText('视频 A 播放画面').getAttribute('src')).toBe('https://assets.example/video-a.mp4')
    expect(screen.getByLabelText('视频 B 播放画面').getAttribute('src')).toBe('https://assets.example/video-b.mp4')
    const stage = document.querySelector<HTMLElement>('.tc-video-compare__stage')
    expect(stage?.dataset.layout).toBe('side-by-side')

    fireEvent.click(screen.getByText('上下'))
    expect(stage?.dataset.layout).toBe('stacked')

    fireEvent.click(screen.getByLabelText('关闭视频对比'))
    expect(useVideoCompareStore.getState().session).toEqual({ phase: 'idle' })
  })

})
