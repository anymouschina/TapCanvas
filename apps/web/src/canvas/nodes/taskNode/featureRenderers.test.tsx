// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderFeatureBlocks, type FeatureRendererContext } from './featureRenderers'

const featureLoads = vi.hoisted(() => ({ image: 0, audio: 0 }))

vi.mock('./components/ImageContent', () => {
  featureLoads.image += 1
  return { ImageContent: () => <div>async image content</div> }
})

vi.mock('./components/AudioContent', () => {
  featureLoads.audio += 1
  return { AudioContent: () => <div>async audio content</div> }
})

function createContext(): FeatureRendererContext {
  return {
    videoContent: null,
    imageProps: {} as unknown as FeatureRendererContext['imageProps'],
    storyboardEditorProps: {} as unknown as FeatureRendererContext['storyboardEditorProps'],
    audioProps: {} as unknown as NonNullable<FeatureRendererContext['audioProps']>,
  }
}

describe('renderFeatureBlocks', () => {
  it('loads only the requested kind content and deduplicates legacy feature aliases', async () => {
    const context = createContext()
    const { rerender } = render(
      <>{renderFeatureBlocks(['image', 'imageResults'], context)}</>,
    )

    expect(await screen.findByText('async image content')).toBeTruthy()
    expect(featureLoads.image).toBe(1)
    expect(featureLoads.audio).toBe(0)

    rerender(<>{renderFeatureBlocks(['audio'], context)}</>)

    expect(await screen.findByText('async audio content')).toBeTruthy()
    expect(featureLoads.audio).toBe(1)
  })
})
