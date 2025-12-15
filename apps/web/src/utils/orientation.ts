export type Orientation = 'portrait' | 'landscape'

const portraitHints = new Set(['portrait', 'vertical', '竖屏', '竖向', 'vertical-screen', 'portrait-mode'])
const landscapeHints = new Set(['landscape', 'horizontal', '横屏', '横向', 'horizontal-screen', 'landscape-mode'])

export function normalizeOrientation(raw: any): Orientation {
  if (raw == null) return 'landscape'
  const val = String(raw).trim().toLowerCase()
  if (!val) return 'landscape'

  if (portraitHints.has(val)) return 'portrait'
  if (landscapeHints.has(val)) return 'landscape'

  const aspectMatch = val.match(/^(\d+)\s*:\s*(\d+)$/)
  if (aspectMatch) {
    const width = Number(aspectMatch[1])
    const height = Number(aspectMatch[2])
    if (Number.isFinite(width) && Number.isFinite(height)) {
      return height > width ? 'portrait' : 'landscape'
    }
  }

  return 'landscape'
}
