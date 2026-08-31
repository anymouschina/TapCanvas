// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTaskInbox } from './useTaskInbox'

const apiMocks = vi.hoisted(() => ({
  listTaskInbox: vi.fn(),
  markTaskInboxNotificationRead: vi.fn(),
}))

vi.mock('../api/server', () => ({
  listTaskInbox: apiMocks.listTaskInbox,
  markTaskInboxNotificationRead: apiMocks.markTaskInboxNotificationRead,
}))

function InboxConsumer({ name }: { name: string }): JSX.Element {
  const inbox = useTaskInbox('user-1', true)
  return <div className="task-inbox-test-consumer" data-testid={name}>{inbox.unreadCount}</div>
}

describe('useTaskInbox shared polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    apiMocks.listTaskInbox.mockResolvedValue({
      items: [],
      nextCursor: null,
      unreadCount: 2,
    })
    apiMocks.markTaskInboxNotificationRead.mockResolvedValue({
      id: 'notification-1',
      readAt: '2026-08-14T00:00:00.000Z',
      updated: true,
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('shares one initial request and one refresh timer across multiple consumers', async () => {
    render(
      <div className="task-inbox-test-host">
        <InboxConsumer name="nav" />
        <InboxConsumer name="panel" />
      </div>,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(apiMocks.listTaskInbox).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('nav')).toHaveTextContent('2')
    expect(screen.getByTestId('panel')).toHaveTextContent('2')

    await act(async () => {
      vi.advanceTimersByTime(15_000)
      await Promise.resolve()
    })

    expect(apiMocks.listTaskInbox).toHaveBeenCalledTimes(2)
  })
})
