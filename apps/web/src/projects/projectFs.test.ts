import { describe, expect, it } from 'vitest'
import {
  buildProjectFsIndex,
  canMoveNode,
  createFolder,
  deleteEmptyFolder,
  deleteProjectNodes,
  ensureProjectNodesExist,
  moveNode,
  parseProjectFsState,
  pathToRoot,
  placeProjectNode,
  renameProjectNodes,
  type ProjectFsState,
} from './projectFs'

function createState(): ProjectFsState {
  return {
    version: 1,
    rootId: 'root',
    nodesById: {
      root: {
        id: 'root',
        kind: 'folder',
        parentId: null,
        name: '项目',
        createdAt: 1,
        updatedAt: 1,
      },
      'folder-a': {
        id: 'folder-a',
        kind: 'folder',
        parentId: 'root',
        name: '甲组',
        createdAt: 2,
        updatedAt: 2,
      },
      'folder-b': {
        id: 'folder-b',
        kind: 'folder',
        parentId: 'folder-a',
        name: '乙组',
        createdAt: 3,
        updatedAt: 3,
      },
      'folder-empty': {
        id: 'folder-empty',
        kind: 'folder',
        parentId: 'root',
        name: '空组',
        createdAt: 4,
        updatedAt: 4,
      },
      'project-a': {
        id: 'project-a',
        kind: 'project',
        parentId: 'root',
        name: '第一画布',
        projectId: 'project-1',
        createdAt: 5,
        updatedAt: 5,
      },
    },
  }
}

describe('project directory state operations', () => {
  it('builds a direct-child and project index without scanning at read sites', () => {
    const index = buildProjectFsIndex(createState())

    expect(index.childrenByFolderId.get('root')?.map((node) => node.id)).toEqual([
      'folder-a',
      'folder-empty',
      'project-a',
    ])
    expect(index.projectNodeByProjectId.get('project-1')?.id).toBe('project-a')
  })

  it('moves a project into a folder and preserves the original state object', () => {
    const initial = createState()
    const moved = moveNode(initial, 'project-a', 'folder-a')

    expect(moved).not.toBe(initial)
    expect(moved.nodesById['project-a']?.parentId).toBe('folder-a')
    expect(initial.nodesById['project-a']?.parentId).toBe('root')
  })

  it('blocks moving a folder into its own descendant', () => {
    const state = createState()

    expect(canMoveNode(state, 'folder-a', 'folder-b')).toBe(false)
    expect(() => moveNode(state, 'folder-a', 'folder-b')).toThrow('目录不能移动到自己的子目录')
  })

  it('only deletes an empty folder', () => {
    const state = createState()

    expect(() => deleteEmptyFolder(state, 'folder-a')).toThrow('目录中仍有内容')
    const next = deleteEmptyFolder(state, 'folder-empty')
    expect(next.nodesById['folder-empty']).toBeUndefined()
    expect(state.nodesById['folder-empty']).toBeDefined()
  })

  it('renames and relocates an existing project node instead of duplicating it', () => {
    const state = createState()
    const next = placeProjectNode(state, 'folder-b', {
      id: 'project-1',
      name: '第一画布（新名称）',
    })

    const matching = Object.values(next.nodesById).filter(
      (node) => node.kind === 'project' && node.projectId === 'project-1',
    )
    expect(matching).toHaveLength(1)
    expect(matching[0]).toMatchObject({
      id: 'project-a',
      name: '第一画布（新名称）',
      parentId: 'folder-b',
    })
  })

  it('renames and deletes project directory nodes by canonical project id', () => {
    const state = createState()
    const renamed = renameProjectNodes(state, 'project-1', '新的画布名称')
    const removed = deleteProjectNodes(renamed, 'project-1')

    expect(renamed.nodesById['project-a']).toMatchObject({ name: '新的画布名称' })
    expect(state.nodesById['project-a']).toMatchObject({ name: '第一画布' })
    expect(removed.nodesById['project-a']).toBeUndefined()
  })

  it('returns the same state reference when project reconciliation has no work', () => {
    const state = createState()
    const next = ensureProjectNodesExist(state, [{ id: 'project-1', name: '第一画布' }])

    expect(next).toBe(state)
  })

  it('keeps reconciliation timestamps valid when the server clock is ahead', () => {
    const futureTimestamp = Date.now() + 60_000
    const state = createState()
    const skewedState: ProjectFsState = {
      ...state,
      nodesById: {
        ...state.nodesById,
        root: {
          ...state.nodesById.root,
          createdAt: futureTimestamp,
          updatedAt: futureTimestamp,
        },
      },
    }

    const next = ensureProjectNodesExist(skewedState, [
      { id: 'project-1', name: '第一画布' },
      { id: 'project-2', name: '第二画布' },
    ])

    expect(next.nodesById.root?.updatedAt).toBe(futureTimestamp)
    expect(() => parseProjectFsState(next)).not.toThrow()
  })

  it('resolves a folder path back to the canonical root', () => {
    expect(pathToRoot(createState(), 'folder-b').map((folder) => folder.id)).toEqual([
      'root',
      'folder-a',
      'folder-b',
    ])
  })

  it('rejects invalid names before generating a new node id', () => {
    expect(() => createFolder(createState(), 'root', '   ')).toThrow('目录名称 必须是非空字符串')
  })

  it('rejects a persisted node that cannot reach the root', () => {
    const state = createState()
    const invalid = {
      ...state,
      nodesById: {
        ...state.nodesById,
        'folder-a': {
          ...state.nodesById['folder-a'],
          parentId: 'missing-folder',
        },
      },
    }

    expect(() => parseProjectFsState(invalid)).toThrow()
  })
})
