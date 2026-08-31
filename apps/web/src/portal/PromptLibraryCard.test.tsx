// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PromptLibraryCard } from './PromptLibraryCard'

vi.mock('../domain/resource-runtime/components/ManagedImage', () => ({
  ManagedImage: ({ className, alt }: { className: string; alt: string }) => <div className={className} aria-label={alt} />,
}))

vi.mock('../ui/toast', () => ({ toast: vi.fn() }))

describe('PromptLibraryCard', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('uses the fixed collection author, preserves multiple outputs and opens detail in a new tab', () => {
    const { container } = render(<PromptLibraryCard entry={{
      id: 'prompt-1',
      title: '多图提示词',
      description: null,
      promptText: '提示词正文',
      mediaType: 'image',
      authorLabel: '搜集自网络',
      publishedAt: null,
      models: [{ slug: 'gpt-image-2', name: 'GPT Image 2' }],
      media: [
        { id: 'm1', kind: 'image', url: 'https://example.com/1.jpg', thumbnailUrl: null, width: 900, height: 1125, order: 0 },
        { id: 'm2', kind: 'image', url: 'https://example.com/2.jpg', thumbnailUrl: null, width: 900, height: 1125, order: 1 },
      ],
    }} />)

    expect(screen.getByText('搜集自网络')).not.toBeNull()
    const nativeLinks = screen.getAllByRole('link').filter((link) => link instanceof HTMLAnchorElement)
    expect(nativeLinks.every((link) => link.getAttribute('target') === '_blank')).toBe(true)
    expect(screen.getByRole('button', { name: '查看第 2 个输出' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '复制预览链接' })).not.toBeNull()
    expect(container.querySelector<HTMLElement>('.prompt-library-card__media')?.style.aspectRatio).toBe('900 / 1125')
    expect(container.querySelector('.prompt-library-card__media-skeleton')).not.toBeNull()
  })

  it('copies the detail link and routes non-icon card clicks without triggering navigation from icon actions', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const nativeShare = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare })
    const openDetail = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    render(<PromptLibraryCard entry={{
      id: 'prompt-1',
      title: '多图提示词',
      description: null,
      promptText: '提示词正文',
      mediaType: 'image',
      authorLabel: '搜集自网络',
      publishedAt: null,
      models: [{ slug: 'gpt-image-2', name: 'GPT Image 2' }],
      media: [
        { id: 'm1', kind: 'image', url: 'https://example.com/1.jpg', thumbnailUrl: null, width: 900, height: 1125, order: 0 },
        { id: 'm2', kind: 'image', url: 'https://example.com/2.jpg', thumbnailUrl: null, width: 900, height: 1125, order: 1 },
      ],
    }} />)

    fireEvent.click(screen.getByRole('button', { name: '复制预览链接' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(new URL('/prompts/prompt-1', window.location.origin).toString()))
    expect(nativeShare).not.toHaveBeenCalled()
    expect(openDetail).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('提示词正文'))
    expect(openDetail).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '查看第 2 个输出' }))
    expect(openDetail).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '复制提示词' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('提示词正文'))
    expect(openDetail).toHaveBeenCalledTimes(1)
  })

  it('mounts the real video behind its managed poster and starts playback on hover', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    const { container } = render(<PromptLibraryCard entry={{
      id: 'prompt-video',
      title: '视频提示词',
      description: null,
      promptText: '视频正文',
      mediaType: 'video',
      authorLabel: '搜集自网络',
      publishedAt: null,
      models: [{ slug: 'seedance-2-5', name: 'Seedance 2.5' }],
      media: [{ id: 'video-1', kind: 'video', url: 'https://files.example.com/video.mp4', thumbnailUrl: 'https://files.example.com/poster.jpg', width: 1080, height: 1920, order: 0 }],
    }} />)

    const preview = container.querySelector<HTMLElement>('.prompt-video-preview')
    expect(preview).not.toBeNull()
    expect(container.querySelector('video')?.getAttribute('src')).toBe('https://files.example.com/video.mp4')
    fireEvent.mouseEnter(preview as HTMLElement)
    expect(play).toHaveBeenCalledTimes(1)
    fireEvent.mouseLeave(preview as HTMLElement)
    expect(pause).toHaveBeenCalledTimes(1)
  })

  it('creates a project from the plus action without opening the detail page', () => {
    const onCreateProject = vi.fn()
    const openDetail = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const entry = {
      id: 'prompt-create',
      title: '添加到画布',
      description: null,
      promptText: '画布提示词',
      mediaType: 'image' as const,
      authorLabel: '搜集自网络',
      publishedAt: null,
      models: [{ slug: 'gpt-image-2', name: 'GPT Image 2' }],
      media: [{ id: 'image-1', kind: 'image' as const, url: 'https://example.com/image.jpg', thumbnailUrl: null, width: 1200, height: 800, order: 0 }],
    }

    render(<PromptLibraryCard entry={entry} onCreateProject={onCreateProject} />)
    fireEvent.click(screen.getByRole('button', { name: '新建项目并添加到画布' }))

    expect(onCreateProject).toHaveBeenCalledWith(entry)
    expect(openDetail).not.toHaveBeenCalled()
  })
})
