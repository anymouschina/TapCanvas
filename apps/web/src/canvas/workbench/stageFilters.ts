import { WORKBENCH_CATEGORIES, type WorkbenchCategory, type WorkbenchItem } from './workbenchModel'

export type StageStatusFilter = 'missing' | 'busy' | 'failed'
export type StageFilter = { category: WorkbenchCategory | null; status: StageStatusFilter | null; query: string }
export const EMPTY_STAGE_FILTER: StageFilter = { category: null, status: null, query: '' }

/** 数据多于这个数量时才出现导航条，少量数据不占用注意力。 */
export const STAGE_NAVIGATOR_MIN_ITEMS = 12

export function stageItemStatus(item: WorkbenchItem, pending: ReadonlySet<string>): StageStatusFilter | 'ready' {
  if (item.busy || pending.has(item.id)) return 'busy'
  if (item.error || item.status === 'error' || item.status === 'failed') return 'failed'
  return item.hasResult ? 'ready' : 'missing'
}

export function filterStageItems(items: readonly WorkbenchItem[], filter: StageFilter, pending: ReadonlySet<string>): WorkbenchItem[] {
  const query = filter.query.trim().toLowerCase()
  return items.filter((item) => (!filter.category || item.category === filter.category)
    && (!filter.status || stageItemStatus(item, pending) === filter.status)
    && (!query || [item.label, ...item.sceneRefs.map((scene) => scene.name)].some((name) => name.toLowerCase().includes(query))))
}

export function stageCategoryCounts(items: readonly WorkbenchItem[]): { id: WorkbenchCategory; label: string; count: number }[] {
  return WORKBENCH_CATEGORIES.flatMap((category) => {
    const count = items.filter((item) => item.category === category.id).length
    return count ? [{ id: category.id, label: category.label, count }] : []
  })
}

export function stageStatusCounts(items: readonly WorkbenchItem[], pending: ReadonlySet<string>): Record<StageStatusFilter, number> {
  const counts: Record<StageStatusFilter, number> = { missing: 0, busy: 0, failed: 0 }
  for (const item of items) {
    const status = stageItemStatus(item, pending)
    if (status !== 'ready') counts[status] += 1
  }
  return counts
}
