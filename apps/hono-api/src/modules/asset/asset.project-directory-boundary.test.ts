import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../types'
import type { AssetRow } from './asset.repo'

const { prisma, syncProjectAssetMemoryInDb } = vi.hoisted(() => ({
  prisma: {
    assets: {
      create: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
  syncProjectAssetMemoryInDb: vi.fn(async () => ({ status: 'persisted' as const, entryId: 'memory-1' })),
}))

vi.mock('../../platform/node/prisma', () => ({
  getPrismaClient: () => prisma,
}))

vi.mock('../memory/project-asset-memory', () => ({ syncProjectAssetMemoryInDb }))

import {
  createAssetRow,
  deleteAssetRow,
  renameAssetRow,
  updateAssetDataRow,
} from './asset.repo'

const db = {} as unknown as PrismaClient

function createRow(data: unknown): AssetRow {
  return {
    id: 'asset-1',
    name: 'Asset',
    data: JSON.stringify(data),
    owner_id: 'user-1',
    project_id: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  }
}

const directoryData = {
  kind: 'projectFsState',
  version: 1,
  state: { version: 1, rootId: 'root', nodesById: {} },
}

describe('generic asset repository project-directory boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks generic project-directory creation before reaching Prisma', async () => {
    await expect(createAssetRow(db, 'user-1', {
      name: 'Project Tree',
      data: directoryData,
      projectId: null,
    }, '2026-08-01T00:00:00.000Z')).rejects.toMatchObject({
      code: 'project_directory_dedicated_endpoint_required',
    })
    expect(prisma.assets.create).not.toHaveBeenCalled()
  })

  it('indexes a project asset after its source row is committed', async () => {
    const projectRow = { ...createRow({ kind: 'generation', url: 'https://assets.example.com/a.png' }), project_id: 'project-1' }
    prisma.assets.findFirst.mockResolvedValue(projectRow)

    await expect(createAssetRow(db, 'user-1', {
      name: 'Project Image',
      data: { kind: 'generation', url: 'https://assets.example.com/a.png' },
      projectId: 'project-1',
    }, '2026-08-01T00:00:00.000Z')).resolves.toEqual(projectRow)

    expect(syncProjectAssetMemoryInDb).toHaveBeenCalledWith(db, {
      userId: 'user-1',
      projectId: 'project-1',
      assetId: 'asset-1',
      name: 'Asset',
      data: { kind: 'generation', url: 'https://assets.example.com/a.png' },
      updatedAt: '2026-08-01T00:00:00.000Z',
    })
  })

  it('blocks changing an ordinary asset into a project directory', async () => {
    prisma.assets.findFirst.mockResolvedValue(createRow({ kind: 'generation' }))

    await expect(updateAssetDataRow(
      db,
      'user-1',
      'asset-1',
      directoryData,
      '2026-08-01T00:00:01.000Z',
    )).rejects.toMatchObject({
      code: 'project_directory_dedicated_endpoint_required',
    })
    expect(prisma.assets.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['update_data', async () => updateAssetDataRow(
      db,
      'user-1',
      'asset-1',
      { kind: 'generation' },
      '2026-08-01T00:00:01.000Z',
    )],
    ['rename', async () => renameAssetRow(
      db,
      'user-1',
      'asset-1',
      'Renamed',
      '2026-08-01T00:00:01.000Z',
    )],
    ['delete', async () => deleteAssetRow(db, 'user-1', 'asset-1')],
  ] as const)('blocks generic %s for an existing project directory', async (_operation, execute) => {
    prisma.assets.findFirst.mockResolvedValue(createRow(directoryData))

    await expect(execute()).rejects.toMatchObject({
      code: 'project_directory_dedicated_endpoint_required',
    })
    expect(prisma.assets.updateMany).not.toHaveBeenCalled()
    expect(prisma.assets.update).not.toHaveBeenCalled()
    expect(prisma.assets.delete).not.toHaveBeenCalled()
  })
})
