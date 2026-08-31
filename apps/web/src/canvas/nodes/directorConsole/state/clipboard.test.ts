import { describe, it, expect } from 'vitest'
import { copySelection, pasteClipboard, PASTE_OFFSET_M } from './clipboard'
import type { DirectorConsoleData, CharacterObj, CameraObj } from '../types'

const char = (over: Partial<CharacterObj> = {}): CharacterObj => ({
  id: 'ch1', name: '角色A', modelId: 'male',
  position: [1, 0, 2], rotation: [0, 0, 0], scale: [1, 1, 1], uniformScale: 1, colorHex: '#4B8BFF',
  ...over,
})

const cam = (over: Partial<CameraObj> = {}): CameraObj => ({
  id: 'cam1', name: '机位1', position: [0, 2, 8], lookAtMode: 'manual', lookAt: [0, 1.2, 0], fovDeg: 50,
  ...over,
})

const dataWith = (chars: CharacterObj[], cams: CameraObj[], sel?: string): DirectorConsoleData => ({
  kind: 'directorConsole', label: '导演台',
  scene: { characters: chars, cameras: cams, aspect: 'auto' },
  activeViewpoint: 'director',
  selectedObjectId: sel,
})

describe('directorConsole clipboard', () => {
  it('复制选中角色并粘贴：新 id、偏移落位、名称去重、选中新对象', () => {
    const d = dataWith([char({ posePresetId: 'fight' })], [], 'ch1')
    const clip = copySelection(d)!
    expect(clip.kind).toBe('character')

    const next = pasteClipboard(d, clip, 'ch2', 1)
    expect(next.scene.characters).toHaveLength(2)
    const pasted = next.scene.characters[1]
    expect(pasted.id).toBe('ch2')
    expect(pasted.name).toBe('角色A副本')
    expect(pasted.position).toEqual([1 + PASTE_OFFSET_M, 0, 2 + PASTE_OFFSET_M])
    expect(pasted.posePresetId).toBe('fight')
    expect(next.selectedObjectId).toBe('ch2')
    // 原对象不动
    expect(next.scene.characters[0].position).toEqual([1, 0, 2])
  })

  it('多次粘贴偏移递增且名称不冲突', () => {
    const d0 = dataWith([char()], [], 'ch1')
    const clip = copySelection(d0)!
    const d1 = pasteClipboard(d0, clip, 'p1', 1)
    const d2 = pasteClipboard(d1, clip, 'p2', 2)
    expect(d2.scene.characters.map((c) => c.name)).toEqual(['角色A', '角色A副本', '角色A副本2'])
    expect(d2.scene.characters[2].position[0]).toBeCloseTo(1 + PASTE_OFFSET_M * 2)
  })

  it('粘贴群演成员剥离 crowd 标记且解除锁定', () => {
    const d = dataWith([char({ crowdId: 'crowd-1', crowdLabel: '群演 3×3', locked: true })], [], 'ch1')
    const next = pasteClipboard(d, copySelection(d)!, 'p1', 1)
    const pasted = next.scene.characters[1]
    expect(pasted.crowdId).toBeUndefined()
    expect(pasted.crowdLabel).toBeUndefined()
    expect(pasted.locked).toBe(false)
  })

  it('复制粘贴机位：lookAt/路径 waypoints 同步平移，成为激活机位', () => {
    const d = dataWith([], [cam({ path: { waypoints: [[0, 0], [2, 2]], mode: 'curve', height: 1.6 } })], 'cam1')
    const clip = copySelection(d)!
    expect(clip.kind).toBe('camera')
    const next = pasteClipboard(d, clip, 'cam2', 1)
    const pasted = next.scene.cameras[1]
    expect(pasted.name).toBe('机位1副本')
    expect(pasted.position).toEqual([PASTE_OFFSET_M, 2, 8 + PASTE_OFFSET_M])
    expect(pasted.lookAt).toEqual([PASTE_OFFSET_M, 1.2, PASTE_OFFSET_M])
    expect(pasted.path!.waypoints).toEqual([[PASTE_OFFSET_M, PASTE_OFFSET_M], [2.6, 2.6]])
    expect(pasted.path!.mode).toBe('curve')
    expect(next.scene.activeCameraId).toBe('cam2')
  })

  it('未选中或选中对象不存在时复制返回 null', () => {
    expect(copySelection(dataWith([char()], []))).toBeNull()
    expect(copySelection(dataWith([char()], [], 'nope'))).toBeNull()
  })
})
