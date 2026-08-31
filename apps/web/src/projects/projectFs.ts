import {
  buildProjectDirectoryAssetData,
  createDefaultProjectDirectoryState,
  parseProjectDirectoryAssetData,
  parseProjectDirectoryState,
  PROJECT_DIRECTORY_ASSET_KIND,
  PROJECT_DIRECTORY_ASSET_NAME,
  type ProjectDirectoryAssetData,
  type ProjectDirectoryFolderNode,
  type ProjectDirectoryNode,
  type ProjectDirectoryProjectNode,
  type ProjectDirectoryState,
} from '@tapcanvas/project-directory-protocol'

export type ProjectFsFolderNode = ProjectDirectoryFolderNode
export type ProjectFsProjectNode = ProjectDirectoryProjectNode
export type ProjectFsNode = ProjectDirectoryNode
export type ProjectFsState = ProjectDirectoryState
export type ProjectFsAssetData = ProjectDirectoryAssetData

export type ProjectFsIndex = {
  childrenByFolderId: Map<string, ProjectFsNode[]>
  projectNodeByProjectId: Map<string, ProjectFsProjectNode>
}

export const PROJECT_FS_ASSET_KIND = PROJECT_DIRECTORY_ASSET_KIND
export const PROJECT_FS_ASSET_NAME = PROJECT_DIRECTORY_ASSET_NAME
export const parseProjectFsState = parseProjectDirectoryState
export const parseProjectFsAssetData = parseProjectDirectoryAssetData
export const buildProjectFsAssetData = buildProjectDirectoryAssetData

