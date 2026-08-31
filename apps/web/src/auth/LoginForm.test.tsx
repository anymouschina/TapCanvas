// @vitest-environment jsdom

import React from 'react'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { LoginForm } from './LoginForm'

const { loginWithCredentials } = vi.hoisted(() => ({
  loginWithCredentials: vi.fn(),
}))

vi.mock('../api/server', () => ({ loginWithCredentials }))

beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }))
})

afterAll(() => { vi.unstubAllGlobals() })

describe('LoginForm', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('uses the administrator account and password path without SMS controls', async () => {
    const onLoginSuccess = vi.fn()
    loginWithCredentials.mockResolvedValue({
      authenticated: true,
      user: { sub: 'tapcanvas_admin', login: 'admin', role: 'admin' },
    })
    render(
      <MantineProvider defaultColorScheme="dark" forceColorScheme="dark">
        <LoginForm onLoginSuccess={onLoginSuccess} />
      </MantineProvider>,
    )

    expect(screen.queryByText('获取验证码')).toBeNull()
    expect(screen.getByText('TapCanvas')).toBeTruthy()
    expect(screen.getByText('new-api')).toBeTruthy()
    expect(screen.getAllByText('admin / 123456')).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('账号'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(loginWithCredentials).toHaveBeenCalledWith('admin', '123456'))
    expect(onLoginSuccess).toHaveBeenCalledWith(expect.objectContaining({ login: 'admin' }))
  })
})
