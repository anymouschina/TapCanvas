import type { WorkbenchItem } from './workbenchModel'

export type ClipSceneGroup = Readonly<{
  /** Scene name; null when no clip in the stage is tied to a scene. */
  label: string | null
  /** The scene asset itself, for its reference image. */
  scene: WorkbenchItem | null
  items: readonly WorkbenchItem[]
}>

export const UNPLACED_SCENE_LABEL = '未关联场景'

type Scene = Readonly<{ name: string; asset: WorkbenchItem | null }>

/**
 * A clip's scene is the first scene in its persisted reference bindings; a manually retried
 * video without bindings falls back to an upstream scene asset. Clips are grouped by scene name,
 * so a regenerated scene card still collects the same clips.
 */
function sceneOf(item: WorkbenchItem, byId: ReadonlyMap<string, WorkbenchItem>): Scene | null {
  const bound = item.sceneRefs[0]
  if (bound) return { name: bound.name, asset: byId.get(bound.nodeId) ?? null }
  for (const id of item.upstreamIds) {
    const upstream = byId.get(id)
    if (upstream?.category === 'scene') return { name: upstream.label, asset: upstream }
  }
  return null
}

const byClipIndex = (left: WorkbenchItem, right: WorkbenchItem): number =>
  (left.clipIndex ?? Infinity) - (right.clipIndex ?? Infinity)

/**
 * The clips stage reads by scene: each scene lists its clips in clip order, scenes appear in the
 * order they are first used. Items without a scene of their own (clip audio) join the scene of the
 * video sharing their clip id.
 */
export function groupClipsByScene(items: readonly WorkbenchItem[], byId: ReadonlyMap<string, WorkbenchItem>): ClipSceneGroup[] {
  const scenes = new Map(items.map((item) => [item.id, sceneOf(item, byId)]))
  const sceneByClip = new Map<string, Scene>()
  for (const item of items) {
    const scene = scenes.get(item.id)
    if (scene) for (const clipId of item.clipIds) if (!sceneByClip.has(clipId)) sceneByClip.set(clipId, scene)
  }
  const groups = new Map<string, { scene: Scene; items: WorkbenchItem[] }>()
  const unplaced: WorkbenchItem[] = []
  for (const item of [...items].sort(byClipIndex)) {
    const scene = scenes.get(item.id) ?? item.clipIds.map((clipId) => sceneByClip.get(clipId)).find(Boolean)
    if (!scene) { unplaced.push(item); continue }
    const group = groups.get(scene.name) ?? { scene, items: [] }
    if (!group.scene.asset && scene.asset) group.scene = scene
    group.items.push(item)
    groups.set(scene.name, group)
  }
  if (!groups.size) return [{ label: null, scene: null, items }]
  return [
    ...[...groups.values()].map((group) => ({ label: group.scene.name, scene: group.scene.asset, items: group.items })),
    ...(unplaced.length ? [{ label: UNPLACED_SCENE_LABEL, scene: null, items: unplaced }] : []),
  ]
}
