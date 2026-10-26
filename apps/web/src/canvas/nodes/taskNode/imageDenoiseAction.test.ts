import { describe, expect, it } from 'vitest'
import { isEligibleForGlobalStyleReference, mergeGlobalStylePrompt } from '../../../runner/globalStyleReferenceInjection'
import { buildImageDenoiseAction, type ImageDenoiseMode } from './imageDenoiseAction'

describe('manual image denoise reference policy', () => {
  it.each<ImageDenoiseMode>(['clean', 'enhance'])('keeps %s edits outside project style injection', (mode) => {
    const action = buildImageDenoiseAction(mode)
    expect(action.referenceImageStrategy).toBe('visible_composite_only')
    const eligible = isEligibleForGlobalStyleReference({
      isImageTask: true,
      isRoleCardTask: false,
      sourceTag: '',
      visibleCompositeOnlyReference: action.referenceImageStrategy === 'visible_composite_only',
      hasFocusGuide: false,
      hasExplicitStyleAssetInput: false,
    })
    expect(eligible).toBe(false)
    expect(mergeGlobalStylePrompt({
      basePrompt: action.prompt,
      stylePrompt: '项目中另行锁定的风格',
      eligible,
    })).toBe(action.prompt)
  })
})
