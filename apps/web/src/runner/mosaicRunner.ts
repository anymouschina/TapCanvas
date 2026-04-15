import type { Node } from '@xyflow/react'
import { toast } from '../ui/toast'
import { isRemoteUrl } from '../canvas/nodes/taskNode/utils'
import { uploadServerAssetFile } from '../api/server'
import { loadBatchImageSource } from '../domain/resource-runtime/services/batchImageSourceLoader'
import { runBatchProcessingJob } from '../domain/resource-runtime/services/batchProcessingQueue'
import { buildAssetRefId, buildImageAssetResultItem } from './assetReference'

const MAX_CELLS = 30
const BG_COLOR = '#0b1224'

type LoadedMosaicSource = {
  source: CanvasImageSource
  width: number
  height: number
  dispose: () => void
}

function nowLabel() {
  return new Date().toLocaleTimeString()
}

async function loadImage(url: string): Promise<LoadedMosaicSource> {
  const loaded = await loadBatchImageSource(url)
  return {
    source: loaded.source,
    width: loaded.width,
    height: loaded.height,
    dispose: loaded.release,
  }
}

type MosaicRenderOptions = {
  cellSize?: number
  dividerWidth?: number
  dividerColor?: string
  layoutMode?: 'square' | 'columns'
  columns?: number
  backgroundColor?: string
  title?: string
  subtitle?: string
  titleColor?: string
  subtitleColor?: string
}

type MosaicNormalizedOptions = {
  grid: number
  picked: string[]
  cellSize: number
  dividerWidth: number
  dividerColor: string
  layoutMode: 'square' | 'columns'
  columns: number
  backgroundColor: string
  title: string
  subtitle: string
  titleColor: string
  subtitleColor: string
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveMosaicInput(data: any): MosaicNormalizedOptions {
  const sourcesFromData = Array.isArray(data?.mosaicImages)
    ? (data.mosaicImages as any[]).map((i) => (typeof i?.url === 'string' ? i.url : null)).filter(Boolean)
    : []
  if (!sourcesFromData.length) {
    throw new Error('请在拼图配置中手动选择图片后再生成')
  }
  const grid = typeof data?.mosaicGrid === 'number' && data.mosaicGrid >= 1 && data.mosaicGrid <= 3 ? data.mosaicGrid : 2
  const limit = Math.min(MAX_CELLS, Math.max(1, Number(data?.mosaicLimit) || grid * grid || MAX_CELLS))
  const picked = sourcesFromData.slice(0, limit)

  const mosaicCellSizeRaw = Number(data?.mosaicCellSize)
  const cellSize =
    Number.isFinite(mosaicCellSizeRaw) && mosaicCellSizeRaw >= 256 && mosaicCellSizeRaw <= 2048
      ? Math.trunc(mosaicCellSizeRaw)
      : 480
  const mosaicDividerWidthRaw = Number(data?.mosaicDividerWidth)
  const dividerWidth =
    Number.isFinite(mosaicDividerWidthRaw) && mosaicDividerWidthRaw >= 0 && mosaicDividerWidthRaw <= 24
      ? mosaicDividerWidthRaw
      : 0
  const dividerColor =
    typeof data?.mosaicDividerColor === 'string' && data.mosaicDividerColor.trim()
      ? String(data.mosaicDividerColor).trim()
      : '#ffffff'
  const layoutMode = data?.mosaicLayoutMode === 'columns' ? 'columns' : 'square'
  const rawColumns = Number(data?.mosaicColumns)
  const columns = Number.isFinite(rawColumns) ? clamp(Math.trunc(rawColumns), 1, 6) : 3
  const backgroundColor =
    typeof data?.mosaicBackgroundColor === 'string' && data.mosaicBackgroundColor.trim()
      ? String(data.mosaicBackgroundColor).trim()
      : BG_COLOR

  return {
    grid,
    picked,
    cellSize,
    dividerWidth,
    dividerColor,
    layoutMode,
    columns,
    backgroundColor,
    title: normalizeText(data?.mosaicTitle),
    subtitle: normalizeText(data?.mosaicSubtitle),
    titleColor: normalizeText(data?.mosaicTitleColor) || '#f8fafc',
    subtitleColor: normalizeText(data?.mosaicSubtitleColor) || '#cbd5e1',
  }
}

async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => {
        if (b) resolve(b)
        else reject(new Error('生成拼图失败'))
      }, 'image/png')
    } catch (err) {
      reject(err)
    }
  })
}

