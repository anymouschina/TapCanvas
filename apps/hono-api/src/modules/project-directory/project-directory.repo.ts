import type { PrismaClient } from '../../types'
import { getPrismaClient } from '../../platform/node/prisma'
import { PROJECT_DIRECTORY_ASSET_KIND } from '@tapcanvas/project-directory-protocol'

export type ProjectDirectoryRow = {
  id: string
  name: string
  data: string | null
  owner_id: string
  project_id: string | null
  created_at: string
  updated_at: string
}

export async function listProjectDirectoryRows(
  db: PrismaClient,
  userId: string,
): Promise<ProjectDirectoryRow[]> {
  void db
  return getPrismaClient().$queryRaw<ProjectDirectoryRow[]>`
    SELECT "id", "name", "data", "owner_id", "project_id", "created_at", "updated_at"
    FROM "assets"
    WHERE "owner_id" = ${userId}
      AND "project_id" IS NULL
      AND ("data"::jsonb ->> 'kind') = ${PROJECT_DIRECTORY_ASSET_KIND}
    ORDER BY "updated_at" DESC, "id" ASC
  `
}

export async function createProjectDirectoryRow(
  db: PrismaClient,
  input: {
    id: string
    userId: string
    name: string
    data: unknown
    nowIso: string
  },
): Promise<ProjectDirectoryRow> {
  void db
  return getPrismaClient().assets.create({
    data: {
      id: input.id,
      name: input.name,
      data: JSON.stringify(input.data),
      owner_id: input.userId,
      project_id: null,
      created_at: input.nowIso,
      updated_at: input.nowIso,
    },
  })
}

export async function updateProjectDirectoryRowIfCurrent(
  db: PrismaClient,
  input: {
    id: string
    userId: string
    expectedUpdatedAt: string
    data: unknown
    nextUpdatedAt: string
  },
): Promise<boolean> {
  void db
  const result = await getPrismaClient().assets.updateMany({
    where: {
      id: input.id,
      owner_id: input.userId,
      project_id: null,
      updated_at: input.expectedUpdatedAt,
    },
    data: {
      data: JSON.stringify(input.data),
      updated_at: input.nextUpdatedAt,
    },
  })
  return result.count === 1
}

export async function getProjectDirectoryRowById(
  db: PrismaClient,
  input: { id: string; userId: string },
): Promise<ProjectDirectoryRow | null> {
  void db
  return getPrismaClient().assets.findFirst({
    where: {
      id: input.id,
      owner_id: input.userId,
      project_id: null,
    },
  })
}
