import {
  ProjectDirectorySnapshotSchema,
  SaveProjectDirectoryRequestSchema,
} from '@tapcanvas/project-directory-protocol'
import { Hono } from 'hono'
import { authMiddleware } from '../../middleware/auth'
import type { AppEnv } from '../../types'
import {
  loadProjectDirectoryForUser,
  saveProjectDirectoryForUser,
} from './project-directory.service'

export const projectDirectoryRouter = new Hono<AppEnv>()

projectDirectoryRouter.use('*', authMiddleware)

projectDirectoryRouter.get('/', async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const snapshot = await loadProjectDirectoryForUser(c, userId)
  return c.json(ProjectDirectorySnapshotSchema.parse(snapshot))
})

projectDirectoryRouter.put('/', async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const body: unknown = await c.req.json().catch(() => null)
  const parsed = SaveProjectDirectoryRequestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
  }
  const snapshot = await saveProjectDirectoryForUser(c, userId, parsed.data)
  return c.json(ProjectDirectorySnapshotSchema.parse(snapshot))
})
