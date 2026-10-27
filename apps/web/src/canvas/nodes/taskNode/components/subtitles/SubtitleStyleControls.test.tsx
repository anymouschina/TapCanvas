// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SubtitleStyleControls } from './SubtitleStyleControls'
import type { SubtitleStyle } from './types'
afterEach(cleanup)

function ControlledStyleEditor({ onChange }: { onChange: (style: SubtitleStyle) => void }) {
  const [style, setStyle] = useState<SubtitleStyle>({ color: '#FFFFFF', strokeColor: '#000000', backgroundColor: '#112233', backgroundOpacity: 0.4 })
  return <MantineProvider><SubtitleStyleControls fontTier="md" style={style} onChange={(next) => { setStyle(next); onChange(next) }} /></MantineProvider>
}
describe('subtitle style editor', () => {
  it('keeps incomplete color input local and persists only a valid color', () => {
    const change = vi.fn()
    render(<MantineProvider><SubtitleStyleControls fontTier="md" onChange={change} /></MantineProvider>)
    const input = screen.getByLabelText('文字颜色')
    fireEvent.change(input, { target: { value: '#' } })
    expect(change).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(screen.getByText('请输入 #RGB 或 #RRGGBB 颜色')).toBeTruthy()
    fireEvent.change(input, { target: { value: '#FF5500' } })
    expect(change).toHaveBeenCalledWith({ color: '#FF5500' })
    expect(screen.queryByText('请输入 #RGB 或 #RRGGBB 颜色')).toBeNull()
  })

  it('shows a color panel immediately and writes a chosen swatch only to the selected target', () => {
    const change = vi.fn()
    render(<ControlledStyleEditor onChange={change} />)
    expect(screen.getByLabelText('文字颜色饱和度与明度')).toBeTruthy()
    expect(screen.getByLabelText('文字颜色色相')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '#FFD43B' }))
    expect(change).toHaveBeenLastCalledWith({ color: '#FFD43B', strokeColor: '#000000', backgroundColor: '#112233', backgroundOpacity: 0.4 })
    fireEvent.click(screen.getByLabelText('描边'))
    fireEvent.click(screen.getByRole('button', { name: '#4DABF7' }))
    expect(change).toHaveBeenLastCalledWith({ color: '#FFD43B', strokeColor: '#4DABF7', backgroundColor: '#112233', backgroundOpacity: 0.4 })
    fireEvent.click(screen.getByLabelText('背景'))
    fireEvent.click(screen.getByRole('button', { name: '#FF6B6B' }))
    expect(change).toHaveBeenLastCalledWith({ color: '#FFD43B', strokeColor: '#4DABF7', backgroundColor: '#FF6B6B', backgroundOpacity: 0.4 })
    fireEvent.click(screen.getByLabelText('文字'))
    expect((screen.getByLabelText('文字颜色') as HTMLInputElement).value).toBe('#FFD43B')
  })

  it('preserves each unfinished HEX draft when switching targets and can recover using the palette', () => {
    const change = vi.fn()
    render(<ControlledStyleEditor onChange={change} />)
    fireEvent.change(screen.getByLabelText('文字颜色'), { target: { value: '#GG' } })
    fireEvent.blur(screen.getByLabelText('文字颜色'))
    fireEvent.click(screen.getByLabelText('背景'))
    expect((screen.getByLabelText('背景颜色') as HTMLInputElement).value).toBe('#112233')
    fireEvent.change(screen.getByLabelText('背景颜色'), { target: { value: '#ABC' } })
    expect(change).toHaveBeenLastCalledWith({ color: '#FFFFFF', strokeColor: '#000000', backgroundColor: '#ABC', backgroundOpacity: 0.4 })
    fireEvent.click(screen.getByLabelText('文字'))
    expect((screen.getByLabelText('文字颜色') as HTMLInputElement).value).toBe('#GG')
    expect(screen.getByText('请输入 #RGB 或 #RRGGBB 颜色')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '#FFFFFF' }))
    expect((screen.getByLabelText('文字颜色') as HTMLInputElement).value).toBe('#FFFFFF')
    expect(screen.queryByText('请输入 #RGB 或 #RRGGBB 颜色')).toBeNull()
  })

  it('allows keyboard color adjustment without persisting invalid colors', () => {
    const change = vi.fn()
    render(<ControlledStyleEditor onChange={change} />)
    fireEvent.keyDown(screen.getByLabelText('文字颜色饱和度与明度'), { key: 'ArrowLeft' })
    expect(change).toHaveBeenCalled()
    expect(change.mock.lastCall?.[0].color).toMatch(/^#[\da-f]{6}$/i)
  })

  it('renders font options above the editor modal and applies the chosen font', () => {
    const change = vi.fn()
    render(<ControlledStyleEditor onChange={change} />)
    fireEvent.click(screen.getByLabelText('字幕字体', { selector: 'input' }))
    const option = screen.getByRole('option', { name: '衬线' })
    expect((option.closest('.mantine-Select-dropdown') as HTMLElement).style.zIndex).toBe('8400')
    fireEvent.click(option)
    expect(change.mock.lastCall?.[0].fontFamily).toBe('serif')
  })
})
