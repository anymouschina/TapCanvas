import { MantineProvider } from '@mantine/core'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createApiKeyMock, toastMock } = vi.hoisted(() => ({ createApiKeyMock: vi.fn(), toastMock: vi.fn() }))
vi.mock('../../api/server', () => ({
  createApiKey: createApiKeyMock,
  absoluteApiBase: () => 'https://canvas.example/api/',
}))
vi.mock('../../ui/toast', () => ({ toast: toastMock }))

import { McpAgentConnectDialog } from './McpAgentConnectDialog'
import { McpIntegrationView } from './McpIntegrationView'
import { buildMcpAgentConnectPrompt, buildMcpEndpoint } from './mcpAgentConnectSupport'

const endpoint = 'https://canvas.example/api/public/mcp'
const result = { key: 'tc_sk_one_time_secret', apiKey: { id: 'key-1' } }
const writeText = vi.fn<[string], Promise<void>>()

function dialog(opened = true, onClose = vi.fn()) {
  return <MantineProvider><McpAgentConnectDialog opened={opened} endpoint={endpoint} onClose={onClose} /></MantineProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  createApiKeyMock.mockResolvedValue(result)
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
})

describe('MCP assistant connection', () => {
  it('opens from the account MCP page without issuing a key', () => {
    render(<MantineProvider><McpIntegrationView /></MantineProvider>)
    fireEvent.click(screen.getByRole('button', { name: '通过 AI 助手接入' }))
    expect(screen.getByRole('dialog', { name: '通过 AI 助手接入 MCP' })).toBeTruthy()
    expect(createApiKeyMock).not.toHaveBeenCalled()
  })

  it('issues a dedicated key on demand and copies the complete credential-bearing prompt', async () => {
    render(dialog())
    fireEvent.click(screen.getByRole('button', { name: '生成密钥和提示词' }))
    await screen.findByRole('button', { name: '复制提示词（含密钥）' })
    expect(createApiKeyMock).toHaveBeenCalledOnce()
    expect(createApiKeyMock).toHaveBeenCalledWith({
      label: expect.stringContaining('智能体 MCP 接入 '),
      allowedOrigins: ['*'],
      scopes: ['public:read', 'public:write', 'agent:execute'],
    })
    expect(screen.getByText('接入提示词（含密钥，只展示这一次）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '复制提示词（含密钥）' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(buildMcpAgentConnectPrompt({ endpoint, apiKey: result.key })))
    expect(toastMock).toHaveBeenCalledWith('含密钥的接入提示词已复制', 'success')
  })

  it('shows request errors in place and allows an explicit retry', async () => {
    createApiKeyMock.mockRejectedValueOnce(new Error('create api key failed: 401'))
    render(dialog())
    fireEvent.click(screen.getByRole('button', { name: '生成密钥和提示词' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('生成接入密钥失败：create api key failed: 401')
    expect(screen.queryByRole('button', { name: '复制提示词（含密钥）' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '生成密钥和提示词' }))
    await screen.findByRole('button', { name: '复制提示词（含密钥）' })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(createApiKeyMock).toHaveBeenCalledTimes(2)
  })

  it('clears the displayed secret when closed and reopened', async () => {
    const view = render(dialog())
    fireEvent.click(screen.getByRole('button', { name: '生成密钥和提示词' }))
    await screen.findByRole('button', { name: '复制提示词（含密钥）' })
    view.rerender(dialog(false))
    view.rerender(dialog())
    expect(screen.queryByRole('region', { name: '接入提示词（含密钥）' })).toBeNull()
    expect(screen.getByRole('button', { name: '生成密钥和提示词' })).toBeTruthy()
    expect(createApiKeyMock).toHaveBeenCalledOnce()
  })

  it('does not write a late mint response into a reopened session and prevents duplicate clicks', async () => {
    let finish: ((value: typeof result) => void) | undefined
    createApiKeyMock.mockReturnValueOnce(new Promise<typeof result>((resolve) => { finish = resolve }))
    const view = render(dialog())
    fireEvent.click(screen.getByRole('button', { name: '生成密钥和提示词' }))
    fireEvent.click(screen.getByRole('button', { name: '正在生成密钥' }))
    expect(createApiKeyMock).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '正在生成密钥' })).toBeDisabled()
    view.rerender(dialog(false))
    view.rerender(dialog())
    await act(async () => { finish?.(result) })
    expect(screen.queryByRole('button', { name: '复制提示词（含密钥）' })).toBeNull()
    expect(screen.getByRole('button', { name: '生成密钥和提示词' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '生成密钥和提示词' }))
    await screen.findByRole('button', { name: '复制提示词（含密钥）' })
    expect(createApiKeyMock).toHaveBeenCalledTimes(2)
  })

  it('retains the one-time prompt after clipboard failure and reports the failure in place', async () => {
    writeText.mockRejectedValueOnce(new Error('clipboard denied'))
    render(dialog())
    fireEvent.click(screen.getByRole('button', { name: '生成密钥和提示词' }))
    fireEvent.click(await screen.findByRole('button', { name: '复制提示词（含密钥）' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('复制失败：clipboard denied')
    expect(screen.getByRole('region', { name: '接入提示词（含密钥）' })).toHaveTextContent(`Authorization: Bearer ${result.key}`)
    expect(createApiKeyMock).toHaveBeenCalledOnce()
  })

  it('includes the exact endpoint, credential and a truthful connection check in client instructions', () => {
    expect(buildMcpEndpoint('https://canvas.example/api///')).toBe(endpoint)
    const prompt = buildMcpAgentConnectPrompt({ endpoint, apiKey: result.key })
    expect(prompt).toContain(`MCP 地址（Streamable HTTP）：${endpoint}`)
    expect(prompt).toContain(`Authorization: Bearer ${result.key}`)
    expect(prompt).toContain(`codex mcp add tapcanvas --url ${endpoint} --bearer-token-env-var TAPCANVAS_TOKEN`)
    expect(prompt).toContain('调用失败时报告错误')
  })
})
