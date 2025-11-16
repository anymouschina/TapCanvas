import type { Node } from 'reactflow'
import type { TaskKind } from '../api/server'
import { runTaskByVendor, createSoraVideo, listSoraPendingVideos } from '../api/server'

type Getter = () => any
type Setter = (fn: (s: any) => any) => void

function nowLabel() {
  return new Date().toLocaleTimeString()
}

export async function runNodeRemote(id: string, get: Getter, set: Setter) {
  const state = get()
  const node: Node | undefined = state.nodes.find((n: Node) => n.id === id)
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

  // 组合提示词：上游文本作为“首轮对话”，当前节点 prompt 作为补充
  let prompt: string
  if (kind === 'image' || kind === 'composeVideo') {
    const edges = (state.edges || []) as any[]
    const inbound = edges.filter((e) => e.target === id)
    let upstreamPrompt = ''
    if (inbound.length) {
      const lastEdge = inbound[inbound.length - 1]
      const src = state.nodes.find((n: Node) => n.id === lastEdge.source)
      const sd: any = src?.data || {}
      const skind: string | undefined = sd.kind
      if (skind === 'textToImage' || skind === 'image') {
        upstreamPrompt =
          (sd.prompt as string | undefined) ||
          (sd.label as string | undefined) ||
          ''
      }
    }
    const own = (data.prompt as string) || ''
    if (upstreamPrompt && own) {
      prompt = `${upstreamPrompt}\n${own}`
    } else {
      prompt = upstreamPrompt || own || (data.label as string) || ''
    }
  } else {
    prompt = (data.prompt as string) || (data.label as string) || ''
  }
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

  // 视频节点：走 Sora-2 nf/create 后端封装
  if (isVideoTask) {
    try {
      const aspect = (data as any)?.aspect as string | undefined
      const orientation: 'portrait' | 'landscape' | 'square' =
        aspect === '9:16' ? 'portrait' : aspect === '1:1' ? 'square' : 'landscape'
      const remixTargetId = ((data as any)?.remixTargetId as string | undefined) || null

      setNodeStatus(id, 'running', { progress: 5 })
      appendLog(
        id,
        `[${nowLabel()}] 调用 Sora-2 生成视频任务…`,
      )

      // 尝试从上游图像节点获取 Sora file_id / imageUrl（图生视频）
      let inpaintFileId: string | null = null
      let imageUrlForUpload: string | null = null
      // 若当前节点配置了 remix 目标，则优先走 remix，不再尝试图生
      if (!remixTargetId) {
        try {
          const edges = (state.edges || []) as any[]
          const inbound = edges.filter((e) => e.target === id)
          if (inbound.length) {
            const lastEdge = inbound[inbound.length - 1]
            const src = state.nodes.find((n: Node) => n.id === lastEdge.source)
            if (src) {
              const sd: any = src.data || {}
              inpaintFileId =
                (sd.soraFileId as string | undefined) ||
                (sd.file_id as string | undefined) ||
                null
              imageUrlForUpload =
                (sd.imageUrl as string | undefined) || null
            }
          }
        } catch {
          inpaintFileId = null
          imageUrlForUpload = null
        }
      }

      const res = await createSoraVideo({
        prompt,
        orientation,
        size: 'small',
        n_frames: 300,
        inpaintFileId,
        imageUrl: imageUrlForUpload,
        remixTargetId,
      })

      const taskId = res?.id as string | undefined
      const preview = {
        type: 'text',
        value: taskId
          ? `已创建 Sora 视频任务（ID: ${taskId}）`
          : '已创建 Sora 视频任务',
      }

      setNodeStatus(id, 'running', {
        progress: 10,
        lastResult: {
          id: taskId || '',
          at: Date.now(),
          kind,
          preview,
        },
        soraVideoTask: res,
        videoTaskId: taskId || null,
        videoInpaintFileId: inpaintFileId || null,
        videoOrientation: orientation,
        videoPrompt: prompt,
      })

      appendLog(
        id,
        `[${nowLabel()}] Sora 视频任务创建完成${taskId ? `（ID: ${taskId}）` : ''}，开始轮询进度…`,
      )

      // 无任务 ID 时无法跟踪队列，直接标记为成功。
      if (!taskId) {
        setNodeStatus(id, 'success', {
          progress: 100,
          lastResult: {
            id: '',
            at: Date.now(),
            kind,
            preview,
          },
          soraVideoTask: res,
          videoTaskId: null,
          videoInpaintFileId: inpaintFileId || null,
          videoOrientation: orientation,
          videoPrompt: prompt,
        })
        appendLog(
          id,
          `[${nowLabel()}] 未返回任务 ID，已结束跟踪，请在 Sora 中查看生成结果。`,
        )
        endRunToken(id)
        return
      }

      // 轮询 nf/pending，最多轮询一段时间（例如 ~90s）
      let progress = 10
      const maxRounds = 30
      for (let round = 0; round < maxRounds; round++) {
        if (isCanceled(id)) {
          setNodeStatus(id, 'canceled', { progress: 0 })
          appendLog(id, `[${nowLabel()}] 已取消 Sora 视频任务`)
          endRunToken(id)
          return
        }

        try {
          const pending = await listSoraPendingVideos(null)
          const found = pending.find((t: any) => t.id === taskId)

          // 不在 pending 列表中：认为已完成或移出队列
          if (!found) {
            setNodeStatus(id, 'success', {
              progress: 100,
              lastResult: {
                id: taskId,
                at: Date.now(),
                kind,
                preview,
              },
              soraVideoTask: res,
              videoTaskId: taskId,
              videoInpaintFileId: inpaintFileId || null,
              videoOrientation: orientation,
              videoPrompt: prompt,
            })
            appendLog(
              id,
              `[${nowLabel()}] Sora 视频任务已从队列移除，预计生成完成，请稍后在 Sora 草稿 / 作品中查看视频。`,
            )
            endRunToken(id)
            return
          }

          const pct =
            typeof found.progress_pct === 'number'
              ? Math.max(0, Math.min(0.99, found.progress_pct))
              : null
          if (pct !== null) {
            const next = Math.max(progress, Math.round(pct * 100))
            progress = next
          }

          setNodeStatus(id, 'running', {
            progress,
            soraVideoTask: found,
          })

          // 简单间隔 3s
          await new Promise((resolve) => setTimeout(resolve, 3000))
        } catch {
          // 忽略单次轮询失败，稍后重试
          await new Promise((resolve) => setTimeout(resolve, 3000))
        }
      }

      // 轮询结束但任务仍未完成，给出提示
      setNodeStatus(id, 'success', {
        progress,
        lastResult: {
          id: taskId,
          at: Date.now(),
          kind,
          preview,
        },
        soraVideoTask: res,
        videoTaskId: taskId,
        videoInpaintFileId: inpaintFileId || null,
        videoOrientation: orientation,
        videoPrompt: prompt,
      })

      appendLog(
        id,
        `[${nowLabel()}] 已停止轮询 Sora 视频任务进度，请在 Sora 控制台继续查看后续状态。`,
      )
      endRunToken(id)
      return
    } catch (err: any) {
      const msg = err?.message || 'Sora 视频任务创建失败'
      setNodeStatus(id, 'error', { progress: 0, lastError: msg })
      appendLog(id, `[${nowLabel()}] error: ${msg}`)
      endRunToken(id)
      return
    }
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
