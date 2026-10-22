import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { projectWorkbench } from './workbenchModel'

function task(id: string, data: Record<string, unknown> = {}): Node {
  return { id, type: 'taskNode', position: { x: 0, y: 0 }, data }
}

describe('canvas workbench projection', () => {
  it('categorizes structured asset types without interpreting labels, prompts or reference bindings', () => {
    const items = projectWorkbench([
      task('script', { kind: 'text', prompt: '正文' }),
      task('character', { kind: 'image', referenceType: 'character' }),
      task('ensemble', { kind: 'image', materialKind: 'ensemble' }),
      task('scene', { kind: 'image', referenceType: 'scene' }),
      task('prop', { kind: 'image', propProfileVersion: 'prop-card/v1' }),
      task('bound-image', { kind: 'image', sceneCardNodeId: 'scene', anchorBindings: [{ kind: 'scene' }], label: '角色卡', prompt: '场景卡' }),
      task('image', { kind: 'image', label: '分镜故事板', prompt: 'storyboard' }),
      task('shots', { kind: 'shotTable' }),
      task('board', { kind: 'storyboardImage' }),
      task('editor', { kind: 'image', storyboardEditorCells: [] }),
      task('clip', { kind: 'video', referenceType: 'scene' }),
      task('final', { kind: 'videoCompose' }),
      task('audio', { kind: 'audio' }),
    ], [])
    expect(Object.fromEntries(items.map((item) => [item.id, item.category]))).toEqual({
      script: 'script', character: 'character', ensemble: 'character', scene: 'scene', prop: 'prop',
      'bound-image': 'other', image: 'other', shots: 'storyboard', board: 'storyboard', editor: 'storyboard',
      clip: 'video', final: 'final', audio: 'audio',
    })
  })

  it('keeps unknown tasks and content visible while excluding workflow controls and groups', () => {
    const items = projectWorkbench([
      task('unknown', { kind: 'futureTask', label: '新任务', status: 'paused', errorMessage: '等待输入' }),
      task('missing-kind', { text: '保留内容' }),
      task('stage', { kind: 'workflowStage' }),
      task('trigger', { kind: 'workflowTrigger' }),
      { ...task('group'), type: 'groupNode' },
      { ...task('flow-group'), type: 'group' },
    ], [])
    expect(items.map((item) => item.id)).toEqual(['unknown', 'missing-kind'])
    expect(items[0]).toMatchObject({ category: 'other', canGenerate: false, status: 'paused', error: '等待输入' })
    expect(items[1]).toMatchObject({ text: '保留内容', hasResult: true })
  })

  it.each(['blocking_diagram', 'keyframe', 'design_board', 'master_board', 'preview'])(
    'categorizes the registered %s production layer as storyboard content', (productionLayer) => {
      const [item] = projectWorkbench([task('board', { kind: 'image', productionLayer })], [])
      expect(item.category).toBe('storyboard')
    },
  )

  it.each([
    'spatial_blocking', 'storyboard_stills', 'approved_keyframe_selection',
    'intent_generate_shot_design_board', 'story_preview', 'beat_keyframe',
  ])('categorizes the registered %s creation stage as storyboard content', (creationStage) => {
    const [item] = projectWorkbench([task('board', { kind: 'image', creationStage })], [])
    expect(item.category).toBe('storyboard')
  })

  it('keeps explicit reference assets ahead of production metadata and leaves generic anchors unclassified', () => {
    const items = projectWorkbench([
      task('character', { kind: 'image', referenceType: 'character', productionLayer: 'keyframe', creationStage: 'beat_keyframe' }),
      task('scene', { kind: 'image', referenceType: 'scene', productionLayer: 'preview', creationStage: 'story_preview' }),
      task('prop', { kind: 'image', referenceType: 'prop', productionLayer: 'design_board', creationStage: 'storyboard_stills' }),
      task('generic', { kind: 'image', productionLayer: 'anchors', creationStage: 'shot_anchor_lock' }),
      task('unknown-meta', { kind: 'image', productionLayer: 'keyframe_variant', creationStage: 'storyboard_stills_pending' }),
    ], [])
    expect(items.map((item) => item.category)).toEqual(['character', 'scene', 'prop', 'other', 'other'])
  })

  it('distinguishes the storyboardScript type from plain text without interpreting a clip label', () => {
    const items = projectWorkbench([
      task('storyboard-script', { kind: 'storyboardScript', content: '镜头一：推门' }),
      task('clip-text', { kind: 'text', label: 'Clip 01 · 视频片段', content: '推门入店' }),
    ], [])
    expect(items.map((item) => item.category)).toEqual(['storyboard', 'script'])
    expect(items.map((item) => item.hasResult)).toEqual([true, true])
  })

  it('requires a real result URL for the task media type, regardless of success status or prompt', () => {
    const items = projectWorkbench([
      task('image', { kind: 'image', status: 'success', prompt: '已设计', imageUrl: 'data:image/png;base64,abc', imageResults: [{ url: 'planned.png' }] }),
      task('video', { kind: 'video', status: 'success', imageUrl: 'https://assets.test/reference.png' }),
      task('audio', { kind: 'audio', status: 'success', videoUrl: 'https://assets.test/reference.mp4' }),
      task('ready', { kind: 'image', status: 'error', imageResults: [{ url: 'https://assets.test/kept.png' }], lastError: '新尝试失败' }),
    ], [])
    expect(items.map((item) => item.hasResult)).toEqual([false, false, false, true])
    expect(items[0].imageUrl).toBeNull()
    expect(items[3]).toMatchObject({ canGenerate: true, status: 'error', error: '新尝试失败' })
  })

  it('keeps a new attempt busy while preserving an existing successful asset', () => {
    const [item] = projectWorkbench([task('video', {
      kind: 'video', status: 'submitting', videoUrl: 'https://assets.test/old.mp4',
    })], [])
    expect(item).toMatchObject({ busy: true, status: 'submitting', hasResult: true, canGenerate: false,
      videoUrl: 'https://assets.test/old.mp4' })
  })

  it('retains local composed video and uploaded image object URLs as actual results', () => {
    const videoUrl = 'blob:http://localhost:5173/955ea35e-d946-4723-89c0-2037b2636d5c'
    const imageUrl = 'blob:https://app.test/e6754389-f7ef-4b41-b5ae-f85038ca020d'
    const items = projectWorkbench([
      task('final', { kind: 'videoCompose', status: 'success', videoUrl,
        videoResults: [{ url: videoUrl, title: '合成视频' }] }),
      task('upload', { kind: 'image', imageUrl }),
      task('board', { kind: 'storyboard', storyboardEditorCells: [{ imageUrl }] }),
    ], [])
    expect(items[0]).toMatchObject({ category: 'final', hasResult: true, videoUrl })
    expect(items[1]).toMatchObject({ hasResult: true, imageUrl })
    expect(items[2]).toMatchObject({ hasResult: true, imageUrl })
  })

  it.each(['blob:', 'blob:planned.png', 'blob:https://app.test/', 'planned.png', 'javascript:alert(1)'])(
    'does not treat an invalid media location %s as an output', (videoUrl) => {
      const [item] = projectWorkbench([task('final', { kind: 'videoCompose', status: 'success', videoUrl })], [])
      expect(item).toMatchObject({ hasResult: false, videoUrl: null })
    },
  )

  it('retains a valid inline image result without treating it as a video output', () => {
    const imageUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
    const items = projectWorkbench([
      task('inline', { kind: 'image', imageResults: [{ url: imageUrl }] }),
      task('board', { kind: 'storyboard', storyboardEditorCells: [{ imageUrl }] }),
      task('video', { kind: 'video', videoUrl: imageUrl }),
    ], [])
    expect(items[0]).toMatchObject({ hasResult: true, imageUrl })
    expect(items[1]).toMatchObject({ hasResult: true, imageUrl })
    expect(items[2]).toMatchObject({ hasResult: false, videoUrl: null })
  })

  it.each(['data:image/png;base64,', 'data:image/png;base64,abc', 'data:image/png;base64,???', 'data:text/plain;base64,SGVsbG8='])(
    'rejects an invalid inline image location %s', (imageUrl) => {
      const [item] = projectWorkbench([task('image', { kind: 'image', imageUrl })], [])
      expect(item).toMatchObject({ hasResult: false, imageUrl: null })
    },
  )

  it('projects append-only workflow attempts to one logical item with current status and dependency IDs', () => {
    const shared = { kind: 'image', workflowExecutionId: 'run', workflowExecutionFamilyId: 'family',
      workflowRuntimeNodeId: 'images', workflowObjectId: 'hero', referenceType: 'character' }
    const nodes = [
      task('script', { kind: 'text', text: '正文' }),
      task('source', { ...shared, status: 'success', imageUrl: 'https://assets.test/hero.png' }),
      task('retry', { ...shared, status: 'running', workflowMediaRetry: { canvasNodeId: 'source', retryIndex: 1 } }),
      task('video', { kind: 'video' }),
    ]
    const edges: Edge[] = [
      { id: 'in', source: 'script', target: 'retry' },
      { id: 'out', source: 'retry', target: 'video' },
      { id: 'duplicate', source: 'source', target: 'video' },
    ]
    const before = JSON.stringify({ nodes, edges })
    const items = projectWorkbench(nodes, edges)
    expect(items.map((item) => item.id)).toEqual(['script', 'source', 'video'])
    expect(items[1]).toMatchObject({ category: 'character', busy: true, hasResult: true,
      imageUrl: 'https://assets.test/hero.png', upstreamIds: ['script'] })
    expect(items[2].upstreamIds).toEqual(['source'])
    expect(JSON.stringify({ nodes, edges })).toBe(before)
  })

  it('does not merge distinct shared assets produced by the same workflow node', () => {
    const shared = { kind: 'image', workflowExecutionId: 'run', workflowRuntimeNodeId: 'assets' }
    const items = projectWorkbench([
      task('a', { ...shared, workflowObjectId: 'character-a' }),
      task('b', { ...shared, workflowObjectId: 'character-b' }),
    ], [])
    expect(items.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('preserves the current failed receipt state without claiming a delivered video', () => {
    const [item] = projectWorkbench([task('late', {
      kind: 'video', status: 'failed', workflowExecutionId: 'run', workflowRuntimeNodeId: 'clip', workflowEffectId: 'effect',
      taskId: 'receipt', videoTaskId: 'receipt', videoReceiptRecovery: { disposition: 'awaiting_late_result' },
      errorMessage: '原轮询超时',
    })], [])
    expect(item).toMatchObject({ status: 'failed', busy: false, hasResult: false, canGenerate: true, error: '原轮询超时' })
  })

  it('uses primary media results and actual storyboard cell assets', () => {
    const items = projectWorkbench([
      task('primary', { kind: 'image', imagePrimaryIndex: 1, imageUrl: 'https://assets.test/old.png',
        imageResults: [{ url: 'https://assets.test/a.png' }, { url: 'https://assets.test/b.png' }] }),
      task('board', { kind: 'storyboard', storyboardEditorCells: [{ prompt: '待生成' }, { imageUrl: 'https://assets.test/cell.png' }] }),
      task('empty-board', { kind: 'storyboard', storyboardEditorCells: [{ prompt: '待生成' }] }),
      task('audio', { kind: 'audio', audioResults: [{ url: 'https://assets.test/voice.mp3' }] }),
    ], [])
    expect(items.map((item) => item.imageUrl)).toEqual(['https://assets.test/b.png', 'https://assets.test/cell.png', null, null])
    expect(items.map((item) => item.hasResult)).toEqual([true, true, false, true])
    expect(items[3].audioUrl).toBe('https://assets.test/voice.mp3')
  })

  it('exposes text results without treating a generation instruction as an agent result', () => {
    const items = projectWorkbench([
      task('plain', { kind: 'text', prompt: '手写剧本' }),
      task('generated', { kind: 'codex', prompt: '生成剧本', textResults: [{ text: '第一稿' }, { text: '最终稿' }] }),
      task('pending', { kind: 'codex', prompt: '生成剧本' }),
      task('structured', { kind: 'scriptDoc', scriptDoc: { scenes: [{ action: '开门' }] } }),
    ], [])
    expect(items.map((item) => item.hasResult)).toEqual([true, true, false, true])
    expect(items[1].text).toBe('最终稿')
    expect(items.every((item) => !item.canGenerate)).toBe(true)
  })

  it('leaves canceled and failed media available for an explicit new attempt', () => {
    const items = projectWorkbench([
      task('canceled', { kind: 'image', status: 'canceled', workflowExecutionId: 'old-run' }),
      task('failed', { kind: 'video', status: 'failed', error: '供应商失败' }),
      task('readonly', { kind: 'audio', readOnly: true }),
      task('editing', { kind: 'shotTable' }),
    ], [])
    expect(items.map((item) => item.canGenerate)).toEqual([true, true, false, false])
    expect(items[1].error).toBe('供应商失败')
  })
})

describe('source text preservation', () => {
  it('preserves reference lines, repeated instructions and whitespace exactly', () => {
    const source = '  参考：@场景卡=室内\n声音只有对白。\n\n\n  镜头1：开门。  \n'
    const items = projectWorkbench([
      task('script', { kind: 'text', text: source }),
      task('clip', { kind: 'video', workflowSourcePrompt: source }),
    ], [])
    expect(items[0].text).toBe(source)
    expect(items[1].shotScript).toBe(source)
  })
})
