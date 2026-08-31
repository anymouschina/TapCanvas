import {
  buildProjectDirectoryAssetData,
  createDefaultProjectDirectoryState,
  PROJECT_DIRECTORY_ASSET_NAME,
  ProjectDirectoryAssetDataSchema,
  ProjectDirectorySnapshotSchema,
  type ProjectDirectorySnapshot,
  type SaveProjectDirectoryRequest,
} from '@tapcanvas/project-directory-protocol'
import { AppError } from '../../middleware/error'
import type { AppContext } from '../../types'
import {
  createProjectDirectoryRow,
  getProjectDirectoryRowById,
  listProjectDirectoryRows,
  updateProjectDirectoryRowIfCurrent,
  type ProjectDirectoryRow,
} from './project-directory.repo'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isUniqueConstraintError(error: unknown): boolean {
  return isRecord(error) && error.code === 'P2002'
}

function parseRowState(row: ProjectDirectoryRow): ProjectDirectorySnapshot['state'] {
  if (!row.data) {
    throw new AppError('项目目录资产缺少数据', {
      status: 409,
      code: 'project_directory_corrupt',
      details: { assetId: row.id },
    })
  }
  let data: unknown
  try {
    data = JSON.parse(row.data)
  } catch {
    throw new AppError('项目目录资产不是有效 JSON', {
      status: 409,
      code: 'project_directory_corrupt',
      details: { assetId: row.id },
    })
  }
  const parsed = ProjectDirectoryAssetDataSchema.safeParse(data)
  if (!parsed.success) {
    throw new AppError('项目目录资产结构损坏', {
      status: 409,
      code: 'project_directory_corrupt',
      details: { assetId: row.id, issues: parsed.error.issues },
    })
  }
  return parsed.data.state
}

function snapshotFromRow(row: ProjectDirectoryRow): ProjectDirectorySnapshot {
  return ProjectDirectorySnapshotSchema.parse({
    assetId: row.id,
    updatedAt: row.updated_at,
    state: parseRowState(row),
  })
}

function assertSingleDirectoryRow(rows: ProjectDirectoryRow[]): ProjectDirectoryRow | null {
  if (rows.length > 1) {
    throw new AppError('检测到多份用户级项目目录资产，无法确定唯一真源', {
      status: 409,
      code: 'project_directory_multiple_sources',
      details: { assetIds: rows.map((row) => row.id) },
    })
  }
  return rows[0] ?? null
}

async function deterministicDirectoryAssetId(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId))
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `project-directory-${hex.slice(0, 32)}`
}

function nextUpdatedAt(expectedUpdatedAt: string): string {
  const expectedMs = Date.parse(expectedUpdatedAt)
  if (!Number.isFinite(expectedMs)) {
    throw new AppError('项目目录资产 updatedAt 无效', {
      status: 409,
      code: 'project_directory_corrupt',
      details: { updatedAt: expectedUpdatedAt },
    })
  }
  return new Date(Math.max(Date.now(), expectedMs + 1)).toISOString()
}

function conflictDetails(row: ProjectDirectoryRow | null): Record<string, string | null> {
  return {
    actualAssetId: row?.id ?? null,
    actualUpdatedAt: row?.updated_at ?? null,
  }
}

export async function loadProjectDirectoryForUser(
  c: AppContext,
  userId: string,
): Promise<ProjectDirectorySnapshot> {
  const row = assertSingleDirectoryRow(await listProjectDirectoryRows(c.env.DB, userId))
  if (row) return snapshotFromRow(row)
  return ProjectDirectorySnapshotSchema.parse({
    assetId: null,
    updatedAt: null,
    state: createDefaultProjectDirectoryState(),
  })
}

export async function saveProjectDirectoryForUser(
  c: AppContext,
  userId: string,
  request: SaveProjectDirectoryRequest,
): Promise<ProjectDirectorySnapshot> {
  const data = buildProjectDirectoryAssetData(request.state)
  const existing = assertSingleDirectoryRow(await listProjectDirectoryRows(c.env.DB, userId))

  if (request.assetId === null && request.expectedUpdatedAt === null) {
    if (existing) {
      throw new AppError('项目目录已由另一会话创建，请刷新后重试', {
        status: 409,
        code: 'project_directory_create_conflict',
        details: conflictDetails(existing),
      })
    }
    const nowIso = new Date().toISOString()
    try {
      const created = await createProjectDirectoryRow(c.env.DB, {
        id: await deterministicDirectoryAssetId(userId),
        userId,
        name: PROJECT_DIRECTORY_ASSET_NAME,
        data,
        nowIso,
      })
      return snapshotFromRow(created)
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const actual = assertSingleDirectoryRow(await listProjectDirectoryRows(c.env.DB, userId))
      throw new AppError('项目目录已由另一会话创建，请刷新后重试', {
        status: 409,
        code: 'project_directory_create_conflict',
        details: conflictDetails(actual),
      })
    }
  }

  if (!request.assetId || !request.expectedUpdatedAt) {
    throw new AppError('项目目录保存缺少并发版本信息', {
      status: 400,
      code: 'project_directory_revision_required',
    })
  }
  if (!existing || existing.id !== request.assetId) {
    throw new AppError('项目目录资产已变化，请刷新后重试', {
      status: 409,
      code: 'project_directory_asset_conflict',
      details: conflictDetails(existing),
    })
  }
  if (existing.updated_at !== request.expectedUpdatedAt) {
    throw new AppError('项目目录已在另一会话中更新，请刷新后重试', {
      status: 409,
      code: 'project_directory_revision_conflict',
      details: conflictDetails(existing),
    })
  }

  const updated = await updateProjectDirectoryRowIfCurrent(c.env.DB, {
    id: request.assetId,
    userId,
    expectedUpdatedAt: request.expectedUpdatedAt,
    data,
    nextUpdatedAt: nextUpdatedAt(request.expectedUpdatedAt),
  })
  if (!updated) {
    const actual = await getProjectDirectoryRowById(c.env.DB, {
      id: request.assetId,
      userId,
    })
    throw new AppError('项目目录已在另一会话中更新，请刷新后重试', {
      status: 409,
      code: 'project_directory_revision_conflict',
      details: conflictDetails(actual),
    })
  }
  const row = await getProjectDirectoryRowById(c.env.DB, {
    id: request.assetId,
    userId,
  })
  if (!row) {
    throw new AppError('项目目录保存后无法回读', {
      status: 500,
      code: 'project_directory_read_after_write_failed',
      details: { assetId: request.assetId },
    })
  }
  return snapshotFromRow(row)
}
