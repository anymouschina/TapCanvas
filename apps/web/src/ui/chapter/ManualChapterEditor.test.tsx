import React from 'react'
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ManualChapterEditor } from './ManualChapterEditor'

describe('ManualChapterEditor', () => {
  it('creates a chapter from a small idea without requiring a finished script', () => {
    const onSubmit = vi.fn()
    render(
      <MantineProvider defaultColorScheme="dark">
        <ManualChapterEditor
          mode="create"
          identity="create:project-1"
          saving={false}
          onCancel={() => undefined}
          onSubmit={onSubmit}
        />
      </MantineProvider>,
    )

    fireEvent.change(screen.getByLabelText('章节标题'), {
      target: { value: '  登录方舟  ' },
    })
    fireEvent.change(screen.getByLabelText('本章构思或正文'), {
      target: { value: '  先完成 30 秒开场。  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '创建并进入' }))

    expect(onSubmit).toHaveBeenCalledWith({
      title: '登录方舟',
      summary: '先完成 30 秒开场。',
    })
  })

  it('keeps the create action disabled until a real title exists', () => {
    render(
      <MantineProvider defaultColorScheme="dark">
        <ManualChapterEditor
          mode="create"
          identity="create:project-1"
          saving={false}
          onCancel={() => undefined}
          onSubmit={() => undefined}
        />
      </MantineProvider>,
    )

    expect(screen.getByRole('button', { name: '创建并进入' })).toBeDisabled()
  })
})
