// @vitest-environment jsdom

import React from 'react'
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listProjectChapters, type ChapterDto, type ProjectDto } from '../api/server'
import { PublishSourcePickerModal, type PublishSource } from './PublishSourcePickerModal'
import { installMantineDomMocks } from './testMantineDomMocks'

installMantineDomMocks()

vi.mock('../api/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/server')>()
  return {
    ...actual,
    listProjectChapters: vi.fn(),
  }
})

const PROJECT: ProjectDto = {
  id: 'project-1',
  name: '测试项目',
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
}

const CHAPTER: ChapterDto = {
  id: 'chapter-1',
  projectId: PROJECT.id,
  index: 0,
  title: '第一章 出发',
  status: 'draft',
  sortOrder: 0,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
}

describe('PublishSourcePickerModal chapter association', () => {
  beforeEach(() => {
    vi.mocked(listProjectChapters).mockReset()
  })

  it('loads and returns a chapter from the selected real project', async () => {
    vi.mocked(listProjectChapters).mockResolvedValue([CHAPTER])
    const onConfirm = vi.fn<[PublishSource], void>()

    render(
      <MantineProvider defaultColorScheme="dark">
        <PublishSourcePickerModal
          projects={[PROJECT]}
          projectCovers={{}}
          shortFilms={[]}
          shortFilmsLoading={false}
          shortFilmsError=""
          opened
          value={null}
          onClose={() => undefined}
          onConfirm={onConfirm}
        />
      </MantineProvider>,
    )

    fireEvent.click(screen.getByRole('tab', { name: '章节' }))
    await waitFor(() => expect(listProjectChapters).toHaveBeenCalledWith(PROJECT.id))

    fireEvent.click(await screen.findByRole('button', { name: /第一章 出发/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认选择' }))

    expect(onConfirm).toHaveBeenCalledWith({
      kind: 'chapter',
      projectId: PROJECT.id,
      chapterId: CHAPTER.id,
      chapterTitle: CHAPTER.title,
      chapterIndex: CHAPTER.index,
    })
  })
})
