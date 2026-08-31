import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildProjectDirectoryAssetData,
  createDefaultProjectDirectoryState,
  type SaveProjectDirectoryRequest,
} from '@tapcanvas/project-directory-protocol'
import type { AppContext } from '../../types'
import type { ProjectDirectoryRow } from './project-directory.repo'

const {
  createProjectDirectoryRow,
  getProjectDirectoryRowById,
  listProjectDirectoryRows,
  updateProjectDirectoryRowIfCurrent,
} = vi.hoisted(() => ({
  createProjectDirectoryRow: vi.fn(),
  getProjectDirectoryRowById: vi.fn(),
  listProjectDirectoryRows: vi.fn(),
  updateProjectDirectoryRowIfCurrent: vi.fn(),
}))

vi.mock('./project-directory.repo', () => ({
  createProjectDirectoryRow,
  getProjectDirectoryRowById,
  listProjectDirectoryRows,
  updateProjectDirectoryRowIfCurrent,
}))

import {
  loadProjectDirectoryForUser,
  saveProjectDirectoryForUser,
} from './project-directory.service'

const INITIAL_UPDATED_AT = '2026-08-01T00:00:00.000Z'
const NEXT_UPDATED_AT = '2026-08-01T00:00:01.000Z'

function createContext(): AppContext {
  return {
    env: { DB: {} } as AppContext['env'],
  } as unknown as AppContext
}

function createRow(overrides: Partial<ProjectDirectoryRow> = {}): ProjectDirectoryRow {
  const state = createDefaultProjectDirectoryState(1_000)
  return {
    id: 'directory-asset-1',
    name: 'Project Tree',
    data: JSON.stringify(buildProjectDirectoryAssetData(state)),
    owner_id: 'user-1',
    project_id: null,
    created_at: INITIAL_UPDATED_AT,
    updated_at: INITIAL_UPDATED_AT,
    ...overrides,
  }
}

function updateRequest(overrides: Partial<SaveProjectDirectoryRequest> = {}): SaveProjectDirectoryRequest {
  return {
    assetId: 'directory-asset-1',
    expectedUpdatedAt: INITIAL_UPDATED_AT,
    state: createDefaultProjectDirectoryState(2_000),
    ...overrides,
  }
}

