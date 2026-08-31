import type { CameraShot } from './types'

export type SendToCanvasApi = {
  addNode: (type: string, label: string, extra: Record<string, unknown>) => string
  connectNodes: (sourceId: string, targetId: string) => void
  nodePosition: (nodeId: string) => { x: number; y: number }
}

/** 把机位截图画廊里的每张图生成一个 reference-only 的 image taskNode，落在导演台节点右侧并连边 */
export function sendShotsToCanvas(api: SendToCanvasApi, directorNodeId: string, shots: CameraShot[]): string[] {
  const origin = api.nodePosition(directorNodeId)
  const ids: string[] = []
  shots.forEach((shot, i) => {
    const position = { x: origin.x + 800, y: origin.y + i * 260 }
    const id = api.addNode('taskNode', shot.name, {
      kind: 'image',
      imageUrl: shot.imageUrl,
      imageResults: [{ url: shot.imageUrl, assetId: shot.serverAssetId }],
      status: 'success',
      position,
    })
    api.connectNodes(directorNodeId, id)
    ids.push(id)
  })
  return ids
}

export type HostedClip = { url: string; assetId: string; name: string }

/** 把渲染好的灰模样片生成 kind:'video' 的 taskNode（带 sourceVideoUrl 作 seedance v2v 入口），落右侧并连边 */
export function sendClipsToCanvas(api: SendToCanvasApi, directorNodeId: string, clips: HostedClip[]): string[] {
  const origin = api.nodePosition(directorNodeId)
  const ids: string[] = []
  clips.forEach((clip, i) => {
    const position = { x: origin.x + 800, y: origin.y + i * 300 }
    const id = api.addNode('taskNode', clip.name, {
      kind: 'video',
      sourceVideoUrl: clip.url, // seedance v2v 入口字段
      videoUrl: clip.url, // 节点可播放
      assetId: clip.assetId,
      status: 'success',
      position,
    })
    api.connectNodes(directorNodeId, id)
    ids.push(id)
  })
  return ids
}

/**
 * 长片拆分后的多段成片：竖向排布并「按序连接」——导演台→段1→段2→…→段N 首尾相连，
 * 体现段间播放顺序（区别于 sendClipsToCanvas 让每段都直接挂在导演台上）。
 */
export function sendClipChainToCanvas(api: SendToCanvasApi, directorNodeId: string, clips: HostedClip[]): string[] {
  const origin = api.nodePosition(directorNodeId)
  const ids: string[] = []
  clips.forEach((clip, i) => {
    const position = { x: origin.x + 800, y: origin.y + i * 300 } // 竖向排布
    const id = api.addNode('taskNode', clip.name, {
      kind: 'video',
      sourceVideoUrl: clip.url,
      videoUrl: clip.url,
      assetId: clip.assetId,
      status: 'success',
      position,
    })
    // 首段挂导演台，其余挂上一段 → 顺序链
    const src = i === 0 ? directorNodeId : ids[i - 1]
    api.connectNodes(src, id)
    ids.push(id)
  })
  return ids
}
