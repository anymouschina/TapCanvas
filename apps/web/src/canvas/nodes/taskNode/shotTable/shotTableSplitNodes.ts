import { serializeShotTable } from '@tapcanvas/shot-table-protocol'
import type { NodeRect } from '../../../utils/nodeBounds'
import type { ShotTableAssetBinding } from './shotTableAssetBinding'
import type { ShotTableSplitPlan } from './shotTableSplit'

export const SHOT_TABLE_SPLIT_NODE_GAP = 40

const VIDEO_ANALYSIS_PROVENANCE_KEYS = [
  'sourceVideoUrl',
  'sourceVideoNodeId',
  'sourceVideoAnalysisNodeId',
  'analysisModel',
  'analysisFps',
  'analysisCompletedAt',
  'analysisTransport',
] as const

const pickVideoAnalysisProvenance = (data: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(VIDEO_ANALYSIS_PROVENANCE_KEYS.flatMap((key) =>
    key in data ? [[key, data[key]]] : []))

export type ShotTableSplitNodeInput = {
  label: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

export const buildShotTableSplitNodeInputs = (input: {
  plan: ShotTableSplitPlan
  sourceNodeId: string
  sourceLabel: string
  sourceData: Record<string, unknown>
  sourceRect: NodeRect
  assetBindings: readonly ShotTableAssetBinding[]
  splitRunId: string
  createdAt: string
}): ShotTableSplitNodeInput[] => {
  const provenance = pickVideoAnalysisProvenance(input.sourceData)
  const sourceDeliveryId = typeof input.sourceData.videoAnalysisDeliveryId === 'string'
    ? input.sourceData.videoAnalysisDeliveryId.trim()
    : ''
  return input.plan.segments.map((segment) => {
    const rowIds = new Set(segment.table.rows.map((row) => row.id))
    const bindings = input.assetBindings
      .filter((binding) => rowIds.has(binding.rowId))
      .map((binding) => ({ ...binding }))
    const rawText = serializeShotTable(segment.table)
    return {
      label: `${input.sourceLabel} · 片段 ${segment.index + 1}/${input.plan.segments.length}`,
      position: {
        x: input.sourceRect.x + input.sourceRect.w + SHOT_TABLE_SPLIT_NODE_GAP,
        y: input.sourceRect.y + segment.index * (input.sourceRect.h + SHOT_TABLE_SPLIT_NODE_GAP),
      },
      data: {
        autoLabel: false,
        kind: 'shotTable',
        nodeWidth: input.sourceRect.w,
        nodeHeight: input.sourceRect.h,
        shotTable: segment.table,
        shotTableRawText: rawText,
        shotTableViewMode: 'table',
        shotTableCurrentSource: '15 秒均匀拆分',
        shotTableCurrentNote: `源片区间：${segment.sourceRangeLabel}；本段时长：${segment.durationLabel}`,
        shotTableHistory: [],
        shotTableAssetBindings: bindings,
        prompt: rawText,
        sourceShotTableNodeId: input.sourceNodeId,
        ...(sourceDeliveryId ? { sourceVideoAnalysisDeliveryId: sourceDeliveryId } : {}),
        shotTableSplit: {
          version: 1,
          splitRunId: input.splitRunId,
          sourceNodeId: input.sourceNodeId,
          segmentIndex: segment.index,
          segmentCount: input.plan.segments.length,
          sourceStartSeconds: segment.sourceStartSeconds,
          sourceEndSeconds: segment.sourceEndSeconds,
          durationSeconds: segment.durationSeconds,
          maxDurationSeconds: input.plan.maxDurationSeconds,
          createdAt: input.createdAt,
        },
        ...provenance,
        status: 'success',
      },
    }
  })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const countCreatedShotTableSplitNodes = (
  nodes: readonly { data?: unknown }[],
  splitRunId: string,
): number => nodes.filter((node) => {
  if (!isRecord(node.data)) return false
  const split = node.data.shotTableSplit
  return isRecord(split) && split.splitRunId === splitRunId
}).length