describe('project directory service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listProjectDirectoryRows.mockResolvedValue([])
    createProjectDirectoryRow.mockResolvedValue(createRow())
    updateProjectDirectoryRowIfCurrent.mockResolvedValue(true)
    getProjectDirectoryRowById.mockResolvedValue(null)
  })

  it('returns an unpersisted default directory when the user has no directory asset', async () => {
    const snapshot = await loadProjectDirectoryForUser(createContext(), 'user-1')

    expect(snapshot.assetId).toBeNull()
    expect(snapshot.updatedAt).toBeNull()
    expect(snapshot.state.rootId).toBe('root')
    expect(snapshot.state.nodesById.root?.name).toBe('项目')
  })

  it('reports every conflicting asset when more than one directory source exists', async () => {
    const conflictingRows = Array.from({ length: 7 }, (_, index) => createRow({
      id: `directory-asset-${index + 1}`,
    }))
    listProjectDirectoryRows.mockResolvedValue(conflictingRows)

    await expect(loadProjectDirectoryForUser(createContext(), 'user-1')).rejects.toMatchObject({
      status: 409,
      code: 'project_directory_multiple_sources',
      details: { assetIds: conflictingRows.map((row) => row.id) },
    })
  })

  it('fails explicitly when persisted directory JSON is corrupt', async () => {
    listProjectDirectoryRows.mockResolvedValue([createRow({ data: '{broken-json' })])

    await expect(loadProjectDirectoryForUser(createContext(), 'user-1')).rejects.toMatchObject({
      status: 409,
      code: 'project_directory_corrupt',
    })
  })

  it('creates the first asset with a deterministic user-scoped id', async () => {
    const request: SaveProjectDirectoryRequest = {
      assetId: null,
      expectedUpdatedAt: null,
      state: createDefaultProjectDirectoryState(3_000),
    }

    await saveProjectDirectoryForUser(createContext(), 'user-1', request)

    const createInput = createProjectDirectoryRow.mock.calls[0]?.[1] as unknown as {
      id: string
      userId: string
      name: string
      data: unknown
      nowIso: string
    }
    expect(createInput.id).toMatch(/^project-directory-[0-9a-f]{32}$/)
    expect(createInput.userId).toBe('user-1')
    expect(createInput.name).toBe('Project Tree')
    expect(createInput.data).toEqual(buildProjectDirectoryAssetData(request.state))
    expect(Number.isFinite(Date.parse(createInput.nowIso))).toBe(true)
  })

  it('rejects a first-save request when another session already created the asset', async () => {
    listProjectDirectoryRows.mockResolvedValue([createRow()])

    await expect(saveProjectDirectoryForUser(createContext(), 'user-1', {
      assetId: null,
      expectedUpdatedAt: null,
      state: createDefaultProjectDirectoryState(3_000),
    })).rejects.toMatchObject({
      status: 409,
      code: 'project_directory_create_conflict',
      details: {
        actualAssetId: 'directory-asset-1',
        actualUpdatedAt: INITIAL_UPDATED_AT,
      },
    })
    expect(createProjectDirectoryRow).not.toHaveBeenCalled()
  })

  it('reports the canonical row when the database unique index wins a create race', async () => {
    listProjectDirectoryRows
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createRow({ id: 'directory-created-by-other-session' })])
    createProjectDirectoryRow.mockRejectedValueOnce({ code: 'P2002' })

    await expect(saveProjectDirectoryForUser(createContext(), 'user-1', {
      assetId: null,
      expectedUpdatedAt: null,
      state: createDefaultProjectDirectoryState(3_000),
    })).rejects.toMatchObject({
      status: 409,
      code: 'project_directory_create_conflict',
      details: {
        actualAssetId: 'directory-created-by-other-session',
        actualUpdatedAt: INITIAL_UPDATED_AT,
      },
    })
  })

  it('rejects a stale revision before attempting a conditional update', async () => {
    listProjectDirectoryRows.mockResolvedValue([
      createRow({ updated_at: NEXT_UPDATED_AT }),
    ])

    await expect(saveProjectDirectoryForUser(createContext(), 'user-1', updateRequest())).rejects.toMatchObject({
      status: 409,
      code: 'project_directory_revision_conflict',
      details: {
        actualAssetId: 'directory-asset-1',
        actualUpdatedAt: NEXT_UPDATED_AT,
      },
    })
    expect(updateProjectDirectoryRowIfCurrent).not.toHaveBeenCalled()
  })

  it('returns the persisted row after a successful compare-and-swap update', async () => {
    const request = updateRequest()
    listProjectDirectoryRows.mockResolvedValue([createRow()])
    getProjectDirectoryRowById.mockResolvedValue(createRow({
      data: JSON.stringify(buildProjectDirectoryAssetData(request.state)),
      updated_at: NEXT_UPDATED_AT,
    }))

    const snapshot = await saveProjectDirectoryForUser(createContext(), 'user-1', request)

    expect(updateProjectDirectoryRowIfCurrent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'directory-asset-1',
        userId: 'user-1',
        expectedUpdatedAt: INITIAL_UPDATED_AT,
        data: buildProjectDirectoryAssetData(request.state),
      }),
    )
    expect(snapshot.updatedAt).toBe(NEXT_UPDATED_AT)
    expect(snapshot.state).toEqual(request.state)
  })

  it('reports the actual revision when the conditional update loses a race', async () => {
    listProjectDirectoryRows.mockResolvedValue([createRow()])
    updateProjectDirectoryRowIfCurrent.mockResolvedValue(false)
    getProjectDirectoryRowById.mockResolvedValue(createRow({ updated_at: NEXT_UPDATED_AT }))

    await expect(saveProjectDirectoryForUser(createContext(), 'user-1', updateRequest())).rejects.toMatchObject({
      status: 409,
      code: 'project_directory_revision_conflict',
      details: {
        actualAssetId: 'directory-asset-1',
        actualUpdatedAt: NEXT_UPDATED_AT,
      },
    })
  })

  it('fails explicitly when a successful update cannot be read back', async () => {
    listProjectDirectoryRows.mockResolvedValue([createRow()])
    updateProjectDirectoryRowIfCurrent.mockResolvedValue(true)
    getProjectDirectoryRowById.mockResolvedValue(null)

    await expect(saveProjectDirectoryForUser(createContext(), 'user-1', updateRequest())).rejects.toMatchObject({
      status: 500,
      code: 'project_directory_read_after_write_failed',
    })
  })
})
