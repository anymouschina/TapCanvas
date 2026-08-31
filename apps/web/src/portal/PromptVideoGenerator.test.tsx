// @vitest-environment jsdom

import React from 'react'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PromptVideoGenerator } from './PromptVideoGenerator'
import { installMantineDomMocks } from './testMantineDomMocks'

installMantineDomMocks()

const mocks = vi.hoisted(() => ({
  token: null as string | null,
  runPublicTaskWithAuth: vi.fn(),
  fetchPublicTaskResultWithAuth: vi.fn(),
  reloadHistory: vi.fn(),
}))

vi.mock('../auth/store', () => ({
  useAuth: (selector: (state: { token: string | null }) => unknown) => selector({ token: mocks.token }),
}))

vi.mock('../api/server', () => ({
  runPublicTaskWithAuth: mocks.runPublicTaskWithAuth,
  fetchPublicTaskResultWithAuth: mocks.fetchPublicTaskResultWithAuth,
}))

vi.mock('../config/useModelOptions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/useModelOptions')>()
  return {
    ...actual,
    useModelOptionsState: () => ({
      options: mocks.token ? [{
        value: 'doubao-seedance-2.0',
        label: 'doubao-seedance-2.0',
        modelKey: 'doubao-seedance-2.0',
        meta: {
          videoOptions: {
            defaultDurationSeconds: 8,
            defaultResolution: '720p',
            defaultSize: '9:16',
            durationOptions: [{ value: 8, label: '8 秒' }],
            resolutionOptions: [{ value: '720p', label: '720P' }],
            sizeOptions: [{ value: '9:16', label: '9:16' }],
          },
        },
        pricing: {
          cost: 320,
          enabled: true,
          specCosts: [{ specKey: 'video:720p:8s', cost: 360, enabled: true }],
        },
      }] : [],
      loading: false,
      error: null,
      retry: vi.fn(),
    }),
  }
})

vi.mock('../ui/useGenerationHistory', () => ({
  useGenerationHistory: () => ({
    items: [],
    loading: false,
    loadingMore: false,
    error: '',
    hasMore: false,
    reload: mocks.reloadHistory,
    loadMore: vi.fn(),
  }),
}))

const BASE_PROPS = {
  entryId: 'prompt-video-1',
  title: '东方女性面部表情特写视频提示词',
  initialPrompt: '原始视频提示词',
  sourceModels: [{ slug: 'seedance-2-0', name: 'Seedance 2.0' }],
  onRequestLogin: vi.fn(),
  onCopyPrompt: vi.fn(),
} as const

function renderGenerator(): ReturnType<typeof render> {
  return render(
    <MantineProvider defaultColorScheme="dark" forceColorScheme="dark">
      <PromptVideoGenerator {...BASE_PROPS} />
    </MantineProvider>,
  )
}

afterEach(() => {
  cleanup()
  mocks.token = null
  mocks.runPublicTaskWithAuth.mockReset()
  mocks.fetchPublicTaskResultWithAuth.mockReset()
  mocks.reloadHistory.mockReset()
  BASE_PROPS.onRequestLogin.mockReset()
  BASE_PROPS.onCopyPrompt.mockReset()
})

describe('PromptVideoGenerator', () => {
  it('keeps the prompt editable but opens login before any generation request', () => {
    const view = renderGenerator()

    fireEvent.change(screen.getByRole('textbox', { name: '可编辑提示词' }), { target: { value: '登录前也能修改' } })
    fireEvent.click(screen.getByRole('button', { name: '登录后生成' }))

    expect(view.container.querySelector('select')).toBeNull()
    expect(BASE_PROPS.onRequestLogin).toHaveBeenCalledTimes(1)
    expect(mocks.runPublicTaskWithAuth).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('登录前也能修改')).not.toBeNull()
    expect(screen.getByRole('button', { name: '登录后查看个人生成历史' })).not.toBeNull()
  })

  it('submits the edited prompt with the live catalog contract and renders the temporary result', async () => {
    mocks.token = 'cookie-session'
    mocks.runPublicTaskWithAuth.mockResolvedValue({
      vendor: 'newapi',
      result: {
        id: 'video-task-1',
        kind: 'text_to_video',
        status: 'succeeded',
        assets: [{ type: 'video', url: 'https://assets.example.com/result.mp4', thumbnailUrl: 'https://assets.example.com/poster.jpg' }],
        raw: {},
      },
    })
    const view = renderGenerator()

    const modelInput = view.container.querySelector<HTMLInputElement>('.prompt-generation-panel__control--primary input')
    if (!modelInput) throw new Error('视频模型选择器未渲染')
    await waitFor(() => expect(modelInput.value).toBe('doubao-seedance-2.0'))
    fireEvent.change(screen.getByRole('textbox', { name: '可编辑提示词' }), { target: { value: '修改后的视频提示词' } })
    fireEvent.click(screen.getByRole('button', { name: '生成临时视频 · 360 积分' }))

    await waitFor(() => expect(mocks.runPublicTaskWithAuth).toHaveBeenCalledTimes(1))
    expect(mocks.runPublicTaskWithAuth).toHaveBeenCalledWith({
      request: {
        kind: 'text_to_video',
        prompt: '修改后的视频提示词',
        extras: {
          modelKey: 'doubao-seedance-2.0',
          awaitResult: false,
          persistAssets: true,
          sourcePromptLibraryEntryId: 'prompt-video-1',
          durationSeconds: 8,
          resolution: '720p',
          aspectRatio: '9:16',
          size: '9:16',
          specKey: 'video:720p:8s',
          videoSpecKey: 'video:720p:8s',
        },
      },
    })
    expect(await screen.findByText('视频已生成并写入个人生成历史')).not.toBeNull()
    expect(screen.getByLabelText('东方女性面部表情特写视频提示词 · 临时生成').getAttribute('src')).toBe('https://assets.example.com/result.mp4')
  })
})
