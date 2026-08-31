// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listApiKeysMock,
  listApiKeyBillingOptionsMock,
  createApiKeyMock,
  rotateApiKeyMock,
  setPublicApiKeyMock,
} = vi.hoisted(() => ({
  listApiKeysMock: vi.fn(),
  listApiKeyBillingOptionsMock: vi.fn(),
  createApiKeyMock: vi.fn(),
  rotateApiKeyMock: vi.fn(),
  setPublicApiKeyMock: vi.fn(),
}))

vi.mock('../../api/server', () => ({
  createApiKey: createApiKeyMock,
  deleteApiKey: vi.fn(),
  listApiKeys: listApiKeysMock,
  listApiKeyBillingOptions: listApiKeyBillingOptionsMock,
  rotateApiKey: rotateApiKeyMock,
  updateApiKey: vi.fn(),
}))

vi.mock('../uiStore', () => ({
  useUIStore: (selector: (state: { publicApiKey: string; setPublicApiKey: (value: string) => void }) => unknown) => selector({
    publicApiKey: '',
    setPublicApiKey: setPublicApiKeyMock,
  }),
}))

vi.mock('../toast', () => ({ toast: vi.fn() }))
vi.mock('./ApiKeyUsagePanel', () => ({
  ApiKeyUsagePanel: () => <div className="api-key-usage-test-double">密钥消耗记录</div>,
}))

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

import { ApiKeyManagementModal } from './ApiKeyManagementModal'

describe('ApiKeyManagementModal', () => {
  beforeEach(() => {
    listApiKeysMock.mockResolvedValue([{
      id: 'key-1',
      label: '生产服务',
      keyPrefix: 'tc_sk_123456',
      allowedOrigins: ['*'],
      scopes: ['public:read', 'public:write', 'agent:execute'],
      enabled: true,
      billingTeamId: 'personal_user-1',
      billingTeamName: '个人账户',
      billingAvailableCredits: 680,
      lastUsedAt: '2026-08-12T01:00:00.000Z',
      expiresAt: '2026-11-10T01:00:00.000Z',
      revokedAt: null,
      rotatedFromId: null,
      createdAt: '2026-08-11T01:00:00.000Z',
      updatedAt: '2026-08-12T01:00:00.000Z',
    }])
    listApiKeyBillingOptionsMock.mockResolvedValue([{
      teamId: 'personal_user-1',
      name: '个人账户',
      isPersonal: true,
      availableCredits: 680,
    }])
    createApiKeyMock.mockResolvedValue({
      key: 'tc_sk_once_only_secret',
      apiKey: {
        id: 'key-2',
        label: 'Agent API',
        keyPrefix: 'tc_sk_once_o',
        allowedOrigins: ['http://localhost:3000'],
        scopes: ['public:read', 'public:write', 'agent:execute'],
        enabled: true,
        billingTeamId: null,
        billingTeamName: null,
        billingAvailableCredits: null,
        lastUsedAt: null,
        expiresAt: '2026-11-10T02:00:00.000Z',
        revokedAt: null,
        rotatedFromId: null,
        createdAt: '2026-08-12T02:00:00.000Z',
        updatedAt: '2026-08-12T02:00:00.000Z',
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows real quota and key-level quota from the existing API manager', async () => {
    render(
      <MantineProvider>
        <ApiKeyManagementModal opened onClose={vi.fn()} persistCreatedKeyLocally={false} />
      </MantineProvider>,
    )

    expect(await screen.findByText('可用配额')).toBeTruthy()
    await waitFor(() => expect(screen.getAllByText('680 积分')).toHaveLength(2))
    expect(screen.getByText('生产服务')).toBeTruthy()
    expect(screen.getByRole('button', { name: '新建 API Key' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: '名称' })).toBeNull()
    expect(screen.queryByText('当前画布 Key')).toBeNull()
  })

  it('opens the consumption records for a selected key', async () => {
    render(
      <MantineProvider>
        <ApiKeyManagementModal opened onClose={vi.fn()} persistCreatedKeyLocally={false} />
      </MantineProvider>,
    )

    const usageButton = await screen.findByRole('button', { name: '查看 API Key 消耗' })
    fireEvent.click(usageButton)

    expect(await screen.findByText('密钥消耗记录')).toBeTruthy()
  })

  it('generates a real key and exposes its secret only in the creation result', async () => {
    render(
      <MantineProvider>
        <ApiKeyManagementModal opened onClose={vi.fn()} persistCreatedKeyLocally={false} />
      </MantineProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '新建 API Key' }))
    expect(await screen.findByRole('dialog', { name: '新建 API Key' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '生成 API Key' }))

    await waitFor(() => expect(createApiKeyMock).toHaveBeenCalledOnce())
    expect(createApiKeyMock).toHaveBeenCalledWith(expect.objectContaining({ label: 'Agent API', billingTeamId: null }))
    expect(screen.getByDisplayValue('tc_sk_once_only_secret')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'API Key 已生成' })).toBeTruthy()
    expect(setPublicApiKeyMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    await waitFor(() => expect(screen.queryByDisplayValue('tc_sk_once_only_secret')).toBeNull())
  })
})
