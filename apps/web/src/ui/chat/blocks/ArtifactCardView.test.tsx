// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtifactCardView } from './DataCardViews'
import type { DataBlock } from './types'

const toastMock = vi.hoisted(() => vi.fn())

vi.mock('../../toast', () => ({ toast: toastMock }))

const block: DataBlock = {
  id: 'artifact-yangchun-noodle',
  type: 'data',
  name: 'artifact',
  payload: {
    title: '30秒阳春面宣传视频制作方案',
    markdown: '# 阳春面宣传片\n\n汤清、面滑、葱香。',
  },
}

describe('ArtifactCardView', () => {
  beforeEach(() => {
    toastMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('uses separate native buttons and copies the full document with visible success feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const { container } = render(<ArtifactCardView block={block} />)
    const copyButton = screen.getByRole('button', { name: '复制文档' })

    expect(copyButton.closest('button')?.parentElement?.tagName).not.toBe('BUTTON')
    expect(container.querySelector('button button')).toBeNull()

    fireEvent.click(copyButton)

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('# 阳春面宣传片\n\n汤清、面滑、葱香。'))
    expect(await screen.findByRole('button', { name: '文档已复制' })).toBeTruthy()
    expect(toastMock).toHaveBeenCalledWith('文档已复制', 'success')
  })

  it('shows an explicit error when clipboard writing fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('剪贴板权限被拒绝'))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<ArtifactCardView block={block} />)
    fireEvent.click(screen.getByRole('button', { name: '复制文档' }))

    expect(await screen.findByRole('button', { name: '重新复制文档' })).toBeTruthy()
    expect(toastMock).toHaveBeenCalledWith('剪贴板权限被拒绝', 'error')
  })

  it('decodes escaped line breaks in generated prompt artifacts for display and copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const escapedBlock: DataBlock = {
      id: 'artifact-video-prompt-escaped',
      type: 'data',
      name: 'artifact',
      payload: {
        title: '15秒仙侠打斗视频提示词',
        markdown: '0—3秒：建立战场。\\n\\n3—7秒：连续攻防。\\n\\n无对白、无字幕。',
      },
    }

    render(<ArtifactCardView block={escapedBlock} />)
    fireEvent.click(screen.getAllByRole('button', { name: '展开文档' })[1]!)

    expect(screen.getByText(/0—3秒：建立战场。/)).toBeTruthy()
    expect(screen.getByText(/3—7秒：连续攻防。/)).toBeTruthy()
    expect(screen.queryByText(/\\n/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '复制文档' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('0—3秒：建立战场。\n\n3—7秒：连续攻防。\n\n无对白、无字幕。'))
  })

  it('shows only content for typed artifacts instead of exposing the JSON envelope', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const typedBlock: DataBlock = {
      id: 'artifact-video-prompt-content',
      type: 'data',
      name: 'artifact',
      payload: {
        title: '15秒仙侠打斗视频提示词',
        artifactType: 'tapcanvas.video-prompt/v1',
        kind: 'video_prompt',
        content: '黄昏悬空古战场，白衣剑修与黑金强者展开决战。',
      },
    }

    render(<ArtifactCardView block={typedBlock} />)
    fireEvent.click(screen.getAllByRole('button', { name: '展开文档' })[1]!)

    expect(screen.getByText('黄昏悬空古战场，白衣剑修与黑金强者展开决战。')).toBeTruthy()
    expect(screen.queryByText(/tapcanvas\.video-prompt/)).toBeNull()
    expect(screen.queryByText(/video_prompt/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '复制文档' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('黄昏悬空古战场，白衣剑修与黑金强者展开决战。'))
  })

  it('fails explicitly when the browser leaves clipboard writing pending', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockReturnValue(new Promise<void>(() => undefined))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<ArtifactCardView block={block} />)
    fireEvent.click(screen.getByRole('button', { name: '复制文档' }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
    })

    expect(screen.getByRole('button', { name: '重新复制文档' })).toBeTruthy()
    expect(toastMock).toHaveBeenCalledWith('剪贴板响应超时，请保持页面在前台后重试', 'error')
  })

  it('keeps structured artifact fields visible and copies the complete fallback document', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const structuredBlock: DataBlock = {
      id: 'artifact-structured',
      type: 'data',
      name: 'artifact',
      payload: {
        title: '30秒分镜',
        kind: '30秒打斗剧情分镜文本',
        shots: [{ time: '00:00-00:02', action: '冲刺' }],
        ending: '黑屏',
      },
    }

    render(<ArtifactCardView block={structuredBlock} />)
    fireEvent.click(screen.getAllByRole('button', { name: '展开文档' })[0]!)

    expect(screen.getByText(/30秒打斗剧情分镜文本/)).toBeTruthy()
    expect(screen.getByText(/00:00-00:02/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '复制文档' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"ending": "黑屏"')))
  })
})
