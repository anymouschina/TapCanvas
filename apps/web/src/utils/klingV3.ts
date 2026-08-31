// Frontend helpers for the kling-v3 family (APIMart channel).
// Mirrors apps/hono-api/src/modules/task/task.kling-v3.ts so model detection
// and the videoReferType vocabulary stay aligned.

const KLING_V3_OMNI_MODELS = new Set(['kling-v3-omni'])

export type KlingVideoReferType = 'base' | 'feature'

function klingModelBase(model: unknown): string {
  let base = typeof model === 'string' ? model.trim().toLowerCase() : ''
  for (const suffix of ['-apimart', '-suchuang', '-all']) {
    if (base.endsWith(suffix)) base = base.slice(0, -suffix.length)
  }
  return base
}

export function isKlingV3OmniVideoModel(model: unknown): boolean {
  return KLING_V3_OMNI_MODELS.has(klingModelBase(model))
}

/**
 * 「参考视频用途」（kling-v3-omni 动作迁移开关）：
 *   - 'feature'（动作迁移）：提取参考视频的动作/运镜/风格，应用到参考图给出的新主体；
 *   - 'base'（默认）：把参考视频当底片做重绘/续演。
 * 未显式设置返回 null（不透传 extras，保持旧行为）。
 * 链路：data.videoReferType → extras.videoReferType → hono metadata.video_refer_type
 * → new-api apimart video_list[].refer_type。
 */
export function normalizeKlingVideoReferType(value: unknown): KlingVideoReferType | null {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (raw === 'feature') return 'feature'
  if (raw === 'base') return 'base'
  return null
}
