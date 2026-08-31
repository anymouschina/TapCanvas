import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import type { FlowDto, ProjectDto } from '../api/server'
import { buildSharePath, canCopySharedProject, listSharePromptEntries, pickInitialPublicFlowId, sanitizeReadonlyGraph } from './shareCanvasModel'

function createProject(isPublic: boolean): ProjectDto {
  return {
    id: 'project-1',
    name: '公开项目',
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    isPublic,
  }
}

describe('share canvas model', () => {
  it('builds project-level share links without chapter scope', () => {
    expect(buildSharePath({
      projectId: 'project/1',
      flowId: 'chapter:chapter/30',
    })).toBe('/share/project%2F1/chapter%3Achapter%2F30')
  })

  it('opens the first populated canvas instead of an empty project root', () => {
    const emptyRoot: FlowDto = {
      id: 'root-flow',
      name: '项目画布',
      data: { nodes: [], edges: [] },
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    }
    const populatedChapter: FlowDto = {
      ...emptyRoot,
      id: 'chapter:chapter-1',
      name: '第一章',
      ownerType: 'chapter',
      ownerId: 'chapter-1',
      data: {
        nodes: [{ id: 'chapter-node', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
      },
    }

    expect(pickInitialPublicFlowId([emptyRoot, populatedChapter])).toBe('chapter:chapter-1')
  })

  it('makes every canvas element non-editable and expands undersized groups', () => {
    const nodes: Array<Node<Record<string, unknown>>> = [
      {
        id: 'group-1',
        type: 'groupNode',
        position: { x: 0, y: 0 },
        width: 240,
        height: 160,
        data: {},
      },
      {
        id: 'node-1',
        type: 'taskNode',
        parentId: 'group-1',
        position: { x: 220, y: 140 },
        width: 120,
        height: 210,
        selected: true,
        data: {},
      },
    ]
    const edges: Array<Edge<Record<string, unknown>>> = [{
      id: 'edge-1',
      source: 'node-1',
      target: 'node-2',
      selected: true,
      data: {},
    }]

    const result = sanitizeReadonlyGraph({ nodes, edges })

    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'node-1',
        selected: false,
        draggable: false,
        selectable: false,
        focusable: false,
        connectable: false,
      }),
    ]))
    expect(result.nodes.find((node) => node.id === 'group-1')).toEqual(expect.objectContaining({
      width: 364,
      height: 374,
    }))
    expect(result.edges[0]).toEqual(expect.objectContaining({
      selected: false,
      selectable: false,
      focusable: false,
    }))
  })

  it('extracts readable prompt fields without inventing missing content', () => {
    const flow: FlowDto = {
      id: 'flow-1',
      name: '第一章',
      data: {
        nodes: [{
          id: 'node-1',
          type: 'taskNode',
          position: { x: 0, y: 0 },
          data: {
            label: '镜头一',
            prompt: '角色走进雨夜。',
            storyboard: '角色走进雨夜。',
            systemPrompt: '保持冷色调。',
          },
        }],
        edges: [],
      },
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    }

    expect(listSharePromptEntries(flow)).toEqual([{
      id: 'node-1',
      label: '镜头一',
      items: [
        { label: '提示词', value: '角色走进雨夜。' },
        { label: '系统提示词', value: '保持冷色调。' },
      ],
    }])
  })

  it('only exposes project copying for an authenticated viewer of a public project', () => {
    expect(canCopySharedProject(createProject(true), 'token')).toBe(true)
    expect(canCopySharedProject(createProject(true), null)).toBe(false)
    expect(canCopySharedProject(createProject(false), 'token')).toBe(false)
    expect(canCopySharedProject(null, 'token')).toBe(false)
  })
})
