export const PORTRAIT_TEXTURE_DEFAULT_STRENGTH = 60

export function normalizePortraitTextureStrength(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return PORTRAIT_TEXTURE_DEFAULT_STRENGTH
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

export function buildPortraitTextureExecutionPrompt(input: {
  strength: unknown
  supplementalPrompt?: string | null
}): string {
  const strength = normalizePortraitTextureStrength(input.strength)
  const supplementalPrompt = String(input.supplementalPrompt || '').trim()
  return [
    '只调整透明蒙版选中的人物区域，蒙版外的全部像素内容必须保持不变。',
    '严格保持选中人物的身份、五官比例、发型、服装、姿态、轮廓与原始构图不变。',
    `人像质感强度：${strength}/100。降低 AI 塑料感，恢复自然皮肤纹理、毛孔与细微瑕疵，改善头发、布料和饰品质感，并让光影过渡真实可信。`,
    '不得美颜换脸、改变年龄体型、重画背景、添加人物或改变未选人物；结果中不得出现选框、蒙版边缘或辅助标记。',
    supplementalPrompt ? `用户补充要求：${supplementalPrompt}` : '',
  ].filter(Boolean).join('\n')
}
