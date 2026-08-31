import type { VideoSpeechAuditResponseDto } from '../../../../../api/server'
import type { SubtitleSegment } from './types'
import { safeSubtitleId } from './types'

/** 将服务端结构化人声证据投影成当前源视频时间轴上的字幕段。 */
export function speechAuditToSubtitleSegments(
  sourceUrl: string,
  response: Pick<VideoSpeechAuditResponseDto, 'transcript'>,
): SubtitleSegment[] {
  const segments: SubtitleSegment[] = []
  for (const utterance of response.transcript.utterances) {
    const startUs = Math.round(utterance.startSeconds * 1_000_000)
    const endUs = Math.round(utterance.endSeconds * 1_000_000)
    if (!Number.isFinite(startUs) || !Number.isFinite(endUs) || endUs <= startUs) continue
    const text = utterance.text.trim()
    if (!text) continue
    segments.push({
      id: safeSubtitleId(),
      sourceUrl,
      startUs,
      endUs,
      text,
      source: 'auto',
    })
  }
  return segments
}
