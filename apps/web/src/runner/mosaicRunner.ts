import type { Node } from '@xyflow/react'
import { toast } from '../ui/toast'
import { isRemoteUrl } from '../canvas/nodes/taskNode/utils'

const MAX_CELLS = 9
const BG_COLOR = '#0b1224'

function nowLabel() {
  return new Date().toLocaleTimeString()
}

function normalizeProxyUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.pathname.includes('/assets/proxy-image') && u.searchParams.has('url')) {
      return u.searchParams.get('url') || url
    }
    return url
  } catch {
    return url
  }
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const sourceUrl = normalizeProxyUrl(url)
  const tryLoad = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('加载图片失败'))
      img.src = src
    })

  // 1) 直接加载
  try {
    return await tryLoad(sourceUrl)
  } catch (directErr) {
    // 2) 前端 fetch -> blob -> dataURL（小图场景优先，避免跨域头）
    try {
      const resp = await fetch(sourceUrl)
      if (!resp.ok) throw new Error(`fetch ${resp.status}`)
      const blob = await resp.blob()
      // 小图转 dataURL，避免 objectURL revoke 时被引用
      const asDataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('blob 转 dataURL 失败'))
        reader.readAsDataURL(blob)
      })
      return await tryLoad(asDataUrl)
    } catch (blobErr) {
      throw blobErr
    }
  }
}

function drawMosaic(images: HTMLImageElement[], grid: number) {
  const count = images.length
  const safeGrid = grid && grid >= 1 && grid <= 3 ? grid : Math.min(3, Math.max(1, Math.ceil(Math.sqrt(count))))
  const cols = safeGrid
  const rows = safeGrid // 保持等分方格（NxN），不足的格子留空背景
  const cellSize = 480
  const width = cellSize * cols
  const height = cellSize * rows
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布上下文')
  ctx.fillStyle = BG_COLOR
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'

  images.forEach((img, idx) => {
    if (idx >= cols * rows) return
    const col = idx % cols
    const row = Math.floor(idx / cols)
    const x = col * cellSize
    const y = row * cellSize
    const scale = Math.max(cellSize / img.width, cellSize / img.height)
    const dw = img.width * scale
    const dh = img.height * scale
    const dx = x + (cellSize - dw) / 2
    const dy = y + (cellSize - dh) / 2

    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, cellSize, cellSize)
    ctx.clip()
    ctx.drawImage(img, dx, dy, dw, dh)
    ctx.restore()
  })

  return canvas
}

export async function buildMosaicCanvas(urls: string[], grid: number) {
  const loaded: HTMLImageElement[] = []
  const failedUrls: string[] = []
  for (const url of urls) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const img = await loadImage(url)
      loaded.push(img)
    } catch (err) {
      console.warn('mosaic load error', err)
      failedUrls.push(url)
    }
  }
  if (!loaded.length) {
    const error: any = new Error('图片已过期或无法加载，请重新选择可访问的图片')
    error.failedUrls = failedUrls
    throw error
  }
  return { canvas: drawMosaic(loaded, grid), failedUrls }
}

export async function runNodeMosaic(id: string, get: () => any, set: (fn: (s: any) => any) => void) {
  const node: Node | undefined = get().nodes.find((n: Node) => n.id === id)
  if (!node) return
  const data: any = node.data || {}
  const setNodeStatus = get().setNodeStatus as (id: string, status: any, patch?: any) => void
  const appendLog = get().appendLog as (id: string, line: string) => void
  const beginToken = get().beginRunToken as (id: string) => void
  const endRunToken = get().endRunToken as (id: string) => void
  const isCanceled = get().isCanceled as (id: string) => boolean

  setNodeStatus(id, 'queued', { progress: 0 })
  appendLog(id, `[${nowLabel()}] queued (mosaic)`) 
  await new Promise((r) => setTimeout(r, 150))
  if (isCanceled?.(id)) {
    setNodeStatus(id, 'canceled', { progress: 0 })
    endRunToken?.(id)
    return
  }
  beginToken?.(id)
  setNodeStatus(id, 'running', { progress: 5 })

  try {
    const sourcesFromData = Array.isArray(data?.mosaicImages)
      ? (data.mosaicImages as any[]).map((i) => (typeof i?.url === 'string' ? i.url : null)).filter(Boolean)
      : []
    if (!sourcesFromData.length) {
      throw new Error('请在拼图配置中手动选择图片后再生成')
    }
    const sources = sourcesFromData
    const grid = typeof data?.mosaicGrid === 'number' && data.mosaicGrid >= 1 && data.mosaicGrid <= 3 ? data.mosaicGrid : 2
    const limit = Math.min(MAX_CELLS, Math.max(1, Number(data?.mosaicLimit) || grid * grid || MAX_CELLS))
    const picked = sources.slice(0, limit)
    appendLog(id, `[${nowLabel()}] 收集参考图 ${picked.length} 张，开始拼图…`)

    const { canvas, failedUrls } = await buildMosaicCanvas(picked, grid)
    if (failedUrls.length) {
      appendLog(id, `[${nowLabel()}] 跳过 ${failedUrls.length} 张失效图片`)
    }
    const blob: Blob = await new Promise((resolve, reject) => {
      try {
        canvas.toBlob((b) => {
          if (b) resolve(b)
          else reject(new Error('生成拼图失败'))
        }, 'image/png')
      } catch (err) {
        reject(err)
      }
    })

    const finalUrl = canvas.toDataURL('image/png')
    if (!finalUrl) {
      throw new Error('拼图生成成功但导出失败')
    }

    const existing = Array.isArray(data.imageResults) ? data.imageResults : []
    const merged = [...existing, { url: finalUrl, title: '拼图' }]
    const primaryIndex = existing.length

    setNodeStatus(id, 'success', {
      progress: 100,
      imageUrl: finalUrl,
      imageResults: merged,
      imagePrimaryIndex: primaryIndex,
      mosaicSources: picked,
      lastResult: {
        id,
        at: Date.now(),
        kind: 'mosaic',
        preview: { type: 'image', src: finalUrl },
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
