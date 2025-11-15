import axios from 'axios'
import type {
  ProviderAdapter,
  ProviderContext,
  TaskResult,
  TextToImageRequest,
  TaskAsset,
} from '../task.types'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const qwenAdapter: ProviderAdapter = {
  name: 'qwen',
  supports: ['text_to_image'],

  async textToImage(req: TextToImageRequest, ctx: ProviderContext): Promise<TaskResult> {
    const apiKey = ctx.apiKey
    if (!apiKey || !apiKey.trim()) {
      throw new Error('Qwen (DashScope) API key not configured for current provider/user')
    }

    const baseUrl = (ctx.baseUrl && ctx.baseUrl.trim()) || 'https://dashscope.aliyuncs.com'
    const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/services/aigc/text2image/image-synthesis`

    const model = (ctx.modelKey && ctx.modelKey.trim()) || 'qwen-image-plus'

    const body = {
      model,
      input: {
        prompt: req.prompt,
      },
      parameters: {
        size: `${req.width || 1328}*${req.height || 1328}`,
        n: 1,
        prompt_extend: true,
        watermark: true,
      },
    }

    const res = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      timeout: 60000,
      validateStatus: () => true,
    })

    if (res.status < 200 || res.status >= 300) {
      const msg =
        (res.data && (res.data.error_message || res.data.message)) ||
        `Qwen image-synthesis failed with status ${res.status}`
      const err = new Error(msg)
      ;(err as any).status = res.status
      throw err
    }

    let raw = res.data as any

    // Qwen 文生图异步：如果返回 task_id，则轮询任务状态直到完成
    const taskId: string | undefined =
      raw?.output?.task_id || raw?.output?.taskId || raw?.task_id || raw?.taskId
    let taskStatus: string | undefined = raw?.output?.task_status || raw?.task_status

    if (taskId && (!Array.isArray(raw?.output?.results) || !raw.output.results.length)) {
      const taskUrl = `${baseUrl.replace(/\/+$/, '')}/api/v1/tasks/${encodeURIComponent(taskId)}`
      // 最多轮询 ~40 秒（20 次 * 2s）
      for (let i = 0; i < 20; i++) {
        await sleep(2000)
        const tr = await axios.get(taskUrl, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
          validateStatus: () => true,
        })
        if (tr.status < 200 || tr.status >= 300) {
          const msg =
            (tr.data && (tr.data.error_message || tr.data.message)) ||
            `Qwen task query failed with status ${tr.status}`
          const err = new Error(msg)
          ;(err as any).status = tr.status
          throw err
        }
        raw = tr.data as any
        taskStatus = raw?.output?.task_status || raw?.task_status
        const done = taskStatus === 'SUCCEEDED' || taskStatus === 'FAILED'
        if (done) break
      }
    }

    const results = Array.isArray(raw?.output?.results) ? raw.output.results : []

    const assets: TaskAsset[] = results
      .map((r: any): TaskAsset | null => {
        const url = r?.url || r?.image_url || ''
        if (!url) return null
        return {
          type: 'image',
          url,
          thumbnailUrl: null,
        }
      })
      .filter((a: TaskAsset | null): a is TaskAsset => a !== null)

    const id = raw?.request_id || taskId || `qwen-img-${Date.now().toString(36)}`
    const status = assets.length > 0 && taskStatus !== 'FAILED' ? 'succeeded' : 'failed'
    const result: TaskResult = {
      id,
      kind: 'text_to_image',
      status,
      assets,
      raw: {
        provider: 'qwen',
        response: raw,
      },
    }
    return result
  },
}