function buildMergedImageResults(existing: any, hostedUrl: string) {
  const safeExisting = Array.isArray(existing) ? existing : []
  const sanitizedExisting = safeExisting.filter(
    (it: any) => typeof it?.url === 'string' && isRemoteUrl(it.url.trim()),
  )
  const merged = [
    ...sanitizedExisting,
    buildImageAssetResultItem({
      url: hostedUrl,
      title: '拼图',
      assetRefId: buildAssetRefId({ name: 'mosaic', fallbackPrefix: 'mosaic' }),
    }),
  ]
  const primaryIndex = sanitizedExisting.length
  return { merged, primaryIndex }
}

function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const normalized = text.trim()
  if (!normalized) return []
  const rawLines = normalized.split(/\r?\n/)
  const output: string[] = []

  rawLines.forEach((rawLine) => {
    const words = rawLine.split(/\s+/).filter(Boolean)
    if (!words.length) {
      output.push('')
      return
    }

    let current = ''
    words.forEach((word) => {
      const next = current ? `${current} ${word}` : word
      if (ctx.measureText(next).width <= maxWidth) {
        current = next
        return
      }
      if (current) output.push(current)
      current = word
    })
    if (current) output.push(current)
  })

  return output
}

function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  options: { x: number; y: number; width: number; fontSize: number; lineHeight: number; color: string; fontWeight?: string },
) {
  if (!text.trim()) return 0
  ctx.save()
  ctx.font = `${options.fontWeight || '600'} ${options.fontSize}px Inter, ui-sans-serif, system-ui, sans-serif`
  ctx.fillStyle = options.color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const lines = wrapTextLines(ctx, text, options.width)
  lines.forEach((line, index) => {
    ctx.fillText(line, options.x, options.y + index * options.lineHeight)
  })
  ctx.restore()
  return lines.length * options.lineHeight
}

