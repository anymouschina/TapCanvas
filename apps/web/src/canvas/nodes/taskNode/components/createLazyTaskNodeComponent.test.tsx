// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createLazyTaskNodeComponent } from './createLazyTaskNodeComponent'

describe('createLazyTaskNodeComponent', () => {
  it('does not request the feature module before the feature is rendered', async () => {
    const loader = vi.fn(async () => ({
      default: ({ label }: { label: string }) => <div>{label}</div>,
    }))
    const LazyFeature = createLazyTaskNodeComponent(loader)

    expect(loader).not.toHaveBeenCalled()

    render(<LazyFeature label="loaded on demand" />)

    expect(loader).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('loaded on demand')).toBeTruthy()
  })
})
