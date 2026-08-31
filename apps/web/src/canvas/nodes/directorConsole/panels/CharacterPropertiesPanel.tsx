import React from 'react'
import type { CharacterObj } from '../types'
import { Section, TextField, Vec3Row, SliderField } from './Field'
import { POSE_PRESETS, JOINT_SLIDERS, POSE_CATEGORIES, JOINT_PARTS, getPoseIcon, deg, toDeg, type JointRole, type JointSlider, type PartKey, type PosePreset } from '../state/pose'
import { loadCustomPoses, saveCustomPose, deleteCustomPose, loadFavorites, toggleFavorite, type CustomPosePreset } from '../state/poseLibrary'
import { getLibraryItem } from '../assets'
import { MOTION_CLIP_OPTIONS } from '../scene/clipAnimation'
import { loadCustomMotions } from '../state/motionLibrary'
import type { PoseClip } from '../state/poseClip'
import { MotionPanel, type MotionPanelProps } from './MotionPanel'

type Props = {
  character: CharacterObj
  onPatch: (patch: Partial<CharacterObj>) => void
  customMotions?: PoseClip[]
  motionUi?: Omit<MotionPanelProps, 'character' | 'onPatch'>
  /** 群演成员时给定：展示「应用到整组」开关（姿势/动作/颜色/缩放/朝向广播全组，位置仍各自独立） */
  crowd?: { label: string; count: number; broadcast: boolean; onToggleBroadcast: (v: boolean) => void }
}

export function CharacterPropertiesPanel({ character, onPatch, customMotions: sceneMotions, motionUi, crowd }: Props) {
  const [tab, setTab] = React.useState<'props' | 'pose' | 'motion'>('props')
  // 道具（几何/家具）没有骨骼，不展示姿势页
  const isProp = getLibraryItem(character.modelId)?.kind === 'prop'
  // 自定义动作 = 场景级(节点数据/小T 生成) + 本地 localStorage(人工保存)，按 id 去重
  const customMotions = React.useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>()
    for (const m of sceneMotions ?? []) byId.set(m.id, { id: m.id, name: m.name })
    for (const m of loadCustomMotions()) if (!byId.has(m.id)) byId.set(m.id, { id: m.id, name: m.name })
    return [...byId.values()]
  }, [sceneMotions])
  const effectiveTab = isProp ? 'props' : (tab === 'motion' && !motionUi) ? 'pose' : tab
  return (
    <div>
      <div style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600 }}>{isProp ? '道具' : '角色'}</div>
      {crowd ? (
        <div style={{ margin: '0 16px 10px', padding: '8px 10px', borderRadius: 8, background: '#141a26', border: '1px solid #24304a' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, color: '#cdd3dc' }}>
            <input type="checkbox" checked={crowd.broadcast} onChange={(e) => crowd.onToggleBroadcast(e.target.checked)} style={{ cursor: 'pointer' }} />
            应用到整组「{crowd.label}」({crowd.count}人)
          </label>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>开启后姿势/动作/颜色/缩放/朝向会广播到全组，位置仍各自独立</div>
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 16, padding: '0 16px 8px', borderBottom: '1px solid #16181d' }}>
        {(isProp ? ['props'] : motionUi ? ['props', 'pose', 'motion'] : ['props', 'pose']).map((t) => (
          <button key={t} onClick={() => setTab(t as 'props' | 'pose' | 'motion')}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, paddingBottom: 8, color: effectiveTab === t ? '#fff' : '#6b7280', borderBottom: effectiveTab === t ? '2px solid #fff' : '2px solid transparent' }}>
            {t === 'props' ? '属性' : t === 'pose' ? '姿势' : '动画'}
          </button>
        ))}
      </div>

      {effectiveTab === 'props' ? (
        <>
          <Section title="名称"><TextField value={character.name} onChange={(v) => onPatch({ name: v })} /></Section>
          <Section title="位置"><Vec3Row value={character.position} onChange={(v) => onPatch({ position: v })} /></Section>
          <Section title="旋转"><Vec3Row value={character.rotation} onChange={(v) => onPatch({ rotation: v })} /></Section>
          <Section title="缩放"><Vec3Row value={character.scale} onChange={(v) => onPatch({ scale: v })} /></Section>
          <Section title="统一缩放">
            <SliderField value={character.uniformScale} min={0.2} max={3} step={0.01} onChange={(v) => onPatch({ uniformScale: v })} />
          </Section>
          <Section title="颜色">
            <input type="color" value={character.colorHex} onChange={(e) => onPatch({ colorHex: e.target.value })}
              style={{ width: 48, height: 32, background: 'transparent', border: '1px solid #2a2f3a', borderRadius: 6, cursor: 'pointer' }} />
          </Section>
          {!isProp ? (
            <Section title="动作片段（编辑器实时播放）">
              <select value={character.motionClip ?? ''} onChange={(e) => onPatch({ motionClip: e.target.value || undefined })}
                style={{ width: '100%', background: '#1c1f26', border: '1px solid #2a2f3a', borderRadius: 6, color: '#e5e7eb', padding: '7px 8px', fontSize: 13, cursor: 'pointer', boxSizing: 'border-box' }}>
                {MOTION_CLIP_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                {customMotions.length ? (
                  <optgroup label="自定义（AI/手作）">
                    {customMotions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </optgroup>
                ) : null}
              </select>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>选一段骨骼动作，角色当场循环播放（优先于静态姿势）。自定义动作即将支持 AI 生成。</div>
            </Section>
          ) : null}
        </>
      ) : effectiveTab === 'motion' && motionUi ? (
        <MotionPanel character={character} onPatch={onPatch} {...motionUi} />
      ) : (
        <PoseTab character={character} onPatch={onPatch} />
      )}
    </div>
  )
}

