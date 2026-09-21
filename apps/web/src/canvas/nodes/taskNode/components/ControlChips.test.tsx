import React from 'react'
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ControlChips } from './ControlChips'

describe('ControlChips running settings', () => {
  it('allows model and parameter changes while generation is running', async () => {
    const onModelChange = vi.fn()
    const onResolutionChange = vi.fn()
    const noop = () => {}
    render(<MantineProvider><ControlChips
      summaryChipStyles={{}} controlValueStyle={{}}
      summaryModelLabel="Model A" summaryDuration="10s" summaryResolution="720p" summaryExec="1个"
      showModelMenu modelList={[{ value: 'a', label: 'Model A' }, { value: 'b', label: 'Model B' }]}
      onModelChange={onModelChange}
      showTimeMenu={false} durationOptions={[]} onDurationChange={noop}
      showResolutionMenu={false} onResolutionChange={noop}
      showImageSizeMenu={false} imageSize="" onImageSizeChange={noop}
      showOrientationMenu={false} orientation="landscape" onOrientationChange={noop}
      showSampleMenu={false} sampleOptions={[1]} sampleCount={1} onSampleChange={noop}
      isCharacterNode={false} isRunning onCancelRun={noop} onRun={noop}
      generationSettings={{
        kind: 'video', summary: '720p', aspectValue: '16:9',
        quantity: { value: 1, options: [1, 2], unit: '个', onChange: noop },
        sections: [{ key: 'resolution', label: '清晰度', value: '720p', layout: 'segmented',
          options: [{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }],
          onChange: onResolutionChange }],
      }}
    /></MantineProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Model A' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Model B' }))
    expect(onModelChange).toHaveBeenCalledWith('b')
    const settings = screen.getByRole('button', { name: '打开视频生成参数' })
    expect(settings).toBeEnabled()
    fireEvent.click(settings)
    fireEvent.click(await screen.findByRole('button', { name: '1080p' }))
    expect(onResolutionChange).toHaveBeenCalledWith('1080p')
  })
})
