// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthExpiredNotice, notifyAuthExpired } from './AuthExpiredNotice'

describe('AuthExpiredNotice', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows a factual alert when the auth interceptor reports an expired session', () => {
    render(<AuthExpiredNotice />)

    act(() => notifyAuthExpired())

    expect(screen.getByRole('alert').textContent).toBe('登录状态已过期，请重新登录')
  })
})
