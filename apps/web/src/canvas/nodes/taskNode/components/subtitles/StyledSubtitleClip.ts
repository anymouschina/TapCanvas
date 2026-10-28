import type { IClip } from '@webav/av-cliper'
import { paintSubtitle, resolveSubtitleStyle, type SubtitleFontSizeTier, type SubtitleStyle } from './subtitleStyle'
import { resolveSubtitleTextAtTime, type RenderSubtitle } from './renderTimeline'

type Caption = Readonly<{ start: number; end: number; text: string }>

/** Transparent WebAV overlay using the same painter as the editor preview. */
export class StyledSubtitleClip implements IClip {
  readonly meta: IClip['meta']
  readonly ready: IClip['ready']
  private readonly canvas: OffscreenCanvas
  private readonly context: OffscreenCanvasRenderingContext2D
  private readonly style: ReturnType<typeof resolveSubtitleStyle>
  private readonly renderCaptions: readonly RenderSubtitle[]
  private cached: VideoFrame | null = null
  private cachedText: string | null = null
  private destroyed = false

  constructor(
    private readonly captions: readonly Caption[],
    width: number,
    height: number,
    private readonly tier: SubtitleFontSizeTier,
    private readonly customStyle?: SubtitleStyle,
  ) {
    this.style = resolveSubtitleStyle(tier, customStyle)
    this.renderCaptions = captions.map(caption => ({ startUs: caption.start, endUs: caption.end, text: caption.text }))
    this.meta = { width, height, duration: captions.reduce((end, caption) => Math.max(end, caption.end), 0) }
    this.canvas = new OffscreenCanvas(width, height)
    const context = this.canvas.getContext('2d')
    if (!context) throw new Error('无法初始化字幕绘制画布')
    this.context = context
    this.ready = Promise.resolve(this.meta)
  }

  async tick(time: number): ReturnType<IClip['tick']> {
    if (this.destroyed) throw new Error('字幕绘制素材已释放')
    if (time >= this.meta.duration) return { state: 'done' }
    const text = resolveSubtitleTextAtTime(this.renderCaptions, time)
    if (text !== this.cachedText || !this.cached) {
      this.cached?.close()
      this.context.clearRect(0, 0, this.meta.width, this.meta.height)
      paintSubtitle(this.context, this.meta.width, this.meta.height, text, this.style)
      this.cached = new VideoFrame(this.canvas, { timestamp: time })
      this.cachedText = text
    }
    return { video: new VideoFrame(this.cached, { timestamp: time }), state: 'success' }
  }

  async clone(): Promise<this> {
    return new StyledSubtitleClip(this.captions, this.meta.width, this.meta.height, this.tier, this.customStyle) as this
  }

  destroy(): void {
    this.destroyed = true
    this.cached?.close()
    this.cached = null
    this.canvas.width = 1
    this.canvas.height = 1
  }
}
