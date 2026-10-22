import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { buildPipelineStageRelations, PIPELINE_STAGES, projectPipelineStages } from './pipelineStages'
import { projectWorkbench, type WorkbenchCategory, type WorkbenchItem } from './workbenchModel'

function item(id: string, category: WorkbenchCategory, values: Partial<WorkbenchItem> = {}): WorkbenchItem {
  return {
    id, category, label: id, kind: '', status: 'idle', busy: false,
    imageUrl: null, videoUrl: null, audioUrl: null, text: '', error: null,
    hasResult: false, canGenerate: false, upstreamIds: [],
    clipIds: [], clipIndex: null, shotScript: '', durationSeconds: null, sceneRefs: [], ...values,
  }
}

function task(id: string, data: Record<string, unknown>): Node {
  return { id, type: 'taskNode', position: { x: 0, y: 0 }, data }
}

describe('pipeline stage projection', () => {
  it('groups every category in five ordered stages while retaining item order and unknown assets', () => {
    const items = [
      item('script', 'script'), item('scene', 'scene'), item('character', 'character'),
      item('prop', 'prop'), item('other', 'other', { label: '最终成片', text: '分镜设计' }),
      item('storyboard', 'storyboard'), item('video', 'video'), item('audio', 'audio'), item('final', 'final'),
    ]
    const before = JSON.stringify(items)
    const stages = projectPipelineStages(items)
    expect(stages.map((stage) => [stage.id, stage.label, stage.items.map((entry) => entry.id)])).toEqual([
      ['script', '故事剧本', ['script']],
      ['assets', '角色与场景', ['scene', 'character', 'prop', 'other']],
      ['storyboard', '分镜设计', ['storyboard']],
      ['clips', '视频片段', ['video', 'audio']],
      ['delivery', '最终成片', ['final']],
    ])
    expect(stages.flatMap((stage) => stage.items)).toHaveLength(items.length)
    expect(PIPELINE_STAGES.flatMap((stage) => stage.categories)).toHaveLength(9)
    expect(JSON.stringify(items)).toBe(before)
  })

  it('reports empty stages without claiming a required dependency or workflow completion', () => {
    expect(projectPipelineStages([]).map((stage) => ({
      items: stage.items, readyCount: stage.readyCount, busyCount: stage.busyCount,
      issueCount: stage.issueCount, statusLabel: stage.statusLabel,
    }))).toEqual(Array.from({ length: 5 }, () => ({
      items: [], readyCount: 0, busyCount: 0, issueCount: 0, statusLabel: '暂无内容',
    })))
  })

  it('counts actual output instead of success status and preserves failed attempts with retained assets', () => {
    const items = projectWorkbench([
      task('successful-without-output', { kind: 'image', referenceType: 'character', status: 'success', prompt: '已设计' }),
      task('failed-with-output', { kind: 'image', referenceType: 'scene', status: 'failed', imageUrl: 'https://assets.test/kept.png', errorMessage: '新尝试失败' }),
      task('ready', { kind: 'image', referenceType: 'prop', imageUrl: 'https://assets.test/prop.png' }),
    ], [])
    expect(projectPipelineStages(items).find((stage) => stage.id === 'assets')).toMatchObject({
      readyCount: 2, busyCount: 0, issueCount: 1, statusLabel: '2/3 已有内容',
    })
    expect(projectPipelineStages([item('existing', 'final', { hasResult: true })])[4].statusLabel).toBe('1/1 已有内容')
  })

  it('counts generating attempts independently from retained output and errors', () => {
    const items = [
      item('retry', 'video', { busy: true, hasResult: true, status: 'running', error: '上次失败' }),
      item('queued', 'audio', { busy: true, status: 'queued' }),
      item('failure-without-message', 'video', { status: 'error' }),
    ]
    expect(projectPipelineStages(items)[3]).toMatchObject({
      readyCount: 1, busyCount: 2, issueCount: 2, statusLabel: '2 生成中',
    })
  })
})

describe('pipeline stage relations', () => {
  it('does not invent a linear dependency from stage order or existing content', () => {
    expect(buildPipelineStageRelations([
      item('script', 'script', { hasResult: true }), item('assets', 'character'),
      item('storyboard', 'storyboard'), item('clip', 'video'), item('final', 'final'),
    ])).toEqual([])
  })

  it('aggregates actual cross-stage references, ignores missing or same-stage references, and deduplicates edges', () => {
    const items = [
      item('script', 'script'),
      item('character', 'character', { upstreamIds: ['script'] }),
      item('scene', 'scene', { upstreamIds: ['character'] }),
      item('board', 'storyboard', { upstreamIds: ['character', 'scene', 'scene', 'missing'] }),
      item('clip', 'video', { upstreamIds: ['script', 'board'] }),
      item('audio', 'audio', { upstreamIds: ['clip'] }),
      item('final', 'final', { upstreamIds: ['clip', 'audio'] }),
    ]
    const before = JSON.stringify(items)
    expect(buildPipelineStageRelations(items)).toEqual([
      { source: 'script', target: 'assets', count: 1 },
      { source: 'script', target: 'clips', count: 1 },
      { source: 'assets', target: 'storyboard', count: 2 },
      { source: 'storyboard', target: 'clips', count: 1 },
      { source: 'clips', target: 'delivery', count: 2 },
    ])
    expect(JSON.stringify(items)).toBe(before)
  })

  it('retains real references that run against presentation order', () => {
    expect(buildPipelineStageRelations([
      item('final', 'final'), item('script', 'script', { upstreamIds: ['final'] }),
    ])).toEqual([{ source: 'delivery', target: 'script', count: 1 }])
  })
})
