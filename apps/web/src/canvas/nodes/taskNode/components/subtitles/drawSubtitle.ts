import { paintSubtitle, resolveSubtitleStyle, type SubtitleFontSizeTier, type SubtitleStyle } from './subtitleStyle'

/** Preview and WebAV export share the same painter and resolution ratios. */
export function drawSubtitleOverlay(
  canvas: HTMLCanvasElement,
  text: string,
  tier: SubtitleFontSizeTier,
  style?: SubtitleStyle,
): void {
  const resolvedStyle = resolveSubtitleStyle(tier, style)
  if (!text) return
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法初始化字幕预览画布')
  paintSubtitle(ctx, canvas.width, canvas.height, text, resolvedStyle)
}
