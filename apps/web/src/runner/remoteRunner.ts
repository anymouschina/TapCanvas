import type { Node } from 'reactflow'
import type { TaskKind } from '../api/server'
import {
  runTaskByVendor,
  createSoraVideo,
  listSoraPendingVideos,
  getSoraVideoDraftByTask,
} from '../api/server'
import { useUIStore } from '../ui/uiStore'
import { toast } from '../ui/toast'

type Getter = () => any
type Setter = (fn: (s: any) => any) => void

function nowLabel() {
  return new Date().toLocaleTimeString()
}

const SORA_VIDEO_MODEL_WHITELIST = new Set(['sora-2', 'sy-8', 'sy_8'])

function getRemixTargetIdFromNodeData(data?: any): string | null {
  if (!data) return null
  const model = String(data.videoModel || '').toLowerCase()
  const normalized = model.replace('_', '-')
  if (
    normalized &&
    !SORA_VIDEO_MODEL_WHITELIST.has(model) &&
    !SORA_VIDEO_MODEL_WHITELIST.has(normalized)
  ) {
    return null
  }

  // 优先检查已知的 remix targets
  const knownCandidates = [
    data.videoPostId,      // s_ 开头的 postId (最高优先级)
    data.videoDraftId,     // draft ID
    data.videoTaskId,      // task_ 开头的 taskId
  ]
  for (const candidate of knownCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }

  // 检查生成任务的 generation_id
  const generationId = data.soraVideoTask?.generation_id
  if (typeof generationId === 'string' && generationId.trim() && generationId.startsWith('gen_')) {
    return generationId.trim()
  }

  // 检查任务本身的 ID
  const taskId = data.soraVideoTask?.id
  if (typeof taskId === 'string' && taskId.trim() && taskId.startsWith('gen_')) {
    return taskId.trim()
  }

  return null
}

