import type { Node } from 'reactflow'
import type { TaskKind } from '../api/server'
import { runTaskByVendor } from '../api/server'

type Getter = () => any
type Setter = (fn: (s: any) => any) => void

function nowLabel() {
  return new Date().toLocaleTimeString()
}

export async function runNodeRemote(id: string, get: Getter, set: Setter) {
  const node: Node | undefined = get().nodes.find((n: Node) => n.id === id)
  if (!node) return

  const data: any = node.data || {}
  const kind: string = data.kind || 'task'
  const setNodeStatus = get().setNodeStatus as (id: string, status: 'idle' | 'queued' | 'running' | 'success' | 'error', patch?: Partial<any>) => void
  const appendLog = get().appendLog as (id: string, line: string) => void
  const beginToken = get().beginRunToken as (id: string) => void
  const endRunToken = get().endRunToken as (id: string) => void
  const isCanceled = get().isCanceled as (id: string) => boolean
  const modelKey = (data.geminiModel as string | undefined) || (data.modelKey as string | undefined)

  let taskKind: TaskKind
  if (kind === 'image') {
    // 文生图：使用生图模型
    taskKind = 'text_to_image'
  } else if (kind === 'composeVideo') {
    // 文生视频：通过模型生成分镜描述
    taskKind = 'text_to_video'
  } else {
    // 文生文：提示词优化
    taskKind = 'prompt_refine'
  }

  const prompt: string = (data.prompt as string) || data.label || ''
  if (!prompt.trim()) {
    appendLog(id, `[${nowLabel()}] 缺少提示词，已跳过`)
    return
  }

  beginToken(id)
  setNodeStatus(id, 'queued', { progress: 0 })
  appendLog(id, `[${nowLabel()}] queued (AI, ${taskKind})`)

  try {
    if (isCanceled(id)) {
      setNodeStatus(id, 'canceled', { progress: 0 })
      endRunToken(id)
      return
    }

    setNodeStatus(id, 'running', { progress: 5 })
    appendLog(id, `[${nowLabel()}] 调用文案模型 …`)

    const res = await runTaskByVendor('gemini', {
      kind: taskKind,
      prompt,
      extras: {
        nodeKind: kind,
        nodeId: id,
        modelKey: modelKey || undefined,
      },
    })

    if (isCanceled(id)) {
      setNodeStatus(id, 'canceled', { progress: 0 })
      appendLog(id, `[${nowLabel()}] 已取消`)
      endRunToken(id)
      return
    }

    const text = (res.raw && (res.raw.text as string)) || ''
    const firstImage = res.assets && res.assets.find((a) => a.type === 'image')
    const preview =
      kind === 'image' && firstImage
        ? { type: 'image', src: firstImage.url }
        : text.trim().length > 0
          ? { type: 'text', value: text }
          : { type: 'text', value: 'AI 调用成功' }

    setNodeStatus(id, 'success', {
      progress: 100,
      lastResult: {
        id: res.id,
        at: Date.now(),
        kind,
        preview,
      },
      ...(kind === 'image' && firstImage ? { imageUrl: firstImage.url } : {}),
    })

    if (text.trim()) {
      appendLog(id, `[${nowLabel()}] AI: ${text.slice(0, 120)}`)
    } else {
      appendLog(id, `[${nowLabel()}] 文案模型调用成功`)
    }
  } catch (err: any) {
    const msg = err?.message || '文案模型调用失败'
    setNodeStatus(id, 'error', { progress: 0, lastError: msg })
    appendLog(id, `[${nowLabel()}] error: ${msg}`)
  } finally {
    endRunToken(id)
  }
}
