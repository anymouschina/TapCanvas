import type { TaskAssetDto, TaskResultDto } from '../api/server'

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function readPromptGenerationTaskFailure(result: TaskResultDto, mediaLabel: string): string {
  const raw = readRecord(result.raw)
  const response = readRecord(raw?.response)
  const candidates = [raw?.error, raw?.message, response?.error, response?.message]
  const message = candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)
  return message?.trim() || `${mediaLabel}生成失败，未返回可用原因`
}

export function findPromptGenerationAssets(
  assets: readonly TaskAssetDto[],
  type: TaskAssetDto['type'],
): TaskAssetDto[] {
  return assets.filter((asset) => asset.type === type && asset.url.trim().length > 0)
}
