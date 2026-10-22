import { describe, expect, it } from 'vitest'
import type { WorkbenchItem } from './workbenchModel'
import { filterStageItems, stageCategoryCounts, stageStatusCounts } from './stageFilters'

function item(partial: Partial<WorkbenchItem> & Pick<WorkbenchItem, 'id' | 'category'>): WorkbenchItem {
  return { label: partial.id, kind: 'image', status: 'success', busy: false, imageUrl: null, videoUrl: null, audioUrl: null,
    text: '', error: null, hasResult: true, canGenerate: true, upstreamIds: [],
    clipIds: [], clipIndex: null, shotScript: '', durationSeconds: null, sceneRefs: [], ...partial }
}

const items = [
  item({ id: 'a', label: '顾观棋角色卡', category: 'character' }),
  item({ id: 'b', label: '顾观棋·少年角色卡', category: 'character', hasResult: false }),
  item({ id: 'c', label: '林嫣儿角色卡', category: 'character', error: '供应商拒绝' }),
  item({ id: 'd', label: '医馆', category: 'scene', busy: true, hasResult: false }),
  item({ id: 'e', label: '长剑', category: 'prop', hasResult: false }),
]

describe('stage navigator filters', () => {
  it('counts categories and actionable statuses', () => {
    expect(stageCategoryCounts(items)).toEqual([
      { id: 'character', label: '角色', count: 3 }, { id: 'scene', label: '场景', count: 1 }, { id: 'prop', label: '道具', count: 1 },
    ])
    expect(stageStatusCounts(items, new Set(['e']))).toEqual({ missing: 1, busy: 2, failed: 1 })
  })

  it('combines category, status and name search', () => {
    const none = new Set<string>()
    expect(filterStageItems(items, { category: 'character', status: null, query: '顾观棋' }, none).map((i) => i.id)).toEqual(['a', 'b'])
    expect(filterStageItems(items, { category: null, status: 'missing', query: '' }, none).map((i) => i.id)).toEqual(['b', 'e'])
    expect(filterStageItems(items, { category: null, status: 'failed', query: '' }, none).map((i) => i.id)).toEqual(['c'])
  })

  it('finds clips by the scene they play in', () => {
    const clips = [
      item({ id: 'c1', label: 'Clip 1', category: 'video', sceneRefs: [{ nodeId: 's', name: '百花酒楼二楼雅间' }] }),
      item({ id: 'c2', label: 'Clip 2', category: 'video' }),
    ]
    expect(filterStageItems(clips, { category: null, status: null, query: '酒楼' }, new Set()).map((i) => i.id)).toEqual(['c1'])
  })
})
