import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StudioProjectNameEditor } from './StudioProjectNameEditor'

const toastMock = vi.hoisted(() => vi.fn())

vi.mock('./toast', () => ({
  toast: toastMock,
}))

function renderEditor(input?: {
  name?: string
  onSave?: (projectId: string, name: string) => Promise<string>
}): {
  input: HTMLInputElement
  onSave: (projectId: string, name: string) => Promise<string>
} {
  const onSave = input?.onSave ?? vi.fn(async (_projectId: string, name: string) => name)
  render(
    <MantineProvider>
      <StudioProjectNameEditor
        project={{ id: 'project-1', name: input?.name ?? '原项目名' }}
        onSave={onSave}
      />
    </MantineProvider>,
  )
  return {
    input: screen.getByRole('textbox', { name: '项目名称' }),
    onSave,
  }
}

describe('StudioProjectNameEditor', () => {
  beforeEach(() => {
    toastMock.mockReset()
  })

  it('edits on focus and saves the trimmed project name on blur', async () => {
    const { input, onSave } = renderEditor()

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '  新项目名  ' } })
    expect(input).toHaveValue('  新项目名  ')
    fireEvent.blur(input)

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('project-1', '新项目名'))
    await waitFor(() => expect(input).toHaveValue('新项目名'))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('does not issue a request when the confirmed name is unchanged', () => {
    const { input, onSave } = renderEditor()

    fireEvent.focus(input)
    fireEvent.blur(input)

    expect(onSave).not.toHaveBeenCalled()
  })

  it('rejects a blank name and restores the confirmed value', () => {
    const { input, onSave } = renderEditor()

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)

    expect(onSave).not.toHaveBeenCalled()
    expect(input).toHaveValue('原项目名')
    expect(toastMock).toHaveBeenCalledWith('项目名称不能为空', 'error')
  })

  it('restores the confirmed name and reports an explicit save failure', async () => {
    const onSave = vi.fn(async (): Promise<string> => {
      throw new Error('没有项目编辑权限')
    })
    const { input } = renderEditor({ onSave })

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '未保存名称' } })
    fireEvent.blur(input)

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('没有项目编辑权限', 'error'))
    expect(input).toHaveValue('原项目名')
  })

  it('cancels the draft with Escape without saving it', () => {
    const { input, onSave } = renderEditor()

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '放弃的名称' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onSave).not.toHaveBeenCalled()
    expect(input).toHaveValue('原项目名')
  })
})
