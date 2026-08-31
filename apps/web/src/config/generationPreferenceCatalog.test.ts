import { describe, expect, it } from 'vitest'
import type { ModelOption } from './models'
import { resolveVideoGenerationPreferenceCatalog } from './generationPreferenceCatalog'

describe('resolveVideoGenerationPreferenceCatalog', () => {
  it('derives MiniMax H3 defaults and selectable specs from the live catalog row', () => {
    const option: ModelOption = {
      value: 'minimax-h3',
      label: 'MiniMax H3',
      meta: {
        videoOptions: {
          defaultResolution: '768p',
          resolutionOptions: [
            { value: '768p', label: '768P' },
            { value: '1440p', label: '1440P' },
          ],
          defaultSize: '16:9',
          sizeOptions: [
            { value: '16:9', label: '16:9', aspectRatio: '16:9' },
            { value: '9:16', label: '9:16', aspectRatio: '9:16' },
          ],
        },
      },
    }

    expect(resolveVideoGenerationPreferenceCatalog(option)).toEqual({
      resolutionOptions: [
        { value: '768p', label: '768P' },
        { value: '1440p', label: '1440P' },
      ],
      aspectOptions: [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
      ],
      defaultResolution: '768p',
      defaultAspect: '16:9',
    })
  })

  it('does not invent specifications when the selected catalog row has no video contract', () => {
    expect(resolveVideoGenerationPreferenceCatalog({ value: 'broken', label: 'Broken' })).toBeNull()
  })
})
