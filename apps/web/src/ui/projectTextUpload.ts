import {
  appendProjectBookUploadChunk,
  createServerAsset,
  deleteServerAsset,
  finishProjectBookUploadSession,
  listServerAssets,
  renameServerAsset,
  startProjectBookUploadSession,
  updateServerAssetData,
  type ProjectBookUploadJobDto,
  type ServerAssetDto,
} from '../api/server'

export const TEXT_UPLOAD_MAX_BYTES = 50 * 1024 * 1024
export const TEXT_UPLOAD_MAX_LABEL = '50MB'
export const PROJECT_BOOK_UPLOAD_CHUNK_CHARS = 250_000
export const PROJECT_TEXT_ASSET_NAME = '当前项目文本'
export const PROJECT_TEXT_SINGLETON_SOURCE = 'projectTextSingleton'

const LEGACY_PROJECT_TEXT_SOURCES = new Set<string>(['uploadedTextCombined'])
const utf8Encoder = new TextEncoder()

type ProjectMaterialKind = 'novelDoc' | 'scriptDoc'

type UploadProjectTextInput = {
  projectId: string
  projectName?: string
  file: File
  isBookUploadLocked?: boolean
  uploadMode?: 'auto' | 'book-only'
  onChunkProgress?: (completed: number, total: number) => void
}

type UploadProjectTextResult =
  | {
      mode: 'book'
      kind: 'novelDoc'
      job: ProjectBookUploadJobDto
    }
  | {
      mode: 'asset'
      kind: ProjectMaterialKind
    }

function getUtf8TextByteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength
}

function inferMaterialKindFromUpload(fileName: string, content: string): ProjectMaterialKind {
  const name = String(fileName || '').toLowerCase()
  const sample = String(content || '').slice(0, 1200).toLowerCase()
  if (/剧本|script|screenplay/i.test(name) || /场景|台词|scene|dialogue|screenplay/i.test(sample)) return 'scriptDoc'
  return 'novelDoc'
}

async function decodeUploadText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const utf8Text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  let gbText = ''
  try {
    gbText = new TextDecoder('gb18030', { fatal: false }).decode(bytes)
  } catch {
    gbText = ''
  }
  const score = (value: string): number => {
    const text = String(value || '')
    if (!text.trim()) return -1_000_000
    const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length
    const replacementCount = (text.match(/\uFFFD/g) || []).length
    const mojibakeCount = (text.match(/�/g) || []).length
    return cjkCount * 3 - (replacementCount + mojibakeCount) * 25
  }
  return gbText && score(gbText) > score(utf8Text) ? gbText : utf8Text
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

async function listAllProjectAssets(projectId: string): Promise<ServerAssetDto[]> {
  const allAssets: ServerAssetDto[] = []
  let cursor: string | null = null
  for (let page = 0; page < 20; page += 1) {
    const listed = await listServerAssets({
      projectId,
      limit: 100,
      cursor,
    })
    const items = Array.isArray(listed?.items) ? listed.items : []
    allAssets.push(...items)
    cursor = listed?.cursor ?? null
    if (!cursor) break
  }
  return allAssets
}

export async function uploadProjectText(input: UploadProjectTextInput): Promise<UploadProjectTextResult> {
  const fileBytes = typeof input.file.size === 'number' && Number.isFinite(input.file.size)
    ? Math.max(0, Math.trunc(input.file.size))
    : 0
  if (fileBytes > TEXT_UPLOAD_MAX_BYTES) {
    throw new Error(`文本文件超过 ${TEXT_UPLOAD_MAX_LABEL} 上传上限`)
  }

  const contentRaw = await decodeUploadText(input.file)
  const content = String(contentRaw || '').trim()
  if (!content) {
    throw new Error('上传文件为空，未写入素材')
  }
  const contentBytes = getUtf8TextByteLength(content)
  if (contentBytes > TEXT_UPLOAD_MAX_BYTES) {
    throw new Error(`文本内容超过 ${TEXT_UPLOAD_MAX_LABEL} 上传上限`)
  }

  const normalizedKind = input.uploadMode === 'book-only'
    ? 'novelDoc'
    : inferMaterialKindFromUpload(input.file.name, content)

  if (normalizedKind === 'novelDoc') {
    if (input.isBookUploadLocked) {
      throw new Error('当前项目有小说上传任务进行中，请等待完成后再上传')
    }
    const uploadTitle = input.file.name.replace(/\.[^.]+$/, '').trim()
      || String(input.projectName || '').trim()
      || PROJECT_TEXT_ASSET_NAME
    const session = await startProjectBookUploadSession({
      projectId: input.projectId,
      title: uploadTitle,
      contentBytes,
    })
    const uploadId = String(session.uploadId || '').trim()
    if (!uploadId) {
      throw new Error('分块上传初始化失败：缺少 uploadId')
    }
    const totalChunks = Math.max(1, Math.ceil(content.length / PROJECT_BOOK_UPLOAD_CHUNK_CHARS))
    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * PROJECT_BOOK_UPLOAD_CHUNK_CHARS
      const end = Math.min(content.length, start + PROJECT_BOOK_UPLOAD_CHUNK_CHARS)
      const chunkText = content.slice(start, end)
      if (!chunkText) continue
      await appendProjectBookUploadChunk({
        projectId: input.projectId,
        uploadId,
        chunk: chunkText,
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

  const allAssets = await listAllProjectAssets(input.projectId)
  const existingTextAsset = pickCurrentProjectTextAsset(allAssets)
  const nextData: Record<string, unknown> = {
    kind: normalizedKind,
    chapter: null,
    content,
    source: PROJECT_TEXT_SINGLETON_SOURCE,
    lastUploadName: input.file.name,
    lastUploadKind: normalizedKind,
    updatedAt: new Date().toISOString(),
  }
  if (existingTextAsset) {
    await updateServerAssetData(existingTextAsset.id, {
      ...((typeof existingTextAsset.data === 'object' && existingTextAsset.data !== null && !Array.isArray(existingTextAsset.data))
        ? existingTextAsset.data
        : {}),
      ...nextData,
    })
    if (String(existingTextAsset.name || '').trim() !== PROJECT_TEXT_ASSET_NAME) {
      await renameServerAsset(existingTextAsset.id, PROJECT_TEXT_ASSET_NAME)
    }
  } else {
    await createServerAsset({
      name: PROJECT_TEXT_ASSET_NAME,
      projectId: input.projectId,
      data: nextData,
    })
  }

  const keepId = String(existingTextAsset?.id || '').trim()
  const staleCandidates = allAssets.filter(isProjectMaterialAsset)
  await Promise.allSettled(
    staleCandidates
      .map((asset) => String(asset.id || '').trim())
      .filter((assetId) => assetId && assetId !== keepId)
      .map((assetId) => deleteServerAsset(assetId)),
  )

  return {
    mode: 'asset',
    kind: normalizedKind,
  }
}

export function isProjectTextReadyAsset(asset: ServerAssetDto | null): boolean {
  if (!asset) return false
  return getProjectMaterialAssetContent(asset).trim().length > 0
}
