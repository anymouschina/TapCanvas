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
  const textModelKey =
    (data.geminiModel as string | undefined) ||
    (data.modelKey as string | undefined)
  const imageModelKey = data.imageModel as string | undefined
  const modelKey = (kind === 'image' ? imageModelKey : textModelKey) || undefined

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

  // 对于图像节点，支持多次连续生成（样本数），上限 5 次
  const isImageTask = kind === 'image'
  const isVideoTask = kind === 'composeVideo'
  const isTextTask = kind === 'textToImage'
  const rawSampleCount =
    typeof data.sampleCount === 'number' ? data.sampleCount : 1
  const supportsSamples = isImageTask || isVideoTask || isTextTask
  const sampleCount = supportsSamples
    ? Math.max(1, Math.min(5, Math.floor(rawSampleCount || 1)))
    : 1

  beginToken(id)
  setNodeStatus(id, 'queued', { progress: 0 })
  appendLog(
    id,
    `[${nowLabel()}] queued (AI, ${taskKind}${
      supportsSamples && sampleCount > 1 ? `, x${sampleCount}` : ''
    })`,
  )

  // 文本节点：提示词优化，多次生成并行调用，单独处理
  if (isTextTask) {
    beginToken(id)
    try {
      const vendor = 'gemini'
      appendLog(
        id,
        `[${nowLabel()}] 调用Gemini 文案模型批量生成提示词 x${sampleCount}（并行）…`,
      )

      const indices = Array.from({ length: sampleCount }, (_, i) => i)
      const settled = await Promise.allSettled(
        indices.map(() =>
          runTaskByVendor(vendor, {
            kind: taskKind,
            prompt,
            extras: {
              nodeKind: kind,
              nodeId: id,
              modelKey,
            },
          }),
        ),
      )

      const allTexts: string[] = []
      let lastRes: any = null
      for (const r of settled) {
        if (r.status === 'fulfilled') {
          const res = r.value as any
          lastRes = res
          const textOut = (res.raw && (res.raw.text as string)) || ''
          if (textOut.trim()) {
            allTexts.push(textOut.trim())
          }
        } else {
          const err = r.reason as any
          const msg = err?.message || '文案模型调用失败'
          appendLog(id, `[${nowLabel()}] error: ${msg}`)
        }
      }

      if (!lastRes || allTexts.length === 0) {
        const msg = '文案模型调用失败：无有效结果'
        setNodeStatus(id, 'error', { progress: 0, lastError: msg })
        appendLog(id, `[${nowLabel()}] error: ${msg}`)
        endRunToken(id)
        return
      }

      const text = (lastRes.raw && (lastRes.raw.text as string)) || ''
      const preview =
        text.trim().length > 0
          ? { type: 'text', value: text }
          : { type: 'text', value: 'AI 调用成功' }

      const existingTexts =
        (data.textResults as { text: string }[] | undefined) || []
      const mergedTexts = [
        ...existingTexts,
        ...allTexts.map((t) => ({ text: t })),
      ]

      setNodeStatus(id, 'success', {
        progress: 100,
        lastResult: {
          id: lastRes.id,
          at: Date.now(),
          kind,
          preview,
        },
        textResults: mergedTexts,
      })

      appendLog(
        id,
        `[${nowLabel()}] 文案模型调用完成，共生成 ${allTexts.length} 条候选提示词`,
      )
    } catch (err: any) {
      const msg = err?.message || '文案模型调用失败'
      setNodeStatus(id, 'error', { progress: 0, lastError: msg })
      appendLog(id, `[${nowLabel()}] error: ${msg}`)
    } finally {
      endRunToken(id)
    }
    return
  }

  try {
    const vendor = taskKind === 'text_to_image' ? 'qwen' : 'gemini'
    const allImageAssets: { url: string }[] = []
    const allTexts: string[] = []
    let lastRes: any = null

    for (let i = 0; i < sampleCount; i++) {
      if (isCanceled(id)) {
        setNodeStatus(id, 'canceled', { progress: 0 })
        appendLog(id, `[${nowLabel()}] 已取消`)
        endRunToken(id)
        return
      }

      const progressBase = 5 + Math.floor((90 * i) / sampleCount)
      setNodeStatus(id, 'running', { progress: progressBase })
      appendLog(
        id,
        `[${nowLabel()}] 调用${
          vendor === 'qwen' ? 'Qwen 图像' : 'Gemini 文案'
        }模型 ${sampleCount > 1 ? `(${i + 1}/${sampleCount})` : ''}…`,
      )

      const res = await runTaskByVendor(vendor, {
        kind: taskKind,
        prompt,
        extras: {
          nodeKind: kind,
          nodeId: id,
          modelKey,
        },
      })

      lastRes = res

      const textOut = (res.raw && (res.raw.text as string)) || ''
      if (isTextTask && textOut.trim()) {
        allTexts.push(textOut.trim())
      }

      const imageAssets = (res.assets || []).filter(
        (a: any) => a.type === 'image',
      )
      if (isImageTask && imageAssets.length) {
        allImageAssets.push(...imageAssets.map((a: any) => ({ url: a.url })))
      }

      if (isCanceled(id)) {
        setNodeStatus(id, 'canceled', { progress: 0 })
        appendLog(id, `[${nowLabel()}] 已取消`)
        endRunToken(id)
        return
      }
    }

    const res = lastRes
    const text = (res?.raw && (res.raw.text as string)) || ''
    const firstImage =
      isImageTask && allImageAssets.length ? allImageAssets[0] : null
    const preview =
      kind === 'image' && firstImage
        ? { type: 'image', src: firstImage.url }
        : text.trim().length > 0
          ? { type: 'text', value: text }
          : { type: 'text', value: 'AI 调用成功' }

    let patchExtra: any = {}
    if (isImageTask && allImageAssets.length) {
      const existing = (data.imageResults as { url: string }[] | undefined) || []
      const merged = [...existing, ...allImageAssets]
      patchExtra = {
        ...patchExtra,
        imageUrl: firstImage!.url,
        imageResults: merged,
      }
    }
    if (isTextTask && allTexts.length) {
      const existingTexts =
        (data.textResults as { text: string }[] | undefined) || []
      const mergedTexts = [
        ...existingTexts,
        ...allTexts.map((t) => ({ text: t })),
      ]
      patchExtra = {
        ...patchExtra,
        textResults: mergedTexts,
      }
    }

    setNodeStatus(id, 'success', {
      progress: 100,
      lastResult: {
        id: res?.id,
        at: Date.now(),
        kind,
        preview,
      },
      ...patchExtra,
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
