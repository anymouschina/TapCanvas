import { describe, it, expect } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import {
  categoryOfUnit,
  computeTidyByCategoryLayout,
  resolveTidySceneKeys,
  TIDY_CATEGORY_ORDER,
} from './tidyByCategory'

function task(id: string, data: Record<string, unknown>, pos = { x: 0, y: 0 }, extra: Partial<Node> = {}): Node {
  return { id, type: 'taskNode', position: pos, data, ...extra } as Node
}
function group(id: string, label: string, pos = { x: 0, y: 0 }, extra: Partial<Node> = {}): Node {
  return { id, type: 'groupNode', position: pos, data: { label }, width: 300, height: 200, ...extra } as Node
}

const childrenOf = (nodes: Node[]) => {
  const m = new Map<string, Node[]>()
  for (const n of nodes) {
    const pid = n.parentId
    if (!pid) continue
    m.set(pid, [...(m.get(pid) ?? []), n])
  }
  return m
}

describe('categoryOfUnit — 统一 schema 与资产事实驱动', () => {
  it('text kind → text，video kind → video，image kind → image', () => {
    expect(categoryOfUnit(task('a', { kind: 'text' }), new Map())).toBe('text')
    expect(categoryOfUnit(task('a', { kind: 'composeVideo' }), new Map())).toBe('video')
    expect(categoryOfUnit(task('a', { kind: 'imageEdit' }), new Map())).toBe('image')
  })
  it('audio kind → audio', () => {
    expect(categoryOfUnit(task('a', { kind: 'audio' }), new Map())).toBe('audio')
  })
  it('directorConsole 节点 → director（介于文本与图片之间）', () => {
    expect(categoryOfUnit({ id: 'd', type: 'directorConsole', position: { x: 0, y: 0 }, data: {} } as Node, new Map())).toBe('director')
  })
  it('schema 中新增的文档节点自动进入 text，不需要整理模块维护 kind 白名单', () => {
    expect(categoryOfUnit(task('analysis', { kind: 'videoAnalysis' }), new Map())).toBe('text')
    expect(categoryOfUnit(task('shots', { kind: 'shotTable' }), new Map())).toBe('text')
  })
  it('真实资产字段优先于未知 kind，自适应识别图片和视频', () => {
    expect(categoryOfUnit(task('image', { kind: 'futureImageTool', imageResults: [{ url: 'image-url' }] }), new Map())).toBe('image')
    expect(categoryOfUnit(task('video', { kind: 'futureVideoTool', videoUrl: 'video-url' }), new Map())).toBe('video')
  })
  it('新增的非 taskNode 内容节点也参与整理，ioNode 保持排除', () => {
    expect(categoryOfUnit({ id: 'future', type: 'futureNode', position: { x: 0, y: 0 }, data: {} } as Node, new Map())).toBe('text')
    expect(categoryOfUnit({ id: 'x', type: 'ioNode', position: { x: 0, y: 0 }, data: {} } as Node, new Map())).toBeNull()
  })
})

describe('categoryOfUnit — 组容器', () => {
  it('空组按文本整理，不根据 label 做语义猜测', () => {
    expect(categoryOfUnit(group('g', '任意标题'), new Map())).toBe('text')
  })
  it('label 无关键词 → 取子节点主流类别', () => {
    const g = group('g', '第一组')
    const kids = [
      task('c1', { kind: 'image', roleName: 'A' }, { x: 0, y: 0 }, { parentId: 'g' }),
      task('c2', { kind: 'image', roleName: 'B' }, { x: 0, y: 0 }, { parentId: 'g' }),
      task('c3', { kind: 'image', label: '场景-x' }, { x: 0, y: 0 }, { parentId: 'g' }),
    ]
    expect(categoryOfUnit(g, childrenOf([g, ...kids]))).toBe('image')
  })
})

