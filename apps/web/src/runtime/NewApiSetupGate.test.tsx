// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../auth/store'

const getNewApiGatewayReadiness = vi.fn()

vi.mock('../api/server', () => ({
  getNewApiGatewayReadiness,
}))

import { NewApiSetupGate } from './NewApiSetupGate'

describe('NewApiSetupGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuth.setState({
      token: 'cookie-session',
      user: { sub: 'fresh-user', login: 'fresh-user' },
      loading: false,
    })
  })

  afterEach(() => cleanup())

  it('blocks an authenticated user until a configured executable channel exists', async () => {
    getNewApiGatewayReadiness.mockResolvedValue({
      ready: false,
      enabledModelCount: 4,
      configuredChannelCount: 0,
      executableModelCount: 0,
      reasons: ['no_configured_channels'],
      setupUrl: 'http://127.0.0.1:14455/console/channel',
      recommendedProvider: {
        name: '鲁班 API',
        baseUrl: 'https://tt-api.lluban.com/',
        registerUrl: 'https://tt-api.lluban.com/register',
        topupUrl: 'https://tt-api.lluban.com/console/topup',
        tokenUrl: 'https://tt-api.lluban.com/console/token',
      },
    })

    render(<NewApiSetupGate />)

    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByText('两个平台的默认管理员账号')).toBeTruthy()
    expect(screen.getByText('TapCanvas')).toBeTruthy()
    expect(screen.getByText('new-api')).toBeTruthy()
    expect(screen.getAllByText('admin')).toHaveLength(2)
    expect(screen.getAllByText('123456')).toHaveLength(2)
    expect(screen.getByText('new-api 已有启用模型，但还没有配置可用的渠道 API Key。')).toBeTruthy()
    expect(screen.getByRole('link', { name: '第 2 步：打开本机 new-api 渠道配置' }).getAttribute('href'))
      .toBe('http://127.0.0.1:14455/console/channel')
    expect(screen.getByRole('link', { name: '兑换额度' }).getAttribute('href'))
      .toBe('https://tt-api.lluban.com/console/topup')
  })

  it('rechecks and releases the gate after configuration becomes executable', async () => {
    getNewApiGatewayReadiness
      .mockResolvedValueOnce({
        ready: false,
        enabledModelCount: 4,
        configuredChannelCount: 0,
        executableModelCount: 0,
        reasons: ['no_configured_channels'],
        setupUrl: 'http://127.0.0.1:14455/console/channel',
        recommendedProvider: {
          name: '鲁班 API',
          baseUrl: 'https://tt-api.lluban.com/',
          registerUrl: 'https://tt-api.lluban.com/register',
          topupUrl: 'https://tt-api.lluban.com/console/topup',
          tokenUrl: 'https://tt-api.lluban.com/console/token',
        },
      })
      .mockResolvedValueOnce({
        ready: true,
        enabledModelCount: 4,
        configuredChannelCount: 1,
        executableModelCount: 2,
        reasons: [],
        setupUrl: 'http://127.0.0.1:14455/console/channel',
        recommendedProvider: {
          name: '鲁班 API',
          baseUrl: 'https://tt-api.lluban.com/',
          registerUrl: 'https://tt-api.lluban.com/register',
          topupUrl: 'https://tt-api.lluban.com/console/topup',
          tokenUrl: 'https://tt-api.lluban.com/console/token',
        },
      })

    render(<NewApiSetupGate />)
    fireEvent.click(await screen.findByRole('button', { name: '我已完成配置' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(getNewApiGatewayReadiness).toHaveBeenCalledTimes(2)
  })

  it('never renders the gate while a refresh check resolves as ready', async () => {
    let resolveReadiness: ((value: {
      ready: boolean
      enabledModelCount: number
      configuredChannelCount: number
      executableModelCount: number
      reasons: string[]
      setupUrl: string
      recommendedProvider: {
        name: string
        baseUrl: string
        registerUrl: string
        topupUrl: string
        tokenUrl: string
      }
    }) => void) | undefined
    getNewApiGatewayReadiness.mockReturnValue(new Promise((resolve) => {
      resolveReadiness = resolve
    }))

    render(<NewApiSetupGate />)

    expect(screen.queryByRole('dialog')).toBeNull()
    resolveReadiness?.({
      ready: true,
      enabledModelCount: 20,
      configuredChannelCount: 1,
      executableModelCount: 20,
      reasons: [],
      setupUrl: 'http://127.0.0.1:14455/console/channel',
      recommendedProvider: {
        name: '鲁班 API',
        baseUrl: 'https://tt-api.lluban.com/',
        registerUrl: 'https://tt-api.lluban.com/register',
        topupUrl: 'https://tt-api.lluban.com/console/topup',
        tokenUrl: 'https://tt-api.lluban.com/console/token',
      },
    })

    await waitFor(() => expect(getNewApiGatewayReadiness).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
