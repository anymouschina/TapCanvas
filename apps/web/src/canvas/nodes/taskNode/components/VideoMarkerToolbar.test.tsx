// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { VideoMarkerToolbar } from './VideoMarkerToolbar'

vi.mock('@xyflow/react', () => ({
  NodeToolbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Position: { Bottom: 'bottom' },
}))

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    }),
  })
})

afterEach(cleanup)

describe('VideoMarkerToolbar', () => {
  it('renders persisted markers and lets the user remove one', () => {
    const onRemove = vi.fn()
    render(
      <MantineProvider>
        <VideoMarkerToolbar
          opened
          currentTimeSeconds={3}
          durationSeconds={12}
          markers={[{ id: 'marker-1', startSeconds: 2, endSeconds: 4, note: '重拍转身动作' }]}
          saving={false}
          onClose={vi.fn()}
          onRemove={onRemove}
          onSave={vi.fn()}
        />
      </MantineProvider>,
    )

    expect(screen.getByText('标记 1 · 2.00–4.00s')).toBeVisible()
    expect(screen.getByText('重拍转身动作')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '删除标记 1' }))
    expect(onRemove).toHaveBeenCalledWith('marker-1')
  })
})