function rewriteSoraVideoResourceUrl(url?: string | null): string | null {
  if (!url) return null
  const base = useUIStore.getState().soraVideoBaseUrl
  if (!base) return url
  try {
    const parsed = new URL(url)
    const baseParsed = new URL(base)
    parsed.protocol = baseParsed.protocol
    parsed.host = baseParsed.host
    parsed.port = baseParsed.port
    return parsed.toString()
  } catch {
    return url
  }
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
              systemPrompt: (data as any)?.systemPrompt,
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
      const status = (err as any)?.status || 'unknown'
      const enhancedMsg = status === 429
        ? `${msg} (API配额已用尽，请稍后重试或升级计划)`
        : msg

      setNodeStatus(id, 'error', {
        progress: 0,
        lastError: enhancedMsg,
        httpStatus: status,
        isQuotaExceeded: status === 429
      })
      appendLog(id, `[${nowLabel()}] error: ${enhancedMsg}`)
    } finally {
      endRunToken(id)
    }
    return
  }

  // 视频节点：走 Sora-2 nf/create 后端封装
  if (isVideoTask) {
    try {
      const aspect = (data as any)?.aspect as string | undefined
      const orientation: 'portrait' | 'landscape' | 'square' = 'portrait';
      let remixTargetId = ((data as any)?.remixTargetId as string | undefined) || null
      const videoDurationSeconds: number =
        (data as any)?.videoDurationSeconds === 15 ? 15 : 10
      const nFrames = videoDurationSeconds === 15 ? 450 : 300
      const getCurrentVideoTokenId = () =>
        (get().nodes.find((n: Node) => n.id === id)?.data as any)
          ?.videoTokenId as string | undefined

      const edges = (state.edges || []) as any[]
      const inbound = edges.filter((e) => e.target === id)
      if (!remixTargetId && inbound.length) {
        for (const edge of inbound) {
          const src = state.nodes.find((n) => n.id === edge.source)
          const candidate = getRemixTargetIdFromNodeData(src?.data)
          if (candidate) {
            remixTargetId = candidate
            break
          }
        }
      }

      const initialPatch: any = { progress: 5 }
      if (remixTargetId) {
        initialPatch.remixTargetId = remixTargetId
      }
      setNodeStatus(id, 'running', initialPatch)
      appendLog(
        id,
        `[${nowLabel()}] 调用 Sora-2 生成视频任务…`,
      )

      // 尝试从上游图像/视频节点获取数据
      let inpaintFileId: string | null = null
      let imageUrlForUpload: string | null = null
      // 若当前节点配置了 remix 目标，则优先走 remix，不再尝试图生/视频
      if (!remixTargetId) {
        try {
          if (inbound.length) {
            const lastEdge = inbound[inbound.length - 1]
            const src = state.nodes.find((n: Node) => n.id === lastEdge.source)
            if (src) {
              const sd: any = src.data || {}
              const skind: string | undefined = sd.kind

              // 获取主图片/视频URL
              let primaryMediaUrl = null
              if ((skind === 'image' || skind === 'textToImage')) {
                primaryMediaUrl = (sd.imageUrl as string | undefined) || null
              } else if ((skind === 'video' || skind === 'composeVideo')) {
                // 对于video节点，获取最新的主视频URL或缩略图
                if (sd.videoResults && sd.videoResults.length > 0 && sd.videoPrimaryIndex !== undefined) {
                  primaryMediaUrl = sd.videoResults[sd.videoPrimaryIndex]?.url || sd.videoResults[0]?.url
                } else {
                  primaryMediaUrl = (sd.videoUrl as string | undefined) || null
                }
              }

              inpaintFileId =
                (sd.soraFileId as string | undefined) ||
                (sd.file_id as string | undefined) ||
                null
              imageUrlForUpload = primaryMediaUrl
            }
          }
        } catch {
          inpaintFileId = null
          imageUrlForUpload = null
        }
      }

      const preferredTokenId = (data as any)?.videoTokenId as string | undefined
      const res = await createSoraVideo({
        prompt,
        orientation,
        size: 'small',
        n_frames: nFrames,
        inpaintFileId,
        imageUrl: imageUrlForUpload,
        remixTargetId,
        tokenId: preferredTokenId || undefined,
      })
      const usedTokenId = (res as any).__usedTokenId as string | undefined
      const switchedTokenIds = (res as any).__switchedFromTokenIds as string[] | undefined
      if (switchedTokenIds?.length) {
        toast('当前 Sora Token 限额已耗尽，已切换备用 Token 继续执行', 'warning')
        appendLog(
          id,
          `[${nowLabel()}] 当前 Token 限额已耗尽，已自动切换备用 Token 继续执行`,
        )
      }
      const generatedModel = (res?.model as string | undefined) || 'sy_8'

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
        videoDurationSeconds,
        videoTokenId: usedTokenId || null,
        videoModel: generatedModel,
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
          videoDurationSeconds,
          videoTokenId: usedTokenId || null,
        })
        appendLog(
          id,
          `[${nowLabel()}] 未返回任务 ID，已结束跟踪，请在 Sora 中查看生成结果。`,
        )
        endRunToken(id)
        return
      }

      // 轮询 nf/pending，最多轮询一段时间（例如 ~90s）
      let draftSynced = false
      let lastDraft: {
        id: string
        title: string | null
        prompt: string | null
        thumbnailUrl: string | null
        videoUrl: string | null
        postId?: string | null
        duration?: number
      } | null = null

          async function syncDraftVideo(force = false) {
        if (!force && draftSynced) return null
        draftSynced = true
        try {
          const draftTokenId = getCurrentVideoTokenId()
          const draft = await getSoraVideoDraftByTask(taskId, draftTokenId || null)
          lastDraft = draft
          const patch: any = {
            videoDraftId: draft.id,
            videoPostId: draft.postId || null,
            videoTokenId: draftTokenId || null,
          }
          if (draft.videoUrl) {
            patch.videoUrl = rewriteSoraVideoResourceUrl(draft.videoUrl)
          }
          if (draft.thumbnailUrl) {
            patch.videoThumbnailUrl = rewriteSoraVideoResourceUrl(draft.thumbnailUrl)
          }
          if (draft.title) {
            patch.videoTitle = draft.title
          }
          setNodeStatus(id, 'running', patch)
          if (draft.videoUrl) {
            appendLog(
              id,
              `[${nowLabel()}] 已从草稿同步生成的视频（task_id=${taskId}），可预览。`,
            )
          }
          return draft
        } catch (err: any) {
          // 如果是HTTP 202错误，表示任务还在进行中，这是正常的
          if (err?.upstreamStatus === 202 || err?.status === 202) {
            appendLog(id, `[${nowLabel()}] 草稿同步：任务仍在进行中，继续等待...`)
            return null
          }

          // 如果是404错误，表示任务可能失败或被删除，应该停止轮询
          if (err?.upstreamStatus === 404 || err?.status === 404) {
            appendLog(id, `[${nowLabel()}] 草稿同步：任务未找到（可能已失败），停止轮询`)
            throw new Error('任务未找到或已失败')
          }

          const msg = err?.message || '同步 Sora 草稿失败'
          appendLog(id, `[${nowLabel()}] error: ${msg}`)
          return null
        }
      }

      let progress = 10
      const pollIntervalMs = 3000
      // 移除最大超时时间限制，让任务持续轮询直到完成
      let finishedFromPending = false

      while (true) {
        if (isCanceled(id)) {
          setNodeStatus(id, 'error', { progress: 0, lastError: '任务已取消' })
          appendLog(id, `[${nowLabel()}] 已取消 Sora 视频任务`)
          endRunToken(id)
          return
        }

        try {
          const pending = await listSoraPendingVideos(null)

          // 如果pending列表为空，直接尝试同步草稿
          if (!pending.length) {
            appendLog(id, `[${nowLabel()}] pending列表为空，尝试同步草稿检查任务状态...`)
            try {
              const draftResult = await syncDraftVideo(true)
              if (draftResult && draftResult.videoUrl) {
                finishedFromPending = true
                appendLog(id, `[${nowLabel()}] 草稿同步成功，任务已完成！`)
                break
              }

              appendLog(id, `[${nowLabel()}] pending为空且草稿未就绪，继续等待...`)
              await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
              continue
            } catch (syncError: any) {
              appendLog(id, `[${nowLabel()}] 草稿同步失败，任务可能已结束: ${syncError.message}`)
              // 草稿同步失败，可能任务已失败，停止轮询
              break
            }
          }

          
          const found = pending.find((t: any) => t.id === taskId)
          if (!found) {
            // 如果在pending中找不到taskId，可能任务已完成，尝试同步草稿
            try {
              const draftResult = await syncDraftVideo(true)
              if (draftResult && draftResult.videoUrl) {
                finishedFromPending = true
                appendLog(id, `[${nowLabel()}] 任务不在pending中，但草稿同步成功，任务已完成！`)
                break
              }
            } catch (syncError: any) {
              appendLog(id, `[${nowLabel()}] 任务不在pending中且草稿同步失败: ${syncError.message}`)
              // 草稿同步失败，任务可能已失败，停止轮询
              break
            }

            appendLog(id, `[${nowLabel()}] 任务不在pending中且草稿未就绪，继续等待...`)
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
            continue
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

          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
        } catch {
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
        }
      }

      if (finishedFromPending) {
        const finalDraft = lastDraft as {
          id: string
          title: string | null
          prompt: string | null
          thumbnailUrl: string | null
          videoUrl: string | null
          postId?: string | null
          duration?: number
        } | null
        const videoUrl = rewriteSoraVideoResourceUrl(
          finalDraft?.videoUrl || (data as any)?.videoUrl || null,
        )
        const thumbnailUrl = rewriteSoraVideoResourceUrl(finalDraft?.thumbnailUrl || (data as any)?.videoThumbnailUrl || null)
        const title = finalDraft?.title || (data as any)?.videoTitle || null
        const duration = finalDraft?.duration || videoDurationSeconds

        const successPreview =
          videoUrl
            ? { type: 'text' as const, value: 'Sora 视频已生成，可在节点中预览。' }
            : {
                type: 'text' as const,
                value: `Sora 视频已生成（任务 ID: ${taskId}），已写入 Sora 草稿列表。`,
              }

        // 构建新的视频结果对象
        const newVideoResult = {
          url: videoUrl,
          thumbnailUrl,
          title,
          duration,
          createdAt: new Date().toISOString(),
        }

        // 更新 videoResults 数组，保留历史记录
        const existingVideoResults = (data.videoResults as any[]) || []
        const updatedVideoResults = [...existingVideoResults, newVideoResult]

        setNodeStatus(id, 'success', {
          progress: 100,
          lastResult: {
            id: taskId,
            at: Date.now(),
            kind,
            preview: successPreview,
          },
          soraVideoTask: res,
          videoTaskId: taskId,
          videoInpaintFileId: inpaintFileId || null,
          videoOrientation: orientation,
          videoPrompt: prompt,
          videoDurationSeconds,
          videoUrl: videoUrl,
          videoThumbnailUrl: thumbnailUrl,
          videoTitle: title,
          videoDuration: duration,
          videoDraftId: finalDraft?.id || (data as any)?.videoDraftId || null,
          videoPostId: finalDraft?.postId || (data as any)?.videoPostId || null,
          videoModel: generatedModel,
          videoTokenId: usedTokenId || null,
          videoResults: updatedVideoResults, // ✅ 添加 videoResults 数组更新
        })

        if (videoUrl) {
          appendLog(
            id,
            `[${nowLabel()}] Sora 视频已生成并同步到节点，可直接预览（task_id=${taskId}）。`,
          )
        } else {
          appendLog(
            id,
            `[${nowLabel()}] Sora 视频已生成并写入草稿（task_id=${taskId}），可在 Sora 草稿 / 作品中查看。`,
          )
        }

        endRunToken(id)
        return
      }

      await syncDraftVideo(true)
      const finalDraft = lastDraft as {
        id: string
        title: string | null
        prompt: string | null
        thumbnailUrl: string | null
        videoUrl: string | null
        postId?: string | null
        duration?: number
      } | null
      const videoUrl = rewriteSoraVideoResourceUrl(
        finalDraft?.videoUrl || (data as any)?.videoUrl || null,
      )
      const thumbnailUrl = rewriteSoraVideoResourceUrl(finalDraft?.thumbnailUrl || (data as any)?.videoThumbnailUrl || null)
      const title = finalDraft?.title || (data as any)?.videoTitle || null
      const duration = finalDraft?.duration || videoDurationSeconds

      // 构建新的视频结果对象
      const newVideoResult = {
        url: videoUrl,
        thumbnailUrl,
        title,
        duration,
        createdAt: new Date().toISOString(),
      }

      // 更新 videoResults 数组，保留历史记录
      const existingVideoResults = (data.videoResults as any[]) || []
      const updatedVideoResults = [...existingVideoResults, newVideoResult]

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
        videoDurationSeconds,
        videoUrl: videoUrl,
        videoThumbnailUrl: thumbnailUrl,
        videoTitle: title,
        videoDuration: duration,
        videoDraftId: finalDraft?.id || (data as any)?.videoDraftId || null,
        videoPostId: finalDraft?.postId || (data as any)?.videoPostId || null,
        videoModel: generatedModel,
        videoTokenId: usedTokenId || null,
        videoResults: updatedVideoResults, // ✅ 添加 videoResults 数组更新
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
    // 根据图像节点选择的模型来决定使用哪个厂商
    const selectedModel = taskKind === 'text_to_image' ?
      ((data.imageModel as string) || 'qwen-image-plus') :
      ((data.model as string) || 'qwen-image-plus')
    const vendor = taskKind === 'text_to_image' && selectedModel.startsWith('gemini') ? 'gemini' :
                   taskKind === 'text_to_image' ? 'qwen' : 'gemini'
    const allImageAssets: { url: string }[] = []
    const allTexts: string[] = []
    let lastRes: any = null

    for (let i = 0; i < sampleCount; i++) {
      if (isCanceled(id)) {
        setNodeStatus(id, 'error', { progress: 0, lastError: '任务已取消' })
        appendLog(id, `[${nowLabel()}] 已取消`)
        endRunToken(id)
        return
      }

      const progressBase = 5 + Math.floor((90 * i) / sampleCount)
      setNodeStatus(id, 'running', { progress: progressBase })
      const vendorName = vendor === 'qwen' ? 'Qwen' : 'Gemini'
      const modelType = taskKind === 'text_to_image' ? '图像' : '文案'
      appendLog(
        id,
        `[${nowLabel()}] 调用${vendorName} ${modelType}模型 ${sampleCount > 1 ? `(${i + 1}/${sampleCount})` : ''}…`,
      )

      const res = await runTaskByVendor(vendor, {
        kind: taskKind,
        prompt,
        extras: {
          nodeKind: kind,
          nodeId: id,
          modelKey: selectedModel,
        },
      })

      lastRes = res

      if (vendor === 'qwen' && res.status === 'failed') {
        const rawResponse = res.raw?.response
        const errMsg =
          rawResponse?.output?.error_message ||
          rawResponse?.error_message ||
          rawResponse?.message ||
          res.raw?.message ||
          'Qwen 图像生成失败'
        throw new Error(errMsg)
      }

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
        setNodeStatus(id, 'error', { progress: 0, lastError: '任务已取消' })
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
    const msg = err?.message || '图像模型调用失败'
    const status = (err as any)?.status || 'unknown'
    const enhancedMsg = status === 429
      ? `${msg} (API配额已用尽，请稍后重试或升级计划)`
      : msg

    // 显示 toast 错误提示
    toast(enhancedMsg, status === 429 ? 'warning' : 'error')

    setNodeStatus(id, 'error', {
      progress: 0,
      lastError: enhancedMsg,
      httpStatus: status,
      isQuotaExceeded: status === 429
    })
    appendLog(id, `[${nowLabel()}] error: ${enhancedMsg}`)
  } finally {
    endRunToken(id)
  }
}
