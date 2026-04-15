const IMAGE_EDIT_FOCUS_GUIDE_HINT =
  '附加约束：最后一张参考图是局部编辑区域引导图。只能修改其中高亮标记的区域，未标记区域必须完整保留原图内容、构图、背景、服装与身体，输出必须保持整张完整画面，禁止只返回局部裁切。'

export function appendImageEditFocusGuidePrompt(prompt: string, hasFocusGuide: boolean): string {
  const trimmedPrompt = String(prompt || '').trim()
  if (!hasFocusGuide) return trimmedPrompt
  return [trimmedPrompt, IMAGE_EDIT_FOCUS_GUIDE_HINT].filter(Boolean).join('\n\n')
}
