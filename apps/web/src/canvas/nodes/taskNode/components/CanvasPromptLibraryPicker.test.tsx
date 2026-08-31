// @vitest-environment jsdom

import React from 'react'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listPromptLibrary } from '../../../../api/promptLibrary'
import { CanvasPromptLibraryPicker } from './CanvasPromptLibraryPicker'

vi.mock('../../../../api/promptLibrary', () => ({
  listPromptLibrary: vi.fn(),
}))

vi.mock('../../../../domain/resource-runtime/components/ManagedImage', () => ({
  ManagedImage: ({ className, src, alt }: Readonly<{ className: string; src: string; alt: string }>) => (
    <img className={className} src={src} alt={alt} />
  ),
}))

describe('CanvasPromptLibraryPicker', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('previews matching media and returns the customized prompt after confirmation', async () => {
    vi.mocked(listPromptLibrary).mockResolvedValue({
      items: [{
        id: 'prompt-image-1',
        title: '电影追逐镜头',
        description: null,
        promptText: '低机位跟拍，角色穿过雨夜街道。',
        mediaType: 'image',
        authorLabel: '搜集自网络',
        publishedAt: null,
        models: [{ slug: 'gpt-image-2', name: 'GPT Image 2' }],
        media: [{
          id: 'preview-image-1',
          kind: 'image',
          url: 'https://assets.example.com/chase.jpg',
          thumbnailUrl: null,
          width: 1280,
          height: 720,
          order: 0,
        }],
      }],
      total: 1,
      page: 1,
      pageSize: 30,
      facets: { media: [], models: [], allMediaCount: 1, allModelCount: 1 },
    })
    const onSelect = vi.fn()

    render(
      <MantineProvider>
        <CanvasPromptLibraryPicker mediaType="image" onSelect={onSelect} />
      </MantineProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '从图片提示词库填入' }))
    await waitFor(() => expect(listPromptLibrary).toHaveBeenCalledWith(expect.objectContaining({ mediaType: 'image' })))
    expect((await screen.findByRole('img', { name: '电影追逐镜头' })).getAttribute('src')).toBe('https://assets.example.com/chase.jpg')
    const promptCard = screen.getByRole('button', { name: '选择 电影追逐镜头' })
    const scrollViewport = screen.getByTestId('canvas-prompt-library-scroll-viewport')
    scrollViewport.scrollTop = 480
    expect(promptCard.classList.contains('prompt-library-card')).toBe(true)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)

    fireEvent.click(promptCard)

    expect(await screen.findByRole('dialog', { name: '预览并编辑图片提示词' })).not.toBeNull()
    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(2)
    expect(promptCard.classList.contains('is-selected')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '继续浏览' }))
    expect(scrollViewport.scrollTop).toBe(480)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)

    fireEvent.click(promptCard)
    fireEvent.change(screen.getByRole('textbox', { name: '自定义提示词' }), {
      target: { value: '低机位跟拍，角色穿过雨夜街道，增加车灯反射。' },
    })
    fireEvent.click(screen.getByRole('button', { name: '填入当前节点' }))

    expect(onSelect).toHaveBeenCalledWith('低机位跟拍，角色穿过雨夜街道，增加车灯反射。')
    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0))
  })

  it('loads the next page from the explicit action when the list cannot be scrolled', async () => {
    const firstPageItem = {
      id: 'prompt-image-1',
      title: '第一页提示词',
      description: null,
      promptText: '第一页提示词正文',
      mediaType: 'image' as const,
      authorLabel: '搜集自网络',
      publishedAt: null,
      models: [],
      media: [{ id: 'media-1', kind: 'image' as const, url: 'https://assets.example.com/1.jpg', thumbnailUrl: null, width: 1280, height: 720, order: 0 }],
    }
    const secondPageItem = { ...firstPageItem, id: 'prompt-image-2', title: '第二页提示词', media: [{ ...firstPageItem.media[0], id: 'media-2', url: 'https://assets.example.com/2.jpg' }] }
    vi.mocked(listPromptLibrary)
      .mockResolvedValueOnce({ items: [firstPageItem], total: 31, page: 1, pageSize: 30, facets: { media: [], models: [], allMediaCount: 31, allModelCount: 0 } })
      .mockResolvedValueOnce({ items: [secondPageItem], total: 31, page: 2, pageSize: 30, facets: { media: [], models: [], allMediaCount: 31, allModelCount: 0 } })

    render(<MantineProvider><CanvasPromptLibraryPicker mediaType="image" onSelect={vi.fn()} /></MantineProvider>)
    fireEvent.click(screen.getByRole('button', { name: '从图片提示词库填入' }))
    await screen.findByRole('button', { name: '选择 第一页提示词' })

    fireEvent.click(screen.getByRole('button', { name: '加载更多提示词' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '选择 第二页提示词' })).not.toBeNull())
    expect(listPromptLibrary).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 30, mediaType: 'image' }))
  })

  it('edits and persists the current node prompt from the custom tab', async () => {
    vi.mocked(listPromptLibrary).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 30,
      facets: { media: [], models: [], allMediaCount: 0, allModelCount: 0 },
    })
    let currentPrompt = '原始节点提示词'
    const onPromptChange = vi.fn((nextPrompt: string) => { currentPrompt = nextPrompt })
    const onSelect = vi.fn((nextPrompt: string) => { currentPrompt = nextPrompt })
    const view = render(
      <MantineProvider>
        <CanvasPromptLibraryPicker mediaType="image" currentPrompt={currentPrompt} onPromptChange={onPromptChange} onSelect={onSelect} />
      </MantineProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '从图片提示词库填入' }))
    await waitFor(() => expect(listPromptLibrary).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('tab', { name: '自定义提示词' }))
    const editor = screen.getByRole('textbox', { name: '自定义提示词' })
    expect(editor).toHaveValue('原始节点提示词')

    fireEvent.change(editor, { target: { value: '保存到当前节点的自定义提示词' } })
    expect(onPromptChange).toHaveBeenLastCalledWith('保存到当前节点的自定义提示词')
    fireEvent.click(screen.getByRole('button', { name: '保存并填入节点' }))
    expect(onSelect).toHaveBeenCalledWith('保存到当前节点的自定义提示词')

    view.rerender(
      <MantineProvider>
        <CanvasPromptLibraryPicker mediaType="image" currentPrompt={currentPrompt} onPromptChange={onPromptChange} onSelect={onSelect} />
      </MantineProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '从图片提示词库填入' }))
    fireEvent.click(await screen.findByRole('tab', { name: '自定义提示词' }))
    expect(screen.getByRole('textbox', { name: '自定义提示词' })).toHaveValue('保存到当前节点的自定义提示词')
  })
})
