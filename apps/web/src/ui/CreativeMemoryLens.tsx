import React from 'react'
import { Button, Loader, Text } from '@mantine/core'
import { IconBrain, IconDatabaseOff } from '@tabler/icons-react'

import type { MemoryEntryDto } from '../api/server'
import type { MemoryLensState } from './useMemoryLens'

function memoryHeadline(item: MemoryEntryDto): string {
  return item.summaryText?.trim() || item.title?.trim() || '未命名记忆'
}

function formatMemoryDate(value: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed)
}

export function CreativeMemoryLens({ state }: Readonly<{ state: MemoryLensState }>): JSX.Element {
  if (state.loading && state.itemCount === 0) {
    return (
      <div className="creative-memory-lens__state" role="status" aria-label="正在读取当前记忆">
        <Loader className="creative-memory-lens__loader" size="sm" />
      </div>
    )
  }

  if (state.error) {
    return (
      <div className="creative-memory-lens__state creative-memory-lens__state--error" role="alert">
        <Text className="creative-memory-lens__state-text" size="sm">{state.error}</Text>
        <Button className="creative-memory-lens__retry" variant="subtle" size="compact-xs" onClick={state.reload}>重试</Button>
      </div>
    )
  }

  if (state.itemCount === 0) {
    return (
      <div className="creative-memory-lens__state">
        <IconDatabaseOff className="creative-memory-lens__empty-icon" size={24} stroke={1.5} />
        <Text className="creative-memory-lens__state-text" size="sm" c="dimmed">当前范围没有可用记忆</Text>
      </div>
    )
  }

  return (
    <div className="creative-memory-lens">
      <div className="creative-memory-lens__notice">
        <IconBrain className="creative-memory-lens__notice-icon" size={15} stroke={1.7} />
        <Text className="creative-memory-lens__notice-text" size="xs">
          这里是当前范围可提供给小 T 的候选记忆，不等于本轮已经采用；本轮实际动作以动态与交付证据为准。
        </Text>
      </div>
      {state.summaryText ? (
        <Text className="creative-memory-lens__summary" size="xs">{state.summaryText}</Text>
      ) : null}
      <div className="creative-memory-lens__groups">
        {state.groups.map((group) => (
          <section className="creative-memory-lens__group" key={group.key} aria-labelledby={`memory-group-${group.key}`}>
            <div className="creative-memory-lens__group-header">
              <Text className="creative-memory-lens__group-title" id={`memory-group-${group.key}`}>{group.label}</Text>
              <span className="creative-memory-lens__group-count">{group.items.length}</span>
            </div>
            <div className="creative-memory-lens__list">
              {group.items.map((item) => (
                <div className="creative-memory-lens__item" key={item.id}>
                  <Text className="creative-memory-lens__item-headline" size="sm">{memoryHeadline(item)}</Text>
                  <div className="creative-memory-lens__item-meta">
                    <span className="creative-memory-lens__item-scope">{item.scopeType}</span>
                    <span className="creative-memory-lens__item-separator">·</span>
                    <time className="creative-memory-lens__item-time" dateTime={item.updatedAt}>{formatMemoryDate(item.updatedAt)}</time>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
