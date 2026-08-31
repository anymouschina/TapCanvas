import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { describe, expect, it, vi } from 'vitest'
import { GenerationSettingsPopover } from './GenerationSettingsPopover'

function renderVideoSettings() {
  const onAspectChange = vi.fn()
  const onResolutionChange = vi.fn()
  const onDurationChange = vi.fn()
  const onAudioChange = vi.fn()
  const onQuantityChange = vi.fn()
  render(
    <MantineProvider>
      <GenerationSettingsPopover
        kind="video"
        summary="16:9 · 720P · 5s · 1个"
        aspectValue="16:9"
        sections={[
          {
            key: 'aspect',
            label: '比例',
            value: '16:9',
            options: [
              { value: 'Auto', label: 'Auto' },
              { value: '16:9', label: '16:9' },
              { value: '9:16', label: '9:16' },
            ],
            layout: 'aspect',
            onChange: onAspectChange,
          },
          {
            key: 'resolution',
            label: '清晰度',
            value: '720P',
            options: [
              { value: '480P', label: '480P' },
              { value: '720P', label: '720P' },
            ],
            layout: 'segmented',
            onChange: onResolutionChange,
          },
        ]}
        duration={{
          value: 5,
          options: [
            { value: '4', label: '4s' },
            { value: '5', label: '5s' },
            { value: '10', label: '10s' },
          ],
          onChange: onDurationChange,
        }}
        audio={{
          value: true,
          onChange: onAudioChange,
        }}
        quantity={{
          value: 1,
          options: [1, 2, 4],
          unit: '个',
          onChange: onQuantityChange,
        }}
      />
    </MantineProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: '打开视频生成参数' }))
  return { onAspectChange, onResolutionChange, onDurationChange, onAudioChange, onQuantityChange }
}

describe('GenerationSettingsPopover', () => {
  it('anchors the panel to the trigger and clamps it inside the viewport', async () => {
    renderVideoSettings()
    const trigger = screen.getByRole('button', { name: '打开视频生成参数' })
    fireEvent.click(trigger)
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 900,
      y: 500,
      top: 500,
      right: 1000,
      bottom: 532,
      left: 900,
      width: 100,
      height: 32,
      toJSON: () => ({}),
    })
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: '视频生成参数' })
    expect(dialog).toHaveStyle({ left: '672px', bottom: '276px' })
  })

  it('places aspect, resolution, duration and quantity in one usable panel', async () => {
    const callbacks = renderVideoSettings()

    expect(await screen.findByRole('heading', { name: '比例' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '清晰度' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '视频时长' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '生成音频' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '生成数量' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '9:16' }))
    expect(callbacks.onAspectChange).toHaveBeenCalledWith('9:16')

    fireEvent.click(screen.getByRole('button', { name: '480P' }))
    expect(callbacks.onResolutionChange).toHaveBeenCalledWith('480P')

    fireEvent.change(screen.getByRole('slider', { name: '视频时长' }), { target: { value: '2' } })
    expect(callbacks.onDurationChange).toHaveBeenCalledWith(10)

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(callbacks.onAudioChange).toHaveBeenCalledWith(false)

    fireEvent.click(screen.getByRole('button', { name: '4个' }))
    expect(callbacks.onQuantityChange).toHaveBeenCalledWith(4)
  })

  it('normalizes a typed duration to the nearest supported catalog value', async () => {
    const { onDurationChange } = renderVideoSettings()
    const input = await screen.findByRole('spinbutton', { name: '视频时长秒数' })

    fireEvent.change(input, { target: { value: '8' } })
    fireEvent.blur(input)

    expect(onDurationChange).toHaveBeenCalledWith(10)
    expect(input).toHaveValue(10)
  })

  it('keeps the open panel mounted when a canvas pan starts', async () => {
    renderVideoSettings()
    const canvasPane = document.createElement('div')
    canvasPane.className = 'react-flow__pane'
    document.body.appendChild(canvasPane)

    fireEvent.pointerDown(canvasPane)

    expect(await screen.findByRole('dialog', { name: '视频生成参数' })).toBeInTheDocument()
    canvasPane.remove()
  })

  it('still closes for a genuine outside interaction away from the canvas', async () => {
    renderVideoSettings()
    expect(await screen.findByRole('dialog', { name: '视频生成参数' })).toBeInTheDocument()

    fireEvent.pointerDown(document.body)

    expect(screen.queryByRole('dialog', { name: '视频生成参数' })).not.toBeInTheDocument()
  })
})
