import { describe, expect, it } from 'vitest'
// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import ChatQueueDock from './ChatQueueDock'

describe('ChatQueueDock', () => {
  it('renders nothing when there is no queued item and no server-only count', () => {
    const { container } = render(
      <ChatQueueDock items={[]} serverOnlyCount={0} consumedCount={0} running={false} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows a single queued item inline with its mode badge', () => {
    render(
      <ChatQueueDock
        items={[{ id: 'm_user_queued_1', text: '把主角换成红发', mode: 'steering' }]}
        serverOnlyCount={0}
        consumedCount={0}
        running
      />,
    )
    expect(screen.getByText('把主角换成红发')).not.toBeNull()
    expect(screen.getByText('纠偏')).not.toBeNull()
    expect(screen.getByText('1 条排队')).not.toBeNull()
  })

  it('collapses multiple items behind a count header by default and expands on click', () => {
    render(
      <ChatQueueDock
        items={[
          { id: 'm_user_queued_1', text: '第一条', mode: 'follow_up' },
          { id: 'm_user_queued_2', text: '第二条', mode: 'steering' },
        ]}
        serverOnlyCount={0}
        consumedCount={0}
        running
      />,
    )
    expect(screen.getByText(/2 条排队/)).not.toBeNull()
    // 默认折叠：两条正文不可见
    expect(screen.queryByText('第一条')).toBeNull()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('第一条')).not.toBeNull()
    expect(screen.getByText('第二条')).not.toBeNull()
  })

  it('surfaces server-only queued items as an honest count row, not fabricated text', () => {
    render(
      <ChatQueueDock
        items={[]}
        serverOnlyCount={2}
        consumedCount={0}
        running
      />,
    )
    expect(screen.getByText(/另有 2 条刷新前已排队的请求/)).not.toBeNull()
  })

  it('reports locally-known items that were consumed by the current turn', () => {
    render(
      <ChatQueueDock
        items={[{ id: 'm_user_queued_1', text: '还要做视频', mode: 'follow_up' }]}
        serverOnlyCount={0}
        consumedCount={1}
        running
      />,
    )
    expect(screen.getByText(/1 条排队消息已在当前回合开始执行/)).not.toBeNull()
  })
})
