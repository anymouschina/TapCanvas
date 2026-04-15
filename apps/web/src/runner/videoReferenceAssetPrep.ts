import { uploadServerAssetFile, type TaskKind } from '../api/server'

export type PreparedVideoReferenceAssetRole = 'target' | 'reference'

export type PreparedVideoReferenceAsset = {
  assetId: string
  url: string
  role: PreparedVideoReferenceAssetRole
  sourceUrl: string
  width: number
  height: number
}

type PrepareVideoReferenceAssetsInput = {
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
  referenceImages: string[]
  aspectRatio: string
  size?: string | null
  vendor: string
  modelKey: string
  prompt?: string
  taskKind: TaskKind
}

type PrepareVideoReferenceAssetsResult = {
  firstFrameAsset: PreparedVideoReferenceAsset | null
  lastFrameAsset: PreparedVideoReferenceAsset | null
  referenceAssets: PreparedVideoReferenceAsset[]
}

async function fetchBlob(url: string, init?: RequestInit): Promise<Blob> {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`下载失败（${response.status}）`)
  return await response.blob()
}

async function fetchImageBlob(url: string): Promise<Blob> {
  const trimmed = String(url || '').trim()
  if (!trimmed) throw new Error('缺少图片 URL')
  return await fetchBlob(trimmed)
}

function parseAspectRatio(input: string): { widthRatio: number; heightRatio: number } | null {
  const match = String(input || '')
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)$/i)
  if (!match) return null
  const widthRatio = Number(match[1])
  const heightRatio = Number(match[2])
  if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio) || widthRatio <= 0 || heightRatio <= 0) {
    return null
  }
  return { widthRatio, heightRatio }
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y !== 0) {
    const next = x % y
    x = y
    y = next
  }
  return x || 1
}

function normalizeDimensions(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  }
}

function parseTargetDimensions(size: string | null | undefined, aspectRatio: string): { width: number; height: number } | null {
  const normalizedSize = String(size || '').trim().replace(/\s+/g, '')
  const ratio = parseAspectRatio(aspectRatio) || { widthRatio: 16, heightRatio: 9 }

  const explicitMatch = normalizedSize.match(/^(\d{2,5})[x*](\d{2,5})$/i)
  if (explicitMatch) {
    return normalizeDimensions(Number(explicitMatch[1]), Number(explicitMatch[2]))
  }

  const pMatch = normalizedSize.match(/^(\d{3,4})p$/i)
  if (pMatch) {
    const baseHeight = Number(pMatch[1])
    if (!Number.isFinite(baseHeight) || baseHeight <= 0) return null
    if (Math.abs(ratio.widthRatio - ratio.heightRatio) < 0.001) {
      return normalizeDimensions(baseHeight, baseHeight)
    }
    if (ratio.widthRatio >= ratio.heightRatio) {
      return normalizeDimensions((baseHeight * ratio.widthRatio) / ratio.heightRatio, baseHeight)
    }
    return normalizeDimensions(baseHeight, (baseHeight * ratio.heightRatio) / ratio.widthRatio)
  }

  if (!normalizedSize) {
    if (Math.abs(ratio.widthRatio - ratio.heightRatio) < 0.001) {
      return { width: 1024, height: 1024 }
    }
    if (ratio.widthRatio >= ratio.heightRatio) {
      return normalizeDimensions((720 * ratio.widthRatio) / ratio.heightRatio, 720)
    }
    return normalizeDimensions(720, (720 * ratio.heightRatio) / ratio.widthRatio)
  }

  const integerRatioDivisor = gcd(ratio.widthRatio, ratio.heightRatio)
  const widthUnit = Math.round(ratio.widthRatio / integerRatioDivisor)
  const heightUnit = Math.round(ratio.heightRatio / integerRatioDivisor)
  if (widthUnit > 0 && heightUnit > 0) {
    const scale = 256
    return normalizeDimensions(widthUnit * scale, heightUnit * scale)
  }
  return null
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }
      reject(new Error('导出参考图失败'))
    }, 'image/png')
  })
}

async function buildPaddedReferenceFile(input: {
  sourceUrl: string
  targetWidth: number
  targetHeight: number
  fileName: string
}): Promise<File> {
  const blob = await fetchImageBlob(input.sourceUrl)
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = input.targetWidth
    canvas.height = input.targetHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 初始化失败')

    context.fillStyle = '#000000'
    context.fillRect(0, 0, input.targetWidth, input.targetHeight)

    const scale = Math.min(input.targetWidth / bitmap.width, input.targetHeight / bitmap.height)
    const drawWidth = Math.max(1, Math.round(bitmap.width * scale))
    const drawHeight = Math.max(1, Math.round(bitmap.height * scale))
    const dx = Math.round((input.targetWidth - drawWidth) / 2)
    const dy = Math.round((input.targetHeight - drawHeight) / 2)

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, dx, dy, drawWidth, drawHeight)

    const fileBlob = await canvasToBlob(canvas)
    return new File([fileBlob], input.fileName, { type: 'image/png' })
  } finally {
    bitmap.close()
  }
}

