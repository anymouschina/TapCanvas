import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { projectWorkbench } from './workbenchModel'
import { isShotDesign, withShotDesigns } from './shotDesign'

function task(id: string, data: Record<string, unknown>): Node {
  return { id, type: 'taskNode', position: { x: 0, y: 0 }, data }
}

const SCRIPT = [
  '【第一场：百花酒楼二楼雅间，午后，暖琥珀色，顾观棋坐于东侧主位】',
  '镜头1：雅间全景，机位静止，午后阳光洒入雅间。',
  '镜头2：顾观棋正面中近景，顾观棋（坦诚从容）说：“沈百户，我先自我介绍一下。”',
  '【第二场：石拱桥头，傍晚】',
  '镜头1：桥头全景，柳枝低垂。',
].join('\n')

describe('shot design', () => {
  it('makes one entry per workflow clip and attaches the staging diagrams that cover it', () => {
    const items = projectWorkbench([
      task('video-2', { kind: 'video', workflowClipId: 'clip-02', clipIndex: 1, workflowSourcePrompt: SCRIPT, videoDurationSeconds: 30 }),
      task('video-1', { kind: 'video', workflowClipId: 'clip-01', clipIndex: 0, workflowSourcePrompt: SCRIPT }),
      task('staging-1', { kind: 'image', productionLayer: 'blocking_diagram', clipId: 'clip-01', clipIds: ['clip-01', 'clip-02'], imageUrl: 'https://cdn.test/s1.png' }),
      task('loose-board', { kind: 'image', productionLayer: 'keyframe', imageUrl: 'https://cdn.test/k.png' }),
    ], [])
    const storyboard = withShotDesigns(items).filter((item) => item.category === 'storyboard')
    expect(storyboard.map((item) => item.label)).toEqual(['Clip 1', 'Clip 2', 'loose-board'])
    const [first, second] = storyboard
    if (!isShotDesign(first) || !isShotDesign(second)) throw new Error('expected shot designs')
    expect(first.text).toBe(SCRIPT)
    expect(first.shotDesign.staging.map((item) => item.id)).toEqual(['staging-1'])
    expect(second.shotDesign.staging.map((item) => item.id)).toEqual(['staging-1'])
    expect(second).toMatchObject({ durationSeconds: 30, hasResult: true, canGenerate: false, imageUrl: 'https://cdn.test/s1.png' })
    // The clip's video node itself stays in the clips step.
    expect(withShotDesigns(items).filter((item) => item.category === 'video').map((item) => item.id)).toEqual(['video-2', 'video-1'])
  })

  it('keeps a manually retried clip through its staging edge', () => {
    const items = projectWorkbench([
      task('retried', { kind: 'video', workflowSourcePrompt: SCRIPT }),
      task('staging-3', { kind: 'image', productionLayer: 'blocking_diagram', clipId: 'clip-03', clipIds: ['clip-03'], clipIndex: 2, imageUrl: 'https://cdn.test/s3.png' }),
    ], [{ id: 'e', source: 'staging-3', target: 'retried' }])
    const [design] = withShotDesigns(items).filter((item) => item.category === 'storyboard')
    if (!isShotDesign(design)) throw new Error('expected a shot design')
    expect(design).toMatchObject({ label: 'Clip 3', clipIndex: 2 })
    expect(design.shotDesign.staging.map((item) => item.id)).toEqual(['staging-3'])
  })

  it('leaves canvases without clip scripts unchanged', () => {
    const items = projectWorkbench([task('staging', { kind: 'image', productionLayer: 'blocking_diagram', clipId: 'clip-01' })], [])
    expect(withShotDesigns(items)).toEqual(items)
  })
})