describe('computeTidyByCategoryLayout', () => {
  it('按核心媒体类型分列：文本 → 图片 → 视频', () => {
    const nodes = [
      task('video1', { kind: 'video' }, { x: 700, y: 500 }),
      task('image1', { kind: 'image' }, { x: 500, y: 500 }),
      task('text1', { kind: 'shotTable' }, { x: 50, y: 50 }),
    ]
    const { positions } = computeTidyByCategoryLayout(nodes)
    expect(positions.get('text1')!.x).toBeLessThan(positions.get('image1')!.x)
    expect(positions.get('image1')!.x).toBeLessThan(positions.get('video1')!.x)
    // 锚点 = 包围盒左上角 (50,50)
    expect(positions.get('text1')!.x).toBe(50)
    expect(positions.get('text1')!.y).toBe(50)
  })

  it('同列多节点沿 y 累进、按原 y 排序', () => {
    const nodes = [
      task('c2', { kind: 'text' }, { x: 0, y: 300 }),
      task('c1', { kind: 'text' }, { x: 0, y: 100 }),
    ]
    const { positions } = computeTidyByCategoryLayout(nodes)
    // c1 原 y 更小 → 排在上面
    expect(positions.get('c1')!.y).toBeLessThan(positions.get('c2')!.y)
    expect(positions.get('c1')!.y).toBe(100) // anchorY
  })

  it('把没有外层组容器的已保存工作流作为一个左到右单元整理', () => {
    const workflowData = (kind: 'workflowTrigger' | 'workflowStage') => ({
      kind,
      adminWorkflow: true,
      workflowInstanceId: 'workflow-instance',
      nodeWidth: 56,
      nodeHeight: 56,
    })
    const nodes = [
      task('trigger', workflowData('workflowTrigger'), { x: 0, y: 0 }),
      task('agent', workflowData('workflowStage'), { x: 0, y: 100 }),
      task('finish', workflowData('workflowStage'), { x: 0, y: 200 }),
      task('agent-skill', {
        ...workflowData('workflowStage'),
        workflowRuntimeReference: true,
        workflowRuntimeReferenceKind: 'skill',
        workflowRuntimeReferenceOwnerNodeId: 'agent',
      }, { x: 0, y: 300 }),
      task('agent-knowledge', {
        ...workflowData('workflowStage'),
        workflowRuntimeReference: true,
        workflowRuntimeReferenceKind: 'knowledge',
        workflowRuntimeReferenceOwnerNodeId: 'agent',
      }, { x: 0, y: 400 }),
    ]
    const edges: Edge[] = [
      { id: 'trigger-agent', source: 'trigger', target: 'agent' },
      { id: 'agent-finish', source: 'agent', target: 'finish' },
      { id: 'skill-agent', source: 'agent-skill', target: 'agent' },
      { id: 'knowledge-agent', source: 'agent-knowledge', target: 'agent' },
    ]

    const { positions } = computeTidyByCategoryLayout(nodes, edges)

    expect(positions.get('trigger')!.x).toBeLessThan(positions.get('agent')!.x)
    expect(positions.get('agent')!.x).toBeLessThan(positions.get('finish')!.x)
    expect(positions.get('trigger')!.y).toBe(positions.get('agent')!.y)
    expect(positions.get('agent-skill')!.y).toBeGreaterThan(positions.get('agent')!.y)
    expect(positions.get('agent-knowledge')!.y).toBe(positions.get('agent-skill')!.y)
    expect(positions.get('agent-skill')!.x).toBeLessThan(positions.get('agent')!.x)
    expect(positions.get('agent-knowledge')!.x).toBeGreaterThan(positions.get('agent')!.x)
  })

  it('组容器参与整理；组内子节点不在结果里（随父跟随）', () => {
    const g = group('g', '视频组', { x: 800, y: 800 })
    const kid = task('k', { kind: 'video' }, { x: 10, y: 10 }, { parentId: 'g' })
    const text = task('text', { kind: 'text' }, { x: 0, y: 0 })
    const { positions } = computeTidyByCategoryLayout([g, kid, text])
    expect(positions.has('g')).toBe(true)
    expect(positions.has('k')).toBe(false) // 子节点不动
    expect(positions.get('g')!.x).toBeGreaterThan(positions.get('text')!.x)
  })

  it('全部不可分类 → 空结果', () => {
    const nodes = [{ id: 'x', type: 'ioNode', position: { x: 0, y: 0 }, data: {} } as Node]
    expect(computeTidyByCategoryLayout(nodes).positions.size).toBe(0)
  })

  it('directorConsole 参与整理：介于 text 与 image 之间、在 audio 之后', () => {
    const nodes = [
      task('img', { kind: 'image', label: '随手一张' }, { x: 0, y: 0 }),
      { id: 'dir', type: 'directorConsole', position: { x: 0, y: 0 }, data: {} } as Node,
      task('aud', { kind: 'audio' }, { x: 0, y: 0 }),
      task('txt', { kind: 'text' }, { x: 0, y: 0 }),
    ]
    const { positions } = computeTidyByCategoryLayout(nodes)
    const tx = positions.get('txt')!.x
    const ax = positions.get('aud')!.x
    const dx = positions.get('dir')!.x
    const ix = positions.get('img')!.x
    expect(tx).toBeLessThan(ax)
    expect(ax).toBeLessThan(dx)
    expect(dx).toBeLessThan(ix)
  })

  it('TIDY_CATEGORY_ORDER 保证主要产物从左到右为文本、图片、视频', () => {
    expect(TIDY_CATEGORY_ORDER).toEqual(['text', 'audio', 'director', 'image', 'video'])
  })
})

