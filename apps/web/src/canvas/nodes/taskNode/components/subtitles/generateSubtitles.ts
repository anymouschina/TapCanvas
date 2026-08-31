import { MP4Clip } from '@webav/av-cliper'
import { fetchClip } from '../reliableClipFetch'
import { extractDialogueLines } from './extractDialogueLines'
import { detectSpeechSegments, alignLinesToSegments } from './vadAlign'
import { extractClipPcm, PCM_SAMPLE_RATE } from './extractClipPcm'
import type { SubtitleSegment } from './types'
import { safeSubtitleId } from './types'

export type GenerateSource = { url: string; title?: string; dialoguePrompt?: string }

export type GenerateResult = {
  segments: SubtitleSegment[]
  /** 提取不到台词而跳过的源（面板提示用） */
  skipped: Array<{ url: string; title?: string }>
}

/**
 * 一键生成：逐源（串行，控内存）提台词 → 抽 PCM → VAD → 对齐。
 * 单源失败（加载/解码）降级为跳过，不阻断其他源。
 */
export async function generateAutoSubtitles(sources: GenerateSource[]): Promise<GenerateResult> {
  const segments: SubtitleSegment[] = []
  const skipped: GenerateResult['skipped'] = []
  for (const src of sources) {
    const lines = extractDialogueLines(src.dialoguePrompt || '')
    if (lines.length === 0) {
      skipped.push({ url: src.url, title: src.title })
      continue
    }
    let clip: MP4Clip | null = null
    try {
      const res = await fetchClip(src.url)
      if (!res.body) throw new Error('empty body')
      clip = new MP4Clip(res.body)
      await clip.ready
      const pcm = await extractClipPcm(clip)
      const speech = detectSpeechSegments(pcm, PCM_SAMPLE_RATE)
      const aligned = alignLinesToSegments(lines.map((l) => l.text), speech, clip.meta.duration)
      for (const a of aligned) {
        segments.push({
          id: safeSubtitleId(),
          sourceUrl: src.url,
          startUs: a.startUs,
          endUs: a.endUs,
          text: a.text,
          source: 'auto',
        })
      }
    } catch (err) {
      // OCR 2026-07-14：网络/解码/对齐的真实错误此前被吞成「未提取到台词」，生产不可追踪——
      // 记录后仍按跳过降级（单源失败不阻断其他源的契约不变）。
      console.warn(`[generateAutoSubtitles] 源处理失败（按跳过降级）: ${src.url}`, err)
      skipped.push({ url: src.url, title: src.title })
    } finally {
      clip?.destroy()
    }
  }
  return { segments, skipped }
}
