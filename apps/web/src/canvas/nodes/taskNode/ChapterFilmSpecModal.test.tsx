import React from 'react'
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChapterFilmSpecModal } from './ChapterFilmSpecModal'

describe('chapter film delivery scope', () => {
  beforeEach(() => localStorage.clear())

  it('explains the final video delivery and submits the selected scope', () => {
    const onConfirm = vi.fn()
    render(<MantineProvider env="test"><ChapterFilmSpecModal opened onCancel={vi.fn()} onConfirm={onConfirm} /></MantineProvider>)
    expect(screen.getByText('从当前章节到最终视频')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '开始成片' }))
    expect(onConfirm).toHaveBeenCalledWith({ deliveryScope: 'full_chapter', adaptationMode: 'faithful', notes: '', onlyVideoNodes: false })
  })

  it('makes an invalid duration visible and enables submission when corrected', () => {
    const onConfirm = vi.fn()
    render(<MantineProvider env="test"><ChapterFilmSpecModal opened onCancel={vi.fn()} onConfirm={onConfirm} /></MantineProvider>)
    fireEvent.click(screen.getByLabelText('开头片段'))
    const duration = screen.getByRole('textbox', { name: '目标时长（秒）' })
    fireEvent.change(duration, { target: { value: '' } })
    expect(screen.getByText('请输入 1–86400 之间的整数秒数')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始成片' })).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.change(duration, { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: '开始成片' }))
    expect(onConfirm).toHaveBeenCalledWith({ deliveryScope: 'opening_duration', targetDurationSeconds: 15, adaptationMode: 'faithful', notes: '', onlyVideoNodes: false })
  })
})

it('only creates video nodes when the explicit switch is enabled', async () => {
  localStorage.clear()
  const onConfirm = vi.fn()
  render(<MantineProvider env="test"><ChapterFilmSpecModal opened onCancel={vi.fn()} onConfirm={onConfirm} /></MantineProvider>)
  fireEvent.click(await screen.findByRole('switch', { name: /只生成视频节点/ }))
  fireEvent.click(screen.getByRole('button', { name: '生成视频节点' }))
  expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ onlyVideoNodes: true }))
})
