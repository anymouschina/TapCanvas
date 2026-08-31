import type { ShotTableColumn, ShotTableData } from './types'

export const DEFAULT_SHOT_TABLE_COLUMNS: ReadonlyArray<ShotTableColumn> = [
  { key: '时间段', label: '时间段', scope: 'timeline' },
  { key: '镜号', label: '镜号', scope: 'shot' },
  { key: '时间区间（镜头完整区间）', label: '时间区间（镜头完整区间）', scope: 'shot' },
  { key: '时长', label: '时长', scope: 'shot' },
  { key: '节拍单元', label: '节拍单元', scope: 'shot' },
  { key: '剧本特征', label: '剧本特征', scope: 'shot' },
  { key: '场景与光影', label: '场景与光影', scope: 'shot' },
  { key: '人物站位（本节拍起始）', label: '人物站位（本节拍起始）', scope: 'shot' },
  { key: '景别', label: '景别', scope: 'shot' },
  { key: '运镜', label: '运镜', scope: 'shot' },
  { key: '构图', label: '构图', scope: 'shot' },
  { key: '画面内容', label: '画面内容', scope: 'shot' },
  { key: '台词', label: '台词', scope: 'shot' },
  { key: '音效', label: '音效', scope: 'shot' },
  { key: '备注', label: '备注', scope: 'shot' },
  { key: '字数与语速', label: '字数与语速', scope: 'shot' },
  { key: '目标人物', label: '目标人物', scope: 'timeline' },
  { key: '表情与呼吸', label: '表情与呼吸', scope: 'timeline' },
  { key: '细微肢体与应激动作', label: '细微肢体与应激动作', scope: 'timeline' },
]

/**
 * 已存在视频的一阶事实证据表。
 *
 * “节拍单元”与“剧本特征”需要创作解释，不是可直接验证的媒体事实，
 * 因此不进入 video evidence 合同。它们仍保留在 DEFAULT_SHOT_TABLE_COLUMNS，
 * 供用户明确发起的剧本转分镜创作流程使用。
 */
export const VIDEO_EVIDENCE_SHOT_TABLE_COLUMNS: ReadonlyArray<ShotTableColumn> =
  DEFAULT_SHOT_TABLE_COLUMNS
    .filter((column) => column.key !== '节拍单元' && column.key !== '剧本特征')
    .map((column) => ({ ...column }))

export const SHOT_TABLE_OVERVIEW_ORDER = ['集数/标题', '总镜数', '素材总时长', '节拍数', '全程说明'] as const

export const createEmptyShotTable = (): ShotTableData => {
  const columns = DEFAULT_SHOT_TABLE_COLUMNS.map((column) => ({ ...column }))
  return {
    version: 1,
    overview: {
      '集数/标题': '',
      总镜数: '1',
      素材总时长: '',
      节拍数: '',
      全程说明: '全程无音乐，只保留音效。不生成字幕。',
    },
    columns,
    rows: [{
      id: 'shot-1-segment-1',
      shotId: 'shot-1',
      values: Object.fromEntries(
        columns.map((column) => [column.key, column.label === '镜号' ? 'M001' : '']),
      ),
    }],
  }
}
