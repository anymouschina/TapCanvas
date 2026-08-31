import { describe, expect, it } from 'vitest'
import { createEmptyShotTable } from '@tapcanvas/shot-table-protocol'
import type { ShotTableAssetBinding } from './shotTableAssetBinding'
import { createEvenShotTableSplitPlan } from './shotTableSplit'
import {
  buildShotTableSplitNodeInputs,
  countCreatedShotTableSplitNodes,
} from './shotTableSplitNodes'

const createSourceTable = () => {
  const table = createEmptyShotTable()
  const createValues = (input: {
    shotNo: string
    timeline: string
    shotRange: string
    duration: string
  }): Record<string, string> => Object.fromEntries(table.columns.map((column) => {
    if (column.label === '镜号') return [column.key, input.shotNo]
    if (column.label === '时间段') return [column.key, input.timeline]
    if (column.label === '时间区间（镜头完整区间）') return [column.key, input.shotRange]
    if (column.label === '时长') return [column.key, input.duration]
    return [column.key, '']
  }))
  return {
    ...table,
    rows: [
      {
        id: 'row-1',
        shotId: 'shot-1',
        values: createValues({ shotNo: 'M001', timeline: '0s-12s', shotRange: '0s-12s', duration: '12s' }),
      },
      {
        id: 'row-2',
        shotId: 'shot-2',
        values: createValues({ shotNo: 'M002', timeline: '12s-31s', shotRange: '12s-31s', duration: '19s' }),
      },
    ],
  }
}

const createBinding = (rowId: string, id: string): ShotTableAssetBinding => ({
  id,
  createdAt: '2026-08-02T00:00:00.000Z',
  rowId,
  columnKey: '画面内容',
  token: `@asset${id}`,
  source: 'project',
  nodeId: null,
  assetId: id,
  assetRefId: id,
  assetName: id,
  assetUrl: `https://example.com/${id}.png`,
})

describe('shotTableSplitNodes', () => {
  it('构造互相独立、可追溯且不复用唯一交付 ID 的节点输入', () => {
    const plan = createEvenShotTableSplitPlan(createSourceTable())
    const nodes = buildShotTableSplitNodeInputs({
      plan,
      sourceNodeId: 'source-table',
      sourceLabel: '视频分析分镜表',
      sourceData: {
        sourceVideoUrl: 'https://example.com/source.mp4',
        videoAnalysisDeliveryId: 'unique-delivery-id',
        analysisModel: 'analysis-model',
      },
      sourceRect: { x: 100, y: 200, w: 920, h: 620 },
      assetBindings: [createBinding('row-1', 'asset-1'), createBinding('row-2', 'asset-2')],
      splitRunId: 'split-run-1',
      createdAt: '2026-08-02T01:00:00.000Z',
    })

    expect(nodes).toHaveLength(3)
    expect(nodes.map((node) => node.label)).toEqual([
      '视频分析分镜表 · 片段 1/3',
      '视频分析分镜表 · 片段 2/3',
      '视频分析分镜表 · 片段 3/3',
    ])
    expect(nodes.map((node) => node.position)).toEqual([
      { x: 1060, y: 200 },
      { x: 1060, y: 860 },
      { x: 1060, y: 1520 },
    ])
    expect(nodes[0]?.data.videoAnalysisDeliveryId).toBeUndefined()
    expect(nodes[0]?.data.sourceVideoAnalysisDeliveryId).toBe('unique-delivery-id')
    expect(nodes[0]?.data.sourceShotTableNodeId).toBe('source-table')
    expect(nodes[0]?.data.shotTableHistory).toEqual([])
    expect(nodes[0]?.data.shotTableAssetBindings).toHaveLength(1)
    expect(nodes[1]?.data.shotTableAssetBindings).toHaveLength(2)
    expect(nodes[2]?.data.shotTableAssetBindings).toHaveLength(1)
  })

  it('只按当前 splitRunId 统计真实创建结果', () => {
    expect(countCreatedShotTableSplitNodes([
      { data: { shotTableSplit: { splitRunId: 'run-a' } } },
      { data: { shotTableSplit: { splitRunId: 'run-b' } } },
      { data: { shotTableSplit: { splitRunId: 'run-a' } } },
      { data: null },
    ], 'run-a')).toBe(2)
  })
})
