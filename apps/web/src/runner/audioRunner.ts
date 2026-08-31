import type { Edge, Node } from '@xyflow/react'
import { toast } from '../ui/toast'
import { generateMusicAudio, synthesizeSpeechAudio } from '../api/server'

function nowLabel() {
  return new Date().toLocaleTimeString()
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function pickText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 音频节点的口播文案：优先节点自身 data.text / data.prompt，为空时回退到
 * 上游直连 text 节点的正文（与「文本节点连入即素材」的画布心智一致）。
 */
export function resolveAudioNodeText(
  node: Node,
  allNodes: Node[],
  allEdges: Edge[],
): string {
  const data = asRecord(node.data)
  const own = pickText(data.text) || pickText(data.prompt)
  if (own) return own

  const upstreamIds = allEdges
    .filter((edge) => edge.target === node.id && edge.source)
    .map((edge) => edge.source)
  const parts: string[] = []
  for (const sourceId of upstreamIds) {
    const source = allNodes.find((n) => n.id === sourceId)
    if (!source || source.type !== 'taskNode') continue
    const sourceData = asRecord(source.data)
    const kind = pickText(sourceData.kind).toLowerCase()
    if (kind && kind !== 'text' && kind !== 'noveldoc' && kind !== 'scriptdoc') continue
    const content =
      pickText(sourceData.content) || pickText(sourceData.prompt) || pickText(sourceData.text)
    if (content) parts.push(content)
  }
  return parts.join('\n').trim()
}

/**
 * 豆包语音音色克隆参考：从上游连线收集参考音频/图片 URL（图优先、与音频互斥）。
 * 上游音频节点的 audioUrl → referenceAudioUrls（≤3）；图片节点的 imageUrl → referenceImageUrl。
 */
export function resolveAudioNodeReferences(
  node: Node,
  allNodes: Node[],
  allEdges: Edge[],
): { referenceAudioUrls: string[]; referenceImageUrl: string } {
  const audioUrls: string[] = []
  let imageUrl = ''
  const incoming = allEdges.filter((edge) => edge.target === node.id && edge.source)
  for (const edge of incoming) {
    const source = allNodes.find((n) => n.id === edge.source)
    if (!source || source.type !== 'taskNode') continue
    const sourceData = asRecord(source.data)
    const handle = pickText(edge.targetHandle)
    // 音频参考：显式连到 in-audio，或上游本身是音频节点
    if (handle === 'in-audio' || pickText(sourceData.kind).toLowerCase() === 'audio') {
      const a = pickText(sourceData.audioUrl)
      if (a) audioUrls.push(a)
      continue
    }
    // 图片参考：显式连到 in-image，或上游是图片类节点
    if (handle === 'in-image' || pickText(sourceData.kind).toLowerCase() === 'image') {
      const candidate =
        pickText(sourceData.imageUrl) ||
        (Array.isArray((sourceData as any).imageUrls)
          ? pickText((sourceData as any).imageUrls.find((u: unknown) => typeof u === 'string'))
          : '')
      if (candidate && !imageUrl) imageUrl = candidate
    }
  }
  return { referenceAudioUrls: audioUrls.slice(0, 3), referenceImageUrl: imageUrl }
}

/**
 * 音频节点远程执行器：TTS 合成（hono /public/audio/speech → new-api relay）。
 * 使用 runToken 防过期回写，并维护 queued→running→success 状态机。
 */
export async function runNodeAudio(
  id: string,
  get: () => any,
  set: (fn: (s: any) => any) => void,
) {
  void set
  const node: Node | undefined = get().nodes.find((n: Node) => n.id === id)
  if (!node) return
  const data: any = node.data || {}

  const setNodeStatusRaw = get().setNodeStatus as (id: string, status: any, patch?: any) => void
  const appendLogRaw = get().appendLog as (id: string, line: string) => void
  const beginToken = get().beginRunToken as ((id: string) => string) | undefined
  const isCanceledRaw = get().isCanceled as
    | ((id: string, runToken?: string | null) => boolean)
    | undefined

  const runToken = beginToken?.(id)
  const isRunTokenActive = () => {
    if (!runToken) return true
    const current: Node | undefined = get().nodes.find((n: Node) => n.id === id)
    const currentToken = (current?.data as any)?.runToken
    return typeof currentToken === 'string' && currentToken === runToken
  }
  const setNodeStatus = (nodeId: string, status: any, patch?: any) => {
    if (nodeId === id && !isRunTokenActive()) return
    setNodeStatusRaw(nodeId, status, patch)
  }
  const appendLog = (nodeId: string, line: string) => {
    if (nodeId === id && !isRunTokenActive()) return
    appendLogRaw?.(nodeId, line)
  }
  const isCanceled = (nodeId: string) => Boolean(isCanceledRaw?.(nodeId, runToken))

  const allNodes = get().nodes as Node[]
  const allEdges = get().edges as Edge[]
  const text = resolveAudioNodeText(node, allNodes, allEdges)
  const isMusic = data.audioType === 'music'
  if (!text) {
    const msg = isMusic
      ? '音乐节点缺少描述：请在底部输入曲风/氛围描述或歌词'
      : '音频节点缺少口播文案：请在底部输入文本或连接文本节点'
    setNodeStatus(id, 'error', { progress: 0, lastError: msg })
    toast(msg, 'error')
    return
  }
  const audioModel = pickText(data.audioModel)
  if (!audioModel) {
    const msg = '音频节点未选择模型，请先从系统模型目录选择可用模型'
    setNodeStatus(id, 'error', { progress: 0, lastError: msg })
    toast(msg, 'error')
    return
  }

  setNodeStatus(id, 'queued', { progress: 0 })
  appendLog(id, `[${nowLabel()}] queued (${isMusic ? 'music' : 'tts'})`)
  if (isCanceled(id)) {
    setNodeStatus(id, 'canceled', { progress: 0 })
    return
  }
  setNodeStatus(id, 'running', { progress: 10 })
  appendLog(
    id,
    isMusic
      ? `[${nowLabel()}] 开始音乐生成（约 1-3 分钟）…`
      : `[${nowLabel()}] 开始语音合成（${text.length} 字）…`,
  )

  try {
    let resultUrl = ''
    let resultDuration: number | null = null
    let resultModel = ''
    if (isMusic) {
      const lyricsMode =
        data.lyricsMode === 'auto' || data.lyricsMode === 'custom'
          ? (data.lyricsMode as 'auto' | 'custom')
          : 'instrumental'
      const result = await generateMusicAudio({
        // custom 模式：底部输入框内容作为歌词；其余模式作为曲风描述
        prompt: lyricsMode === 'custom' ? undefined : text,
        lyrics: lyricsMode === 'custom' ? text : undefined,
        lyricsMode,
        model: audioModel,
      })
      resultUrl = result.url
      resultDuration = result.durationSec
      resultModel = result.model
    } else {
      const isDoubao = audioModel.toLowerCase().startsWith('doubao-seed-audio')
      if (isDoubao) {
        const refs = resolveAudioNodeReferences(node, allNodes, allEdges)
        const result = await synthesizeSpeechAudio({
          text,
          model: audioModel,
          voiceId: pickText(data.doubaoVoiceId) || undefined,
          speechRate: typeof data.speechRate === 'number' ? data.speechRate : undefined,
          pitchRate: typeof data.pitchRate === 'number' ? data.pitchRate : undefined,
          loudnessRate: typeof data.loudnessRate === 'number' ? data.loudnessRate : undefined,
          referenceAudioUrls: refs.referenceAudioUrls.length ? refs.referenceAudioUrls : undefined,
          referenceImageUrl: refs.referenceImageUrl || undefined,
        })
        resultUrl = result.url
        resultDuration = result.durationSec
        resultModel = result.model
      } else {
        const result = await synthesizeSpeechAudio({
          text,
          model: audioModel,
          voiceId: pickText(data.voiceId) || undefined,
          emotion: pickText(data.emotion) || undefined,
          speed: typeof data.speed === 'number' ? data.speed : undefined,
          soundEffects: Array.isArray(data.soundEffects)
            ? data.soundEffects.filter((v: unknown) => typeof v === 'string')
            : undefined,
        })
        resultUrl = result.url
        resultDuration = result.durationSec
        resultModel = result.model
      }
    }
    if (isCanceled(id)) {
      setNodeStatus(id, 'canceled', { progress: 0 })
      return
    }
    setNodeStatus(id, 'success', {
      progress: 100,
      audioUrl: resultUrl,
      audioDurationSec: resultDuration,
      audioModel: resultModel,
      lastError: null,
    })
    appendLog(
      id,
      `[${nowLabel()}] 生成完成：${resultDuration ? `${resultDuration}s` : ''} ${resultUrl}`,
    )
  } catch (error: unknown) {
    const msg = error instanceof Error && error.message
      ? error.message
      : isMusic ? '音乐生成失败' : '语音合成失败'
    setNodeStatus(id, 'error', { progress: 0, lastError: msg })
    appendLog(id, `[${nowLabel()}] error: ${msg}`)
    if (!isCanceled(id)) toast(msg, 'error')
  }
}
