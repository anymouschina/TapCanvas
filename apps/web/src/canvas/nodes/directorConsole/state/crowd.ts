// 群演阵列（吸收 storyai-3d-director-desk 的 crowd 设计）：
// 行×列×间距一键生成一组共享 crowdId 的角色，场景树按组折叠，支持整组统一操作。
// 群组广播只覆盖「造型/表演」键（姿势/动作/颜色/缩放/朝向/显隐/锁定），位置始终各自独立。
import type { DirectorConsoleData, CharacterObj, Vec3 } from '../types'

export type CrowdInput = {
  /** 素体 id（BODY_TYPES），默认 male */
  modelId?: string
  rows: number
  columns: number
  /** 间距(米) */
  spacing: number
  /** 阵列中心 XZ；缺省自动排在现有角色后方（+z 方向） */
  center?: [number, number]
}

/** 群组统一操作允许广播的键：位置不在内（否则整组叠一起） */
export const CROWD_BROADCAST_KEYS = [
  'posePresetId', 'pose', 'motionClip', 'motionSequence', 'motion',
  'colorHex', 'uniformScale', 'rotation', 'hidden', 'locked', 'modelId',
] as const satisfies readonly (keyof CharacterObj)[]

export type CrowdBroadcastPatch = Partial<Pick<CharacterObj, (typeof CROWD_BROADCAST_KEYS)[number]>>

const r3 = (v: number) => Math.round(v * 1000) / 1000

const clone = (d: DirectorConsoleData): DirectorConsoleData => ({
  ...d,
  scene: { ...d.scene, characters: [...d.scene.characters], cameras: [...d.scene.cameras] },
})

/** 现有群组数 → 下一个群组序号（标签用） */
function nextCrowdIndex(characters: CharacterObj[]): number {
  const ids = new Set(characters.map((c) => c.crowdId).filter(Boolean))
  return ids.size + 1
}

/** 自动落位：排在现有角色最大 z 之后，避免叠在主角身上 */
function autoCenter(characters: CharacterObj[], rows: number, spacing: number): [number, number] {
  if (!characters.length) return [0, 0]
  const maxZ = Math.max(...characters.map((c) => c.position[2]))
  return [0, r3(maxZ + spacing + ((rows - 1) * spacing) / 2)]
}

export function crowdMembers(d: DirectorConsoleData, crowdId: string): CharacterObj[] {
  return d.scene.characters.filter((c) => c.crowdId === crowdId)
}

/** 生成群演阵列。makeId 由调用方注入（Modal 的 uid）。返回新数据与 crowdId。 */
export function addCrowdCharacters(
  d: DirectorConsoleData,
  input: CrowdInput,
  makeId: () => string,
): { data: DirectorConsoleData; crowdId: string; memberIds: string[] } {
  const rows = Math.max(1, Math.min(12, Math.round(input.rows)))
  const columns = Math.max(1, Math.min(12, Math.round(input.columns)))
  const spacing = Math.max(0.4, input.spacing)
  const modelId = input.modelId || 'male'
  const next = clone(d)
  const crowdId = `crowd-${makeId()}`
  const idx = nextCrowdIndex(d.scene.characters)
  const crowdLabel = `群演${idx > 1 ? idx : ''} ${rows}×${columns}`
  const [cx, cz] = input.center ?? autoCenter(d.scene.characters, rows, spacing)

  const memberIds: string[] = []
  let n = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      n += 1
      const id = makeId()
      memberIds.push(id)
      next.scene.characters.push({
        id,
        name: `${crowdLabel}-${String(n).padStart(2, '0')}`,
        modelId,
        position: [
          r3(cx + (c - (columns - 1) / 2) * spacing),
          0,
          r3(cz + (r - (rows - 1) / 2) * spacing),
        ] as Vec3,
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        uniformScale: 1,
        colorHex: '#8b93a1',
        crowdId,
        crowdLabel,
      })
    }
  }
  next.selectedObjectId = memberIds[0]
  return { data: next, crowdId, memberIds }
}

/** 群组统一操作：只接受白名单键，广播到组内所有成员。 */
export function patchCrowdMembers(
  d: DirectorConsoleData,
  crowdId: string,
  patch: CrowdBroadcastPatch,
): DirectorConsoleData {
  const safe: CrowdBroadcastPatch = {}
  for (const k of CROWD_BROADCAST_KEYS) {
    if (k in patch) (safe as Record<string, unknown>)[k] = (patch as Record<string, unknown>)[k]
  }
  if (Object.keys(safe).length === 0) return d
  const next = clone(d)
  next.scene.characters = next.scene.characters.map((c) => (c.crowdId === crowdId ? { ...c, ...safe } : c))
  return next
}

/** 群组整体平移（保持成员相对站位） */
export function translateCrowd(d: DirectorConsoleData, crowdId: string, delta: Vec3): DirectorConsoleData {
  const next = clone(d)
  next.scene.characters = next.scene.characters.map((c) =>
    c.crowdId === crowdId
      ? { ...c, position: [r3(c.position[0] + delta[0]), r3(c.position[1] + delta[1]), r3(c.position[2] + delta[2])] as Vec3 }
      : c,
  )
  return next
}

/** 删除整组 */
export function removeCrowd(d: DirectorConsoleData, crowdId: string): DirectorConsoleData {
  const next = clone(d)
  const removed = new Set(next.scene.characters.filter((c) => c.crowdId === crowdId).map((c) => c.id))
  next.scene.characters = next.scene.characters.filter((c) => c.crowdId !== crowdId)
  if (next.selectedObjectId && removed.has(next.selectedObjectId)) next.selectedObjectId = undefined
  return next
}
