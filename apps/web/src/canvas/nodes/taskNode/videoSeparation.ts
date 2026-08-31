import { uploadServerAssetFile } from '../../../api/server'
import { notifyAssetRefresh } from '../../../ui/assetEvents'
import { toast } from '../../../ui/toast'
import { demuxVideo } from '../../../utils/demuxVideo'
import { useRFStore } from '../../store'

export type VideoSeparationOutput = 'both' | 'video' | 'audio'

type VideoSeparationPlan = Readonly<{
  needsVideo: boolean
  needsAudio: boolean
  startedMessage: string
  successMessage: string
}>

type RunVideoSeparationInput = Readonly<{
  nodeId: string
  nodeWidth: number
  output: VideoSeparationOutput
  projectId: string
  sourceDuration?: number
  sourceLabel: string
  sourceUrl: string
  onPlaceholdersCreated: () => void
}>

export function resolveVideoSeparationPlan(output: VideoSeparationOutput): VideoSeparationPlan {
  if (output === 'both') {
    return {
      needsVideo: true,
      needsAudio: true,
      startedMessage: '已创建无声视频与独立音轨节点，正在处理',
      successMessage: '已生成无声视频与独立音轨节点',
    }
  }
  if (output === 'video') {
    return {
      needsVideo: true,
      needsAudio: false,
      startedMessage: '已创建无声视频节点，正在处理',
      successMessage: '已生成无声视频节点',
    }
  }
  return {
    needsVideo: false,
    needsAudio: true,
    startedMessage: '已创建独立音轨节点，正在处理',
    successMessage: '已生成独立音轨节点',
  }
}

