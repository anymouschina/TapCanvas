import { describe, expect, it } from 'vitest'
import { createEmptyShotTable } from '@tapcanvas/shot-table-protocol'
import {
  readVideoAnalysisRuns,
  readVideoAnalysisUndeliveredResults,
} from './videoAnalysisHistory'

const run = {
  startedAt: '2026-08-01T00:00:00.000Z',
  completedAt: '2026-08-01T00:01:00.000Z',
  model: 'doubao-seed-2-0-lite-260428',
  fps: 1,
  sourceVideoNodeId: 'video-1',
  sourceVideoUrl: 'https://example.com/video.mp4',
  outputNodeId: 'shot-table-1',
  deliveryId: 'delivery-1',
  delivery: 'created_and_connected',
}

describe('video analysis history', () => {
  it('accepts traceable run and undelivered result records', () => {
    expect(readVideoAnalysisRuns([run]).error).toBe('')
    expect(readVideoAnalysisUndeliveredResults([{
      table: createEmptyShotTable(),
      rawText: 'structured output',
      model: run.model,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      fps: run.fps,
      sourceVideoNodeId: run.sourceVideoNodeId,
      sourceVideoUrl: run.sourceVideoUrl,
      deliveryId: null,
      deliveryError: '画布交付失败',
    }]).error).toBe('')
  })

  it('rejects malformed entries instead of replacing their arrays', () => {
    expect(readVideoAnalysisRuns([{ ...run, deliveryId: '' }]).error).toContain('deliveryId')
    expect(readVideoAnalysisRuns([{
      ...run,
      delivery: 'analysis_failed',
      outputNodeId: null,
      error: '结构解析失败',
      rawOutput: 'unstructured output',
    }]).error).toContain('原始模型输出诊断不完整')
    expect(readVideoAnalysisUndeliveredResults([{ invalid: true }]).error).toContain('分镜表无效')
  })
})