// chip 行：全部 / 各内置类 / 收藏 / 自定义
const POSE_CHIPS = ['全部', ...POSE_CATEGORIES, '收藏', '自定义'] as const
type PoseChip = (typeof POSE_CHIPS)[number]

function PoseTab({ character, onPatch }: Props) {
  const pose = (character.pose ?? {}) as Record<string, [number, number, number]>
  const [chip, setChip] = React.useState<PoseChip>('全部')
  const [part, setPart] = React.useState<PartKey>('头部')
  const [custom, setCustom] = React.useState<CustomPosePreset[]>(() => loadCustomPoses())
  const [favs, setFavs] = React.useState<string[]>(() => loadFavorites())
  const [name, setName] = React.useState('')

  const allPresets: PosePreset[] = React.useMemo(() => [...POSE_PRESETS, ...custom], [custom])
  const visible: PosePreset[] = React.useMemo(() => {
    if (chip === '全部') return allPresets
    if (chip === '收藏') return allPresets.filter((p) => favs.includes(p.id))
    if (chip === '自定义') return custom
    return POSE_PRESETS.filter((p) => p.category === chip)
  }, [chip, allPresets, custom, favs])

  const applyPreset = (p: PosePreset) => onPatch({ pose: { ...p.pose } as Record<string, [number, number, number]>, posePresetId: p.id })
  const onToggleFav = (id: string) => setFavs(toggleFavorite(id))
  const onDeleteCustom = (id: string) => { setCustom(deleteCustomPose(id)); setFavs(loadFavorites()) }
  const onSave = () => {
    if (!character.pose || Object.keys(character.pose).length === 0) return
    setCustom(saveCustomPose(name, character.pose as Record<string, [number, number, number]>))
    setName('')
    setChip('自定义')
  }
  const setJoint = (role: JointRole, axis: 0 | 1 | 2, valDeg: number) => {
    const cur = (pose[role] ?? [0, 0, 0]).slice() as [number, number, number]
    cur[axis] = deg(valDeg)
    onPatch({ pose: { ...pose, [role]: cur } })
  }
  const partSliders: JointSlider[] = JOINT_SLIDERS.filter((j) => j.part === part)

  return (
    <>
      <Section title="动作预设">
        {/* 分类 chip 行 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {POSE_CHIPS.map((c) => (
            <button key={c} onClick={() => setChip(c)}
              style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer', border: '1px solid ' + (chip === c ? '#3b82f6' : '#2a2f3a'), background: chip === c ? '#1d2940' : '#16181d', color: chip === c ? '#cfe0ff' : '#9ca3af' }}>
              {c === '收藏' ? '★收藏' : c}
            </button>
          ))}
        </div>
        {/* emoji 图标卡片网格 */}
        {visible.length === 0 ? (
          <div style={{ fontSize: 12, color: '#6b7280', padding: '8px 0' }}>{chip === '收藏' ? '还没有收藏的动作（点卡片右上角 ★）' : '暂无'}</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            {visible.map((p) => {
              const active = character.posePresetId === p.id
              const faved = favs.includes(p.id)
              const isCustom = (p as CustomPosePreset).custom === true
              return (
                <div key={p.id} style={{ position: 'relative' }}>
                  <button onClick={() => applyPreset(p)} title={p.name}
                    style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 2px 6px', borderRadius: 8, background: active ? '#1d2940' : '#1c1f26', color: '#cdd3dc', border: '1px solid ' + (active ? '#3b82f6' : '#2a2f3a'), cursor: 'pointer' }}>
                    <span style={{ fontSize: 20, lineHeight: 1 }}>{getPoseIcon(p)}</span>
                    <span style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{p.name}</span>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onToggleFav(p.id) }} title={faved ? '取消收藏' : '收藏'}
                    style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, padding: 0, borderRadius: 4, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, color: faved ? '#f5c518' : '#5b6470', lineHeight: 1 }}>{faved ? '★' : '☆'}</button>
                  {isCustom ? (
                    <button onClick={(e) => { e.stopPropagation(); onDeleteCustom(p.id) }} title="删除自定义"
                      style={{ position: 'absolute', top: 2, left: 2, width: 18, height: 18, padding: 0, borderRadius: 4, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, color: '#9b6b6b', lineHeight: 1 }}>✕</button>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
        {/* 保存当前姿势为自定义预设 */}
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="预设名称（可留空）"
            style={{ flex: 1, background: '#1c1f26', border: '1px solid #2a2f3a', borderRadius: 6, color: '#e5e7eb', padding: '6px 8px', fontSize: 12, boxSizing: 'border-box' }} />
          <button onClick={onSave} disabled={!character.pose || Object.keys(character.pose).length === 0} title="把当前姿势存为自定义预设"
            style={{ flex: 'none', padding: '6px 12px', borderRadius: 6, border: '1px solid #2a2f3a', background: '#1c1f26', color: '#cdd3dc', cursor: character.pose ? 'pointer' : 'not-allowed', fontSize: 12 }}>保存为预设</button>
        </div>
      </Section>
      <Section title="动作微调">
        {/* 分部位 sub-tab */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {JOINT_PARTS.map((pk) => (
            <button key={pk} onClick={() => setPart(pk)}
              style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: '1px solid ' + (part === pk ? '#3b82f6' : '#2a2f3a'), background: part === pk ? '#1d2940' : '#16181d', color: part === pk ? '#cfe0ff' : '#9ca3af' }}>{pk}</button>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {partSliders.map((j) => {
            const v = toDeg((pose[j.role]?.[j.axis]) ?? 0)
            return (
              <div key={`${j.role}-${j.axis}`}>
                <div style={{ fontSize: 11, color: '#8b93a1', marginBottom: 2 }}>{j.label}</div>
                <SliderField value={v} min={j.min} max={j.max} step={1} onChange={(nv) => setJoint(j.role, j.axis, nv)} />
              </div>
            )
          })}
        </div>
      </Section>
      <div style={{ padding: '8px 16px' }}>
        <button onClick={() => onPatch({ pose: undefined, posePresetId: undefined })} style={{ width: '100%', padding: '7px 0', borderRadius: 8, background: '#1c1f26', color: '#9ca3af', border: '1px solid #2a2f3a', cursor: 'pointer' }}>重置姿势</button>
      </div>
    </>
  )
}
