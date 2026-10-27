export type SubtitleFontSizeTier = 'sm' | 'md' | 'lg'
export type SubtitleStyle = {
  fontFamily?: 'sans-serif' | 'serif' | 'monospace'
  /** Fraction of video height; when present, overrides the fontSize shortcut. */
  fontSizeRatio?: number
  color?: string
  bold?: boolean
  strokeColor?: string
  /** Reference pixels at 1080 video height, scaled with the output resolution. */
  strokeWidth?: number
  backgroundColor?: string
  backgroundOpacity?: number
  position?: 'top' | 'center' | 'bottom'
  verticalMarginRatio?: number
  alignment?: 'left' | 'center' | 'right'
}

export const SUBTITLE_FONT_RATIO: Record<SubtitleFontSizeTier, number> = { sm: 0.035, md: 0.045, lg: 0.06 }
export const SUBTITLE_BOTTOM_OFFSET_RATIO = 0.06
export const SUBTITLE_MIN_FONT_PX = 12
export const DEFAULT_SUBTITLE_STYLE = {
  fontFamily: 'sans-serif', color: '#FFFFFF', bold: false, strokeColor: '#000000',
  backgroundColor: '#000000', backgroundOpacity: 0, position: 'bottom',
  verticalMarginRatio: SUBTITLE_BOTTOM_OFFSET_RATIO, alignment: 'center',
} as const

/** Restrict colours to hex, so persisted input is safe in both Canvas and HTML. */
export function parseSubtitleStyle(value: unknown): SubtitleStyle | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('字幕样式必须是对象')
  const raw = value as Record<string, unknown>
  const result: SubtitleStyle = {}
  const allowed = ['fontFamily', 'fontSizeRatio', 'color', 'bold', 'strokeColor', 'strokeWidth', 'backgroundColor', 'backgroundOpacity', 'position', 'verticalMarginRatio', 'alignment']
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) throw new Error(`不支持的字幕样式字段：${key}`)
  for (const key of ['color', 'strokeColor', 'backgroundColor'] as const) {
    const color = raw[key]
    if (color === undefined) continue
    if (typeof color !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) throw new Error(`字幕 ${key} 必须是 #RGB 或 #RRGGBB 颜色`)
    result[key] = color.toUpperCase()
  }
  for (const [key, min, max] of [['fontSizeRatio', 0.015, 0.15], ['strokeWidth', 0, 12], ['backgroundOpacity', 0, 1], ['verticalMarginRatio', 0, 0.4]] as const) {
    const numeric = raw[key]
    if (numeric === undefined) continue
    if (typeof numeric !== 'number' || !Number.isFinite(numeric) || numeric < min || numeric > max) throw new Error(`字幕 ${key} 必须在 ${min}–${max} 范围内`)
    result[key] = numeric
  }
  if (raw.bold !== undefined) {
    if (typeof raw.bold !== 'boolean') throw new Error('字幕 bold 必须是布尔值')
    result.bold = raw.bold
  }
  if (raw.fontFamily !== undefined) {
    if (raw.fontFamily !== 'sans-serif' && raw.fontFamily !== 'serif' && raw.fontFamily !== 'monospace') throw new Error('不支持的字幕字体')
    result.fontFamily = raw.fontFamily
  }
  if (raw.position !== undefined) {
    if (raw.position !== 'top' && raw.position !== 'center' && raw.position !== 'bottom') throw new Error('字幕位置无效')
    result.position = raw.position
  }
  if (raw.alignment !== undefined) {
    if (raw.alignment !== 'left' && raw.alignment !== 'center' && raw.alignment !== 'right') throw new Error('字幕对齐方式无效')
    result.alignment = raw.alignment
  }
  return result
}

export function resolveSubtitleStyle(tier: SubtitleFontSizeTier, value?: SubtitleStyle) {
  if (tier !== 'sm' && tier !== 'md' && tier !== 'lg') throw new Error('字幕字号无效')
  return { ...DEFAULT_SUBTITLE_STYLE, fontSizeRatio: SUBTITLE_FONT_RATIO[tier], ...parseSubtitleStyle(value) }
}

