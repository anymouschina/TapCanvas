import React from 'react'
import type { CameraObj, DirectorScene, CameraShot } from '../types'
import { Section, TextField, NumberField, Vec3Row, SliderField } from './Field'
import { LENS_PRESETS, fovFromFocal, focalFromFov } from '../state/lens'
import { SHOT_PRESETS, applyShotPreset } from '../state/shots'

export type ShotGroup = { cameraId: string; cameraName: string; shots: CameraShot[] }

type Props = {
  camera: CameraObj
  scene: DirectorScene
  tab: 'props' | 'shots'
  onTab: (t: 'props' | 'shots') => void
  shotGroups: ShotGroup[]
  busy: boolean
  onPatch: (patch: Partial<CameraObj>) => void
  onSwitchCamera: (id: string) => void
  onClearAll: () => void
  onSendAll: () => void
  onSendShot: (cameraId: string, shotId: string) => void
  onDeleteShot: (cameraId: string, shotId: string) => void
  clipSettings: ClipSettings
  onClipSettingsChange: (patch: Partial<ClipSettings>) => void
  onRenderClip: () => void
  previewOrbit: boolean
  onTogglePreviewOrbit: () => void
  onStartFlyRecord: () => void
  hasRecording: boolean
  recordedDuration?: number
  onClearRecordedCam: () => void
  /** 相机运动路径绘制（在地面点 waypoint，相机沿样条飞）。缺省不渲染该区。 */
  camPath?: {
    drawActive: boolean
    onToggleDraw: () => void
    hasWaypoints: boolean
    mode: 'linear' | 'curve'
    onSetMode: (m: 'linear' | 'curve') => void
    height: number
    onSetHeight: (h: number) => void
    lookAtCharacterId?: string
    onSetLookAt: (id: string | undefined) => void
    onClear: () => void
    /** 一键把此路径作为「路径运镜」镜头加入时间线（绑定本机位）。 */
    onUseAsShot: () => void
  }
}

export type ClipSettings = { durationSeconds: number; fps: number; orbitDegrees: number; orbitRadius: number }

const selectStyle: React.CSSProperties = {
  width: '100%', background: '#1c1f26', border: '1px solid #2a2f3a', borderRadius: 6,
  color: '#e5e7eb', padding: '6px 8px', fontSize: 13, boxSizing: 'border-box',
}

