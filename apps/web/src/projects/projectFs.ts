export type ProjectFsFolderNode = {
  id: string
  kind: 'folder'
  parentId: string | null
  name: string
  createdAt: number
  updatedAt: number
}

export type ProjectFsProjectNode = {
  id: string
  kind: 'project'
  parentId: string
  name: string
  projectId: string
  createdAt: number
  updatedAt: number
}

export type ProjectFsNode = ProjectFsFolderNode | ProjectFsProjectNode

export type ProjectFsState = {
  version: 1
  rootId: string
  nodesById: Record<string, ProjectFsNode>
}

const STORAGE_PREFIX = 'tapcanvas-project-fs:v1:'

function now() {
  return Date.now()
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Math.random().toString(36).slice(2, 10)}`
}

export function storageKeyForUser(userId: string) {
  return `${STORAGE_PREFIX}${String(userId || 'anon')}`
}

export function loadProjectFs(userId: string): ProjectFsState {
  if (typeof localStorage === 'undefined') return createDefaultFs()
  const key = storageKeyForUser(userId)
  const parsed = safeParse<ProjectFsState>(localStorage.getItem(key))
  const normalized = normalizeState(parsed)
  return normalized
}

export function saveProjectFs(userId: string, state: ProjectFsState) {
  if (typeof localStorage === 'undefined') return
  const key = storageKeyForUser(userId)
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    // ignore
  }
}

export function createDefaultFs(): ProjectFsState {
  const rootId = 'root'
  const t = now()
  return {
    version: 1,
    rootId,
    nodesById: {
      [rootId]: { id: rootId, kind: 'folder', parentId: null, name: '项目', createdAt: t, updatedAt: t },
    },
  }
}

function normalizeState(input: ProjectFsState | null): ProjectFsState {
  if (!input || input.version !== 1 || !input.rootId || !input.nodesById) {
    return createDefaultFs()
  }
  const root = input.nodesById[input.rootId]
  if (!root || root.kind !== 'folder') {
    return createDefaultFs()
  }
  if (root.name !== '项目') {
    return {
      ...input,
      nodesById: {
        ...input.nodesById,
        [input.rootId]: { ...root, name: '项目' },
      },
    }
  }
  return input
}

export function listChildren(state: ProjectFsState, folderId: string): ProjectFsNode[] {
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

export function pathToRoot(state: ProjectFsState, folderId: string): ProjectFsFolderNode[] {
  const chain: ProjectFsFolderNode[] = []
  let cur: string | null = folderId
  const seen = new Set<string>()
  while (cur) {
    if (seen.has(cur)) break
    seen.add(cur)
    const n: ProjectFsNode | undefined = state.nodesById[cur]
    if (!n || n.kind !== 'folder') break
    chain.push(n)
    cur = n.parentId
  }
  return chain.reverse()
}

export function createFolder(state: ProjectFsState, parentId: string, name: string): ProjectFsState {
  const parent = state.nodesById[parentId]
  if (!parent || parent.kind !== 'folder') return state
  const t = now()
  const id = uid('dir')
  return {
    ...state,
    nodesById: {
      ...state.nodesById,
      [id]: { id, kind: 'folder', parentId, name: name.trim() || '未命名', createdAt: t, updatedAt: t },
      [parentId]: { ...parent, updatedAt: t },
    },
  }
}

export function createProjectNode(state: ProjectFsState, parentId: string, payload: { name: string; projectId: string }): ProjectFsState {
  const parent = state.nodesById[parentId]
  if (!parent || parent.kind !== 'folder') return state
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
        name: payload.name.trim() || '未命名',
        projectId: String(payload.projectId),
        createdAt: t,
        updatedAt: t,
      },
      [parentId]: { ...parent, updatedAt: t },
    },
  }
}

export function renameNode(state: ProjectFsState, nodeId: string, name: string): ProjectFsState {
  const node = state.nodesById[nodeId]
  if (!node) return state
  const t = now()
  return {
    ...state,
    nodesById: {
      ...state.nodesById,
      [nodeId]: { ...node, name: name.trim() || node.name, updatedAt: t } as any,
    },
  }
}

export function deleteNode(state: ProjectFsState, nodeId: string): ProjectFsState {
  if (nodeId === state.rootId) return state
  const node = state.nodesById[nodeId]
  if (!node) return state

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
  if (!node || !target || target.kind !== 'folder') return state
  if (node.id === state.rootId) return state
  if (node.id === targetFolderId) return state
  if (node.parentId === targetFolderId) return state
  if (node.kind === 'folder' && isDescendantFolder(state, targetFolderId, node.id)) {
    return state
  }

  const t = now()
  const prevParentId = node.parentId
  const nextNodes: Record<string, ProjectFsNode> = {
    ...state.nodesById,
    [node.id]: {
      ...node,
      parentId: targetFolderId,
      updatedAt: t,
    } as ProjectFsNode,
    [targetFolderId]: {
      ...target,
      updatedAt: t,
    },
  }

  if (prevParentId) {
    const prevParent = state.nodesById[prevParentId]
    if (prevParent && prevParent.kind === 'folder') {
      nextNodes[prevParentId] = { ...prevParent, updatedAt: t }
    }
  }

  return {
    ...state,
    nodesById: nextNodes,
  }
}

export function ensureProjectNodesExist(state: ProjectFsState, projects: Array<{ id: string; name: string }>): ProjectFsState {
  const existing = new Set<string>()
  for (const node of Object.values(state.nodesById)) {
    if (node.kind === 'project') existing.add(node.projectId)
  }

  let next = state
  for (const p of projects) {
    if (!p?.id) continue
    if (existing.has(p.id)) continue
    next = createProjectNode(next, next.rootId, { projectId: p.id, name: p.name || `项目 ${p.id}` })
  }
  return next
}
