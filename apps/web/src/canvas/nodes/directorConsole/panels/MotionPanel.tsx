import React from 'react'
import type { CharacterObj, Vec2 } from '../types'
import { Section, SliderField } from './Field'
import {
  setLocomotionClip, setSpeed, clearLocomotion,
  setPathMode, removeWaypoint, moveWaypoint, clearWaypoints,
  putPoseKeyframe, removePoseKeyframeAt, clearMotion,
} from '../state/motionEdit'
import type { PoseMap } from '../state/pose'
import { MOTION_PRESETS, MOTION_PRESET_CATEGORIES, findMotionPreset } from '../state/motionPresets'

export type MotionPanelProps = {
  character: CharacterObj
  onPatch: (patch: Partial<CharacterObj>) => void
  drawPathActive: boolean
  onToggleDrawPath: () => void
  /** 当前播放头在本角色片段内的局部时间（打/读上半身关键帧用；时长/播放由底部时间线统一控制）。 */
  keyframeTime: number
  /** 跳到某关键帧时间（驱动全局时间线播放头）。 */
  onSeekTo: (t: number) => void
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  background: '#1c1f26',
  border: '1px solid #2a2f3a',
  borderRadius: 6,
  color: '#e5e7eb',
  padding: '7px 8px',
  fontSize: 13,
  cursor: 'pointer',
  boxSizing: 'border-box',
}

const numInputStyle: React.CSSProperties = {
  width: '100%',
  background: '#1c1f26',
  border: '1px solid #2a2f3a',
  borderRadius: 6,
  color: '#e5e7eb',
  padding: '4px 6px',
  fontSize: 12,
  boxSizing: 'border-box',
}

function chipStyle(active: boolean, disabled?: boolean): React.CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 12,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    border: '1px solid ' + (active ? '#3b82f6' : '#2a2f3a'),
    background: active ? '#1d2940' : '#16181d',
    color: active ? '#cfe0ff' : '#9ca3af',
  }
}

