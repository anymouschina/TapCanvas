import React from 'react'
import type { ShotTableData } from '@tapcanvas/shot-table-protocol'
import { useRFStore } from '../../../store'
import { getNodeAbsRect } from '../../../utils/nodeBounds'
import type { ShotTableAssetBindingsResult } from './shotTableAssetBinding'
import {
  createEvenShotTableSplitPlan,
  SHOT_TABLE_CLIP_DURATION_LIMIT_SECONDS,
  type ShotTableSplitPlan,
} from './shotTableSplit'
import {
  buildShotTableSplitNodeInputs,
  countCreatedShotTableSplitNodes,
} from './shotTableSplitNodes'

type SplitInspection = {
  plan: ShotTableSplitPlan | null
  error: string
}

export type ShotTableSplitControl = {
  disabled: boolean
  tooltip: string
  split: () => void
}

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim() ? error.message.trim() : fallback

const inspectSplitPlan = (table: ShotTableData | null): SplitInspection => {
  if (!table) return { plan: null, error: '分镜表数据缺失。' }
  try {
    return { plan: createEvenShotTableSplitPlan(table), error: '' }
  } catch (planError: unknown) {
    return { plan: null, error: errorMessage(planError, '无法解析分镜表时间轴。') }
  }
}

const createSplitRunId = (): string => {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error('当前浏览器不支持安全 UUID，无法创建分镜拆分记录。')
  }
  return `shot-table-split-${crypto.randomUUID()}`
}

const readText = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

export const useShotTableSplit = (input: {
  nodeId: string
  data: Record<string, unknown>
  table: ShotTableData | null
  readOnly: boolean
  rawDirty: boolean
  assetBindings: ShotTableAssetBindingsResult
  onSuccess: (message: string) => void
}): ShotTableSplitControl => {
  const addNode = useRFStore((state) => state.addNode)
  const inspection = React.useMemo(() => inspectSplitPlan(input.table), [input.table])
  const assetBindingsValid = !input.assetBindings.error

  const split = React.useCallback((): void => {
    if (input.readOnly) throw new Error('只读画布不能创建拆分节点。')
    if (input.rawDirty) throw new Error('原文存在尚未应用的修改，请先应用后再拆分。')
    if (!assetBindingsValid) {
      throw new Error(`素材绑定历史损坏：${input.assetBindings.error} 修复后才能拆分。`)
    }
    if (!input.table) throw new Error('分镜表数据缺失，无法拆分。')
    const plan = createEvenShotTableSplitPlan(input.table)
    if (!plan.requiresSplit) {
      throw new Error(`当前分镜表时长为 ${plan.totalDurationSeconds}s，未超过 ${SHOT_TABLE_CLIP_DURATION_LIMIT_SECONDS}s，无需拆分。`)
    }
    const state = useRFStore.getState()
    const sourceNode = state.nodes.find((node) => node.id === input.nodeId)
    if (!sourceNode) throw new Error('当前分镜表节点已不在画布中，无法定位拆分结果。')
    const splitRunId = createSplitRunId()
    const nodeInputs = buildShotTableSplitNodeInputs({
      plan,
      sourceNodeId: input.nodeId,
      sourceLabel: readText(input.data.label) || '分镜表',
      sourceData: input.data,
      sourceRect: getNodeAbsRect(sourceNode, new Map(state.nodes.map((node) => [node.id, node]))),
      assetBindings: input.assetBindings.bindings,
      splitRunId,
      createdAt: new Date().toISOString(),
    })

    nodeInputs.forEach((nodeInput) => {
      addNode('taskNode', nodeInput.label, { ...nodeInput.data, position: nodeInput.position })
    })
    const createdCount = countCreatedShotTableSplitNodes(useRFStore.getState().nodes, splitRunId)
    if (createdCount !== nodeInputs.length) {
      throw new Error(
        `拆分仅创建了 ${createdCount}/${nodeInputs.length} 个节点；原节点与已创建节点均已保留，请根据 splitRunId ${splitRunId} 核对画布。`,
      )
    }
    const durationLabels = Array.from(new Set(plan.segments.map((segment) => segment.durationLabel)))
    input.onSuccess(
      `已均匀创建 ${createdCount} 个独立分镜表（每段 ${durationLabels.join(' / ')}，均不超过 ${plan.maxDurationSeconds}s）；原节点已保留。`,
    )
  }, [
    addNode,
    assetBindingsValid,
    input.assetBindings.bindings,
    input.assetBindings.error,
    input.data,
    input.nodeId,
    input.onSuccess,
    input.rawDirty,
    input.readOnly,
    input.table,
  ])

  const tooltip = input.readOnly
    ? '只读画布不能拆分节点'
    : input.rawDirty
      ? '请先应用原文修改，再拆分节点'
      : !assetBindingsValid
        ? `素材绑定历史损坏，无法安全拆分：${input.assetBindings.error}`
        : inspection.error
          ? `无法拆分：${inspection.error}`
          : inspection.plan?.requiresSplit
            ? `均匀拆为 ${inspection.plan.segments.length} 个独立分镜表，每段不超过 ${SHOT_TABLE_CLIP_DURATION_LIMIT_SECONDS}s`
            : `当前时长 ${inspection.plan?.totalDurationSeconds ?? 0}s，未超过 ${SHOT_TABLE_CLIP_DURATION_LIMIT_SECONDS}s`
  const disabled = input.readOnly
    || input.rawDirty
    || !assetBindingsValid
    || Boolean(inspection.error)
    || inspection.plan?.requiresSplit !== true

  return { disabled, tooltip, split }
}