function buildUploadFileName(input: {
  role: PreparedVideoReferenceAssetRole | 'end'
  index: number
}): string {
  const suffix = input.role === 'target' ? 'start' : input.role === 'end' ? 'end' : `ref-${input.index + 1}`
  return `sora-video-reference-${suffix}-${Date.now()}.png`
}

async function uploadPreparedReferenceAsset(input: {
  sourceUrl: string
  role: PreparedVideoReferenceAssetRole | 'end'
  index: number
  targetWidth: number
  targetHeight: number
  vendor: string
  modelKey: string
  prompt?: string
  taskKind: TaskKind
}): Promise<PreparedVideoReferenceAsset> {
  const file = await buildPaddedReferenceFile({
    sourceUrl: input.sourceUrl,
    targetWidth: input.targetWidth,
    targetHeight: input.targetHeight,
    fileName: buildUploadFileName({ role: input.role, index: input.index }),
  })
  const uploaded = await uploadServerAssetFile(file, file.name, {
    prompt: input.prompt,
    vendor: input.vendor,
    modelKey: input.modelKey,
    taskKind: input.taskKind,
  })
  const uploadedData =
    uploaded.data && typeof uploaded.data === 'object' && uploaded.data !== null
      ? (uploaded.data as Record<string, unknown>)
      : null
  const url = typeof uploadedData?.url === 'string' ? uploadedData.url.trim() : ''
  if (!uploaded.id || !url) {
    throw new Error('参考图已处理，但上传结果缺少 assetId 或 url')
  }
  return {
    assetId: uploaded.id,
    url,
    role: input.role === 'target' ? 'target' : 'reference',
    sourceUrl: input.sourceUrl,
    width: input.targetWidth,
    height: input.targetHeight,
  }
}

export function isSoraVideoModel(modelKey: string): boolean {
  return /(^|[-_])sora([_-]|$)/i.test(String(modelKey || '').trim())
}

export async function prepareSoraVideoReferenceAssets(
  input: PrepareVideoReferenceAssetsInput,
): Promise<PrepareVideoReferenceAssetsResult> {
  const targetSize = parseTargetDimensions(input.size, input.aspectRatio)
  if (!targetSize) {
    throw new Error(`无法解析 Sora 参考图目标尺寸：size=${String(input.size || '').trim() || '(empty)'} aspect=${input.aspectRatio}`)
  }

  const firstFrameUrl = typeof input.firstFrameUrl === 'string' ? input.firstFrameUrl.trim() : ''
  const lastFrameUrl = typeof input.lastFrameUrl === 'string' ? input.lastFrameUrl.trim() : ''
  const referenceImages = input.referenceImages
    .map((item) => String(item || '').trim())
    .filter(Boolean)

  const firstFrameAsset = firstFrameUrl
    ? await uploadPreparedReferenceAsset({
        sourceUrl: firstFrameUrl,
        role: 'target',
        index: 0,
        targetWidth: targetSize.width,
        targetHeight: targetSize.height,
        vendor: input.vendor,
        modelKey: input.modelKey,
        prompt: input.prompt,
        taskKind: input.taskKind,
      })
    : null

  const lastFrameAsset = lastFrameUrl
    ? await uploadPreparedReferenceAsset({
        sourceUrl: lastFrameUrl,
        role: 'end',
        index: 0,
        targetWidth: targetSize.width,
        targetHeight: targetSize.height,
        vendor: input.vendor,
        modelKey: input.modelKey,
        prompt: input.prompt,
        taskKind: input.taskKind,
      })
    : null

  const referenceAssets: PreparedVideoReferenceAsset[] = []
  for (let index = 0; index < referenceImages.length; index += 1) {
    const sourceUrl = referenceImages[index]
    if (!sourceUrl) continue
    const preparedAsset = await uploadPreparedReferenceAsset({
      sourceUrl,
      role: 'reference',
      index,
      targetWidth: targetSize.width,
      targetHeight: targetSize.height,
      vendor: input.vendor,
      modelKey: input.modelKey,
      prompt: input.prompt,
      taskKind: input.taskKind,
    })
    referenceAssets.push(preparedAsset)
  }

  return {
    firstFrameAsset,
    lastFrameAsset,
    referenceAssets,
  }
}
