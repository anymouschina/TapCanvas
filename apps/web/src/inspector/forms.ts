import { z } from 'zod'

export const textToImageSchema = z.object({
  prompt: z.string().min(1, '请输入提示词'),
  steps: z.number().min(1).max(100).default(30),
  seed: z.number().int().optional(),
  aspect: z.enum(['16:9','1:1','9:16']).default('16:9')
})

export type TextToImage = z.infer<typeof textToImageSchema>

export const composeVideoSchema = z.object({
  storyboard: z.string().min(1, '请输入分镜/脚本'),
  duration: z.number().min(1).max(600).default(30),
  fps: z.number().int().min(1).max(60).default(24)
})
export type ComposeVideo = z.infer<typeof composeVideoSchema>

export const ttsSchema = z.object({
  text: z.string().min(1, '请输入文本'),
  voice: z.enum(['female','male']).default('female'),
  speed: z.number().min(0.5).max(1.5).default(1)
})
export type TTS = z.infer<typeof ttsSchema>

export const subtitleAlignSchema = z.object({
  audioUrl: z.string().url('请输入有效音频 URL'),
  transcript: z.string().min(1, '请输入文本')
})
export type SubtitleAlign = z.infer<typeof subtitleAlignSchema>

export function defaultsFor(kind?: string) {
  switch (kind) {
    case 'textToImage':
      return { prompt: '', steps: 30, seed: undefined, aspect: '16:9' }
    case 'composeVideo':
      return { storyboard: '', duration: 30, fps: 24 }
    case 'tts':
      return { text: '', voice: 'female', speed: 1 }
    case 'subtitleAlign':
      return { audioUrl: '', transcript: '' }
    default:
      return {}
  }
}

