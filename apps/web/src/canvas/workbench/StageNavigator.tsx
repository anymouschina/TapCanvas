import { TextInput } from '@mantine/core'
import { IconSearch, IconX } from '@tabler/icons-react'
import type { WorkbenchItem } from './workbenchModel'
import {
  stageCategoryCounts, stageStatusCounts,
  type StageFilter, type StageStatusFilter,
} from './stageFilters'

const STATUS_LABELS: Record<StageStatusFilter, string> = { missing: '待生成', busy: '生成中', failed: '异常' }

function Tag({ active, label, count, tone, onClick }: {
  active: boolean
  label: string
  count: number
  tone?: StageStatusFilter
  onClick: () => void
}): JSX.Element {
  return <button className="tc-stage-nav__tag" type="button" aria-pressed={active} data-tone={tone} onClick={onClick}>
    {label}<span className="tc-stage-nav__tag-count">{count}</span>
  </button>
}

/** 阶段内快速导航：分类与状态标签做筛选，名称搜索做定位。 */
export function StageNavigator({ items, pending, filter, showCategories, onChange }: {
  items: readonly WorkbenchItem[]
  pending: ReadonlySet<string>
  filter: StageFilter
  showCategories: boolean
  onChange: (next: StageFilter) => void
}): JSX.Element {
  const categories = showCategories ? stageCategoryCounts(items) : []
  const statuses = stageStatusCounts(items, pending)
  const statusEntries = (Object.keys(STATUS_LABELS) as StageStatusFilter[]).filter((status) => statuses[status] > 0)
  return (
    <nav className="tc-stage-nav" aria-label="快速导航">
      <div className="tc-stage-nav__tags">
        {categories.length > 1 ? <>
          <Tag active={!filter.category} label="全部" count={items.length} onClick={() => onChange({ ...filter, category: null })} />
          {categories.map((category) => (
            <Tag key={category.id} active={filter.category === category.id} label={category.label} count={category.count}
              onClick={() => onChange({ ...filter, category: filter.category === category.id ? null : category.id })} />
          ))}
        </> : null}
        {categories.length > 1 && statusEntries.length ? <span className="tc-stage-nav__divider" aria-hidden="true" /> : null}
        {statusEntries.map((status) => (
          <Tag key={status} active={filter.status === status} label={STATUS_LABELS[status]} count={statuses[status]} tone={status}
            onClick={() => onChange({ ...filter, status: filter.status === status ? null : status })} />
        ))}
      </div>
      <TextInput className="tc-stage-nav__search" classNames={{ input: 'tc-stage-nav__search-input' }}
        type="search" placeholder="搜索名称或场景" aria-label="搜索名称或场景" size="xs"
        leftSection={<IconSearch className="tc-stage-nav__search-icon" size={14} aria-hidden="true" />}
        value={filter.query} onChange={(event) => onChange({ ...filter, query: event.currentTarget.value })}
        rightSection={filter.query ? <button className="tc-stage-nav__search-clear" type="button" aria-label="清除搜索"
          onClick={() => onChange({ ...filter, query: '' })}><IconX className="tc-stage-nav__search-clear-icon" size={12} /></button> : null} />
    </nav>
  )
}
