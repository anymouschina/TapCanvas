import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ImageAdvancedSettings } from './ImageAdvancedSettings'

describe('ImageAdvancedSettings', () => {
  it('emits typed user selections including zero and explicit false', () => {
    const onChange = vi.fn()
    render(<ImageAdvancedSettings setting={{ values: { raw: true }, onChange, specs: [
      { key: 'personalization', label: '个性化风格', type: 'string' },
      { key: 'stylize', label: '风格化程度', type: 'integer', default: 100, min: 0, max: 1000 },
      { key: 'raw', label: 'Raw', type: 'boolean' },
    ] }} />)
    fireEvent.change(screen.getByLabelText('个性化风格'), { target: { value: 'profile123' } })
    fireEvent.change(screen.getByLabelText('风格化程度'), { target: { value: '0' } })
    fireEvent.click(screen.getByLabelText('Raw'))
    expect(onChange.mock.calls).toEqual([['personalization', 'profile123'], ['stylize', 0], ['raw', false]])
  })
})
