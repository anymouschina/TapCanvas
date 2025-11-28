const HANDLE_TYPE_LABELS: Record<string, string> = {
  any: '通用',
  image: '图像',
  video: '视频',
  audio: '音频',
  subtitle: '字幕',
  character: '角色',
  text: '文本',
}

/**
 * 返回端口类型对应的本地化标签
 */
export function getHandleTypeLabel(type?: string | null): string {
  if (!type) return HANDLE_TYPE_LABELS.any
  return HANDLE_TYPE_LABELS[type] || type
}
