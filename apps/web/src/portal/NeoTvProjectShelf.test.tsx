import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectDto } from '../api/server'
import { NeoTvProjectShelf } from './NeoTvProjectShelf'

const PROJECT: ProjectDto = {
  id: 'project-1',
  name: 'TcTv 画布',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T01:00:00.000Z',
  access: 'owner',
  teamShared: false,
}

function renderShelf(project: ProjectDto = PROJECT): {
  onRenameProject: ReturnType<typeof vi.fn>
  onDeleteProject: ReturnType<typeof vi.fn>
  onToggleShare: ReturnType<typeof vi.fn>
} {
  const onRenameProject = vi.fn()
  const onDeleteProject = vi.fn()
  const onToggleShare = vi.fn().mockResolvedValue(undefined)
  render(
    <MantineProvider>
      <NeoTvProjectShelf
        projects={[project]}
        projectCovers={{}}
        loading={false}
        error=""
        signedIn
        scope="all"
        query=""
        busy={false}
        managingProjectId={null}
        sharingProjectId={null}
        shareAvailable
        onScopeChange={vi.fn()}
        onQueryChange={vi.fn()}
        onCreate={vi.fn()}
        onLogin={vi.fn()}
        onRenameProject={onRenameProject}
        onDeleteProject={onDeleteProject}
        onToggleShare={onToggleShare}
      />
    </MantineProvider>,
  )
  return { onRenameProject, onDeleteProject, onToggleShare }
}

describe('NeoTvProjectShelf project management', () => {
  it('exposes the same owner actions from the TcTv project card menu', async () => {
    const actions = renderShelf()

    fireEvent.click(screen.getByRole('button', { name: '管理画布：TcTv 画布' }))
    fireEvent.click(await screen.findByText('重命名'))
    fireEvent.click(screen.getByRole('button', { name: '管理画布：TcTv 画布' }))
    fireEvent.click(await screen.findByText('共享到团队'))
    fireEvent.click(screen.getByRole('button', { name: '管理画布：TcTv 画布' }))
    fireEvent.click(await screen.findByText('删除'))

    expect(actions.onRenameProject).toHaveBeenCalledWith(PROJECT)
    expect(actions.onToggleShare).toHaveBeenCalledWith(PROJECT)
    expect(actions.onDeleteProject).toHaveBeenCalledWith(PROJECT)
  })

  it('does not expose owner actions for a team edit project', () => {
    renderShelf({ ...PROJECT, access: 'team_edit' })

    expect(screen.queryByRole('button', { name: '管理画布：TcTv 画布' })).toBeNull()
  })
})