const STORAGE_PREFIX = 'tapcanvas-project-fs:v1:'

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必须是非空字符串`)
  return value.trim()
}

function now() {
  return Date.now()
}

function monotonicUpdatedAt(node: ProjectFsNode, candidate: number = now()): number {
  return Math.max(candidate, node.createdAt, node.updatedAt)
}

function uid(prefix: string) {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error('当前环境不支持安全的目录节点 ID 生成')
  }
  return `${prefix}_${crypto.randomUUID()}`
}

export function storageKeyForUser(userId: string) {
  return `${STORAGE_PREFIX}${requireNonEmptyString(userId, '用户 ID')}`
}

export function loadProjectFs(userId: string): ProjectFsState {
  if (typeof localStorage === 'undefined') throw new Error('当前环境不支持本地目录存储')
  const key = storageKeyForUser(userId)
  const raw = localStorage.getItem(key)
  if (!raw) return createDefaultFs()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('本地项目目录不是有效 JSON')
  }
  return parseProjectFsState(parsed)
}

export function saveProjectFs(userId: string, state: ProjectFsState) {
  if (typeof localStorage === 'undefined') throw new Error('当前环境不支持本地目录存储')
  const key = storageKeyForUser(userId)
  localStorage.setItem(key, JSON.stringify(parseProjectFsState(state)))
}

export function createDefaultFs(): ProjectFsState {
  return createDefaultProjectDirectoryState(now())
}

export function listChildren(state: ProjectFsState, folderId: string): ProjectFsNode[] {
  const folder = state.nodesById[folderId]
  if (!folder || folder.kind !== 'folder') throw new Error(`目录 ${folderId} 不存在`)
  const out: ProjectFsNode[] = []
  for (const node of Object.values(state.nodesById)) {
    if (node.parentId === folderId) out.push(node)
  }
  out.sort((a, b) => {
    const ak = a.kind === 'folder' ? 0 : 1
    const bk = b.kind === 'folder' ? 0 : 1
    if (ak !== bk) return ak - bk
    return a.name.localeCompare(b.name, 'zh-Hans-CN-u-co-pinyin')
  })
  return out
}

export function buildProjectFsIndex(state: ProjectFsState): ProjectFsIndex {
  const childrenByFolderId = new Map<string, ProjectFsNode[]>()
  const projectNodeByProjectId = new Map<string, ProjectFsProjectNode>()
  for (const node of Object.values(state.nodesById)) {
    if (node.parentId) {
      const children = childrenByFolderId.get(node.parentId)
      if (children) children.push(node)
      else childrenByFolderId.set(node.parentId, [node])
    }
    if (node.kind === 'project') projectNodeByProjectId.set(node.projectId, node)
  }
  for (const children of childrenByFolderId.values()) {
    children.sort((a, b) => {
      const leftKind = a.kind === 'folder' ? 0 : 1
      const rightKind = b.kind === 'folder' ? 0 : 1
      if (leftKind !== rightKind) return leftKind - rightKind
      return a.name.localeCompare(b.name, 'zh-Hans-CN-u-co-pinyin')
    })
  }
  return { childrenByFolderId, projectNodeByProjectId }
}

export function pathToRoot(state: ProjectFsState, folderId: string): ProjectFsFolderNode[] {
  const chain: ProjectFsFolderNode[] = []
  let cur: string | null = folderId
  const seen = new Set<string>()
  while (cur) {
    if (seen.has(cur)) throw new Error(`目录 ${folderId} 的父级链存在循环`)
    seen.add(cur)
    const n: ProjectFsNode | undefined = state.nodesById[cur]
    if (!n || n.kind !== 'folder') throw new Error(`目录 ${folderId} 的父级链无效`)
    chain.push(n)
    cur = n.parentId
  }
  if (chain[chain.length - 1]?.id !== state.rootId) throw new Error(`目录 ${folderId} 无法追溯到根目录`)
  return chain.reverse()
}

export function createFolder(state: ProjectFsState, parentId: string, name: string): ProjectFsState {
  const parent = state.nodesById[parentId]
  if (!parent || parent.kind !== 'folder') throw new Error(`父目录 ${parentId} 不存在`)
  const normalizedName = requireNonEmptyString(name, '目录名称')
  const t = now()
  const id = uid('dir')
  return {
    ...state,
    nodesById: {
      ...state.nodesById,
      [id]: { id, kind: 'folder', parentId, name: normalizedName, createdAt: t, updatedAt: t },
      [parentId]: { ...parent, updatedAt: monotonicUpdatedAt(parent, t) },
    },
  }
}

export function createProjectNode(state: ProjectFsState, parentId: string, payload: { name: string; projectId: string }): ProjectFsState {
  const parent = state.nodesById[parentId]
  if (!parent || parent.kind !== 'folder') throw new Error(`父目录 ${parentId} 不存在`)
  const projectId = requireNonEmptyString(payload.projectId, '项目 ID')
  const projectName = requireNonEmptyString(payload.name, '项目名称')
  const duplicate = Object.values(state.nodesById).find(
    (node) => node.kind === 'project' && node.projectId === projectId,
  )
  if (duplicate) throw new Error(`项目 ${projectId} 已存在于目录中`)
  const t = now()
  const id = uid('proj')
  return {
    ...state,
    nodesById: {
      ...state.nodesById,
      [id]: {
        id,
        kind: 'project',
        parentId,
        name: projectName,
        projectId,
        createdAt: t,
        updatedAt: t,
      },
      [parentId]: { ...parent, updatedAt: monotonicUpdatedAt(parent, t) },
    },
  }
}

export function renameNode(state: ProjectFsState, nodeId: string, name: string): ProjectFsState {
  const node = state.nodesById[nodeId]
  if (!node) throw new Error(`目录节点 ${nodeId} 不存在`)
  if (node.id === state.rootId) throw new Error('根目录不允许重命名')
  const normalizedName = requireNonEmptyString(name, '节点名称')
  const t = now()
  const renamedNode: ProjectFsNode = node.kind === 'folder'
    ? { ...node, name: normalizedName, updatedAt: monotonicUpdatedAt(node, t) }
    : { ...node, name: normalizedName, updatedAt: monotonicUpdatedAt(node, t) }
  return {
    ...state,
    nodesById: {
      ...state.nodesById,
      [nodeId]: renamedNode,
    },
  }
}

export function renameProjectNodes(state: ProjectFsState, projectId: string, name: string): ProjectFsState {
  const normalizedProjectId = requireNonEmptyString(projectId, '项目 ID')
  const normalizedName = requireNonEmptyString(name, '项目名称')
  const matchingNodes = Object.values(state.nodesById).filter(
    (node): node is ProjectFsProjectNode => node.kind === 'project' && node.projectId === normalizedProjectId,
  )
  if (matchingNodes.length === 0) throw new Error(`项目 ${normalizedProjectId} 的目录节点不存在`)
  if (matchingNodes.every((node) => node.name === normalizedName)) return state

  const updatedAt = now()
  const nodesById = { ...state.nodesById }
  for (const node of matchingNodes) {
    nodesById[node.id] = { ...node, name: normalizedName, updatedAt }
  }
  return { ...state, nodesById }
}

export function deleteProjectNodes(state: ProjectFsState, projectId: string): ProjectFsState {
  const normalizedProjectId = requireNonEmptyString(projectId, '项目 ID')
  const matchingNodeIds = Object.values(state.nodesById)
    .filter((node) => node.kind === 'project' && node.projectId === normalizedProjectId)
    .map((node) => node.id)
  if (matchingNodeIds.length === 0) return state

  const nodesById = { ...state.nodesById }
  for (const nodeId of matchingNodeIds) delete nodesById[nodeId]
  return { ...state, nodesById }
}

export function deleteNode(state: ProjectFsState, nodeId: string): ProjectFsState {
  if (nodeId === state.rootId) throw new Error('根目录不允许删除')
  const node = state.nodesById[nodeId]
  if (!node) throw new Error(`目录节点 ${nodeId} 不存在`)

  const nodesById = { ...state.nodesById }
  const toDelete: string[] = [nodeId]
  while (toDelete.length) {
    const id = toDelete.pop()!
    const n = nodesById[id]
    if (!n) continue
    delete nodesById[id]
    if (n.kind === 'folder') {
      for (const child of Object.values(nodesById)) {
        if (child.parentId === id) toDelete.push(child.id)
      }
    }
  }
  return { ...state, nodesById }
}

export function deleteEmptyFolder(state: ProjectFsState, folderId: string): ProjectFsState {
  if (folderId === state.rootId) throw new Error('根目录不允许删除')
  const folder = state.nodesById[folderId]
  if (!folder || folder.kind !== 'folder') throw new Error(`目录 ${folderId} 不存在`)
  if (Object.values(state.nodesById).some((node) => node.parentId === folderId)) {
    throw new Error('目录中仍有内容，请先移出后再删除')
  }
  const parent = folder.parentId ? state.nodesById[folder.parentId] : null
  if (!parent || parent.kind !== 'folder') throw new Error(`目录 ${folderId} 的父目录无效`)
  const nodesById = { ...state.nodesById }
  delete nodesById[folderId]
  nodesById[parent.id] = { ...parent, updatedAt: monotonicUpdatedAt(parent) }
  return { ...state, nodesById }
}

function isDescendantFolder(state: ProjectFsState, folderId: string, ancestorFolderId: string): boolean {
  let cur: string | null = folderId
  const seen = new Set<string>()
  while (cur) {
    if (seen.has(cur)) break
    seen.add(cur)
    if (cur === ancestorFolderId) return true
    const node: ProjectFsNode | undefined = state.nodesById[cur]
    if (!node || node.kind !== 'folder') break
    cur = node.parentId
  }
  return false
}

export function moveNode(state: ProjectFsState, nodeId: string, targetFolderId: string): ProjectFsState {
  const node = state.nodesById[nodeId]
  const target = state.nodesById[targetFolderId]
  if (!node) throw new Error(`目录节点 ${nodeId} 不存在`)
  if (!target || target.kind !== 'folder') throw new Error(`目标目录 ${targetFolderId} 不存在`)
  if (node.id === state.rootId) throw new Error('根目录不允许移动')
  if (node.id === targetFolderId) throw new Error('目录不能移动到自身')
  if (node.parentId === targetFolderId) throw new Error('目录节点已经位于目标目录')
  if (node.kind === 'folder' && isDescendantFolder(state, targetFolderId, node.id)) {
    throw new Error('目录不能移动到自己的子目录')
  }

  const t = now()
  const prevParentId = node.parentId
  const nextNodes: Record<string, ProjectFsNode> = {
    ...state.nodesById,
    [node.id]: {
      ...node,
      parentId: targetFolderId,
      updatedAt: monotonicUpdatedAt(node, t),
    } as ProjectFsNode,
    [targetFolderId]: {
      ...target,
      updatedAt: monotonicUpdatedAt(target, t),
    },
  }

  if (prevParentId) {
    const prevParent = state.nodesById[prevParentId]
    if (prevParent && prevParent.kind === 'folder') {
      nextNodes[prevParentId] = {
        ...prevParent,
        updatedAt: monotonicUpdatedAt(prevParent, t),
      }
    }
  }

  return {
    ...state,
    nodesById: nextNodes,
  }
}

export function ensureProjectNodesExist(state: ProjectFsState, projects: Array<{ id: string; name: string }>): ProjectFsState {
  const existing = new Map<string, ProjectFsProjectNode>()
  for (const node of Object.values(state.nodesById)) {
    if (node.kind === 'project') existing.set(node.projectId, node)
  }

  let nodesById = state.nodesById
  let changed = false
  let rootUpdatedAt: number | null = null
  const writableNodes = (): Record<string, ProjectFsNode> => {
    if (!changed) {
      nodesById = { ...nodesById }
      changed = true
    }
    return nodesById
  }
  for (const p of projects) {
    const projectId = requireNonEmptyString(p.id, '项目 ID')
    const projectName = requireNonEmptyString(p.name, `项目 ${projectId} 名称`)
    const currentNode = existing.get(projectId)
    if (currentNode) {
      if (currentNode.name !== projectName) {
        const updatedNode: ProjectFsProjectNode = {
          ...currentNode,
          name: projectName,
          updatedAt: monotonicUpdatedAt(currentNode),
        }
        writableNodes()[updatedNode.id] = updatedNode
        existing.set(projectId, updatedNode)
      }
      continue
    }
    const timestamp = now()
    let nodeId = uid('proj')
    while (nodesById[nodeId]) nodeId = uid('proj')
    const created: ProjectFsProjectNode = {
      id: nodeId,
      kind: 'project',
      parentId: state.rootId,
      name: projectName,
      projectId,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    writableNodes()[nodeId] = created
    rootUpdatedAt = Math.max(rootUpdatedAt ?? 0, timestamp)
    existing.set(projectId, created)
  }
  if (!changed) return state
  if (rootUpdatedAt !== null) {
    const root = nodesById[state.rootId]
    if (!root || root.kind !== 'folder') throw new Error('项目目录根节点无效')
    nodesById[state.rootId] = {
      ...root,
      updatedAt: monotonicUpdatedAt(root, rootUpdatedAt),
    }
  }
  return { ...state, nodesById }
}

export function findProjectNode(state: ProjectFsState, projectId: string): ProjectFsProjectNode | null {
  const normalizedProjectId = requireNonEmptyString(projectId, '项目 ID')
  return Object.values(state.nodesById).find(
    (node): node is ProjectFsProjectNode => node.kind === 'project' && node.projectId === normalizedProjectId,
  ) ?? null
}

export function placeProjectNode(
  state: ProjectFsState,
  targetFolderId: string,
  project: { id: string; name: string },
): ProjectFsState {
  const projectId = requireNonEmptyString(project.id, '项目 ID')
  const projectName = requireNonEmptyString(project.name, `项目 ${projectId} 名称`)
  const current = findProjectNode(state, projectId)
  if (!current) return createProjectNode(state, targetFolderId, { projectId, name: projectName })

  let next = current.name === projectName ? state : renameNode(state, current.id, projectName)
  const placed = findProjectNode(next, projectId)
  if (!placed) throw new Error(`项目 ${projectId} 的目录节点不存在`)
  if (placed.parentId !== targetFolderId) next = moveNode(next, placed.id, targetFolderId)
  return next
}

export function canMoveNode(state: ProjectFsState, nodeId: string, targetFolderId: string): boolean {
  const node = state.nodesById[nodeId]
  const target = state.nodesById[targetFolderId]
  if (!node || !target || target.kind !== 'folder') return false
  if (node.id === state.rootId || node.id === targetFolderId || node.parentId === targetFolderId) return false
  return node.kind !== 'folder' || !isDescendantFolder(state, targetFolderId, node.id)
}