function drawMosaic(images: LoadedMosaicSource[], grid: number, options?: MosaicRenderOptions) {
  const count = images.length
  const safeGrid = grid && grid >= 1 && grid <= 3 ? grid : Math.min(3, Math.max(1, Math.ceil(Math.sqrt(count))))
  const layoutMode = options?.layoutMode === 'columns' ? 'columns' : 'square'
  const safeColumnsRaw = Number(options?.columns)
  const safeColumns = Number.isFinite(safeColumnsRaw) ? clamp(Math.trunc(safeColumnsRaw), 1, 6) : 3
  const cols = layoutMode === 'columns' ? safeColumns : safeGrid
  const rows = layoutMode === 'columns' ? Math.max(1, Math.ceil(count / cols)) : safeGrid
  const cellSizeRaw = Number(options?.cellSize)
  const cellSize = Number.isFinite(cellSizeRaw) && cellSizeRaw >= 256 && cellSizeRaw <= 2048 ? Math.trunc(cellSizeRaw) : 480
  const dividerWidthRaw = Number(options?.dividerWidth)
  const dividerWidth = Number.isFinite(dividerWidthRaw) && dividerWidthRaw >= 0 && dividerWidthRaw <= 24 ? dividerWidthRaw : 0
  const dividerColor =
    typeof options?.dividerColor === 'string' && options.dividerColor.trim()
      ? options.dividerColor.trim()
      : '#ffffff'
  const backgroundColor =
    typeof options?.backgroundColor === 'string' && options.backgroundColor.trim()
      ? options.backgroundColor.trim()
      : BG_COLOR
  const title = normalizeText(options?.title)
  const subtitle = normalizeText(options?.subtitle)
  const titleColor = normalizeText(options?.titleColor) || '#f8fafc'
  const subtitleColor = normalizeText(options?.subtitleColor) || '#cbd5e1'
  const textPadding = Math.max(24, Math.round(cellSize * 0.14))
  const textBlockWidth = Math.max(cellSize, cellSize * cols - textPadding * 2)
  const titleFontSize = clamp(Math.round(cellSize * 0.15), 28, 72)
  const subtitleFontSize = clamp(Math.round(cellSize * 0.075), 16, 32)
  const titleLineHeight = Math.round(titleFontSize * 1.24)
  const subtitleLineHeight = Math.round(subtitleFontSize * 1.45)
  const measureCanvas = document.createElement('canvas')
  const measureCtx = measureCanvas.getContext('2d')
  if (!measureCtx) throw new Error('无法创建画布上下文')
  measureCtx.font = `700 ${titleFontSize}px Inter, ui-sans-serif, system-ui, sans-serif`
  const titleLines = title ? wrapTextLines(measureCtx, title, textBlockWidth) : []
  measureCtx.font = `500 ${subtitleFontSize}px Inter, ui-sans-serif, system-ui, sans-serif`
  const subtitleLines = subtitle ? wrapTextLines(measureCtx, subtitle, textBlockWidth) : []
  const headerHeight = titleLines.length ? textPadding + titleLines.length * titleLineHeight : 0
  const footerHeight = subtitleLines.length ? textPadding + subtitleLines.length * subtitleLineHeight : 0
  const width = cellSize * cols
  const imageAreaHeight = cellSize * rows
  const height = headerHeight + imageAreaHeight + footerHeight
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布上下文')
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'

  if (titleLines.length) {
    drawTextBlock(ctx, title, {
      x: textPadding,
      y: textPadding,
      width: textBlockWidth,
      fontSize: titleFontSize,
      lineHeight: titleLineHeight,
      color: titleColor,
      fontWeight: '700',
    })
  }

  const imageAreaTop = headerHeight

  images.forEach((img, idx) => {
    if (idx >= cols * rows) return
    const col = idx % cols
    const row = Math.floor(idx / cols)
    const x = col * cellSize
    const y = imageAreaTop + row * cellSize
    const scale = Math.max(cellSize / img.width, cellSize / img.height)
    const dw = img.width * scale
    const dh = img.height * scale
    const dx = x + (cellSize - dw) / 2
    const dy = y + (cellSize - dh) / 2

    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, cellSize, cellSize)
    ctx.clip()
    ctx.drawImage(img.source, dx, dy, dw, dh)
    ctx.restore()
  })

  if (dividerWidth > 0) {
    ctx.save()
    ctx.strokeStyle = dividerColor
    ctx.lineWidth = dividerWidth
    for (let c = 1; c < cols; c += 1) {
      const x = c * cellSize
      ctx.beginPath()
      ctx.moveTo(x, imageAreaTop)
      ctx.lineTo(x, imageAreaTop + imageAreaHeight)
      ctx.stroke()
    }
    for (let r = 1; r < rows; r += 1) {
      const y = imageAreaTop + r * cellSize
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }
    ctx.restore()
  }

  if (subtitleLines.length) {
    drawTextBlock(ctx, subtitle, {
      x: textPadding,
      y: headerHeight + imageAreaHeight + Math.round(textPadding * 0.65),
      width: textBlockWidth,
      fontSize: subtitleFontSize,
      lineHeight: subtitleLineHeight,
      color: subtitleColor,
      fontWeight: '500',
    })
  }

  return canvas
}

export async function buildMosaicCanvas(urls: string[], grid: number, options?: MosaicRenderOptions) {
  return runBatchProcessingJob(async () => {
    const settled = await Promise.allSettled(urls.map(async (url) => ({ url, image: await loadImage(url) })))
    const loaded: LoadedMosaicSource[] = []
    const failedUrls: string[] = []
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        loaded.push(result.value.image)
        return
      }
      console.warn('mosaic load error', result.reason)
      const failedUrl = urls[index]
      if (failedUrl) failedUrls.push(failedUrl)
    })
    if (!loaded.length) {
      const error = new Error('图片已过期或无法加载，请重新选择可访问的图片') as Error & { failedUrls?: string[] }
      error.failedUrls = failedUrls
      throw error
    }
    try {
      return { canvas: drawMosaic(loaded, grid, options), failedUrls }
    } finally {
      loaded.forEach((item) => item.dispose())
    }
  })
}

