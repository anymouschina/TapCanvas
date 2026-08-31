// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectDto } from '../api/server'
import type { ProjectFsFolderNode } from '../projects/projectFs'
import { CanvasHubProjectGrid, type CanvasHubProjectGridProps } from './CanvasHubProjectGrid'

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: vi.fn((query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  })),
})

afterEach(() => cleanup())

const PROJECT: ProjectDto = {
  id: 'project-1',
  name: '第一画布',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T01:00:00.000Z',
  access: 'owner',
  teamShared: false,
}

const FOLDER: ProjectFsFolderNode = {
  id: 'folder-1',
  kind: 'folder',
  parentId: 'root',
  name: '甲组',
  createdAt: 1,
  updatedAt: 1,
}

function createProps(overrides: Partial<CanvasHubProjectGridProps> = {}): CanvasHubProjectGridProps {
  return {
    cardSize: 'medium',
    authenticated: true,
    loading: false,
    creatingProject: false,
    directorySaving: false,
    directoryConflicted: false,
    showFolderComposer: false,
    sharingProjectId: null,
    managingProjectId: null,
    shareAvailable: true,
    folders: [{ node: FOLDER, childCount: 0 }],
    projects: [{ nodeId: 'project-node-1', project: PROJECT, cover: '', location: null }],
    dragNodeId: null,
    onDragNodeChange: vi.fn(),
    onCreateProject: vi.fn(),
    onCloseFolderComposer: vi.fn(),
    onCreateFolder: vi.fn().mockResolvedValue(true),
    onOpenFolder: vi.fn(),
    canMoveNode: vi.fn().mockReturnValue(true),
    onMoveNode: vi.fn().mockResolvedValue(true),
    onOpenProject: vi.fn(),
    onRenameProject: vi.fn(),
    onDeleteProject: vi.fn(),
    onToggleShare: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function renderGrid(props: CanvasHubProjectGridProps): ReturnType<typeof render> {
  return render(
    <MantineProvider>
      <CanvasHubProjectGrid {...props} />
    </MantineProvider>,
  )
}

describe('CanvasHubProjectGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps project actions outside the open button and dispatches the exact menu actions', async () => {
    const props = createProps()
    const { container } = renderGrid(props)

    expect(container.querySelector('button button')).toBeNull()
    fireEvent.click(screen.getByText('甲组').closest('button') as HTMLButtonElement)
    fireEvent.click(screen.getByText('第一画布').closest('button') as HTMLButtonElement)
    fireEvent.click(screen.getByRole('button', { name: '管理画布：第一画布' }))
    fireEvent.click(await screen.findByText('重命名'))

    fireEvent.click(screen.getByRole('button', { name: '管理画布：第一画布' }))
    fireEvent.click(await screen.findByText('共享到团队'))

    fireEvent.click(screen.getByRole('button', { name: '管理画布：第一画布' }))
    fireEvent.click(await screen.findByText('删除'))

    expect(props.onOpenFolder).toHaveBeenCalledWith('folder-1')
    expect(props.onOpenProject).toHaveBeenCalledWith('project-1')
    expect(props.onRenameProject).toHaveBeenCalledWith(PROJECT)
    expect(props.onToggleShare).toHaveBeenCalledWith(PROJECT)
    expect(props.onDeleteProject).toHaveBeenCalledWith(PROJECT)
  })

  it('does not expose owner management actions for a collaborative edit project', () => {
    const props = createProps({
      projects: [{
        nodeId: 'project-node-1',
        project: { ...PROJECT, access: 'team_edit' },
        cover: '',
        location: null,
      }],
    })
    renderGrid(props)

    expect(screen.queryByRole('button', { name: '管理画布：第一画布' })).toBeNull()
  })

  it('moves the dragged node only when the target folder passes structural validation', async () => {
    const props = createProps({ dragNodeId: 'project-node-1' })
    const { container } = renderGrid(props)
    const folderCard = container.querySelector('[aria-label="分组：甲组"]')
    if (!(folderCard instanceof HTMLElement)) throw new Error('folder card was not rendered')
    const dataTransfer = {
      dropEffect: 'none',
      getData: () => 'project-node-1',
    }

    fireEvent.dragOver(folderCard, { dataTransfer })
    fireEvent.drop(folderCard, { dataTransfer })

    await waitFor(() => {
      expect(props.onMoveNode).toHaveBeenCalledWith('project-node-1', 'folder-1')
    })
  })

  it('shows an explicit validation error for an empty folder name', () => {
    const props = createProps({ showFolderComposer: true })
    renderGrid(props)

    fireEvent.click(screen.getByRole('button', { name: '创建分组' }))

    expect(screen.getByRole('alert').textContent).toBe('分组名称不能为空')
    expect(props.onCreateFolder).not.toHaveBeenCalled()
  })
})
