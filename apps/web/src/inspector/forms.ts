import { z } from 'zod'


export const composeVideoSchema = z.object({
  storyboard: z.string().min(1, '请输入分镜/脚本'),
  duration: z.number().min(1).max(600).default(30),
  fps: z.number().int().min(1).max(60).default(24),
  remixTargetId: z.string().optional(),
})
export type ComposeVideo = z.infer<typeof composeVideoSchema>

export const subtitleAlignSchema = z.object({
  audioUrl: z.string().url('请输入有效音频 URL'),
  transcript: z.string().min(1, '请输入文本')
})
export type SubtitleAlign = z.infer<typeof subtitleAlignSchema>

export function defaultsFor(kind?: string) {
  switch (kind) {
    case 'composeVideo':
    case 'storyboard':
      return { storyboard: '', duration: 30, fps: 24, remixTargetId: undefined }
    case 'subtitleAlign':
      return { audioUrl: '', transcript: '' }
    default:
      return {}
  }
}
