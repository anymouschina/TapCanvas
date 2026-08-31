// 全局画风参考（uiStore.activeStyleBible）注入普通文生图节点的纯逻辑。
// 背景：空项目里随手「文生图」也应跟随素材库设定的全局参考画风；但角色卡/故事板分镜/局部编辑
// 已各有自己的参考锚定，不能重复注入。这里把「是否注入」与「怎么合并」抽成纯函数便于单测。

/** 已有自己参考锚定、不应再叠加全局画风的图片任务来源标记。 */
const STYLEBOUND_IMAGE_SOURCE_TAGS = new Set([
  'storyboard_shot_split',
  'novel_storyboard_group',
  'storyboard_shot_node',
])

/**
 * 仅「普通文生图」节点才注入全局画风参考。排除：
 * - 非图片任务
 * - 角色卡任务（自带风格锚定 referenceImages）
 * - 故事板分镜（一致性锁）
 * - 局部编辑：visibleCompositeOnly / 带 focusGuide(poseMask) 的精修
 * - 已显式声明 style 资产输入（节点自带风格图）
 */
export function isEligibleForGlobalStyleReference(input: {
  isImageTask: boolean
  isRoleCardTask: boolean
  sourceTag: string
  visibleCompositeOnlyReference: boolean
  hasFocusGuide: boolean
  hasExplicitStyleAssetInput: boolean
}): boolean {
  if (!input.isImageTask) return false
  if (input.isRoleCardTask) return false
  if (STYLEBOUND_IMAGE_SOURCE_TAGS.has(String(input.sourceTag || '').trim())) return false
  if (input.visibleCompositeOnlyReference) return false
  if (input.hasFocusGuide) return false
  if (input.hasExplicitStyleAssetInput) return false
  return true
}

/**
 * 把全局画风参考合并进节点 referenceImages：风格图固定放最后、去重、剔除节点自有产物、限 hardLimit。
 * 全局约定（图位语义确定性）：画风锚定图永远排在参考图末尾，前面的图位留给待编辑目标/内容参考；
 * hardLimit 不足时优先保住风格图（截断内容参考），保证画风锚定不静默丢失。
 * 返回合并后的数组、实际注入条数与实际注入的风格图 URL（供调用方标注 role=style）。
 */
export function mergeGlobalStyleReferenceImages(input: {
  referenceImages: string[]
  globalStyleRefs: string[]
  selfOwnedImageUrls: Set<string>
  hardLimit: number
}): { referenceImages: string[]; injectedCount: number; styleUrls: string[] } {
  const limit = Math.max(0, Math.trunc(input.hardLimit))
  const styleRefs = Array.from(
    new Set(
      (Array.isArray(input.globalStyleRefs) ? input.globalStyleRefs : [])
        .map((u) => (typeof u === 'string' ? u.trim() : ''))
        .filter((u) => u && !input.selfOwnedImageUrls.has(u)),
    ),
  )
  if (!styleRefs.length || limit === 0) {
    return { referenceImages: input.referenceImages.slice(0, limit), injectedCount: 0, styleUrls: [] }
  }
  const styleKept = styleRefs.slice(0, limit)
  const rest = Array.from(new Set(input.referenceImages.filter((u) => !styleKept.includes(u))))
  const restKept = rest.slice(0, Math.max(0, limit - styleKept.length))
  return {
    referenceImages: [...restKept, ...styleKept],
    injectedCount: styleKept.length,
    styleUrls: styleKept,
  }
}

/**
 * 把全局锁定风格的「文字指令」追加到图片任务 prompt 末尾。
 * 主要服务自定义文字风格（无参考图，只能靠文字传达画风），预设卡若带文字风格亦适用。
 * - 不合格（eligible=false，如角色卡/故事板/局部编辑/节点自带风格）或文字为空：原样返回。
 * - 已包含该文字（去重）：不重复追加。
 */
export function mergeGlobalStylePrompt(input: {
  basePrompt: string
  stylePrompt: string
  eligible: boolean
}): string {
  const base = typeof input.basePrompt === 'string' ? input.basePrompt : ''
  const style = typeof input.stylePrompt === 'string' ? input.stylePrompt.trim() : ''
  if (!input.eligible || !style) return base
  if (base.includes(style)) return base
  return base ? `${base.trimEnd()}\n\n${style}` : style
}
