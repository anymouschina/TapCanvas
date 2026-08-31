// @vitest-environment jsdom

import React from 'react'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PromptImageGenerator } from './PromptImageGenerator'
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
        value: 'doubao-seedream-4.5',
        label: 'doubao-seedream-4.5',
        modelKey: 'doubao-seedream-4.5',
        meta: {
          imageOptions: {
            defaultAspectRatio: '16:9',
            defaultImageSize: '2K',
            aspectRatioOptions: [{ value: '16:9', label: '16:9' }],
            imageSizeOptions: [{ value: '2K', label: '2K' }],
            controls: [
              { key: 'aspect-ratio', label: '画面比例', binding: 'aspectRatio', optionSource: 'aspectRatioOptions' },
              { key: 'image-size', label: '图片尺寸', binding: 'imageSize', optionSource: 'imageSizeOptions' },
            ],
            supportsTextToImage: true,
          },
        },
        pricing: {
          cost: 80,
          enabled: true,
          specCosts: [{ specKey: 'image:2k', cost: 120, enabled: true }],
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

vi.mock('../domain/resource-runtime/components/ManagedImage', () => ({
  ManagedImage: (props: Readonly<{ className: string; src: string; alt: string }>) => (
    <span className={props.className} data-managed-image-src={props.src} aria-label={props.alt} />
  ),
}))

const BASE_PROPS = {
  entryId: 'prompt-image-1',
  title: '电影感人物肖像图片提示词',
  initialPrompt: '原始图片提示词',
  sourceModels: [{ slug: 'seedream-4-5', name: 'Seedream 4.5' }],
  onRequestLogin: vi.fn(),
  onCopyPrompt: vi.fn(),
} as const

function renderGenerator(): ReturnType<typeof render> {
  return render(
    <MantineProvider defaultColorScheme="dark" forceColorScheme="dark">
      <PromptImageGenerator {...BASE_PROPS} />
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

describe('PromptImageGenerator', () => {
  it('keeps the prompt editable but opens login before any image generation request', () => {
    const view = renderGenerator()

    fireEvent.change(screen.getByRole('textbox', { name: '可编辑提示词' }), { target: { value: '登录前也能修改图片提示词' } })
    fireEvent.click(screen.getByRole('button', { name: '登录后生成' }))

    expect(view.container.querySelector('select')).toBeNull()
    expect(BASE_PROPS.onRequestLogin).toHaveBeenCalledTimes(1)
    expect(mocks.runPublicTaskWithAuth).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('登录前也能修改图片提示词')).not.toBeNull()
    expect(screen.getByRole('button', { name: '登录后查看个人生成历史' })).not.toBeNull()
  })

  it('matches the source image model and submits the edited prompt with the live catalog contract', async () => {
    mocks.token = 'cookie-session'
    mocks.runPublicTaskWithAuth.mockResolvedValue({
      vendor: 'newapi',
      result: {
        id: 'image-task-1',
        kind: 'text_to_image',
        status: 'succeeded',
        assets: [
          { type: 'image', url: 'https://assets.example.com/result-1.png' },
          { type: 'image', url: 'https://assets.example.com/result-2.png' },
        ],
        raw: {},
      },
    })
    const view = renderGenerator()

    const modelInput = view.container.querySelector<HTMLInputElement>('.prompt-generation-panel__control--primary input')
    if (!modelInput) throw new Error('图片模型选择器未渲染')
    await waitFor(() => expect(modelInput.value).toBe('doubao-seedream-4.5'))
    fireEvent.change(screen.getByRole('textbox', { name: '可编辑提示词' }), { target: { value: '修改后的图片提示词' } })
    fireEvent.click(screen.getByRole('button', { name: '生成临时图片 · 120 积分' }))

    await waitFor(() => expect(mocks.runPublicTaskWithAuth).toHaveBeenCalledTimes(1))
    expect(mocks.runPublicTaskWithAuth).toHaveBeenCalledWith({
      request: {
        kind: 'text_to_image',
        prompt: '修改后的图片提示词',
        extras: {
          modelKey: 'doubao-seedream-4.5',
          awaitResult: false,
          persistAssets: true,
          sourcePromptLibraryEntryId: 'prompt-image-1',
          aspectRatio: '16:9',
          imageSize: '2K',
          specKey: 'image:2k',
          billingSpecKey: 'image:2k',
        },
      },
    })
    expect(await screen.findByText('图片已生成并写入个人生成历史')).not.toBeNull()
    const firstImage = screen.getByLabelText('电影感人物肖像图片提示词 · 临时生成 1')
    const secondImage = screen.getByLabelText('电影感人物肖像图片提示词 · 临时生成 2')
    expect(firstImage.getAttribute('data-managed-image-src')).toBe('https://assets.example.com/result-1.png')
    expect(secondImage.getAttribute('data-managed-image-src')).toBe('https://assets.example.com/result-2.png')
  })

  it('reports an unavailable source model instead of silently selecting a replacement', async () => {
    mocks.token = 'cookie-session'
    const view = render(
      <MantineProvider defaultColorScheme="dark" forceColorScheme="dark">
        <PromptImageGenerator
          {...BASE_PROPS}
          sourceModels={[{ slug: 'seedream-4-0', name: 'Seedream 4.0' }]}
        />
      </MantineProvider>,
    )

    const modelInput = view.container.querySelector<HTMLInputElement>('.prompt-generation-panel__control--primary input')
    if (!modelInput) throw new Error('图片模型选择器未渲染')
    await waitFor(() => expect(screen.getByText(/Seedream 4\.0.*不在可用目录中/)).not.toBeNull())
    expect(modelInput.value).toBe('')
    expect(screen.getByText(/系统不会自动降级/)).not.toBeNull()
  })
})
