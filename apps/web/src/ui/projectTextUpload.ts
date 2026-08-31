import {
  appendProjectBookUploadChunk,
  finishProjectBookUploadSession,
  startProjectBookUploadSession,
  type ProjectBookUploadJobDto,
  type ServerAssetDto,
} from '../api/server'

export const TEXT_UPLOAD_MAX_BYTES = 50 * 1024 * 1024
export const TEXT_UPLOAD_MAX_LABEL = '50MB'
export const PROJECT_BOOK_UPLOAD_CHUNK_BYTES = 1024 * 1024
export const PROJECT_TEXT_ASSET_NAME = '当前项目文本'
export const PROJECT_TEXT_SINGLETON_SOURCE = 'projectTextSingleton'

const LEGACY_PROJECT_TEXT_SOURCES = new Set<string>(['uploadedTextCombined'])
const PROJECT_BOOK_SOURCE_EXTENSIONS = new Set([
  '.txt',
  '.text',
  '.md',
  '.markdown',
  '.docx',
  '.epub',
])

type UploadProjectTextInput = {
  projectId: string
  projectName?: string
  file: File
  isBookUploadLocked?: boolean
  onChunkProgress?: (completed: number, total: number) => void
}

type UploadProjectTextResult = {
  mode: 'book'
  kind: 'novelDoc'
  job: ProjectBookUploadJobDto
}

function readFileExtension(fileName: string): string {
  const normalized = String(fileName || '').trim().toLowerCase()
  const lastDot = normalized.lastIndexOf('.')
  return lastDot >= 0 ? normalized.slice(lastDot) : ''
}

function getProjectMaterialAssetContent(asset: ServerAssetDto): string {
  const data = asset.data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return ''
  const record = data as Record<string, unknown>
  if (typeof record.content === 'string') return record.content
  if (typeof record.prompt === 'string') return record.prompt
  const textResults = record.textResults
  if (!Array.isArray(textResults) || textResults.length === 0) return ''
  const lastResult = textResults[textResults.length - 1]
  if (typeof lastResult !== 'object' || lastResult === null || Array.isArray(lastResult)) return ''
  const text = Reflect.get(lastResult, 'text')
  return typeof text === 'string' ? text : ''
}

function isProjectMaterialAsset(asset: ServerAssetDto): boolean {
  const data = asset.data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false
  const kind = Reflect.get(data, 'kind')
  return kind === 'novelDoc' || kind === 'scriptDoc'
}

function getProjectTextAssetUpdatedAt(asset: ServerAssetDto): number {
  const ts = Date.parse(String(asset.updatedAt || asset.createdAt || ''))
  return Number.isFinite(ts) ? ts : 0
}

export function pickCurrentProjectTextAsset(assets: readonly ServerAssetDto[]): ServerAssetDto | null {
  const materialAssets = assets.filter(isProjectMaterialAsset)
  if (!materialAssets.length) return null
  const preferred = materialAssets.filter((asset) => {
    const data = asset.data
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return false
    const source = String(Reflect.get(data, 'source') || '').trim()
    return source === PROJECT_TEXT_SINGLETON_SOURCE || LEGACY_PROJECT_TEXT_SOURCES.has(source)
  })
  const pool = preferred.length > 0 ? preferred : materialAssets
  return pool.slice().sort((left, right) => getProjectTextAssetUpdatedAt(right) - getProjectTextAssetUpdatedAt(left))[0] || null
}

export async function uploadProjectText(input: UploadProjectTextInput): Promise<UploadProjectTextResult> {
  const fileBytes = typeof input.file.size === 'number' && Number.isFinite(input.file.size)
    ? Math.max(0, Math.trunc(input.file.size))
    : 0
  if (fileBytes > TEXT_UPLOAD_MAX_BYTES) {
    throw new Error(`文本文件超过 ${TEXT_UPLOAD_MAX_LABEL} 上传上限`)
  }
  if (fileBytes === 0) {
    throw new Error('上传文件为空，未创建书籍')
  }
  const sourceExtension = readFileExtension(input.file.name)
  if (!PROJECT_BOOK_SOURCE_EXTENSIONS.has(sourceExtension)) {
    throw new Error('仅支持 TXT、TEXT、Markdown、DOCX、EPUB 书籍源文件')
  }
  if (input.isBookUploadLocked) {
    throw new Error('当前项目有小说上传任务进行中，请等待完成后再上传')
  }
  const uploadTitle = input.file.name.replace(/\.[^.]+$/, '').trim()
    || String(input.projectName || '').trim()
    || PROJECT_TEXT_ASSET_NAME
  const session = await startProjectBookUploadSession({
    projectId: input.projectId,
    title: uploadTitle,
    sourceFileName: input.file.name,
    contentBytes: fileBytes,
  })
  const uploadId = String(session.uploadId || '').trim()
  if (!uploadId) {
    throw new Error('分块上传初始化失败：缺少 uploadId')
  }
  const totalChunks = Math.max(1, Math.ceil(fileBytes / PROJECT_BOOK_UPLOAD_CHUNK_BYTES))
  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * PROJECT_BOOK_UPLOAD_CHUNK_BYTES
    const end = Math.min(fileBytes, start + PROJECT_BOOK_UPLOAD_CHUNK_BYTES)
    const chunk = input.file.slice(start, end)
    if (chunk.size === 0) {
      throw new Error(`第 ${index + 1} 个上传分块为空`)
    }
    await appendProjectBookUploadChunk({
      projectId: input.projectId,
      uploadId,
      offset: start,
      chunk,
    })
    input.onChunkProgress?.(index + 1, totalChunks)
  }
  const finished = await finishProjectBookUploadSession({
    projectId: input.projectId,
    uploadId,
    strictAgents: true,
  })
  if (!finished?.job?.id) {
    throw new Error('创建异步任务失败：缺少 jobId')
  }
  return {
    mode: 'book',
    kind: 'novelDoc',
    job: finished.job,
  }
}

export function isProjectTextReadyAsset(asset: ServerAssetDto | null): boolean {
  if (!asset) return false
  return getProjectMaterialAssetContent(asset).trim().length > 0
}
