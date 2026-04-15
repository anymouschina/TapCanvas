import { uploadServerAssetFile, type TaskKind } from '../api/server'
import { loadBatchImageSource } from '../domain/resource-runtime/services/batchImageSourceLoader'
import { runBatchProcessingJob } from '../domain/resource-runtime/services/batchProcessingQueue'
import type { NamedReferenceEntry } from './assetReference'

export type ReferenceSheetEntryMeta = {
  sourceUrl: string
  label: string
  assetId?: string | null
  note?: string | null
}

export type UploadedReferenceSheet = {
  url: string
  sourceUrls: string[]
  entries: ReferenceSheetEntryMeta[]
}

type LoadedReferenceImageSource = {
  source: CanvasImageSource
  width: number
  height: number
  dispose: () => void
}

export async function loadReferenceSheetImageSource(url: string): Promise<LoadedReferenceImageSource> {
  const loaded = await loadBatchImageSource(url)
  return {
    source: loaded.source,
    width: loaded.width,
    height: loaded.height,
    dispose: loaded.release,
  }
}

export async function composeLabeledReferenceSheetBlob(entries: NamedReferenceEntry[]): Promise<Blob | null> {
  return runBatchProcessingJob(async () => {
    const items = entries
      .map((x) => ({ label: String(x.label || '').trim(), url: String(x.url || '').trim() }))
      .filter((x) => x.label && x.url)
      .slice(0, 8)
    if (!items.length) return null

    const cols = items.length <= 2 ? items.length : 2
    const rows = Math.ceil(items.length / cols)
    const cellW = 420
    const cellH = 520
    const gap = 10
    const pad = 14
    const width = Math.min(2200, pad * 2 + cols * cellW + (cols - 1) * gap)
    const height = Math.min(2800, pad * 2 + rows * cellH + (rows - 1) * gap)
    const offscreenSupported = typeof OffscreenCanvas !== 'undefined'
    const canvas: OffscreenCanvas | HTMLCanvasElement = offscreenSupported
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height })
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.fillStyle = '#0b1220'
    ctx.fillRect(0, 0, width, height)

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]!
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = pad + col * (cellW + gap)
      const y = pad + row * (cellH + gap)

      let loaded: LoadedReferenceImageSource | null = null
      try {
        // eslint-disable-next-line no-await-in-loop
        loaded = await loadReferenceSheetImageSource(item.url)
        const scale = Math.min(cellW / loaded.width, cellH / loaded.height)
        const drawW = Math.max(1, Math.round(loaded.width * scale))
        const drawH = Math.max(1, Math.round(loaded.height * scale))
        const dx = x + Math.floor((cellW - drawW) / 2)
        const dy = y + Math.floor((cellH - drawH) / 2)

        ctx.fillStyle = '#111827'
        ctx.fillRect(x, y, cellW, cellH)
        ctx.drawImage(loaded.source, dx, dy, drawW, drawH)
        ctx.strokeStyle = 'rgba(148,163,184,0.55)'
        ctx.lineWidth = 2
        ctx.strokeRect(x, y, cellW, cellH)
      } catch {
        ctx.fillStyle = '#111827'
        ctx.fillRect(x, y, cellW, cellH)
        ctx.strokeStyle = 'rgba(148,163,184,0.4)'
        ctx.lineWidth = 2
        ctx.strokeRect(x, y, cellW, cellH)
      } finally {
        loaded?.dispose()
      }

      const label = item.label.length > 22 ? `${item.label.slice(0, 22)}…` : item.label
      ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft Yahei, sans-serif'
      const textWidth = Math.ceil(ctx.measureText(label).width)
      const pillWidth = Math.min(cellW - 24, textWidth + 24)
      const pillHeight = 34
      const pillX = x + cellW - pillWidth - 10
      const pillY = y + cellH - pillHeight - 10
      ctx.fillStyle = 'rgba(15,23,42,0.88)'
      ctx.fillRect(pillX, pillY, pillWidth, pillHeight)
      ctx.fillStyle = '#f8fafc'
      ctx.fillText(label, pillX + 12, pillY + 24)
    }

    if (canvas instanceof OffscreenCanvas) {
      return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
    }
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('导出拼图失败'))), 'image/jpeg', 0.92)
    })
  })
}

export async function uploadMergedReferenceSheet(input: {
  id: string
  entries: NamedReferenceEntry[]
  prompt: string
  vendor: string
  modelKey: string
  taskKind: TaskKind
  mergeThreshold?: number
}): Promise<UploadedReferenceSheet | null> {
  const mergeThreshold =
    typeof input.mergeThreshold === 'number' && Number.isFinite(input.mergeThreshold)
      ? Math.max(1, Math.trunc(input.mergeThreshold))
      : 2
  if (input.entries.length <= mergeThreshold) return null
  const mergedBlob = await composeLabeledReferenceSheetBlob(input.entries)
  if (!mergedBlob) return null
  const file = new File([mergedBlob], `reference-sheet-${input.id}-${Date.now()}.jpg`, { type: 'image/jpeg' })
  const uploaded = await uploadServerAssetFile(file, file.name, {
    prompt: input.prompt,
    vendor: input.vendor,
    modelKey: input.modelKey,
    taskKind: input.taskKind,
  })
  const uploadedUrl =
    typeof uploaded?.data?.url === 'string'
      ? String(uploaded.data.url).trim()
      : ''
  if (!uploadedUrl) return null
  return {
    url: uploadedUrl,
    sourceUrls: input.entries.map((entry) => String(entry.url || '').trim()).filter(Boolean),
    entries: input.entries.map((entry) => ({
      sourceUrl: String(entry.url || '').trim(),
      label: String(entry.label || '').trim(),
      ...(entry.assetId ? { assetId: entry.assetId } : null),
      ...(entry.note ? { note: entry.note } : null),
    })),
  }
}
