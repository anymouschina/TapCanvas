import { describe, it, expect } from 'vitest'
import { addCrowdCharacters, patchCrowdMembers, translateCrowd, removeCrowd, crowdMembers } from './crowd'
import type { DirectorConsoleData, CharacterObj } from '../types'

const makeIdGen = () => {
  let n = 0
  return () => `id-${++n}`
}

const emptyData = (): DirectorConsoleData => ({
  kind: 'directorConsole', label: '导演台',
  scene: { characters: [], cameras: [], aspect: 'auto' },
  activeViewpoint: 'director',
})

const hero = (): CharacterObj => ({
  id: 'hero', name: '角色A', modelId: 'male',
  position: [0, 0, 1], rotation: [0, 0, 0], scale: [1, 1, 1], uniformScale: 1, colorHex: '#4B8BFF',
})

describe('directorConsole crowd', () => {
  it('按行×列×间距生成阵列，共享 crowdId/label，序号命名', () => {
    const { data, crowdId, memberIds } = addCrowdCharacters(emptyData(), { rows: 2, columns: 3, spacing: 1.2 }, makeIdGen())
    expect(memberIds).toHaveLength(6)
    const members = crowdMembers(data, crowdId)
    expect(members).toHaveLength(6)
    expect(new Set(members.map((m) => m.crowdId)).size).toBe(1)
    expect(members[0].crowdLabel).toBe('群演 2×3')
    expect(members[0].name).toBe('群演 2×3-01')
    expect(members[5].name).toBe('群演 2×3-06')
    // 3 列间距 1.2：x ∈ {-1.2, 0, 1.2}
    expect(members.map((m) => m.position[0]).sort((a, b) => a - b)).toEqual([-1.2, -1.2, 0, 0, 1.2, 1.2])
    // 生成后选中首个成员
    expect(data.selectedObjectId).toBe(memberIds[0])
  })

  it('已有角色时自动排在其后方，不叠在主角身上', () => {
    const d = emptyData()
    d.scene.characters.push(hero())
    const { data, crowdId } = addCrowdCharacters(d, { rows: 2, columns: 2, spacing: 1 }, makeIdGen())
    const members = crowdMembers(data, crowdId)
    // 全部成员 z > 主角 z
    expect(Math.min(...members.map((m) => m.position[2]))).toBeGreaterThan(1)
    // 主角不受影响
    expect(data.scene.characters[0].position).toEqual([0, 0, 1])
  })

  it('第二组标签带序号', () => {
    const gen = makeIdGen()
    const first = addCrowdCharacters(emptyData(), { rows: 1, columns: 2, spacing: 1 }, gen)
    const second = addCrowdCharacters(first.data, { rows: 1, columns: 2, spacing: 1 }, gen)
    const members = crowdMembers(second.data, second.crowdId)
    expect(members[0].crowdLabel).toBe('群演2 1×2')
  })

  it('群组广播只透传白名单键，位置不广播', () => {
    const { data, crowdId } = addCrowdCharacters(emptyData(), { rows: 1, columns: 3, spacing: 1 }, makeIdGen())
    const next = patchCrowdMembers(data, crowdId, {
      posePresetId: 'fight', colorHex: '#ff0000', uniformScale: 1.2,
      // @ts-expect-error 位置不在广播白名单
      position: [9, 9, 9],
    })
    for (const m of crowdMembers(next, crowdId)) {
      expect(m.posePresetId).toBe('fight')
      expect(m.colorHex).toBe('#ff0000')
      expect(m.uniformScale).toBe(1.2)
      expect(m.position).not.toEqual([9, 9, 9])
    }
  })

  it('整体平移保持相对站位', () => {
    const { data, crowdId } = addCrowdCharacters(emptyData(), { rows: 1, columns: 2, spacing: 2 }, makeIdGen())
    const before = crowdMembers(data, crowdId).map((m) => m.position[0])
    const next = translateCrowd(data, crowdId, [3, 0, -1])
    const after = crowdMembers(next, crowdId)
    expect(after.map((m) => m.position[0])).toEqual(before.map((x) => x + 3))
    expect(after.every((m) => m.position[2] === -1)).toBe(true)
  })

  it('删除整组并清掉组内选中', () => {
    const d = emptyData()
    d.scene.characters.push(hero())
    const { data, crowdId, memberIds } = addCrowdCharacters(d, { rows: 2, columns: 2, spacing: 1 }, makeIdGen())
    const withSel = { ...data, selectedObjectId: memberIds[2] }
    const next = removeCrowd(withSel, crowdId)
    expect(next.scene.characters).toHaveLength(1)
    expect(next.scene.characters[0].id).toBe('hero')
    expect(next.selectedObjectId).toBeUndefined()
  })

  it('行列钳制在 1..12，间距下限 0.4', () => {
    const { data, crowdId } = addCrowdCharacters(emptyData(), { rows: 0, columns: 99, spacing: 0.01 }, makeIdGen())
    const members = crowdMembers(data, crowdId)
    expect(members).toHaveLength(12) // 1×12
    const xs = members.map((m) => m.position[0]).sort((a, b) => a - b)
    expect(xs[1] - xs[0]).toBeCloseTo(0.4)
  })
})
