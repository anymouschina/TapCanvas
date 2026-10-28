import { afterEach, describe, expect, it, vi } from 'vitest'
import { drawSubtitleOverlay } from './drawSubtitle'
import { StyledSubtitleClip } from './StyledSubtitleClip'
import { paintSubtitle, parseSubtitleStyle, resolveSubtitleStyle, type SubtitleStyle } from './subtitleStyle'

function drawingContext() {
  const ctx = {
    font: '', textAlign: '', textBaseline: '', lineJoin: '', lineWidth: 1,
    globalAlpha: 1, fillStyle: '', strokeStyle: '',
    save: vi.fn(), restore: vi.fn(), clearRect: vi.fn(),
    measureText: (text: string) => ({ width: Array.from(text).length * 10 }),
    fillRect: vi.fn(), strokeText: vi.fn(), fillText: vi.fn(),
  }
  return { ctx, canvasContext: ctx as unknown as CanvasRenderingContext2D }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('subtitle style contract', () => {
  it('preserves the Pro fields and normalizes hex colours', () => {
    const style: SubtitleStyle = { fontFamily: 'monospace', fontSizeRatio: 0.08, color: '#acF',
      bold: true, strokeColor: '#0f0', strokeWidth: 3, backgroundColor: '#aabbcc',
      backgroundOpacity: 0.5, position: 'top', verticalMarginRatio: 0.1, alignment: 'left' }
    expect(parseSubtitleStyle(style)).toEqual({ ...style, color: '#ACF', strokeColor: '#0F0', backgroundColor: '#AABBCC' })
    expect(resolveSubtitleStyle('md', style)).toMatchObject({ ...style, color: '#ACF', strokeColor: '#0F0', backgroundColor: '#AABBCC' })
    expect(resolveSubtitleStyle('lg')).toMatchObject({ fontSizeRatio: 0.06, position: 'bottom', color: '#FFFFFF' })
  })

  it.each([null, [], { unexpected: true }, { color: 'red' }, { color: 'url(x)' },
    { fontSizeRatio: Number.NaN }, { strokeWidth: -1 }, { backgroundOpacity: 2 },
    { verticalMarginRatio: 0.5 }, { bold: 1 }, { position: 'outside' },
    { alignment: 'justify' }, { fontFamily: 'custom-font' }])('rejects invalid persisted input %j', value => {
    expect(() => parseSubtitleStyle(value)).toThrow()
  })
})

describe('shared subtitle painter', () => {
  it('paints bold coloured text, scaled stroke, opacity background and top-left placement', () => {
    const { ctx, canvasContext } = drawingContext()
    const bounds = paintSubtitle(canvasContext, 1920, 1080, 'Title', resolveSubtitleStyle('md', {
      fontSizeRatio: 0.1, fontFamily: 'serif', color: '#00ff00', bold: true, strokeWidth: 4,
      strokeColor: '#ff0000', backgroundColor: '#0000ff', backgroundOpacity: 0.5,
      position: 'top', alignment: 'left', verticalMarginRatio: 0.1,
    }))
    expect(ctx.font).toBe('bold 108px serif')
    expect(ctx.textAlign).toBe('left')
    expect(ctx.lineWidth).toBe(4)
    expect(ctx.fillStyle).toBe('#00FF00')
    expect(ctx.strokeStyle).toBe('#FF0000')
    expect(ctx.fillRect).toHaveBeenCalledOnce()
    expect(ctx.fillText).toHaveBeenCalledWith('Title', 96, 216, 1728)
    expect(bounds).toMatchObject({ left: 74, top: 86 })
    expect(ctx.restore).toHaveBeenCalledOnce()
  })

  it('uses the same minimum font size for preview and export and honours a zero stroke', () => {
    const { ctx, canvasContext } = drawingContext()
    const canvas = { width: 160, height: 90, getContext: () => canvasContext } as unknown as HTMLCanvasElement
    drawSubtitleOverlay(canvas, 'Hi', 'sm', { strokeWidth: 0, alignment: 'right', position: 'center' })
    expect(ctx.font).toBe('12px sans-serif')
    expect(ctx.strokeText).not.toHaveBeenCalled()
    expect(ctx.fillRect).not.toHaveBeenCalled()
    expect(ctx.fillText).toHaveBeenCalledWith('Hi', 152, 51, 144)
  })

  it('preserves explicit line breaks and wraps Chinese and western lines', () => {
    const { ctx, canvasContext } = drawingContext()
    paintSubtitle(canvasContext, 100, 200, '一二三四五六七八九十一\nhello world', resolveSubtitleStyle('md'))
    expect(ctx.fillText.mock.calls.map(call => call[0])).toEqual(['一二三四五六七八九', '十一', 'hello', 'world'])
  })
})

describe('StyledSubtitleClip', () => {
  it('draws every overlapping caption and clears ended lines on the next frame', async () => {
    const { ctx, canvasContext } = drawingContext()
    class TestCanvas {
      constructor(public width: number, public height: number) {}
      getContext() { return canvasContext }
    }
    class TestFrame { close() {} }
    vi.stubGlobal('OffscreenCanvas', TestCanvas)
    vi.stubGlobal('VideoFrame', TestFrame)
    const clip = new StyledSubtitleClip([
      { start: 0, end: 2_000_000, text: 'First' },
      { start: 1_000_000, end: 3_000_000, text: 'Second' },
    ], 640, 360, 'md')
    await clip.tick(1_500_000)
    expect(ctx.fillText.mock.calls.map(call => call[0])).toEqual(['First', 'Second'])
    ctx.fillText.mockClear()
    await clip.tick(2_000_000)
    expect(ctx.fillText.mock.calls.map(call => call[0])).toEqual(['Second'])
    clip.destroy()
  })

  it('renders the selected style in microsecond intervals, clears gaps and releases frames', async () => {
    const { ctx, canvasContext } = drawingContext()
    class TestCanvas {
      constructor(public width: number, public height: number) {}
      getContext() { return canvasContext }
    }
    const frames: TestFrame[] = []
    class TestFrame {
      close = vi.fn()
      timestamp: number
      constructor(_source: unknown, options: { timestamp: number }) {
        this.timestamp = options.timestamp
        frames.push(this)
      }
    }
    vi.stubGlobal('OffscreenCanvas', TestCanvas)
    vi.stubGlobal('VideoFrame', TestFrame)
    const clip = new StyledSubtitleClip([
      { start: 100_000, end: 500_000, text: 'Hello' },
      { start: 800_000, end: 1_000_000, text: 'End' },
    ], 320, 180, 'md', { color: '#00ff00', position: 'top', strokeWidth: 0 })
    expect(await clip.ready).toEqual({ width: 320, height: 180, duration: 1_000_000 })
    const first = await clip.tick(100_000)
    const second = await clip.tick(200_000)
    expect((first.video as unknown as TestFrame).timestamp).toBe(100_000)
    expect((second.video as unknown as TestFrame).timestamp).toBe(200_000)
    expect(ctx.fillText).toHaveBeenCalledOnce()
    expect(ctx.fillStyle).toBe('#00FF00')
    expect(ctx.strokeText).not.toHaveBeenCalled()
    await clip.tick(600_000)
    expect(ctx.clearRect).toHaveBeenCalledTimes(2)
    expect(frames[0].close).toHaveBeenCalledOnce()
    expect(await clip.tick(1_000_000)).toEqual({ state: 'done' })
    const clone = await clip.clone()
    expect(clone.meta).toEqual(clip.meta)
    clone.destroy()
    clip.destroy()
    await expect(clip.tick(0)).rejects.toThrow('已释放')
  })
})