export type ResolvedSubtitleStyle = ReturnType<typeof resolveSubtitleStyle>

/** Shared by canvas preview and WebAV export, including its Worker execution. */
export function paintSubtitle(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
  style: ResolvedSubtitleStyle,
): { left: number; top: number; width: number; height: number } | undefined {
  if (!text) return undefined
  const fontSize = Math.max(12, Math.round(height * style.fontSizeRatio))
  const maxWidth = width * 0.9
  const lineHeight = Math.round(fontSize * 1.25)
  const padding = Math.round(fontSize * 0.2)
  ctx.save()
  ctx.font = `${style.bold ? 'bold ' : ''}${fontSize}px ${style.fontFamily}`
  ctx.textAlign = style.alignment
  ctx.textBaseline = 'alphabetic'
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let current = ''
    const cjk = /[\u4e00-\u9fff]/.test(paragraph)
    const units = cjk ? Array.from(paragraph) : paragraph.split(' ')
    for (const unit of units) {
      const next = current ? `${current}${cjk ? '' : ' '}${unit}` : unit
      if (ctx.measureText(next).width <= maxWidth) current = next
      else if (current) { lines.push(current); current = unit }
      else { lines.push(unit); current = '' }
    }
    if (current || paragraph === '') lines.push(current)
  }
  const blockHeight = fontSize + Math.max(0, lines.length - 1) * lineHeight
  const margin = Math.round(height * style.verticalMarginRatio)
  const firstBaseline = style.position === 'top' ? margin + fontSize
    : style.position === 'center' ? (height - blockHeight) / 2 + fontSize
      : height - margin - Math.max(0, lines.length - 1) * lineHeight
  const x = style.alignment === 'left' ? width * 0.05 : style.alignment === 'right' ? width * 0.95 : width / 2
  ctx.lineJoin = 'round'
  const strokeWidth = style.strokeWidth === undefined ? Math.max(2, Math.round(fontSize / 6)) : style.strokeWidth * height / 1080
  // Canvas ignores a lineWidth assignment of zero; skip strokeText explicitly.
  if (strokeWidth > 0) ctx.lineWidth = strokeWidth
  const boundsPadding = Math.max(padding, strokeWidth, 2)
  let boundsLeft = width
  let boundsRight = 0
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const y = firstBaseline + index * lineHeight
    const measuredWidth = Math.min(maxWidth, ctx.measureText(line).width)
    const left = style.alignment === 'left' ? x : style.alignment === 'right' ? x - measuredWidth : x - measuredWidth / 2
    boundsLeft = Math.min(boundsLeft, left - boundsPadding)
    boundsRight = Math.max(boundsRight, left + measuredWidth + boundsPadding)
    if (style.backgroundOpacity > 0) {
      ctx.globalAlpha = style.backgroundOpacity
      ctx.fillStyle = style.backgroundColor
      ctx.fillRect(left - padding, y - fontSize - padding, measuredWidth + padding * 2, lineHeight)
      ctx.globalAlpha = 1
    }
    if (strokeWidth > 0) {
      ctx.strokeStyle = style.strokeColor
      ctx.strokeText(line, x, y, maxWidth)
    }
    ctx.fillStyle = style.color
    ctx.fillText(line, x, y, maxWidth)
  }
  ctx.restore()
  const left = Math.max(0, Math.floor(boundsLeft))
  const top = Math.max(0, Math.floor(firstBaseline - fontSize - boundsPadding))
  return { left, top, width: Math.max(1, Math.ceil(Math.min(width, boundsRight)) - left),
    height: Math.max(1, Math.ceil(Math.min(height, firstBaseline + (lines.length - 1) * lineHeight + fontSize * 0.35 + boundsPadding)) - top) }
}
