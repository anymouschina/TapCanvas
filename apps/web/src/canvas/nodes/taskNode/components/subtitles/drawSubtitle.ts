import { SUBTITLE_FONT_RATIO, type SubtitleFontSizeTier } from './types'

/** CJK 逐字断行 / 西文按词断行（与 EmbedSubtitlesClip 同策略的简化版） */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let cur = ''
  const isCjk = /[一-鿿]/.test(text)
  const units = isCjk ? Array.from(text) : text.split(' ')
  const joiner = isCjk ? '' : ' '
  for (const u of units) {
    const next = cur ? cur + joiner + u : u
    if (ctx.measureText(next).width <= maxWidth) cur = next
    else if (cur) {
      lines.push(cur)
      cur = u
    } else {
      lines.push(u)
      cur = ''
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/** 在预览 canvas 底部叠画字幕（帧已画好后调用），风格对齐烧录效果 */
export function drawSubtitleOverlay(
  canvas: HTMLCanvasElement,
  text: string,
  tier: SubtitleFontSizeTier,
): void {
  if (!text) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const fontSize = Math.max(10, Math.round(canvas.height * SUBTITLE_FONT_RATIO[tier]))
  ctx.save()
  ctx.font = `${fontSize}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const maxWidth = canvas.width * 0.9
  const lines = wrapText(ctx, text, maxWidth)
  const lineH = Math.round(fontSize * 1.25)
  let y = canvas.height - Math.round(canvas.height * 0.06)
  ctx.lineWidth = Math.max(2, Math.round(fontSize / 6))
  ctx.lineJoin = 'round'
  ctx.strokeStyle = 'rgba(0,0,0,0.9)'
  ctx.fillStyle = '#fff'
  for (let i = lines.length - 1; i >= 0; i--) {
    ctx.strokeText(lines[i], canvas.width / 2, y, maxWidth)
    ctx.fillText(lines[i], canvas.width / 2, y, maxWidth)
    y -= lineH
  }
  ctx.restore()
}
