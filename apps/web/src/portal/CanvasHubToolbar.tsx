import React from 'react'
import {
  IconFolderPlus,
  IconLayoutGrid,
  IconPlus,
  IconSearch,
  IconSquare,
  IconUsers,
  IconX,
} from '@tabler/icons-react'
import type { ProjectScope } from './NeoTvProjectShelf'
import type { CanvasHubCardSize } from './CanvasHubProjectGrid'

export type CanvasHubToolbarProps = {
  scope: ProjectScope
  cardSize: CanvasHubCardSize
  query: string
  authenticated: boolean
  creating: boolean
  directoryReady: boolean
  directorySaving: boolean
  directoryConflicted: boolean
  onScopeChange: (scope: ProjectScope) => void
  onCardSizeChange: (size: CanvasHubCardSize) => void
  onQueryChange: (query: string) => void
  onCreateProject: () => void
  onToggleFolderComposer: () => void
}

export function CanvasHubToolbar({
  scope,
  cardSize,
  query,
  authenticated,
  creating,
  directoryReady,
  directorySaving,
  directoryConflicted,
  onScopeChange,
  onCardSizeChange,
  onQueryChange,
  onCreateProject,
  onToggleFolderComposer,
}: CanvasHubToolbarProps): JSX.Element {
  return (
    <div className="canvas-hub-toolbar">
      <div className="canvas-hub-tabs" role="tablist" aria-label="画布范围">
        {([
          ['all', '全部', IconLayoutGrid],
          ['personal', '个人画布', IconSquare],
          ['collab', '协作画布', IconUsers],
        ] as const).map(([value, label, TabIcon]) => (
          <button
            className={`canvas-hub-tab${scope === value ? ' is-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={scope === value}
            key={value}
            onClick={() => onScopeChange(value)}
          >
            <TabIcon className="canvas-hub-tab__icon" size={14} />
            <span className="canvas-hub-tab__label">{label}</span>
          </button>
        ))}
      </div>
      <div className="canvas-hub-toolbar__right">
        <button className="canvas-hub-toolbar__create" type="button" aria-label="新建画布" disabled={creating} onClick={onCreateProject}>
          <IconPlus className="canvas-hub-toolbar__create-icon" size={15} />
          <span className="canvas-hub-toolbar__create-label">新建画布</span>
        </button>
        {authenticated ? (
          <button
            className="canvas-hub-toolbar__create canvas-hub-toolbar__folder"
            type="button"
            aria-label="新建分组"
            title="新建分组"
            disabled={!directoryReady || directorySaving || directoryConflicted}
            onClick={onToggleFolderComposer}
          >
            <IconFolderPlus className="canvas-hub-toolbar__create-icon" size={15} />
            <span className="canvas-hub-toolbar__create-label">新建分组</span>
          </button>
        ) : null}
        <label className="canvas-hub-search">
          <IconSearch className="canvas-hub-search__icon" size={15} />
          <input
            className="canvas-hub-search__input"
            value={query}
            placeholder="搜索全部分组"
            onChange={(event) => onQueryChange(event.currentTarget.value)}
          />
          {query ? (
            <button className="canvas-hub-search__clear" type="button" aria-label="清空搜索" onClick={() => onQueryChange('')}>
              <IconX className="canvas-hub-search__clear-icon" size={14} />
            </button>
          ) : null}
        </label>
        <div className="canvas-hub-size" role="group" aria-label="卡片尺寸">
          {(['small', 'medium', 'large'] as const).map((size) => {
            const SizeIcon = size === 'large' ? IconSquare : IconLayoutGrid
            return (
              <button
                className={`canvas-hub-size__button is-${size}${cardSize === size ? ' is-active' : ''}`}
                type="button"
                aria-label={`${size === 'small' ? '小' : size === 'medium' ? '默认' : '大'}卡片`}
                aria-pressed={cardSize === size}
                key={size}
                onClick={() => onCardSizeChange(size)}
              >
                <SizeIcon
                  className="canvas-hub-size__glyph"
                  size={size === 'medium' ? 16 : 14}
                  stroke={size === 'large' ? 2.2 : 2}
                />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
