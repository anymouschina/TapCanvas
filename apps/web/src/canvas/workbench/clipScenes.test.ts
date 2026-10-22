import { describe, expect, it } from 'vitest'
import { groupClipsByScene, UNPLACED_SCENE_LABEL } from './clipScenes'
import type { WorkbenchItem } from './workbenchModel'

function item(id: string, values: Partial<WorkbenchItem> = {}): WorkbenchItem {
  return {
    id, label: id, category: 'video', kind: 'video', status: 'success', busy: false,
    imageUrl: null, videoUrl: null, audioUrl: null, text: '', error: null, hasResult: true, canGenerate: false, upstreamIds: [],
    clipIds: [], clipIndex: null, shotScript: '', durationSeconds: null, sceneRefs: [], ...values,
  }
}

const hall = item('hall', { category: 'scene', kind: 'image', label: '酒楼大堂', imageUrl: 'https://cdn.test/hall.png' })
const room = item('room', { category: 'scene', kind: 'image', label: '雅间' })
const byIdOf = (items: WorkbenchItem[]) => new Map([hall, room, ...items].map((entry) => [entry.id, entry]))

describe('groupClipsByScene', () => {
  it('groups clips by their bound main scene, in first-use order and clip order', () => {
    const clips = [
      item('c3', { clipIndex: 2, sceneRefs: [{ nodeId: 'hall', name: '酒楼大堂' }] }),
      item('c2', { clipIndex: 1, sceneRefs: [{ nodeId: 'room', name: '雅间' }, { nodeId: 'hall', name: '酒楼大堂' }] }),
      item('c1', { clipIndex: 0, sceneRefs: [{ nodeId: 'hall', name: '酒楼大堂' }] }),
    ]
    const groups = groupClipsByScene(clips, byIdOf(clips))
    expect(groups.map((group) => [group.label, group.items.map((entry) => entry.id)])).toEqual([
      ['酒楼大堂', ['c1', 'c3']],
      ['雅间', ['c2']],
    ])
    expect(groups[0].scene?.id).toBe('hall')
  })

  it('falls back to an upstream scene asset and places clip audio with its video', () => {
    const clips = [
      item('retried', { clipIndex: 0, clipIds: ['clip-1'], upstreamIds: ['room'] }),
      item('voice', { category: 'audio', kind: 'audio', clipIds: ['clip-1'] }),
      item('loose', { clipIndex: 1 }),
    ]
    const groups = groupClipsByScene(clips, byIdOf(clips))
    expect(groups.map((group) => [group.label, group.items.map((entry) => entry.id)])).toEqual([
      ['雅间', ['retried', 'voice']],
      [UNPLACED_SCENE_LABEL, ['loose']],
    ])
  })

  it('keeps one unlabelled sequence when no clip is tied to a scene', () => {
    const clips = [item('a'), item('b')]
    expect(groupClipsByScene(clips, byIdOf(clips))).toEqual([{ label: null, scene: null, items: clips }])
  })
})
