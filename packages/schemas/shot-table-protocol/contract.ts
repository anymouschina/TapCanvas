import { DEFAULT_SHOT_TABLE_COLUMNS } from './defaults'
import type { ShotTableColumn } from './types'

export const buildShotTableOutputContract = (
  columns: readonly ShotTableColumn[] = DEFAULT_SHOT_TABLE_COLUMNS,
): string => {
  const labels = new Set<string>()
  for (const column of columns) {
    if (labels.has(column.label)) throw new Error(`当前分镜表存在重复列名：“${column.label}”。`)
    labels.add(column.label)
  }
  if (!columns.some((column) => column.scope === 'timeline' && column.label === '时间段')) {
    throw new Error('当前分镜表缺少时序列“时间段”，无法构造结构化输出契约。')
  }
  const shotLabels = columns.filter((column) => column.scope === 'shot').map((column) => column.label)
  const timelineLabels = columns.filter((column) => column.scope === 'timeline').map((column) => column.label)
  return [
    '只输出可解析的分镜层级文本，不要输出 Markdown 表格、代码围栏、解释、总结或质检过程。',
    '输出必须从“【镜头总览】”开始，并为每个镜头完整使用“=========单镜头开始=========”与“=========单镜头结束=========”。',
    `每个镜头必须逐项输出这些镜头级字段，即使值为空也不得省略：${shotLabels.join('、') || '无'}。`,
    '随后必须输出“---镜头内时序细分”，每个时序行必须从“时间段：”开始。',
    `每个时序行必须逐项输出这些时序级字段，即使值为空也不得省略：${timelineLabels.join('、') || '无'}。`,
    '不得新增当前分镜表不存在的字段；未知或不可确认的值留空，不得编造。',
  ].join('\n')
}

export const SHOT_TABLE_ANALYSIS_OUTPUT_MODE = 'shot-table-v1' as const