export async function runVideoSeparation({
  nodeId,
  nodeWidth,
  output,
  projectId,
  sourceDuration,
  sourceLabel,
  sourceUrl,
  onPlaceholdersCreated,
}: RunVideoSeparationInput): Promise<void> {
  if (!sourceUrl) throw new Error('当前节点没有可分离的视频资产')
  const plan = resolveVideoSeparationPlan(output)
  const store = useRFStore.getState()
  const sourceNode = store.nodes.find((node) => node.id === nodeId)
  const baseX = sourceNode?.position?.x ?? 0
  const baseY = sourceNode?.position?.y ?? 0
  const beforeIds = new Set(store.nodes.map((node) => node.id))

  if (plan.needsVideo) {
    store.addNode('taskNode', `${sourceLabel} · 无声视频`, {
      kind: 'video',
      label: `${sourceLabel} · 无声视频`,
      videoResults: [],
      videoPrimaryIndex: 0,
      videoDuration: sourceDuration,
      sourceVideoNodeId: nodeId,
      sourceVideoUrl: sourceUrl,
      sourcePrevVideoNodeId: nodeId,
      silentVideo: true,
      status: 'queued',
      progress: 0,
    })
  }
  if (plan.needsAudio) {
    store.addNode('taskNode', `${sourceLabel} · 独立音轨`, {
      kind: 'audio',
      label: `${sourceLabel} · 独立音轨`,
      audioResults: [],
      audioDurationSec: sourceDuration ?? null,
      sourceVideoNodeId: nodeId,
      sourceVideoUrl: sourceUrl,
      status: 'queued',
      progress: 0,
    })
  }

  const afterAdd = useRFStore.getState()
  const placeholders = afterAdd.nodes.filter((node) => !beforeIds.has(node.id))
  const videoPlaceholder = placeholders.find((node) => {
    const nodeData = node.data as Record<string, unknown>
    return nodeData.kind === 'video'
  })
  const audioPlaceholder = placeholders.find((node) => {
    const nodeData = node.data as Record<string, unknown>
    return nodeData.kind === 'audio'
  })
  if (plan.needsVideo && !videoPlaceholder) throw new Error('无声视频占位节点创建失败')
  if (plan.needsAudio && !audioPlaceholder) throw new Error('独立音轨占位节点创建失败')

  const placeholderIds = [
    videoPlaceholder ? { id: videoPlaceholder.id, kind: 'video' as const } : null,
    audioPlaceholder ? { id: audioPlaceholder.id, kind: 'audio' as const } : null,
  ].filter((item): item is { id: string; kind: 'video' | 'audio' } => item !== null)

  placeholderIds.forEach((placeholder, index) => {
    afterAdd.onNodesChange([{
      id: placeholder.id,
      type: 'position' as const,
      position: { x: baseX + nodeWidth + 80, y: baseY + index * 220 },
      dragging: false,
    }])
    afterAdd.onConnect({
      source: nodeId,
      sourceHandle: 'out-video',
      target: placeholder.id,
      targetHandle: placeholder.kind === 'audio' ? 'in-audio' : 'in-video',
    })
  })
  // addNode 默认会写入 pendingFocusNodeId；菜单动作只负责落结果节点，不能劫持视口。
  afterAdd.clearPendingFocusNodeId()
  onPlaceholdersCreated()
  toast(plan.startedMessage, 'info')

  const failures: string[] = []
  try {
    if (videoPlaceholder) afterAdd.setNodeStatus(videoPlaceholder.id, 'running', { progress: 5 })
    if (audioPlaceholder) afterAdd.setNodeStatus(audioPlaceholder.id, 'running', { progress: 5 })
    const result = await demuxVideo(sourceUrl, {
      video: plan.needsVideo,
      audio: plan.needsAudio,
    })
    if (videoPlaceholder) afterAdd.setNodeStatus(videoPlaceholder.id, 'running', { progress: 40 })
    if (audioPlaceholder) afterAdd.setNodeStatus(audioPlaceholder.id, 'running', { progress: 40 })

    if (plan.needsVideo && videoPlaceholder) {
      try {
        if (!result.silentVideo) throw new Error('源视频没有可导出的画面轨道')
        const uploadedVideo = await uploadServerAssetFile(
          new File([result.silentVideo], `${sourceLabel}-无声.mp4`, { type: 'video/mp4' }),
          `${sourceLabel} · 无声视频`,
          { ownerNodeId: nodeId, ...(projectId ? { projectId } : {}) },
        )
        const silentVideoUrl = typeof uploadedVideo.data?.url === 'string'
          ? uploadedVideo.data.url.trim()
          : ''
        if (!silentVideoUrl) throw new Error('无声视频已处理，但 Assets 未返回真实链接')
        afterAdd.updateNodeData(videoPlaceholder.id, {
          videoUrl: silentVideoUrl,
          videoResults: [{
            url: silentVideoUrl,
            title: `${sourceLabel} · 无声视频`,
            duration: sourceDuration,
          }],
          videoPrimaryIndex: 0,
          videoDuration: sourceDuration,
          serverAssetId: uploadedVideo.id,
        })
        afterAdd.setNodeStatus(videoPlaceholder.id, 'success', { progress: 100 })
        notifyAssetRefresh()
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '无声视频上传失败'
        afterAdd.setNodeStatus(videoPlaceholder.id, 'error', { lastError: message })
        failures.push(`无声视频：${message}`)
      }
    }

    if (plan.needsAudio && audioPlaceholder) {
      try {
        if (!result.audio) throw new Error('源视频没有可导出的音频轨道')
        const uploadedAudio = await uploadServerAssetFile(
          new File([result.audio], `${sourceLabel}-音轨.m4a`, { type: 'audio/mp4' }),
          `${sourceLabel} · 独立音轨`,
          { ownerNodeId: nodeId, ...(projectId ? { projectId } : {}) },
        )
        const audioUrl = typeof uploadedAudio.data?.url === 'string'
          ? uploadedAudio.data.url.trim()
          : ''
        if (!audioUrl) throw new Error('音轨已处理，但 Assets 未返回真实链接')
        afterAdd.updateNodeData(audioPlaceholder.id, {
          audioUrl,
          audioResults: [{
            url: audioUrl,
            title: `${sourceLabel} · 独立音轨`,
            duration: sourceDuration,
            assetId: uploadedAudio.id,
          }],
          audioDurationSec: sourceDuration ?? null,
          serverAssetId: uploadedAudio.id,
        })
        afterAdd.setNodeStatus(audioPlaceholder.id, 'success', { progress: 100 })
        notifyAssetRefresh()
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '独立音轨上传失败'
        afterAdd.setNodeStatus(audioPlaceholder.id, 'error', { lastError: message })
        failures.push(`独立音轨：${message}`)
      }
    }

    if (failures.length > 0) throw new Error(failures.join('；'))
    notifyAssetRefresh()
    toast(plan.successMessage, 'success')
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '音视频分离失败'
    if (failures.length === 0) {
      if (videoPlaceholder) afterAdd.setNodeStatus(videoPlaceholder.id, 'error', { lastError: message })
      if (audioPlaceholder) afterAdd.setNodeStatus(audioPlaceholder.id, 'error', { lastError: message })
    }
    toast(`音视频分离失败：${message}`, 'error')
    throw error
  }
}
