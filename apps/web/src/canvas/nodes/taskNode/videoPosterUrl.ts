// 视频 poster 取值链（统一入口，禁止散落各处手拼）：
//   posterInline（新出片内联 base64，首绘零请求，天然免 CORS）
//   → thumbnailUrl/fallback 直链原样
//
// ⚠️ 不包 cdn-cgi/image 变体（2026-07-15 实证翻车）：video 元素带 crossorigin=anonymous 时
// poster 按 CORS 模式拉取，而 cdn-cgi 代理层不回 Access-Control-Allow-Origin → 图被整张
// 丢弃=全画布视频节点黑卡。TOS 直链有 CORS 头，且服务端
// poster 本就 ≤640（asset.video-poster.ts MAX_POSTER_EDGE），无需二次缩略。
export type VideoPosterSource = {
  posterInline?: string | null
  thumbnailUrl?: string | null
} | null | undefined

function readDisplayableImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return /^(https?:\/\/|data:image\/)/i.test(trimmed) ? trimmed : null
}

export function resolveVideoInputPosterUrl(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const record = data as Record<string, unknown>
  const direct = readDisplayableImageUrl(record.videoInputPosterUrl)
    ?? readDisplayableImageUrl(record.firstFrameUrl)
  if (direct) return direct
  const references = Array.isArray(record.referenceImages) ? record.referenceImages : []
  for (const reference of references) {
    const url = readDisplayableImageUrl(reference)
    if (url) return url
  }
  return null
}

export function resolveVideoPosterUrl(result: VideoPosterSource, fallback?: string | null): string | null {
  const inline = result?.posterInline
  if (typeof inline === 'string' && inline.startsWith('data:image/')) return inline
  const remote = (typeof result?.thumbnailUrl === 'string' && result.thumbnailUrl.trim())
    ? result.thumbnailUrl.trim()
    : (typeof fallback === 'string' && fallback.trim() ? fallback.trim() : null)
  return remote
}
