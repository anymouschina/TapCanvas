import { describe, expect, it } from 'vitest'
import { sanitizeGraphForCanvas } from '../../src/canvas/store'
import { deserializeCanvas, extractCanvasGraph } from '../../src/canvas/utils/serialization'

const apiCanvasPayload = {
  code: 0,
  data: {
    id: 'canvas-1',
    nodes: [
      {
        id: 'group-1',
        type: 'group',
        extent: '',
        sourcePosition: '',
        targetPosition: '',
        position: { x: 120, y: 80 },
        data: {
          title: '分镜大师',
        },
      },
      {
        id: 'image-1',
        type: 'image',
        parentId: 'group-1',
        extent: 'parent',
        position: { x: 40, y: 60 },
        data: {
          title: '场景1',
          src: 'https://example.com/image.png',
          options: ['https://example.com/image.png'],
        },
      },
      {
        id: 'text-1',
        type: 'text',
        position: { x: 420, y: 60 },
        data: {
          title: '脚本分镜设计',
          text: '镜头1：车辆冲出沙漠',
        },
      },
      {
        id: 'video-1',
        type: 'video',
        position: { x: 420, y: 320 },
        data: {
          title: '首尾帧-跟随镜头',
          src: 'https://example.com/video.mp4',
          options: ['https://example.com/video.mp4'],
        },
      },
    ],
    connections: [
      {
        id: 'edge-1',
        source: 'group-1',
        target: 'image-1',
        type: 'default',
      },
    ],
  },
}

const apiCanvasPayloadWithLegacyHandles = {
  code: 0,
  data: {
    id: 'canvas-legacy-handles',
    nodes: [
      {
        id: 'group-1',
        type: 'group',
        position: { x: 0, y: 0 },
        data: { title: '线稿上色' },
      },
      {
        id: 'text-1',
        type: 'text',
        parentId: 'group-1',
        position: { x: 40, y: 40 },
        data: {
          title: '颜色说明',
          text: '使用指定色板上色',
        },
      },
      {
        id: 'image-1',
        type: 'image',
        parentId: 'group-1',
        position: { x: 40, y: 260 },
        data: {
          title: '角色线稿',
          src: 'https://example.com/line.png',
          options: ['https://example.com/line.png'],
        },
      },
      {
        id: 'image-2',
        type: 'image',
        parentId: 'group-1',
        position: { x: 420, y: 180 },
        data: {
          title: '上色结果',
          src: 'https://example.com/color.png',
          options: ['https://example.com/color.png'],
        },
      },
    ],
    connections: [
      {
        id: 'edge-text-image',
        source: 'text-1',
        sourceHandle: 'right',
        target: 'image-2',
        targetHandle: 'left',
        type: 'default',
      },
      {
        id: 'edge-image-image',
        source: 'image-1',
        sourceHandle: 'right',
        target: 'image-2',
        targetHandle: 'left',
        type: 'default',
      },
    ],
  },
}

describe('canvas import compatibility', () => {
  it('extracts nodes and connections from api-style payload', () => {
    const extracted = extractCanvasGraph(apiCanvasPayload)

    expect(extracted).not.toBeNull()
    expect(extracted?.nodes).toHaveLength(4)
    expect(extracted?.edges).toHaveLength(1)
    expect(extracted?.edges[0]?.source).toBe('group-1')
    expect(extracted?.edges[0]?.target).toBe('image-1')
  })

  it('normalizes api-style group nodes for canvas usage', () => {
    const sanitized = sanitizeGraphForCanvas(apiCanvasPayload)
    const groupNode = sanitized.nodes.find((node) => node.id === 'group-1')
    const childNode = sanitized.nodes.find((node) => node.id === 'image-1')
    const textNode = sanitized.nodes.find((node) => node.id === 'text-1')
    const videoNode = sanitized.nodes.find((node) => node.id === 'video-1')

    expect(groupNode?.type).toBe('groupNode')
    expect(groupNode?.extent).toBeUndefined()
    expect(groupNode?.sourcePosition).toBeUndefined()
    expect(groupNode?.targetPosition).toBeUndefined()
    expect(childNode?.parentId).toBe('group-1')
    expect(childNode?.type).toBe('taskNode')
    expect(childNode?.data).toMatchObject({
      kind: 'image',
      imageUrl: 'https://example.com/image.png',
    })
    expect(textNode?.type).toBe('taskNode')
    expect(textNode?.data).toMatchObject({
      kind: 'text',
      prompt: '镜头1：车辆冲出沙漠',
    })
    expect(videoNode?.type).toBe('taskNode')
    expect(videoNode?.data).toMatchObject({
      kind: 'video',
      videoUrl: 'https://example.com/video.mp4',
    })
    expect(sanitized.edges).toHaveLength(1)
  })

  it('deserializes api-style payloads as standard serialized canvas data', () => {
    const deserialized = deserializeCanvas(JSON.stringify(apiCanvasPayload))

    expect(deserialized.version).toBe('1.0.0')
    expect(typeof deserialized.timestamp).toBe('number')
    expect(deserialized.nodes).toHaveLength(4)
    expect(deserialized.edges).toHaveLength(1)
  })

  it('keeps legacy left/right handles when importing api-style connections', () => {
    const sanitized = sanitizeGraphForCanvas(apiCanvasPayloadWithLegacyHandles)

    expect(sanitized.edges).toHaveLength(2)
    expect(sanitized.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'edge-text-image',
          source: 'text-1',
          target: 'image-2',
          sourceHandle: 'out-text-wide',
          targetHandle: 'in-image-wide',
        }),
        expect.objectContaining({
          id: 'edge-image-image',
          source: 'image-1',
          target: 'image-2',
          sourceHandle: 'out-image-wide',
          targetHandle: 'in-image-wide',
        }),
      ]),
    )
  })

  it('hydrates task text nodes that only provide data.text', () => {
    const sanitized = sanitizeGraphForCanvas({
      nodes: [
        {
          id: 'task-text-1',
          type: 'taskNode',
          position: { x: 420, y: 0 },
          data: {
            kind: 'text',
            label: 'CG画风参考词',
            text: '电影级写实CG角色风格参考图',
          },
        },
      ],
      edges: [],
    })

    expect(sanitized.nodes).toEqual([
      expect.objectContaining({
        id: 'task-text-1',
        type: 'taskNode',
        data: expect.objectContaining({
          kind: 'text',
          text: '电影级写实CG角色风格参考图',
          prompt: '电影级写实CG角色风格参考图',
          textResults: [{ text: '电影级写实CG角色风格参考图' }],
        }),
      }),
    ])
  })
})
