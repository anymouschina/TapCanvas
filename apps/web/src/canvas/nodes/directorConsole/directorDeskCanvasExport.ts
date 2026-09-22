import { uploadServerAssetFile, type ServerAssetDto } from '../../../api/server'
import { useRFStore } from '../../store'

/**
 * 导演台成片落画布。
 *
 * 导演台导出的参考视频在网页嵌入里不是本机文件，而是 TapCanvas 的资产：
 * 上传后生成一个 video 节点接在导演台节点右侧，沿用画布既有的
 * `sourceVideoUrl`（seedance v2v 入口）+ `videoUrl`（可播放）字段约定。
 */

async function sha256Hex(blob: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('当前浏览器缺少摘要能力')
  const digest = await subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function readHostedUrl(asset: ServerAssetDto): string {
  const rawData = asset.data
  const data = rawData && typeof rawData === 'object' && !Array.isArray(rawData)
    ? rawData as Record<string, unknown>
    : {}
  const url = typeof data.url === 'string' ? data.url.trim() : ''
  return /^https?:\/\//i.test(url) ? url : ''
}

export async function uploadDirectorDeskVideo(input: {
  blob: Blob
  label: string
  ownerNodeId: string
  projectId?: string
}): Promise<{ url: string; assetId: string }> {
  const mime = (input.blob.type || '').split(';')[0].trim() || 'video/mp4'
  const digest = await sha256Hex(input.blob)
  const fileName = `director-desk-${digest.slice(0, 16)}.${mime.includes('webm') ? 'webm' : 'mp4'}`
  const file = new File([input.blob], fileName, { type: mime, lastModified: 0 })
  const uploaded = await uploadServerAssetFile(file, input.label, {
    taskKind: 'video',
    ownerNodeId: input.ownerNodeId,
    ...(input.projectId ? { projectId: input.projectId } : {}),
  })
  const url = readHostedUrl(uploaded)
  const assetId = typeof uploaded.id === 'string' ? uploaded.id.trim() : ''
  if (!url || !assetId) throw new Error(`${input.label}上传结果缺少可用 URL`)
  return { url, assetId }
}

/** 在导演台节点右侧生成一个 video 节点并连边；返回新节点 id。 */
export function addDirectorDeskVideoNode(input: {
  url: string
  assetId: string
  name: string
  directorNodeId: string
}): string {
  const store = useRFStore.getState()
  const origin = store.nodes.find((node) => node.id === input.directorNodeId)?.position ?? { x: 0, y: 0 }
  const before = new Set(store.nodes.map((node) => node.id))
  store.addNode('taskNode', input.name, {
    kind: 'video',
    sourceVideoUrl: input.url,
    videoUrl: input.url,
    assetId: input.assetId,
    status: 'success',
    position: { x: origin.x + 800, y: origin.y },
  })
  const created = useRFStore.getState().nodes.find((node) => !before.has(node.id))
  if (!created) throw new Error('视频节点创建失败')
  useRFStore.getState().onConnect({
    source: input.directorNodeId,
    target: created.id,
    sourceHandle: null,
    targetHandle: null,
  })
  return created.id
}
