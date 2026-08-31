import React from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ManagedImage } from './ManagedImage'

const resourceManagerMock = vi.hoisted(() => ({
  buildResourceId: vi.fn(() => 'image:original:https://example.com/cover.png'),
  recordDecodedSize: vi.fn(),
  reportImageElementFailure: vi.fn(),
}))

vi.mock('../services/resourceManager', () => ({
  resourceManager: resourceManagerMock,
}))

vi.mock('../store/resourceRuntimeStore', () => ({
  useResourceRuntimeStore: {
    getState: () => ({ imageEntries: {} }),
  },
}))

vi.mock('../hooks/useViewportVisibility', () => ({
  useViewportVisibility: () => ({
    ref: { current: null },
    isVisible: true,
  }),
}))

vi.mock('../hooks/useImageResource', () => ({
  useImageResource: ({ url }: { url: string }) => ({
    id: `image:original:${url}`,
    url,
    state: 'ready',
    renderUrl: url,
    transport: 'direct-url',
    lastError: null,
    estimatedBytes: null,
    width: null,
    height: null,
    failurePhase: null,
    ownerCount: 1,
  }),
}))

vi.mock('./useTapCanvasUri', () => ({
  useTapCanvasUri: () => null,
}))

describe('ManagedImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mounts only one image when source and direct render URL are identical', async () => {
    const { container } = render(
      <React.StrictMode>
        <ManagedImage className="cover" src="https://example.com/cover.png" alt="cover" />
      </React.StrictMode>,
    )

    await waitFor(() => {
      expect(container.querySelectorAll('img')).toHaveLength(1)
    })
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/cover.png')
  })

  it('records a native image failure and does not remount the broken URL', async () => {
    const onError = vi.fn()
    const { container, rerender } = render(
      <ManagedImage
        className="cover"
        src="https://example.com/cover.png"
        alt="cover"
        onError={onError}
      />,
    )

    const image = await waitFor(() => {
      const element = container.querySelector('img')
      expect(element).not.toBeNull()
      return element as HTMLImageElement
    })
    fireEvent.error(image)

    await waitFor(() => {
      expect(container.querySelector('img[src="https://example.com/cover.png"]')).toBeNull()
    })
    rerender(
      <ManagedImage
        className="cover"
        src="https://example.com/cover.png"
        alt="cover"
        onError={onError}
      />,
    )
    expect(container.querySelector('img[src="https://example.com/cover.png"]')).toBeNull()
    expect(resourceManagerMock.reportImageElementFailure).toHaveBeenCalledWith(
      'image:original:https://example.com/cover.png',
      'https://example.com/cover.png',
    )
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