export function CameraPropertiesPanel({ camera, scene, tab, onTab, shotGroups, busy, onPatch, onSwitchCamera, onClearAll, onSendAll, onSendShot, onDeleteShot, clipSettings, onClipSettingsChange, onRenderClip, previewOrbit, onTogglePreviewOrbit, onStartFlyRecord, hasRecording, recordedDuration, onClearRecordedCam, camPath }: Props) {
  const total = shotGroups.reduce((n, g) => n + g.shots.length, 0)
  const [shotPresetId, setShotPresetId] = React.useState<string>(SHOT_PRESETS[0].id)
  const focalMm = camera.focalLengthMm ?? focalFromFov(camera.fovDeg)

  // 应用景别预设：以相机锁定的角色（否则首个角色）为锚，第二角色用于双人/过肩。
  const applyShot = () => {
    const preset = SHOT_PRESETS.find((p) => p.id === shotPresetId)
    if (!preset) return
    const locked = scene.characters.find((c) => c.id === camera.lookAtMode)
    const subject = locked ?? scene.characters[0]
    if (!subject) return
    const second = scene.characters.find((c) => c.id !== subject.id)
    const r = applyShotPreset(preset, subject, second)
    onPatch({ position: r.position, lookAt: r.lookAt, lookAtMode: 'manual', fovDeg: r.fovDeg, focalLengthMm: r.focalLengthMm, roll: r.roll })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600 }}>摄像机</div>
      <div style={{ display: 'flex', gap: 16, padding: '0 16px 8px', borderBottom: '1px solid #16181d' }}>
        {(['props', 'shots'] as const).map((t) => (
          <button key={t} onClick={() => onTab(t)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, paddingBottom: 8, color: tab === t ? '#fff' : '#6b7280', borderBottom: tab === t ? '2px solid #fff' : '2px solid transparent' }}>
            {t === 'props' ? '属性' : `摄像机截图${total ? ` (${total})` : ''}`}
          </button>
        ))}
      </div>

      {tab === 'props' ? (
        <div style={{ overflowY: 'auto' }}>
          <Section title="名称"><TextField value={camera.name} onChange={(v) => onPatch({ name: v })} /></Section>
          <Section title="切换机位">
            <select style={selectStyle} value={scene.activeCameraId ?? camera.id} onChange={(e) => onSwitchCamera(e.target.value)}>
              {scene.cameras.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Section>
          <Section title="位置"><Vec3Row value={camera.position} onChange={(v) => onPatch({ position: v })} /></Section>
          <Section title="注视目标">
            <select style={selectStyle} value={camera.lookAtMode} onChange={(e) => onPatch({ lookAtMode: e.target.value })}>
              <option value="manual">手动坐标</option>
              {scene.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Section>
          {camera.lookAtMode === 'manual' ? (
            <Section title="注视坐标"><Vec3Row value={camera.lookAt} onChange={(v) => onPatch({ lookAt: v })} /></Section>
          ) : null}
          <Section title="景别预设（创建镜头）">
            <select style={selectStyle} value={shotPresetId} onChange={(e) => setShotPresetId(e.target.value)}>
              <optgroup label="单人">
                {SHOT_PRESETS.filter((p) => p.group === '单人').map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </optgroup>
              <optgroup label="双人">
                {SHOT_PRESETS.filter((p) => p.group === '双人').map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </optgroup>
            </select>
            <button onClick={applyShot} disabled={scene.characters.length === 0}
              style={{ width: '100%', marginTop: 8, padding: '7px 0', borderRadius: 8, background: scene.characters.length ? '#1d2940' : '#1c1f26', color: scene.characters.length ? '#cfe0ff' : '#6b7280', border: '1px solid ' + (scene.characters.length ? '#3b82f6' : '#2a2f3a'), cursor: scene.characters.length ? 'pointer' : 'not-allowed', fontSize: 13 }}>
              {scene.characters.length ? '套用到当前机位' : '场景需先有角色'}
            </button>
          </Section>
          <Section title="镜头预设">
            <select style={selectStyle} value={LENS_PRESETS.find((l) => Math.abs(l.focalMm - focalMm) < 0.5)?.id ?? ''}
              onChange={(e) => { const lp = LENS_PRESETS.find((l) => l.id === e.target.value); if (lp) onPatch({ focalLengthMm: lp.focalMm, apertureF: lp.apertureF, fovDeg: fovFromFocal(lp.focalMm) }) }}>
              <option value="">自定义焦距</option>
              {LENS_PRESETS.map((l) => <option key={l.id} value={l.id}>{l.label} · f/{l.apertureF}</option>)}
            </select>
          </Section>
          <Section title="焦距 (mm)">
            <SliderField value={Math.round(focalMm)} min={14} max={200} step={1}
              onChange={(v) => onPatch({ focalLengthMm: v, fovDeg: fovFromFocal(v) })} />
          </Section>
          <Section title="视野角度 (FOV)">
            <SliderField value={camera.fovDeg} min={6} max={120} step={1}
              onChange={(v) => onPatch({ fovDeg: v, focalLengthMm: focalFromFov(v) })} />
          </Section>
          {camPath ? (
            <Section title="相机运动路径">
              <button onClick={camPath.onToggleDraw}
                style={{ width: '100%', padding: '7px 0', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                  border: '1px solid ' + (camPath.drawActive ? '#f59e0b' : '#2a2f3a'),
                  background: camPath.drawActive ? '#2a210f' : '#1c1f26', color: camPath.drawActive ? '#fde6b0' : '#e5e7eb' }}>
                ✏️ {camPath.drawActive ? '绘制中（点地面落点）' : '绘制相机路径'}
              </button>
              {(camPath.drawActive || camPath.hasWaypoints) ? (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10, color: '#5b6470', marginBottom: 6 }}>在导演视角地面点击落 waypoint，拖动小球调整；相机在设定高度沿路径飞、注视目标。</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>飞行高度 m</div>
                      <NumberField value={camPath.height} step={0.1} onChange={(v) => camPath.onSetHeight(Math.max(0, v))} />
                    </div>
                    <button onClick={() => camPath.onSetMode(camPath.mode === 'curve' ? 'linear' : 'curve')}
                      style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid #2a2f3a', background: '#1c1f26', color: '#cdd3dc', cursor: 'pointer', fontSize: 12 }}>
                      {camPath.mode === 'curve' ? '曲线' : '折线'}
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>注视目标</div>
                  <select value={camPath.lookAtCharacterId ?? ''} onChange={(e) => camPath.onSetLookAt(e.target.value || undefined)} style={selectStyle}>
                    <option value="">场景中心</option>
                    {scene.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {camPath.hasWaypoints ? (
                    <button onClick={camPath.onUseAsShot}
                      style={{ width: '100%', marginTop: 10, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: '#16a34a', color: '#fff' }}>
                      ＋ 用此路径建镜头（加入时间线并播放）
                    </button>
                  ) : null}
                  <button onClick={camPath.onClear} style={{ marginTop: 8, padding: '5px 10px', borderRadius: 6, border: '1px solid #3a2a2a', background: '#1a1416', color: '#f87171', cursor: 'pointer', fontSize: 12 }}>清空路径</button>
                  <div style={{ fontSize: 10, color: '#5b6470', marginTop: 8 }}>或在底部时间线把该机位的镜头切到「路径」也行。</div>
                </div>
              ) : null}
            </Section>
          ) : null}
          <Section title="光圈 / 景深">
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>光圈 f</div>
                <NumberField value={camera.apertureF ?? 2.8} step={0.1} onChange={(v) => onPatch({ apertureF: Math.max(0.7, v) })} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>对焦距离 m</div>
                <NumberField value={camera.focusDistance ?? 0} step={0.1} onChange={(v) => onPatch({ focusDistance: Math.max(0, v) })} />
              </div>
            </div>
            <div style={{ fontSize: 10, color: '#5b6470', marginTop: 4 }}>景深为出图元数据，不在视口做实时虚化</div>
          </Section>
          <Section title="荷兰角 (roll)">
            <SliderField value={camera.roll ?? 0} min={-45} max={45} step={1} onChange={(v) => onPatch({ roll: v })} />
          </Section>
          <Section title="灰模样片（运镜 + 渲染）">
            {/* 自定义运镜:飞行录制 */}
            <button onClick={onStartFlyRecord} disabled={scene.characters.length === 0}
              style={{ width: '100%', padding: '8px 0', marginBottom: 8, borderRadius: 8, background: '#1c1f26', color: '#cdd3dc', border: '1px solid #2a2f3a', cursor: scene.characters.length ? 'pointer' : 'not-allowed', fontSize: 13 }}>
              🎥 录制运镜（穿梭机飞行）
            </button>
            {hasRecording ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12, color: '#cfe0ff' }}>
                <span style={{ flex: 1 }}>✓ 已录运镜 {recordedDuration?.toFixed(1)}s（渲染将用此轨迹）</span>
                <button onClick={onClearRecordedCam} style={{ padding: '4px 10px', borderRadius: 6, background: '#1c1f26', color: '#f1a1a1', border: '1px solid #2a2f3a', cursor: 'pointer', fontSize: 12 }}>清除</button>
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>时长 (秒)</div>
                <NumberField value={clipSettings.durationSeconds} step={1} onChange={(v) => onClipSettingsChange({ durationSeconds: Math.min(15, Math.max(1, Math.round(v))) })} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>帧率 fps</div>
                <NumberField value={clipSettings.fps} step={1} onChange={(v) => onClipSettingsChange({ fps: Math.min(30, Math.max(8, Math.round(v))) })} />
              </div>
            </div>
            {!hasRecording ? (
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>环绕角度°（无录制时）</div>
                  <NumberField value={clipSettings.orbitDegrees} step={30} onChange={(v) => onClipSettingsChange({ orbitDegrees: Math.min(720, Math.max(0, Math.round(v))) })} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>半径 m</div>
                  <NumberField value={clipSettings.orbitRadius} step={0.5} onChange={(v) => onClipSettingsChange({ orbitRadius: Math.max(1, v) })} />
                </div>
              </div>
            ) : null}
            <button onClick={onTogglePreviewOrbit} disabled={scene.characters.length === 0}
              style={{ width: '100%', padding: '8px 0', marginBottom: 8, borderRadius: 8, background: previewOrbit ? '#1d2940' : '#1c1f26', color: previewOrbit ? '#cfe0ff' : '#9ca3af', border: '1px solid ' + (previewOrbit ? '#3b82f6' : '#2a2f3a'), cursor: scene.characters.length ? 'pointer' : 'not-allowed', fontSize: 13 }}>
              {previewOrbit ? '⏸ 停止回放' : (hasRecording ? '▶ 回放录制运镜' : '▶ 预览环绕')}
            </button>
            <button onClick={onRenderClip} disabled={busy || scene.characters.length === 0}
              style={{ width: '100%', padding: '9px 0', borderRadius: 8, background: scene.characters.length && !busy ? '#fff' : '#1c1f26', color: scene.characters.length && !busy ? '#111' : '#6b7280', border: 'none', cursor: scene.characters.length && !busy ? 'pointer' : 'not-allowed', fontWeight: 600, fontSize: 13 }}>
              {busy ? '渲染中…' : '渲染样片 → 画布'}
            </button>
            <div style={{ fontSize: 10, color: '#5b6470', marginTop: 6 }}>角色在「属性」里选「动作片段」即可让其动起来；相机绕场景中心环绕。出 mp4 video 节点（带 sourceVideoUrl，可直接喂 seedance v2v）。</div>
          </Section>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
            {total === 0 ? (
              <div style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', marginTop: 40 }}>暂无摄像机截图</div>
            ) : (
              shotGroups.map((g) => (
                <div key={g.cameraId} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: '#8b93a1', marginBottom: 6 }}>{g.cameraName}截图</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {g.shots.map((s) => (
                      <div key={s.id}>
                        <div style={{ position: 'relative', aspectRatio: '16/9', borderRadius: 6, overflow: 'hidden', background: '#000' }}>
                          {/* 本地 dataURL 缩略图，用原生 img（非远程资源，不走 ManagedImage） */}
                          <img src={s.imageUrl} alt={s.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 4 }}>
                            <button title="发送到画布" disabled={busy} onClick={() => onSendShot(g.cameraId, s.id)}
                              style={{ width: 22, height: 22, borderRadius: 4, border: 'none', background: 'rgba(255,255,255,0.92)', color: '#111', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>↗</button>
                            <button title="删除" disabled={busy} onClick={() => onDeleteShot(g.cameraId, s.id)}
                              style={{ width: 22, height: 22, borderRadius: 4, border: 'none', background: 'rgba(0,0,0,0.6)', color: '#f1a1a1', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>✕</button>
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: '#8b93a1', marginTop: 4 }}>{s.name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, padding: 16, borderTop: '1px solid #16181d' }}>
            <button onClick={onClearAll} disabled={busy || total === 0}
              style={{ flex: 1, padding: '9px 0', borderRadius: 8, background: '#1c1f26', color: '#9ca3af', border: '1px solid #2a2f3a', cursor: 'pointer' }}>全部清空</button>
            <button onClick={onSendAll} disabled={busy || total === 0}
              style={{ flex: 1, padding: '9px 0', borderRadius: 8, background: '#fff', color: '#111', border: 'none', cursor: 'pointer', fontWeight: 600 }}>{busy ? '发送中…' : '发送到画布'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
