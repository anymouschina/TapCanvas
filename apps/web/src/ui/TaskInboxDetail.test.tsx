// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TaskInboxItemDto } from '../api/server'
import { TaskInboxDetail } from './TaskInboxDetail'

const failedItem: TaskInboxItemDto = {
  taskId: 'task-failed',
  vendor: 'newapi',
  kind: 'text_to_video',
  status: 'failed',
  assetCount: 0,
  assets: [],
  prompt: '雨夜中的霓虹街道，缓慢推进镜头',
  errorMessage: '供应商拒绝了本次生成请求',
  nodeId: null,
  chapterId: null,
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:01:00.000Z',
  completedAt: '2026-08-14T00:01:00.000Z',
  notificationId: 'task-result:user-1:task-failed',
  readAt: null,
}

afterEach(cleanup)

describe('TaskInboxDetail', () => {
  it('shows the prompt, explicit failure reason, and truthful empty artifact state for a failed generation', () => {
    render(
      <MantineProvider>
        <TaskInboxDetail
          item={failedItem}
          title="文生视频"
          onBack={vi.fn()}
          onPreview={vi.fn()}
          onFocusNode={vi.fn()}
        />
      </MantineProvider>,
    )

    expect(screen.getByText('执行失败 · newapi')).toBeInTheDocument()
    expect(screen.getByText('供应商拒绝了本次生成请求')).toBeInTheDocument()
    expect(screen.getByText('雨夜中的霓虹街道，缓慢推进镜头')).toBeInTheDocument()
    expect(screen.getByText('该任务没有可预览产物')).toBeInTheDocument()
  })
})