describe('computeTidyByCategoryLayout — 场景聚合与网格', () => {
  const sceneA = task('scA', { kind: 'scene', referenceType: 'scene', label: '教室', imageUrl: 'u' }, { x: 0, y: 0 })
  const sceneB = task('scB', { kind: 'scene', referenceType: 'scene', label: '操场', imageUrl: 'u' }, { x: 0, y: 100 })
  const imgOf = (id: string, label: string, y = 0) =>
    task(id, { kind: 'image', imageUrl: 'u', anchorBindings: [{ kind: 'scene', label }] }, { x: 500, y })

  it('同场景图片聚簇同行横排;不同场景簇纵向分隔', () => {
    const nodes = [sceneA, sceneB, imgOf('a1', '教室', 0), imgOf('a2', '教室', 10), imgOf('b1', '操场', 20)]
    const { positions } = computeTidyByCategoryLayout(nodes)
    // 同簇同行:a1/a2 同 y,a2 在 a1 右侧
    expect(positions.get('a2')!.y).toBe(positions.get('a1')!.y)
    expect(positions.get('a2')!.x).toBeGreaterThan(positions.get('a1')!.x)
    // 场景A簇在场景B簇上方(sceneOrder 按场景卡 y 序)
    expect(positions.get('b1')!.y).toBeGreaterThan(positions.get('a1')!.y)
    // b1 回到列起点 x
    expect(positions.get('b1')!.x).toBe(positions.get('a1')!.x)
  })

  it('簇内每行最多 3 个(场景卡领头占一格),第 3 个产物换行回簇左缘', () => {
    const nodes = [sceneA, ...[1, 2, 3, 4, 5].map((i) => imgOf(`i${i}`, '教室', i))]
    const { positions } = computeTidyByCategoryLayout(nodes)
    // 行1 = [场景卡, i1, i2];i3 换行
    expect(positions.get('i2')!.y).toBe(positions.get('i1')!.y)
    expect(positions.get('i3')!.y).toBeGreaterThan(positions.get('i1')!.y)
    expect(positions.get('i3')!.x).toBe(positions.get('scA')!.x) // 回簇左缘
    // 行2 = [i3, i4, i5] 同一行
    expect(positions.get('i5')!.y).toBe(positions.get('i3')!.y)
    expect(positions.get('i5')!.x).toBeGreaterThan(positions.get('i4')!.x)
  })

  it('audio 不参与场景聚合:配音卡竖排单列', () => {
    const au1 = task('au1', { kind: 'audio', label: '配音卡｜玄甲刀客' }, { x: 0, y: 0 })
    const au2 = task('au2', { kind: 'audio', label: '配音卡｜赤衣女刺客' }, { x: 0, y: 10 })
    const { positions } = computeTidyByCategoryLayout([au1, au2])
    expect(positions.get('au2')!.x).toBe(positions.get('au1')!.x)
    expect(positions.get('au2')!.y).toBeGreaterThan(positions.get('au1')!.y)
  })

  it('归档旧版进同簇、排在活跃版之后', () => {
    const img = imgOf('img1', '教室')
    const old = task('arc1', { kind: 'image', imageUrl: 'u', archivedFromNodeId: 'img1', archivedAt: '2026-07-01T00:00:00Z' }, { x: 0, y: 0 })
    const { positions } = computeTidyByCategoryLayout([sceneA, img, old])
    // 同簇同行:同 y,归档在右
    expect(positions.get('arc1')!.y).toBe(positions.get('img1')!.y)
    expect(positions.get('arc1')!.x).toBeGreaterThan(positions.get('img1')!.x)
  })

  it('无场景信号的图落同列尾部未归类,在场景簇之后', () => {
    // pinned 走 sceneCardNodeId 预留位归属场景A;stray 无信号 → 未归类殿后(同 image 列)
    const pinned = task('pin1', { kind: 'image', imageUrl: 'u', sceneCardNodeId: 'scA' }, { x: 500, y: 0 })
    const stray = task('stray', { kind: 'image', imageUrl: 'u', label: '随手一张' }, { x: 500, y: 0 })
    const { positions } = computeTidyByCategoryLayout([sceneA, pinned, stray])
    expect(positions.get('stray')!.y).toBeGreaterThan(positions.get('pin1')!.y)
  })

  it('视频列靠入边归属场景簇(传 edges)', () => {
    const v1 = task('v1', { kind: 'video' }, { x: 900, y: 0 })
    const v2 = task('v2', { kind: 'video' }, { x: 900, y: 10 })
    const edges = [{ id: 'e1', source: 'scA', target: 'v1' }] as Edge[]
    const { positions } = computeTidyByCategoryLayout([sceneA, v1, v2], edges)
    // v1 归场景A簇,v2 未归类在其下
    expect(positions.get('v2')!.y).toBeGreaterThan(positions.get('v1')!.y)
  })

  it('同类图片节点保持在图片列，并按统一图片网格聚合', () => {
    const c1 = task('c1', { kind: 'image', roleName: 'A' }, { x: 0, y: 0 })
    const c2 = task('c2', { kind: 'image', roleName: 'B' }, { x: 0, y: 10 })
    const { positions } = computeTidyByCategoryLayout([c1, c2])
    expect(positions.get('c2')!.x).toBeGreaterThan(positions.get('c1')!.x)
    expect(positions.get('c2')!.y).toBe(positions.get('c1')!.y)
  })
})

