import axios from 'axios'
import type {
  ProviderAdapter,
  ProviderContext,
  TaskResult,
  TextToVideoRequest,
} from '../task.types'

export const soraAdapter: ProviderAdapter = {
  name: 'sora',
  supports: ['text_to_video'],

  async textToVideo(req: TextToVideoRequest, ctx: ProviderContext): Promise<TaskResult> {
    const baseUrl = ctx.baseUrl || 'https://sora.chatgpt.com'
    // 这里先占位一个规范化调用，未来接入官方 Sora 任务创建接口时再补充细节。
    // 为了不引入新的上游依赖，这里暂时返回一个简单的占位结果。
    const id = `sora-${Date.now().toString(36)}`
    const payload = {
      prompt: req.prompt,
      duration: req.durationSeconds ?? 6,
      width: req.width,
      height: req.height,
      extras: req.extras || {},
    }

    try {
      // 预留位置：实际接入 Sora 时替换为真实 API
      await axios.post(
        new URL('/backend/project_y/tasks/text-to-video', baseUrl).toString(),
        payload,
        {
          headers: {
            Authorization: `Bearer ${ctx.apiKey}`,
            Accept: 'application/json',
          },
          validateStatus: () => true,
        },
      )
    } catch {
      // 忽略占位调用错误，只返回规范化结果。
    }

    const result: TaskResult = {
      id,
      kind: 'text_to_video',
      status: 'queued',
      assets: [],
      raw: { placeholder: true, provider: 'sora', payload },
    }
    return result
  },
}

