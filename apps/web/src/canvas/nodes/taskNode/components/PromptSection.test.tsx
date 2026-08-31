// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { describe, expect, it, vi } from 'vitest'
import { PromptSection } from './PromptSection'

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

type PromptSectionProps = React.ComponentProps<typeof PromptSection>

function createProps(overrides: Partial<PromptSectionProps> = {}): PromptSectionProps {
  return {
    layout: 'media-focus',
    prompt: '开头',
    setPrompt: vi.fn(),
    onUpdateNodeData: vi.fn(),
    mentionOpen: false,
    mentionItems: [],
    setMentionFilter: vi.fn(),
    setMentionOpen: vi.fn(),
    mentionMetaRef: React.createRef(),
    isDarkUi: true,
    nodeShellText: '#eef0f4',
    ...overrides,
  }
}

function renderPromptSection(props: PromptSectionProps) {
  return render(
    <MantineProvider>
      <PromptSection {...props} />
    </MantineProvider>,
  )
}

function getEditor(container: HTMLElement): HTMLDivElement {
  const editor = container.querySelector<HTMLDivElement>('.task-node-prompt__editor')
  if (!editor) throw new Error('prompt editor was not rendered')
  return editor
}

describe('PromptSection IME editing', () => {
  it('keeps the material-library action visible in the compact media toolbar', () => {
    const onPickFromLibrary = vi.fn()
    const { getByTitle } = renderPromptSection(createProps({
      onPickFromLibrary,
      hideBrainButton: true,
      onOpenPromptSamples: undefined,
    }))

    fireEvent.click(getByTitle('从素材库选择参考图'))
    expect(onPickFromLibrary).toHaveBeenCalledOnce()
  })

  it('keeps browser page translation away from the editable prompt DOM', () => {
    const { container } = renderPromptSection(createProps())
    const editor = getEditor(container)

    expect(editor.getAttribute('translate')).toBe('no')
    expect(editor.classList.contains('notranslate')).toBe(true)
  })

  it('does not expose the removed prompt autocomplete mode or shortcut', () => {
    const { container } = renderPromptSection(createProps())
    const editor = getEditor(container)

    expect(editor.getAttribute('data-placeholder')).toBe('在这里输入提示词...')
    expect(container.querySelector('.task-node-prompt__suggestions')).toBeNull()
  })

  it('restores a persisted asset token as a chip on editor remount', () => {
    const props = createProps({
      prompt: '@image ',
      mentionItems: [{
        username: 'image',
        display_name: '参考图',
        profile_picture_url: 'https://assets.example.com/reference.png',
        source: 'asset',
        assetBinding: {
          url: 'https://assets.example.com/reference.png',
          assetId: 'asset-1',
          assetRefId: 'image',
          assetName: '参考图',
          role: 'reference',
        },
      }],
    })
    const firstView = renderPromptSection(props)
    expect(firstView.container.querySelector('.task-node-prompt__chip')?.getAttribute('data-mention')).toBe('image')
    firstView.unmount()

    const remountedView = renderPromptSection(props)
    expect(remountedView.container.querySelector('.task-node-prompt__chip')?.getAttribute('data-mention')).toBe('image')
    expect(getEditor(remountedView.container).textContent).toContain('@参考图')
  })

  it('upgrades a late asset catalog on refocus without rebuilding an active draft', () => {
    const initialProps = createProps({ prompt: '@image ', mentionItems: [] })
    const view = renderPromptSection(initialProps)
    const editor = getEditor(view.container)
    editor.focus()

    view.rerender(
      <MantineProvider>
        <PromptSection
          {...initialProps}
          mentionItems={[{
            username: 'image',
            display_name: '参考图',
            profile_picture_url: 'https://assets.example.com/reference.png',
            source: 'asset',
          }]}
        />
      </MantineProvider>,
    )
    expect(editor.querySelector('.task-node-prompt__chip')).toBeNull()

    fireEvent.blur(editor)
    fireEvent.focus(editor)
    expect(editor.querySelector('.task-node-prompt__chip')?.getAttribute('data-mention')).toBe('image')
  })

  it('does not turn a composition-confirming Enter into a manual line break', () => {
    const onUpdateNodeData = vi.fn()
    const { container } = renderPromptSection(createProps({ onUpdateNodeData }))
    const editor = getEditor(container)
    editor.focus()

    fireEvent.compositionStart(editor)
    editor.textContent = '开头中文'
    fireEvent.keyDown(editor, {
      key: 'Enter',
      code: 'Enter',
      keyCode: 229,
      isComposing: true,
    })

    expect(editor.querySelector('br')).toBeNull()
    expect(onUpdateNodeData).not.toHaveBeenCalled()

    fireEvent.compositionEnd(editor)
    expect(onUpdateNodeData).toHaveBeenLastCalledWith({ prompt: '开头中文' })
  })

  it('keeps the focused DOM draft when an older external prompt arrives', () => {
    const onUpdateNodeData = vi.fn()
    const initialProps = createProps({
      prompt: '开头已提交',
      onUpdateNodeData,
    })
    const view = renderPromptSection(initialProps)
    const editor = getEditor(view.container)
    editor.focus()
    editor.textContent = '开头已提交刚输入的中文'

    view.rerender(
      <MantineProvider>
        <PromptSection {...initialProps} prompt="服务器旧值" />
      </MantineProvider>,
    )

    expect(editor.textContent).toBe('开头已提交刚输入的中文')
    fireEvent.blur(editor)
    expect(onUpdateNodeData).toHaveBeenLastCalledWith({ prompt: '开头已提交刚输入的中文' })
  })
})
