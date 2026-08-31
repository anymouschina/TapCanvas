// @vitest-environment jsdom

import React from 'react'
import { MantineProvider } from '@mantine/core'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listPromptLibrary, type PromptLibraryCard as PromptLibraryCardDto, type PromptLibraryPageResult } from '../api/promptLibrary'
import PromptLibraryPage from './PromptLibraryPage'
import { installMantineDomMocks } from './testMantineDomMocks'

installMantineDomMocks()

vi.mock('../api/promptLibrary', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('../api/promptLibrary')>()
  return { ...original, listPromptLibrary: vi.fn() }
})

vi.mock('./PortalHeader', () => ({ PortalHeader: () => <header className="test-portal-header" /> }))
vi.mock('./PortalFooter', () => ({ PortalFooter: () => <footer className="test-portal-footer" /> }))
vi.mock('../ui/toast', () => ({ ToastHost: () => null }))
vi.mock('../ui/StatePanel', () => ({ StatePanel: ({ title }: { title: string }) => <p className="test-state-panel">{title}</p> }))
vi.mock('./PromptLibraryCard', () => ({ PromptLibraryCard: ({ entry }: { entry: PromptLibraryCardDto }) => <article className="test-prompt-card">{entry.title}</article> }))

const createEntry = (id: string): PromptLibraryCardDto => ({
  id,
  title: `提示词 ${id}`,
  description: null,
  promptText: `正文 ${id}`,
  mediaType: 'image',
  authorLabel: '搜集自网络',
  publishedAt: null,
  models: [{ slug: 'gpt-image-2', name: 'GPT Image 2' }],
  media: [{ id: `media-${id}`, kind: 'image', url: `https://example.com/${id}.jpg`, thumbnailUrl: null, width: 900, height: 900, order: 0 }],
})

const facets = {
  media: [{ kind: 'image' as const, count: 3 }],
  models: [{ slug: 'gpt-image-2', name: 'GPT Image 2', count: 3 }],
  allMediaCount: 3,
  allModelCount: 3,
}

describe('PromptLibraryPage pagination', () => {
  let intersectionCallback: IntersectionObserverCallback | null = null
  const scrollTo = vi.fn()

  beforeEach(() => {
    intersectionCallback = null
    class TestIntersectionObserver implements IntersectionObserver {
      readonly root = null
      readonly rootMargin = ''
      readonly thresholds = [0]

      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback
      }

      disconnect(): void {}
      observe(): void {}
      takeRecords(): IntersectionObserverEntry[] { return [] }
      unobserve(): void {}
    }
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('loads the next page when the bottom sentinel intersects', async () => {
    vi.mocked(listPromptLibrary)
      .mockResolvedValueOnce({ items: [createEntry('1'), createEntry('2')], total: 3, page: 1, pageSize: 24, facets })
      .mockResolvedValueOnce({ items: [createEntry('3')], total: 3, page: 2, pageSize: 24, facets })

    render(
      <MantineProvider defaultColorScheme="dark" forceColorScheme="dark">
        <PromptLibraryPage />
      </MantineProvider>,
    )

    await screen.findByText('提示词 1')
    const firstCardColumn = screen.getByText('提示词 1').parentElement
    fireEvent.click(screen.getByRole('button', { name: '返回页面顶部' }))
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(screen.queryByRole('tab', { name: /视频/ })).toBeNull()
    fireEvent.click(screen.getByRole('textbox', { name: '模型筛选' }))
    expect(screen.getByRole('option', { name: /GPT Image 2.*3 条/ })).not.toBeNull()
    await waitFor(() => expect(intersectionCallback).not.toBeNull())
    await act(async () => {
      intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    })

    await screen.findByText('提示词 3')
    expect(screen.getByText('提示词 1').parentElement).toBe(firstCardColumn)
    expect(listPromptLibrary).toHaveBeenCalledTimes(2)
    expect(screen.getByText('已加载全部 3 条')).not.toBeNull()
  })

  it('keeps the current cards visible while a mid-page filter request is pending', async () => {
    let resolveFiltered: ((result: PromptLibraryPageResult) => void) | undefined
    const filteredResult = new Promise<PromptLibraryPageResult>((resolve) => {
      resolveFiltered = resolve
    })
    vi.mocked(listPromptLibrary)
      .mockResolvedValueOnce({ items: [createEntry('1'), createEntry('2')], total: 2, page: 1, pageSize: 24, facets })
      .mockReturnValueOnce(filteredResult)

    const { container } = render(
      <MantineProvider defaultColorScheme="dark" forceColorScheme="dark">
        <PromptLibraryPage />
      </MantineProvider>,
    )

    await screen.findByText('提示词 1')
    fireEvent.change(screen.getByRole('textbox', { name: '搜索提示词' }), { target: { value: '人物' } })
    await waitFor(() => expect(listPromptLibrary).toHaveBeenCalledTimes(2), { timeout: 1000 })

    expect(screen.getByText('提示词 1')).not.toBeNull()
    expect(container.querySelector('.prompt-library-page__grid.is-filtering')).not.toBeNull()
    expect(screen.getByText('正在筛选…')).not.toBeNull()

    await act(async () => {
      resolveFiltered?.({ items: [createEntry('3')], total: 1, page: 1, pageSize: 24, facets })
      await filteredResult
    })

    await screen.findByText('提示词 3')
    expect(screen.queryByText('提示词 1')).toBeNull()
    expect(container.querySelector('.prompt-library-page__grid.is-filtering')).toBeNull()
  })

  it('requests a full server-side reload when the sort mode changes', async () => {
    vi.mocked(listPromptLibrary).mockResolvedValue({
      items: [createEntry('1')],
      total: 1,
      page: 1,
      pageSize: 24,
      facets,
    })

    render(
      <MantineProvider defaultColorScheme="dark" forceColorScheme="dark">
        <PromptLibraryPage />
      </MantineProvider>,
    )

    await screen.findByText('提示词 1')
    expect(listPromptLibrary).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'likes_desc', page: 1 }))

    fireEvent.click(screen.getByRole('textbox', { name: '排序方式' }))
    fireEvent.click(screen.getByRole('option', { name: '名称首字母' }))

    await waitFor(() => expect(listPromptLibrary).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'name_asc', page: 1 })))
  })
})
