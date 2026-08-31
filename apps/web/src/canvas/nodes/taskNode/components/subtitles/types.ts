export type SubtitleFontSizeTier = 'sm' | 'md' | 'lg'

export type SubtitleSegment = {
  id: string
  /** 归属源视频 URL（EditableClip.sourceUrl）；split 后多个子片段共享同一 sourceUrl */
  sourceUrl: string
  /** 相对源视频原始 0 点（µs） */
  startUs: number
  endUs: number
  text: string
  source: 'auto' | 'manual'
}

/** 持久化到 node.data.composeSubtitles 的形状 */
export type ComposeSubtitleState = {
  segments: SubtitleSegment[]
  fontSize: SubtitleFontSizeTier
  /** 生成真实人声时间轴时使用的 new-api 视频理解模型。 */
  model?: string
}

/** 字幕底边距 = 视频高 × 此比例（烧录与预览同源） */
export const SUBTITLE_BOTTOM_OFFSET_RATIO = 0.06
/** 烧录字号下限（px）——低分辨率下防不可读 */
export const SUBTITLE_MIN_FONT_PX = 12

/** 烧录字号 = 视频高 × 比例（预览叠画同比例） */
export const SUBTITLE_FONT_RATIO: Record<SubtitleFontSizeTier, number> = {
  sm: 0.035,
  md: 0.045,
  lg: 0.06,
}

/**
 * 安全随机 id：crypto.randomUUID 仅安全上下文（HTTPS/localhost）可用，纯 HTTP 部署下会抛
 * TypeError 炸掉手动加字幕/自动生成（OCR 2026-07-14）。降级=时间戳+计数+随机段，唯一性足够
 * （id 只做 React key 与段内寻址，不做持久全局主键）。
 */
let subtitleIdSeq = 0
export function safeSubtitleId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* 非安全上下文降级 */
  }
  subtitleIdSeq += 1
  return `sub-${Date.now().toString(36)}-${subtitleIdSeq}-${Math.random().toString(36).slice(2, 8)}`
}
