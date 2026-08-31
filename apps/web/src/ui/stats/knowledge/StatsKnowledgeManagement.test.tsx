// @vitest-environment jsdom
import React from 'react'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AdminKnowledgeListResponseDto } from '../../../api/server'
import StatsKnowledgeManagement from './StatsKnowledgeManagement'

const apiMocks = vi.hoisted(() => ({
  listAdminKnowledge: vi.fn(),
  syncAdminKnowledge: vi.fn(),
  upsertAdminKnowledge: vi.fn(),
}))

vi.mock('../../../api/server', () => apiMocks)
vi.mock('../../toast', () => ({ toast: vi.fn() }))

const RESPONSE: AdminKnowledgeListResponseDto = {
  embeddingModel: 'doubao-embedding-vision-251215',
  cards: [{
    id: 'market-video-prompt-1',
    domain: 'market-validated-prompt-example',
    facet: '视频 / seedance',
    title: '高速追逐视频提示词',
    roleScope: ['director', 'storyboard', 'generation'],
    keywords: ['视频提示词', '追逐'],
    sourceUrls: ['https://example.com/source'],
    body: 'originalPrompt:\n高速追逐镜头。',
    path: 'prompt-library://video/1',
    sourceRoot: 'tapcanvas:prompt-library:market-validated:video',
    sourceKind: 'admin',
    contentSha256: 'a'.repeat(64),
    embeddingModel: 'doubao-embedding-vision-251215',
    updatedAt: '2026-08-26T00:00:00.000Z',
    collectionId: 'prompt-video',
    collectionLabel: '视频提示词',
    editable: false,
  }],
  pagination: {
    page: 1,
    pageSize: 24,
    total: 1_004,
    totalPages: 42,
  },
  filters: {
    collections: [
      { id: 'builtin', label: '内置知识', sourceRoot: 'builtin:agents-cli/knowledge', editable: true, count: 289 },
      {
        id: 'prompt-image',
        label: '图片提示词',
        sourceRoot: 'tapcanvas:prompt-library:market-validated:image',
        editable: false,
        count: 979,
      },
      {
        id: 'prompt-video',
        label: '视频提示词',
        sourceRoot: 'tapcanvas:prompt-library:market-validated:video',
        editable: false,
        count: 1_004,
      },
    ],
    domains: ['market-validated-prompt-example'],
    facets: ['视频 / seedance'],
    roles: ['director', 'storyboard', 'generation', 'editor', 'post', 'qa'],
  },
}

function renderManagement(): void {
  render(
    <MantineProvider defaultColorScheme="dark" forceColorScheme="dark">
      <StatsKnowledgeManagement />
    </MantineProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('StatsKnowledgeManagement', () => {
  it('shows all registered collections and server pagination facts', async () => {
    apiMocks.listAdminKnowledge.mockResolvedValue(RESPONSE)

    renderManagement()

    expect(await screen.findByText(/共 2,272 张已索引卡/u)).toBeInTheDocument()
    expect(screen.getByText('视频提示词')).toBeInTheDocument()
    expect(screen.getByText(/共 1,004 条 · 第 1 \/ 42 页/u)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看 高速追逐视频提示词' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑 高速追逐视频提示词' })).toBeNull()
  })

  it('sends search and page changes to the paged API', async () => {
    apiMocks.listAdminKnowledge.mockResolvedValue(RESPONSE)
    renderManagement()
    await screen.findByText('高速追逐视频提示词')

    fireEvent.change(screen.getByRole('textbox', { name: '搜索知识卡' }), {
      target: { value: '追逐' },
    })
    await waitFor(() => expect(apiMocks.listAdminKnowledge).toHaveBeenCalledWith(expect.objectContaining({
      query: '追逐',
      page: 1,
    })))

    fireEvent.click(screen.getByRole('button', { name: '2' }))
    await waitFor(() => expect(apiMocks.listAdminKnowledge).toHaveBeenCalledWith(expect.objectContaining({
      query: '追逐',
      page: 2,
    })))
  })
})
