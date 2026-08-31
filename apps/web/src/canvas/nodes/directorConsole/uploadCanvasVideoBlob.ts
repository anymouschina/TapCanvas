import { uploadServerAssetFile, type ServerAssetDto } from '../../../api/server'

export type HostedCanvasVideo = { url: string; assetId: string }

async function sha256Hex(blob: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('当前浏览器缺少摘要能力')
  const digest = await subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function readHostedUrl(asset: ServerAssetDto): string {
  const rawData = asset.data
  const data = rawData && typeof rawData === 'object' && !Array.isArray(rawData) ? (rawData as Record<string, unknown>) : {}
  const url = typeof data.url === 'string' ? data.url.trim() : ''
  return /^https?:\/\//i.test(url) ? url : ''
}

export async function uploadCanvasVideoBlob(input: {
  blob: Blob
  label: string
  filePrefix: string
  ownerNodeId: string
  projectId?: string
}): Promise<HostedCanvasVideo> {
  const mime = (input.blob.type || '').split(';')[0].trim() || 'video/mp4'
  const digest = await sha256Hex(input.blob)
  const fileName = `${input.filePrefix}-${digest.slice(0, 16)}.mp4`
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