describe('resolveTidySceneKeys — 场景归属解析', () => {
  const sceneCard = task('sc1', { kind: 'scene', referenceType: 'scene', label: '教室' }, { x: 0, y: 0 })
  it('场景卡自己领自己的簇', () => {
    const keys = resolveTidySceneKeys([sceneCard], [])
    expect(keys.get('sc1')).toBe('sc1')
  })
  it('图片按 scene binding label 匹配场景卡', () => {
    const img = task('img1', { kind: 'image', anchorBindings: [{ kind: 'scene', label: '教室' }] })
    const keys = resolveTidySceneKeys([sceneCard, img], [])
    expect(keys.get('img1')).toBe('sc1')
  })
  it('视频靠入边 场景卡→视频 归属', () => {
    const vid = task('v1', { kind: 'video' })
    const edges = [{ id: 'e1', source: 'sc1', target: 'v1' }] as Edge[]
    const keys = resolveTidySceneKeys([sceneCard, vid], edges)
    expect(keys.get('v1')).toBe('sc1')
  })
  it('归档节点通过 archivedFromNodeId 回链继承场景', () => {
    const img = task('img1', { kind: 'image', anchorBindings: [{ kind: 'scene', label: '教室' }] })
    const old = task('arc1', { kind: 'image', archivedFromNodeId: 'img1', archivedAt: '2026-07-01T00:00:00Z' })
    const keys = resolveTidySceneKeys([sceneCard, img, old], [])
    expect(keys.get('arc1')).toBe('sc1')
  })
  it('无任何信号 → null(未归类)', () => {
    const img = task('img1', { kind: 'image', label: '随手一张' })
    const keys = resolveTidySceneKeys([sceneCard, img], [])
    expect(keys.get('img1')).toBeNull()
  })
  it('真实场景卡形态:kind=image+label「场景卡｜X」也识别为卡;产物按场景名匹配', () => {
    // 线上场景卡无 referenceType/anchorBindings,唯一信号是 label 前缀(全角｜)
    const realCard = task('rc1', { kind: 'image', imageUrl: 'u', label: '场景卡｜废墟古刹雨夜' }, { x: 0, y: 0 })
    const img = task('img1', { kind: 'image', imageUrl: 'u', anchorBindings: [{ kind: 'scene', label: '废墟古刹雨夜' }] })
    const keys = resolveTidySceneKeys([realCard, img], [])
    expect(keys.get('rc1')).toBe('rc1')
    expect(keys.get('img1')).toBe('rc1')
  })
  it('data.sceneCardNodeId 预留位优先于 binding', () => {
    const sc2 = task('sc2', { kind: 'scene', referenceType: 'scene', label: '操场' })
    const img = task('img1', { kind: 'image', sceneCardNodeId: 'sc2', anchorBindings: [{ kind: 'scene', label: '教室' }] })
    const keys = resolveTidySceneKeys([sceneCard, sc2, img], [])
    expect(keys.get('img1')).toBe('sc2')
  })
})
