import React from 'react'
import { MantineProvider } from '@mantine/core'
import { act, fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TextContent } from './TextContent'
import { createLazyTaskNodeComponent } from './createLazyTaskNodeComponent'

function editorProps(editorRef: React.RefObject<HTMLDivElement>) {
  return {
    html: '<h2>第2章学校</h2><p>教室内的正文</p>',
    selected: true,
    textEditorFocused: false,
    textBackgroundTint: 'transparent',
    textColor: '#fff',
    textFontSize: 16,
    textFontWeight: 400,
    editorRef,
    onFocus: vi.fn(),
    onInput: vi.fn(),
    onCompositionStart: vi.fn(),
    onCompositionEnd: vi.fn(),
    onBlur: vi.fn(),
  }
}

describe('TextContent', () => {
  it('fills the first editor mounted after a delayed feature load without refocusing', async () => {
    const editorRef = React.createRef<HTMLDivElement>()
    const props = editorProps(editorRef)
    let finishLoading: ((module: { default: typeof TextContent }) => void) | undefined
    const LazyEditor = createLazyTaskNodeComponent(() => new Promise<{ default: typeof TextContent }>((resolve) => {
      finishLoading = resolve
    }))
    render(<MantineProvider><LazyEditor {...props} /></MantineProvider>)
    expect(editorRef.current).toBeNull()

    await act(async () => {
      if (!finishLoading) throw new Error('Editor load was not requested')
      finishLoading({ default: TextContent })
    })

    expect(editorRef.current?.innerHTML).toBe(props.html)
    expect(props.onFocus).not.toHaveBeenCalled()
    expect(props.onInput).not.toHaveBeenCalled()
    expect(props.onBlur).not.toHaveBeenCalled()
  })

  it('preserves active edits and selection, then syncs external content after blur', () => {
    const editorRef = React.createRef<HTMLDivElement>()
    const props = editorProps(editorRef)
    const view = render(<MantineProvider><TextContent {...props} /></MantineProvider>)
    const editor = editorRef.current
    if (!editor) throw new Error('Editor was not mounted')
    act(() => editor.focus())
    editor.innerHTML = '<p>正在输入的新正文</p>'
    const text = editor.firstChild?.firstChild
    if (!text) throw new Error('Text was not rendered')
    const selection = window.getSelection()
    const range = document.createRange()
    range.setStart(text, 3)
    range.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(range)
    fireEvent.input(editor)

    const externalHtml = '<p>外部更新</p>'
    view.rerender(<MantineProvider><TextContent {...props} html={externalHtml} textEditorFocused /></MantineProvider>)
    expect(editor.innerHTML).toBe('<p>正在输入的新正文</p>')
    expect(selection?.anchorNode).toBe(text)
    expect(selection?.anchorOffset).toBe(3)

    act(() => editor.blur())
    view.rerender(<MantineProvider><TextContent {...props} html={externalHtml} /></MantineProvider>)
    expect(editor.innerHTML).toBe(externalHtml)
  })
})
