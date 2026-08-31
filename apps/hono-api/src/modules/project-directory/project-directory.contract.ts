import { z } from 'zod'

export const PROJECT_DIRECTORY_ASSET_KIND = 'projectFsState' as const
export const PROJECT_DIRECTORY_ASSET_NAME = 'Project Tree' as const
export const PROJECT_DIRECTORY_ROOT_NAME = '项目' as const
export const PROJECT_DIRECTORY_MAX_NODES = 5000
export const PROJECT_DIRECTORY_MAX_DEPTH = 32
export const PROJECT_DIRECTORY_MAX_FOLDER_NAME_LENGTH = 120
export const PROJECT_DIRECTORY_MAX_PROJECT_NAME_LENGTH = 200

const NodeIdSchema = z.string().trim().min(1).max(200)
const TimestampSchema = z.number().finite().nonnegative()

export const ProjectDirectoryFolderNodeSchema = z.object({
  id: NodeIdSchema,
  kind: z.literal('folder'),
  parentId: NodeIdSchema.nullable(),
  name: z.string().trim().min(1).max(PROJECT_DIRECTORY_MAX_FOLDER_NAME_LENGTH),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict()

export const ProjectDirectoryProjectNodeSchema = z.object({
  id: NodeIdSchema,
  kind: z.literal('project'),
  parentId: NodeIdSchema,
  name: z.string().trim().min(1).max(PROJECT_DIRECTORY_MAX_PROJECT_NAME_LENGTH),
  projectId: NodeIdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict()

export const ProjectDirectoryNodeSchema = z.discriminatedUnion('kind', [
  ProjectDirectoryFolderNodeSchema,
  ProjectDirectoryProjectNodeSchema,
])

export type ProjectDirectoryFolderNode = z.infer<typeof ProjectDirectoryFolderNodeSchema>
export type ProjectDirectoryProjectNode = z.infer<typeof ProjectDirectoryProjectNodeSchema>
export type ProjectDirectoryNode = z.infer<typeof ProjectDirectoryNodeSchema>

function addStateIssue(
  context: z.RefinementCtx,
  message: string,
  path: Array<string | number> = [],
): void {
  context.addIssue({ code: z.ZodIssueCode.custom, message, path })
}

export const ProjectDirectoryStateSchema = z.object({
  version: z.literal(1),
  rootId: NodeIdSchema,
  nodesById: z.record(ProjectDirectoryNodeSchema),
}).strict().superRefine((state, context) => {
  const nodeEntries = Object.entries(state.nodesById)
  if (nodeEntries.length > PROJECT_DIRECTORY_MAX_NODES) {
    addStateIssue(
      context,
      `项目目录节点数量不能超过 ${PROJECT_DIRECTORY_MAX_NODES}`,
      ['nodesById'],
    )
    return
  }
  const root = state.nodesById[state.rootId]
  if (!root || root.kind !== 'folder' || root.parentId !== null) {
    addStateIssue(context, '项目目录根节点无效', ['rootId'])
    return
  }
  if (root.name !== PROJECT_DIRECTORY_ROOT_NAME) {
    addStateIssue(context, `项目目录根节点必须命名为“${PROJECT_DIRECTORY_ROOT_NAME}”`, [
      'nodesById',
      state.rootId,
      'name',
    ])
  }

  const projectIds = new Set<string>()
  for (const [nodeKey, node] of nodeEntries) {
    if (node.id !== nodeKey) {
      addStateIssue(context, `目录节点键 ${nodeKey} 与节点 id ${node.id} 不一致`, [
        'nodesById',
        nodeKey,
        'id',
      ])
      continue
    }
    if (node.kind === 'project') {
      if (projectIds.has(node.projectId)) {
        addStateIssue(context, `项目 ${node.projectId} 在目录中重复出现`, [
          'nodesById',
          nodeKey,
          'projectId',
        ])
      }
      projectIds.add(node.projectId)
    }
    if (node.createdAt > node.updatedAt) {
      addStateIssue(context, `目录节点 ${node.id} 的 updatedAt 早于 createdAt`, [
        'nodesById',
        nodeKey,
        'updatedAt',
      ])
    }
    if (node.id === state.rootId) continue
    if (!node.parentId) {
      addStateIssue(context, `目录节点 ${node.id} 缺少父目录`, ['nodesById', nodeKey, 'parentId'])
      continue
    }

    const seen = new Set<string>([node.id])
    let parentId: string | null = node.parentId
    let depth = 1
    while (parentId !== null && parentId !== state.rootId) {
      if (seen.has(parentId)) {
        addStateIssue(context, `目录节点 ${node.id} 存在循环父级`, ['nodesById', nodeKey, 'parentId'])
        parentId = null
        break
      }
      depth += 1
      if (depth > PROJECT_DIRECTORY_MAX_DEPTH) {
        addStateIssue(context, `目录节点 ${node.id} 的层级超过 ${PROJECT_DIRECTORY_MAX_DEPTH}`, [
          'nodesById',
          nodeKey,
          'parentId',
        ])
        parentId = null
        break
      }
      seen.add(parentId)
      const parent: ProjectDirectoryNode | undefined = state.nodesById[parentId]
      if (!parent || parent.kind !== 'folder') {
        addStateIssue(context, `目录节点 ${node.id} 的父级链无效`, ['nodesById', nodeKey, 'parentId'])
        parentId = null
        break
      }
      parentId = parent.parentId
    }
    if (parentId === null) {
      addStateIssue(context, `目录节点 ${node.id} 无法追溯到根目录`, ['nodesById', nodeKey, 'parentId'])
      continue
    }
    const parent = state.nodesById[node.parentId]
    if (!parent || parent.kind !== 'folder') {
      addStateIssue(context, `目录节点 ${node.id} 的父目录无效`, ['nodesById', nodeKey, 'parentId'])
    }
  }
})

export type ProjectDirectoryState = z.infer<typeof ProjectDirectoryStateSchema>

export const ProjectDirectoryAssetDataSchema = z.object({
  kind: z.literal(PROJECT_DIRECTORY_ASSET_KIND),
  version: z.literal(1),
  state: ProjectDirectoryStateSchema,
}).strict()

export type ProjectDirectoryAssetData = z.infer<typeof ProjectDirectoryAssetDataSchema>

export const ProjectDirectorySnapshotSchema = z.object({
  assetId: NodeIdSchema.nullable(),
  updatedAt: z.string().trim().min(1).nullable(),
  state: ProjectDirectoryStateSchema,
}).strict()

export type ProjectDirectorySnapshot = z.infer<typeof ProjectDirectorySnapshotSchema>

export const SaveProjectDirectoryRequestSchema = z.object({
  assetId: NodeIdSchema.nullable(),
  expectedUpdatedAt: z.string().trim().min(1).nullable(),
  state: ProjectDirectoryStateSchema,
}).strict().superRefine((request, context) => {
  if ((request.assetId === null) !== (request.expectedUpdatedAt === null)) {
    addStateIssue(
      context,
      'assetId 与 expectedUpdatedAt 必须同时为空或同时存在',
      ['expectedUpdatedAt'],
    )
  }
})

export type SaveProjectDirectoryRequest = z.infer<typeof SaveProjectDirectoryRequestSchema>

export function createDefaultProjectDirectoryState(
  timestamp: number = Date.now(),
): ProjectDirectoryState {
  const rootId = 'root'
  return ProjectDirectoryStateSchema.parse({
    version: 1,
    rootId,
    nodesById: {
      [rootId]: {
        id: rootId,
        kind: 'folder',
        parentId: null,
        name: PROJECT_DIRECTORY_ROOT_NAME,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
  })
}

export function parseProjectDirectoryState(value: unknown): ProjectDirectoryState {
  return ProjectDirectoryStateSchema.parse(value)
}

export function parseProjectDirectoryAssetData(value: unknown): ProjectDirectoryAssetData {
  return ProjectDirectoryAssetDataSchema.parse(value)
}

export function buildProjectDirectoryAssetData(
  state: ProjectDirectoryState,
): ProjectDirectoryAssetData {
  return ProjectDirectoryAssetDataSchema.parse({
    kind: PROJECT_DIRECTORY_ASSET_KIND,
    version: 1,
    state,
  })
}