export async function runNodeMosaic(id: string, get: () => any, set: (fn: (s: any) => any) => void) {
  const node: Node | undefined = get().nodes.find((n: Node) => n.id === id)
  if (!node) return
  const data: any = node.data || {}
  const setNodeStatusRaw = get().setNodeStatus as (id: string, status: any, patch?: any) => void
  const appendLogRaw = get().appendLog as (id: string, line: string) => void
  const beginToken = get().beginRunToken as (id: string) => string
  const endRunToken = get().endRunToken as (id: string) => void
  const isCanceledRaw = get().isCanceled as (id: string, runToken?: string | null) => boolean

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
    appendLogRaw(nodeId, line)
  }
  const isCanceled = (nodeId: string) => Boolean(isCanceledRaw?.(nodeId, runToken))

  setNodeStatus(id, 'queued', { progress: 0 })
  appendLog(id, `[${nowLabel()}] queued (mosaic)`) 
  await new Promise((r) => setTimeout(r, 150))
  if (isCanceled?.(id)) {
    setNodeStatus(id, 'canceled', { progress: 0 })
    endRunToken?.(id)
    return
  }
  setNodeStatus(id, 'running', { progress: 5 })

  try {
    const {
      picked,
      grid,
      cellSize: mosaicCellSize,
      dividerWidth: mosaicDividerWidth,
      dividerColor: mosaicDividerColor,
      layoutMode,
      columns,
      backgroundColor,
      title,
      subtitle,
      titleColor,
      subtitleColor,
    } = resolveMosaicInput(data)
    appendLog(id, `[${nowLabel()}] 收集参考图 ${picked.length} 张，开始拼图…`)

    const { canvas, failedUrls } = await buildMosaicCanvas(picked, grid, {
      cellSize: mosaicCellSize,
      dividerWidth: mosaicDividerWidth,
      dividerColor: mosaicDividerColor,
      layoutMode,
      columns,
      backgroundColor,
      title,
      subtitle,
      titleColor,
      subtitleColor,
    })
    if (failedUrls.length) {
      appendLog(id, `[${nowLabel()}] 跳过 ${failedUrls.length} 张失效图片`)
    }
    const blob = await canvasToPngBlob(canvas)
    setNodeStatus(id, 'running', { progress: 85 })
    appendLog(id, `[${nowLabel()}] 拼图已生成，上传到 OSS…`)
    const fileName = `mosaic-${Date.now()}.png`
    const file = new File([blob], fileName, { type: 'image/png' })
    const hosted = await uploadServerAssetFile(file, fileName, { taskKind: 'mosaic' })
    const hostedUrl = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
    if (!hostedUrl) {
      throw new Error('拼图已生成，但上传到 OSS 失败')
    }

    const { merged, primaryIndex } = buildMergedImageResults(data.imageResults, hostedUrl)

    setNodeStatus(id, 'success', {
      progress: 100,
      imageUrl: hostedUrl,
      imageResults: merged,
      imagePrimaryIndex: primaryIndex,
      serverAssetId: hosted.id,
      mosaicSources: picked,
      mosaicCellSize,
      mosaicDividerWidth,
      mosaicDividerColor,
      mosaicLayoutMode: layoutMode,
      mosaicColumns: columns,
      mosaicBackgroundColor: backgroundColor,
      mosaicTitle: title,
      mosaicSubtitle: subtitle,
      mosaicTitleColor: titleColor,
      mosaicSubtitleColor: subtitleColor,
      lastResult: {
        id,
        at: Date.now(),
        kind: 'mosaic',
        preview: { type: 'image', src: hostedUrl },
      },
    })
    appendLog(id, `[${nowLabel()}] 拼图完成，输出 ${merged.length} 张结果，主图更新。`)
  } catch (err: any) {
    const msg = err?.message || '拼图失败'
    toast(msg, 'error')
    setNodeStatus(id, 'error', { progress: 0, lastError: msg })
    appendLog(id, `[${nowLabel()}] error: ${msg}`)
  } finally {
    endRunToken?.(id)
  }
}