export function MotionPanel(props: MotionPanelProps): JSX.Element {
  const { character, onPatch, drawPathActive, onToggleDrawPath, keyframeTime, onSeekTo } = props
  const motion = character.motion
  const hasPose = !!character.pose && Object.keys(character.pose).length > 0
  const poseKeyframes = motion?.poseTrack ?? []
  const hasLoco = !!motion?.locomotion
  const waypointList = motion?.locomotion?.path?.waypoints ?? []
  const pathMode = motion?.locomotion?.path?.mode ?? 'linear'
  const hasPath = !!motion?.locomotion?.path

  // 动作预设 → 连招序列：点预设把它【追加】进 character.motionSequence；角色循环播放整串首尾相接的连续动作。
  // 只点一个 = 单动作。清掉 motionClip/motion（避免与合成器/旧单 clip 打架，序列优先）。
  const sequence = character.motionSequence ?? []
  const [presetCat, setPresetCat] = React.useState<string>(MOTION_PRESET_CATEGORIES[0])
  const presetsInCat = MOTION_PRESETS.filter((p) => p.category === presetCat)
  const seqDuration = sequence.reduce((s, id) => s + (findMotionPreset(id)?.durationSeconds ?? 0), 0)
  const nameOf = (id: string) => findMotionPreset(id)?.name ?? id
  const setSeq = (next: string[]) =>
    onPatch({ motionSequence: next.length ? next : undefined, motionClip: undefined, motion: undefined })
  const moveSeq = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= sequence.length) return
    const next = sequence.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    setSeq(next)
  }

  return (
    <div>
      {/* Section — 动作预设：点一下加入下方「连招」，多个首尾相接连续播放 */}
      <Section title="动作预设 / 连招">
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
          点一个预设把它加入下方「连招」——多个预设首尾相接连续播放（拔剑起手→出拳连击→踢腿）。只点一个 = 单动作。
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {MOTION_PRESET_CATEGORIES.map((cat) => (
            <button key={cat} onClick={() => setPresetCat(cat)} style={chipStyle(presetCat === cat)}>{cat}</button>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {presetsInCat.map((p) => {
            const count = sequence.filter((id) => id === p.id).length
            return (
              <button
                key={p.id}
                title={`${p.name} · ${p.durationSeconds}s${p.loop ? ' · 循环' : ''}（点击加入连招）`}
                onClick={() => setSeq([...sequence, p.id])}
                style={chipStyle(count > 0)}
              >
                {p.name}{count > 0 ? ` ×${count}` : ''}
              </button>
            )
          })}
        </div>
      </Section>

      {/* Section — 连招序列：有序、可上下移/删，角色循环播放整套连续动作 */}
      {sequence.length > 0 && (
        <Section title={`连招序列 · ${sequence.length} 段 · ${seqDuration.toFixed(1)}s`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sequence.map((id, i) => (
              <div
                key={`${id}-${i}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1c1f26', border: '1px solid #2a2f3a', borderRadius: 6, padding: '5px 8px' }}
              >
                <span style={{ fontSize: 12, color: '#cdd3dc', flex: 1 }}>
                  {i + 1}. {nameOf(id)} <span style={{ color: '#6b7280' }}>· {(findMotionPreset(id)?.durationSeconds ?? 0)}s</span>
                </span>
                <button disabled={i === 0} onClick={() => moveSeq(i, -1)} style={{ padding: '2px 7px', borderRadius: 6, fontSize: 12, cursor: i === 0 ? 'not-allowed' : 'pointer', opacity: i === 0 ? 0.4 : 1, border: '1px solid #2a2f3a', background: '#16181d', color: '#9ca3af' }}>↑</button>
                <button disabled={i === sequence.length - 1} onClick={() => moveSeq(i, 1)} style={{ padding: '2px 7px', borderRadius: 6, fontSize: 12, cursor: i === sequence.length - 1 ? 'not-allowed' : 'pointer', opacity: i === sequence.length - 1 ? 0.4 : 1, border: '1px solid #2a2f3a', background: '#16181d', color: '#9ca3af' }}>↓</button>
                <button onClick={() => setSeq(sequence.filter((_, k) => k !== i))} style={{ padding: '2px 8px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: '1px solid #2a2f3a', background: '#16181d', color: '#9b6b6b' }}>删</button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setSeq([])}
            style={{ width: '100%', marginTop: 8, padding: '5px 0', borderRadius: 6, border: '1px solid #2a2f3a', background: '#16181d', color: '#9ca3af', cursor: 'pointer', fontSize: 12 }}
          >
            清空连招
          </button>
        </Section>
      )}

      {/* Section — 上半身姿势关键帧（时间由底部时间线播放头给；时长/播放也在时间线控制） */}
      <Section title="上半身姿势关键帧">
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
          先在『姿势』tab 摆好上半身，再回这里在播放头当前时刻打关键帧（让角色边走边做动作）
        </div>
        <button
          disabled={!hasPose}
          onClick={() => {
            if (!hasPose) return
            onPatch({ motion: putPoseKeyframe(motion, keyframeTime, character.pose as unknown as PoseMap) })
          }}
          style={{
            width: '100%', padding: '6px 0', borderRadius: 6,
            border: '1px solid #2a2f3a',
            background: hasPose ? '#1c1f26' : '#16181d',
            color: hasPose ? '#e5e7eb' : '#4b5563',
            cursor: hasPose ? 'pointer' : 'not-allowed',
            fontSize: 13, marginBottom: 10,
          }}
        >
          ＋ 在 {keyframeTime.toFixed(2)}s 打关键帧
        </button>
        {poseKeyframes.length === 0 ? (
          <div style={{ fontSize: 11, color: '#6b7280' }}>暂无关键帧</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {poseKeyframes.map((k) => (
              <div
                key={k.t}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: '#1c1f26', border: '1px solid #2a2f3a',
                  borderRadius: 6, padding: '5px 8px',
                }}
              >
                <span style={{ fontSize: 12, color: '#cdd3dc', flex: 1 }}>
                  {k.t.toFixed(2)}s · {Object.keys(k.pose).length} 关节
                </span>
                <button
                  onClick={() => onSeekTo(k.t)}
                  style={{ padding: '2px 8px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: '1px solid #2a2f3a', background: '#16181d', color: '#9ca3af' }}
                >
                  跳到
                </button>
                <button
                  onClick={() => onPatch({ motion: removePoseKeyframeAt(motion, k.t) })}
                  style={{ padding: '2px 8px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: '1px solid #2a2f3a', background: '#16181d', color: '#9b6b6b' }}
                >
                  删
                </button>
              </div>
            ))}
          </div>
        )}
        {hasLoco && (
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8 }}>
            关键帧只盖上半身（脊/颈/肩肘），腿由位移驱动
          </div>
        )}
      </Section>

      {/* Section 3 — 位移 */}
      <Section title="位移">
        <select
          value={motion?.locomotion?.clip ?? ''}
          onChange={(e) => {
            const val = e.target.value
            if (val === '') {
              onPatch({ motion: clearLocomotion(motion) })
            } else {
              onPatch({ motion: setLocomotionClip(motion, val as 'walk' | 'run' | 'idle') })
            }
          }}
          style={selectStyle}
        >
          <option value="">无</option>
          <option value="walk">走路</option>
          <option value="run">跑步</option>
          <option value="idle">原地待机</option>
        </select>
        {hasLoco && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: '#8b93a1', marginBottom: 4 }}>速率</div>
            <SliderField
              value={motion!.locomotion!.speed ?? 1}
              min={0.25}
              max={3}
              step={0.05}
              onChange={(v) => onPatch({ motion: setSpeed(motion, v) })}
            />
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>腿部循环速率，不改行进距离</div>
          </div>
        )}
      </Section>

      {/* Section 4 — 路径（仅当有位移时渲染） */}
      {hasLoco && (
        <Section title="路径">
          <button
            onClick={onToggleDrawPath}
            style={{
              width: '100%', padding: '6px 0', borderRadius: 6,
              cursor: 'pointer', fontSize: 13, marginBottom: 8,
              border: '1px solid ' + (drawPathActive ? '#3b82f6' : '#2a2f3a'),
              background: drawPathActive ? '#1d2940' : '#1c1f26',
              color: drawPathActive ? '#cfe0ff' : '#e5e7eb',
            }}
          >
            ✏️ 绘制路径
          </button>
          {drawPathActive && (
            <div style={{ fontSize: 11, color: '#8b93a1', marginBottom: 8 }}>
              在视口点击地面落点；拖动路点球可移动；再次点此结束
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {(['linear', 'curve'] as const).map((mode) => (
              <button
                key={mode}
                disabled={!hasPath}
                onClick={() => {
                  if (hasPath) onPatch({ motion: setPathMode(motion, mode) })
                }}
                style={chipStyle(pathMode === mode, !hasPath)}
              >
                {mode === 'linear' ? '折线' : '曲线'}
              </button>
            ))}
          </div>
          {waypointList.length === 0 ? (
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>无路点 = 原地循环</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              {waypointList.map((w, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: '#8b93a1', width: 32, flexShrink: 0 }}>点{i + 1}</span>
                  <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                    {(['x', 'z'] as const).map((ax, ai) => (
                      <div key={ax} style={{ display: 'flex', alignItems: 'center', gap: 3, flex: 1 }}>
                        <span style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase' }}>{ax}</span>
                        <input
                          type="number"
                          step={0.1}
                          value={w[ai]}
                          onChange={(e) => {
                            const v = Number(e.target.value)
                            if (!Number.isFinite(v)) return
                            const next: Vec2 = ai === 0 ? [v, w[1]] : [w[0], v]
                            onPatch({ motion: moveWaypoint(motion, i, next) })
                          }}
                          style={numInputStyle}
                        />
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => onPatch({ motion: removeWaypoint(motion, i) })}
                    style={{ padding: '2px 8px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: '1px solid #2a2f3a', background: '#16181d', color: '#9b6b6b' }}
                  >
                    删
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => onPatch({ motion: clearWaypoints(motion) })}
            style={{
              width: '100%', padding: '5px 0', borderRadius: 6,
              border: '1px solid #2a2f3a', background: '#16181d',
              color: '#9ca3af', cursor: 'pointer', fontSize: 12,
            }}
          >
            清空路径
          </button>
        </Section>
      )}

      {/* Footer */}
      <div style={{ padding: '8px 16px' }}>
        <button
          onClick={() => onPatch({ motion: clearMotion() })}
          style={{
            width: '100%', padding: '7px 0', borderRadius: 8,
            background: '#1c1f26', color: '#9ca3af',
            border: '1px solid #2a2f3a', cursor: 'pointer',
          }}
        >
          重置动画
        </button>
      </div>
    </div>
  )
}
