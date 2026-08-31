// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { resolveBlockView } from './registry'
import { MediaItemView } from './MediaBlockView'
import type { ContentBlock } from './types'

describe('block registry', () => {
  it('未知 type 走 Fallback，不抛错', () => {
    const unknown = { id: 'x', type: 'totally-unknown' } as unknown as ContentBlock
    const View = resolveBlockView(unknown)
    expect(() => render(<View block={unknown} />)).not.toThrow()
  })

  it('未注册 data.name 走 DataFallback 并显示 name', () => {
    const data: ContentBlock = { id: 'd', type: 'data', name: 'no-such-card', payload: { a: 1 } }
    const View = resolveBlockView(data)
    const { container } = render(<View block={data} />)
    expect(container.textContent ?? '').toContain('no-such-card')
  })

  it('media 解析到 MediaBlockView', () => {
    const media: ContentBlock = { id: 'media-1', type: 'media', layout: 'single', items: [{ kind: 'image', url: 'https://x/a.png' }] }
    const View = resolveBlockView(media)
    expect(View).toBeTypeOf('function')
  })

  it('audio media 渲染真实音频播放器', () => {
    const media: ContentBlock = {
      id: 'media-audio-1',
      type: 'media',
      layout: 'single',
      items: [{ kind: 'audio', url: 'https://x/voice.mp3', title: '角色试听' }],
    }
    const { container } = render(createElement(MediaItemView, { item: media.items[0], index: 0 }))
    const player = container.querySelector('audio.tc-ai-chat-bubble__audio-player')
    expect(player).not.toBeNull()
    expect(player?.getAttribute('src')).toBe('https://x/voice.mp3')
    expect(container.textContent).toContain('角色试听')
  })

  it('role_note 渲染角色名/类别徽标/点评，未知 role 不抛错', () => {
    const block: ContentBlock = {
      id: 'rn-1',
      type: 'data',
      name: 'role_note',
      payload: {
        role: 'director-review',
        roleName: '导演质检',
        label: 'review',
        markdown: '当前画布 18 个节点，连接数 13。现在只能确认已提交队列。',
      },
    }
    const View = resolveBlockView(block)
    const { container } = render(<View block={block} />)
    const text = container.textContent ?? ''
    expect(text).toContain('导演质检')
    expect(text).toContain('REVIEW') // label 大写化
    expect(text).toContain('只能确认已提交队列')
    // 未知 role 回落小T，不抛错
    const unknownRole: ContentBlock = { ...block, id: 'rn-2', payload: { ...(block as any).payload, role: 'no-such-role' } }
    expect(() => render(<View block={unknownRole} />)).not.toThrow()
  })

  it('role_note 缺 markdown 不渲染（返回 null）', () => {
    const block: ContentBlock = { id: 'rn-3', type: 'data', name: 'role_note', payload: { roleName: '美术指导' } }
    const View = resolveBlockView(block)
    const { container } = render(<View block={block} />)
    expect((container.textContent ?? '').trim()).toBe('')
  })

  it('source_contract 分开展示来源范围、事实、推断与待确认项', () => {
    const block: ContentBlock = {
      id: 'source-1',
      type: 'data',
      name: 'source_contract',
      payload: {
        source: '第1章正文',
        scope: '仅当前章节',
        mode: '忠实改编',
        confirmed: ['原文已提供'],
        assumptions: ['网页导航不是正文'],
        unresolved: ['目标时长待确认'],
      },
    }
    const View = resolveBlockView(block)
    const { container } = render(<View block={block} />)
    const text = container.textContent ?? ''
    expect(text).toContain('第1章正文')
    expect(text).toContain('仅当前章节')
    expect(text).toContain('忠实改编')
    expect(text).toContain('原文已提供')
    expect(text).toContain('网页导航不是正文')
    expect(text).toContain('目标时长待确认')
  })

  it('generation_task 展示提案状态、规格、提示词与真实失败原因', () => {
    const block: ContentBlock = {
      id: 'generation-1',
      type: 'data',
      name: 'generation_task',
      payload: {
        title: '15秒视频提示词',
        kind: 'video',
        status: 'failed',
        model: 'Seedance 2.0',
        parameters: [{ label: '时长', value: '15s' }],
        prompt: '大师姐在白玉广场拦住师弟。',
        taskId: 'task-real-1',
        failureReason: '上游明确返回生成失败',
      },
    }
    const View = resolveBlockView(block)
    const { container } = render(<View block={block} />)
    const text = container.textContent ?? ''
    expect(text).toContain('15秒视频提示词')
    expect(text).toContain('失败')
    expect(text).toContain('Seedance 2.0')
    expect(text).toContain('15s')
    expect(text).toContain('task-real-1')
    expect(text).toContain('上游明确返回生成失败')
  })
})
