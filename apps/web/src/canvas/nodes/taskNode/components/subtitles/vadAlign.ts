export type SpeechSegment = { startUs: number; endUs: number }
export type AlignedLine = { startUs: number; endUs: number; text: string }

const FRAME_MS = 20
const MERGE_GAP_US = 300_000
const MIN_SEGMENT_US = 250_000

/**
 * 能量 VAD：20ms 帧 RMS，噪声底自适应阈值，短间隙合并、短段丢弃。
 * 返回说话段（µs，相对 PCM 起点=源视频 0 点）。
 */
export function detectSpeechSegments(pcm: Float32Array, sampleRate: number): SpeechSegment[] {
  const frameLen = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000))
  const frameCount = Math.floor(pcm.length / frameLen)
  if (frameCount === 0) return []

  const rms: number[] = []
  for (let f = 0; f < frameCount; f++) {
    let sum = 0
    const off = f * frameLen
    for (let i = 0; i < frameLen; i++) {
      const v = pcm[off + i]
      sum += v * v
    }
    rms.push(Math.sqrt(sum / frameLen))
  }

  const sorted = [...rms].sort((a, b) => a - b)
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)] ?? 0
  const peak = sorted[sorted.length - 1] ?? 0
  if (peak < 0.01) return [] // 整段近乎无声
  const threshold = Math.max(noiseFloor + (peak - noiseFloor) * 0.18, 0.008)

  const frameUs = (frameLen / sampleRate) * 1e6
  const raw: SpeechSegment[] = []
  let start = -1
  for (let f = 0; f < frameCount; f++) {
    const active = rms[f] >= threshold
    if (active && start < 0) start = f
    if (!active && start >= 0) {
      raw.push({ startUs: start * frameUs, endUs: f * frameUs })
      start = -1
    }
  }
  if (start >= 0) raw.push({ startUs: start * frameUs, endUs: frameCount * frameUs })

  const merged: SpeechSegment[] = []
  for (const s of raw) {
    const last = merged[merged.length - 1]
    if (last && s.startUs - last.endUs < MERGE_GAP_US) last.endUs = s.endUs
    else merged.push({ ...s })
  }
  return merged
    .filter((s) => s.endUs - s.startUs >= MIN_SEGMENT_US)
    .map((s) => ({ startUs: Math.round(s.startUs), endUs: Math.round(s.endUs) }))
}

/**
 * K 句台词 ↔ M 个说话段：
 * - M ≥ K：在 K-1 个最大静音间隙处把说话段切成 K 组，组跨度=句起止。
 * - M < K（含 0）：按字数比例均摊说话总跨度；无说话段时用整 clip 去首尾 0.3s。
 */
export function alignLinesToSegments(
  lines: string[],
  segments: SpeechSegment[],
  clipDurationUs: number,
): AlignedLine[] {
  const texts = lines.map((t) => t.trim()).filter((t) => t.length > 0)
  if (texts.length === 0) return []
  const K = texts.length

  if (segments.length >= K) {
    const gaps: Array<{ i: number; gap: number }> = []
    for (let i = 0; i < segments.length - 1; i++) {
      gaps.push({ i, gap: segments[i + 1].startUs - segments[i].endUs })
    }
    const cutAfter = new Set(
      gaps.sort((a, b) => b.gap - a.gap).slice(0, K - 1).map((g) => g.i),
    )
    const out: AlignedLine[] = []
    let groupStart = segments[0].startUs
    let li = 0
    for (let i = 0; i < segments.length; i++) {
      if (cutAfter.has(i) || i === segments.length - 1) {
        out.push({ startUs: groupStart, endUs: segments[i].endUs, text: texts[li] })
        li += 1
        if (i < segments.length - 1) groupStart = segments[i + 1].startUs
      }
    }
    return out
  }

  const spanStart = segments.length
    ? segments[0].startUs
    : Math.min(300_000, Math.round(clipDurationUs * 0.1))
  // 尾部修剪与头部同款按比例封顶：短片（<0.6s）下固定 300ms 修剪会把 span 压塌成 1µs、
  // 全部字幕挤在一点不可见（OCR 2026-07-14）。
  const spanEnd = segments.length
    ? segments[segments.length - 1].endUs
    : Math.max(spanStart + 1, clipDurationUs - Math.min(300_000, Math.round(clipDurationUs * 0.1)))
  const span = Math.max(1, spanEnd - spanStart)
  const totalChars = texts.reduce((a, t) => a + t.length, 0) || 1
  const out: AlignedLine[] = []
  let cursor = spanStart
  for (const t of texts) {
    const w = (t.length / totalChars) * span
    out.push({
      startUs: Math.round(cursor),
      endUs: Math.round(Math.min(spanEnd, cursor + w)),
      text: t,
    })
    cursor += w
  }
  return out
}
