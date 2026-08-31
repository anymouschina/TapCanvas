import React from 'react'
import type { SceneTimeline, Shot, ShotCameraMove } from '../state/timeline'
import { timelineDuration } from '../state/timeline'

type CamOpt = { id: string; name: string; hasPath?: boolean }
type CharTrack = { id: string; name: string; label: string; durationSeconds: number }

export type TimelinePanelProps = {
  timeline: SceneTimeline
  cameras: CamOpt[]
  /** 「默认机位」镜头解析到的机位 id，用于判断它是否有可用路径。 */
  defaultCameraId?: string
  /** 有动作的角色 → 各占一条轨道（展示其动作片段）。 */
  characters: CharTrack[]
  playhead: number
  playing: boolean
  speed: number
  selectedShotId?: string
  onPlayToggle: () => void
  onReset: () => void
  onSeek: (t: number) => void
  onSpeed: (s: number) => void
  onAddShot: () => void
  onSelectShot: (id: string | undefined) => void
  onPatchShot: (id: string, patch: Partial<Shot>) => void
  onRemoveShot: (id: string) => void
  onMoveShot: (id: string, toIndex: number) => void
  onCaptureShot?: () => void
  /** 角色轨：拖右缘改时长(=走位速度) / 删除动作片段 / 点选角色。 */
  onPatchCharDuration: (id: string, seconds: number) => void
  onRemoveChar: (id: string) => void
  onSelectCharacter: (id: string) => void
  /** 按当前时间轴配置合成视频并发送到画布。 */
  onComposeVideo?: () => void
  busy?: boolean
  /** 每个镜头沿时长的缩略图胶片条(dataURL[])，平铺成片段块背景。 */
  thumbs?: Record<string, string[]>
}

const MOVE_LABEL: Record<ShotCameraMove['kind'], string> = { static: '静态机位', orbit: '环绕运镜', recorded: '录制运镜', path: '路径运镜' }
const MOVE_SHORT: Record<ShotCameraMove['kind'], string> = { static: '静态', orbit: '环绕', recorded: '录制', path: '路径' }
const MOVE_COLOR: Record<ShotCameraMove['kind'], string> = { static: '#3b4252', orbit: '#1e4d6b', recorded: '#5b3f7a', path: '#7a5a1e' }
const SPEEDS = [1, 2, 4]
const ZOOMS = [30, 60, 120, 240] // 像素/秒
const GUTTER = 92
const TRACK_H = 30
const RULER_H = 14
const DUR_MAX = 120 // 单片段时长上限（秒）—— 时间轴是规划/预览，不受单镜 15s 出片上限约束
const fmt = (t: number) => `${t.toFixed(1)}s`
const clampDur = (v: number) => Math.max(0.5, Math.min(DUR_MAX, Math.round(v * 2) / 2))

/** 多轨道时间线（像素/秒刻度 + 横向滚动 + 缩放）：镜头轨 = 顺序剪辑块；角色轨 = 动作片段；共享播放头。 */
export function TimelinePanel(props: TimelinePanelProps) {
  const { timeline, cameras, characters, playhead, playing, speed, selectedShotId } = props
  // 总长 = max(镜头之和, 各角色片段长)，让角色片段不被镜头总长截断
  const total = Math.max(0.001, timelineDuration(timeline), ...characters.map((c) => c.durationSeconds))
  const shots = timeline.shots
  const [pxs, setPxs] = React.useState(60) // 像素/秒（缩放）
  const innerRef = React.useRef<HTMLDivElement>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const drag = React.useRef<null | { mode: 'scrub' | 'resize' | 'move'; shotId?: string; charId?: string; startX: number; startDur?: number }>(null)

  const starts: number[] = []
  shots.reduce((acc, s, i) => { starts[i] = acc; return acc + Math.max(0, s.durationSeconds || 0) }, 0)

  // 轨道内容宽度：至少铺满可视区，便于点击空白处 scrub
  const contentW = Math.max(total * pxs + 24, 320)
  const xToSec = (clientX: number) => {
    const el = innerRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return Math.max(0, Math.min(total, (clientX - r.left) / pxs))
  }

  const onScrubDown = (e: React.PointerEvent) => {
    drag.current = { mode: 'scrub', startX: e.clientX }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    props.onSeek(xToSec(e.clientX))
  }
  const onTrackPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.mode === 'scrub') props.onSeek(xToSec(e.clientX))
    else if (d.mode === 'resize') {
      const dur = clampDur((d.startDur ?? 4) + (e.clientX - d.startX) / pxs)
      if (d.shotId) props.onPatchShot(d.shotId, { durationSeconds: dur })
      else if (d.charId) props.onPatchCharDuration(d.charId, dur)
    }
  }
  const onTrackPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    if (d?.mode === 'move' && d.shotId) {
      const tDrop = xToSec(e.clientX)
      let idx = 0
      for (let i = 0; i < shots.length; i++) { if (tDrop >= starts[i]) idx = i }
      props.onMoveShot(d.shotId, idx)
    }
    drag.current = null
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  }

  const cycleMove = (shot: Shot) => {
    const cur = shot.cameraMove?.kind ?? 'static'
    const camId = shot.cameraId || props.defaultCameraId || ''
    const camHasPath = !!cameras.find((c) => c.id === camId)?.hasPath
    let next: ShotCameraMove
    if (cur === 'static') next = { kind: 'orbit', orbit: { radius: 6, degrees: 360, height: 1.6, lookAtHeight: 1.3, fovDeg: 40 } }
    else if (cur === 'orbit' && camHasPath) next = { kind: 'path' }
    else next = { kind: 'static' }
    props.onPatchShot(shot.id, { cameraMove: next })
  }

  const sel = shots.find((s) => s.id === selectedShotId)

  return (
    <div data-testid="timeline-panel" style={{ borderTop: '1px solid #1c1f26', background: '#0d0f13', padding: '8px 14px 10px', userSelect: 'none' }}>
      {/* transport */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <button onClick={props.onPlayToggle} aria-label={playing ? '暂停' : '播放'}
          style={{ width: 64, padding: '5px 0', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: playing ? '#374151' : '#16a34a', color: '#fff' }}>
          {playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <button onClick={props.onReset} style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid #2a2f3a', background: '#16181d', color: '#cdd3dc', cursor: 'pointer', fontSize: 12 }}>⟲ 重置</button>
        <button onClick={props.onAddShot} style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid #2a2f3a', background: '#16181d', color: '#cdd3dc', cursor: 'pointer', fontSize: 12 }}>+ 添加镜头</button>
        {props.onCaptureShot ? (
          <button onClick={props.onCaptureShot} style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid #2a2f3a', background: '#16181d', color: '#cdd3dc', cursor: 'pointer', fontSize: 12 }}>⛶ 截取当前为镜头</button>
        ) : null}
        {props.onComposeVideo ? (
          <button onClick={props.onComposeVideo} disabled={props.busy || shots.length === 0}
            title="按当前时间轴(多镜头+走位)合成视频，发送到画布"
            style={{ padding: '5px 12px', borderRadius: 7, border: 'none', cursor: props.busy || shots.length === 0 ? 'default' : 'pointer', fontSize: 12, fontWeight: 600, background: props.busy || shots.length === 0 ? '#2a2f3a' : '#2563eb', color: '#fff', opacity: props.busy ? 0.7 : 1 }}>
            {props.busy ? '合成中…' : '⬇ 合成视频到画布'}
          </button>
        ) : null}
        {/* 缩放 */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 6, color: '#8b93a1', fontSize: 11 }}>
          <span title="时间轴缩放">🔍</span>
          {ZOOMS.map((z) => (
            <button key={z} onClick={() => setPxs(z)} title={`${z}px/秒`}
              style={{ padding: '2px 6px', borderRadius: 5, border: '1px solid #2a2f3a', cursor: 'pointer', fontSize: 10, background: pxs === z ? '#2c313c' : 'transparent', color: pxs === z ? '#fff' : '#8b93a1' }}>
              {z <= 60 ? '小' : z <= 120 ? '中' : '大'}
            </button>
          ))}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 12 }}>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: '#cdd3dc' }}>{fmt(playhead)} / {fmt(total)}</span>
          <span>倍速</span>
          {SPEEDS.map((s) => (
            <button key={s} onClick={() => props.onSpeed(s)}
              style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #2a2f3a', cursor: 'pointer', fontSize: 11, background: speed === s ? '#2c313c' : 'transparent', color: speed === s ? '#fff' : '#8b93a1' }}>{s}x</button>
          ))}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {/* gutter（固定，不随横向滚动） */}
        <div style={{ width: GUTTER, flex: `0 0 ${GUTTER}px`, paddingTop: RULER_H + 4 }}>
          <div style={{ height: TRACK_H, marginBottom: 2, display: 'flex', alignItems: 'center', fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>🎥 镜头</div>
          {characters.map((c) => (
            <div key={c.id} style={{ height: TRACK_H, marginBottom: 2, display: 'flex', alignItems: 'center', fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.name}>🚶 {c.name}</div>
          ))}
        </div>

        {/* 横向滚动区 */}
        <div ref={scrollRef} style={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden' }}>
          <div
            ref={innerRef}
            onPointerDown={onScrubDown}
            onPointerMove={onTrackPointerMove}
            onPointerUp={onTrackPointerUp}
            style={{ position: 'relative', width: contentW, cursor: 'ew-resize', touchAction: 'none' }}
          >
            {/* ruler */}
            <div style={{ position: 'relative', height: RULER_H, marginBottom: 4, background: '#16181d', borderRadius: 4 }} />

            {/* 镜头轨 */}
            <div style={{ position: 'relative', height: TRACK_H, marginBottom: 2 }}>
              {shots.length === 0 ? (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 8, color: '#6b7280', fontSize: 11 }}>「+ 添加镜头」把运镜排进时间线</div>
              ) : null}
              {shots.map((shot, i) => {
                const kind = shot.cameraMove?.kind ?? 'static'
                const selected = shot.id === selectedShotId
                const strip = props.thumbs?.[shot.id]
                return (
                  <div key={shot.id}
                    onPointerDown={(e) => { e.stopPropagation(); props.onSelectShot(shot.id); drag.current = { mode: 'move', shotId: shot.id, startX: e.clientX }; (innerRef.current as HTMLElement)?.setPointerCapture?.(e.pointerId) }}
                    title={`${shot.name}｜${MOVE_LABEL[kind]}｜${shot.durationSeconds}s（拖右缘改时长=运镜速度）`}
                    style={{ position: 'absolute', left: starts[i] * pxs, width: Math.max(8, shot.durationSeconds * pxs - 2), top: 0, height: TRACK_H, borderRadius: 5, overflow: 'hidden',
                      background: MOVE_COLOR[kind],
                      border: selected ? '1.5px solid #f59e0b' : '1px solid #2a2f3a', cursor: 'grab',
                      display: 'flex', alignItems: 'center', padding: '0 6px', boxSizing: 'border-box' }}>
                    {/* 胶片条：沿片段平铺多帧（看相机运动） */}
                    {strip && strip.length ? (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
                        {strip.map((u, k) => (
                          <div key={k} style={{ flex: 1, minWidth: 0, backgroundImage: u ? `url(${u})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center', borderRight: k < strip.length - 1 ? '1px solid rgba(0,0,0,0.3)' : 'none' }} />
                        ))}
                      </div>
                    ) : null}
                    {/* 左侧渐变遮罩保证标签清晰 */}
                    {strip && strip.length ? <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(0,0,0,0.7), rgba(0,0,0,0) 42%)', pointerEvents: 'none' }} /> : null}
                    <span style={{ position: 'relative', fontSize: 11, color: '#fff', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>镜头{i + 1} · {MOVE_SHORT[kind]}</span>
                    <span onPointerDown={(e) => { e.stopPropagation(); drag.current = { mode: 'resize', shotId: shot.id, startX: e.clientX, startDur: shot.durationSeconds }; (innerRef.current as HTMLElement)?.setPointerCapture?.(e.pointerId) }}
                      style={{ position: 'absolute', right: 0, top: 0, width: 8, height: '100%', cursor: 'ew-resize', background: 'rgba(255,255,255,0.12)' }} />
                  </div>
                )
              })}
            </div>

            {/* 角色轨 */}
            {characters.map((c) => (
              <div key={c.id} style={{ position: 'relative', height: TRACK_H, marginBottom: 2 }}>
                <div title={`${c.name}｜${c.label}｜${c.durationSeconds}s（拖右缘改时长=走位速度）`}
                  onPointerDown={(e) => { e.stopPropagation(); props.onSelectCharacter(c.id) }}
                  style={{ position: 'absolute', left: 0, width: Math.max(8, c.durationSeconds * pxs - 2), top: 0, height: TRACK_H, borderRadius: 5,
                    background: '#1e5142', border: '1px solid #2a3f37', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0 6px', boxSizing: 'border-box' }}>
                  <span style={{ fontSize: 11, color: '#d6f5e6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
                  <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); props.onRemoveChar(c.id) }} aria-label={`删除${c.name}动作`}
                    style={{ marginLeft: 'auto', flex: '0 0 auto', padding: '0 4px', border: 'none', background: 'transparent', color: '#9ad6bf', cursor: 'pointer', fontSize: 12 }}>✕</button>
                  <span onPointerDown={(e) => { e.stopPropagation(); drag.current = { mode: 'resize', charId: c.id, startX: e.clientX, startDur: c.durationSeconds }; (innerRef.current as HTMLElement)?.setPointerCapture?.(e.pointerId) }}
                    style={{ position: 'absolute', right: 0, top: 0, width: 8, height: '100%', cursor: 'ew-resize', background: 'rgba(255,255,255,0.12)' }} />
                </div>
              </div>
            ))}

            {/* 播放头（贯穿所有轨道，随内容滚动） */}
            <div style={{ position: 'absolute', left: playhead * pxs - 1, top: 0, bottom: 0, width: 2, background: '#f59e0b', pointerEvents: 'none' }}>
              <div style={{ position: 'absolute', top: -3, left: -4, width: 10, height: 10, borderRadius: '50%', background: '#f59e0b', boxShadow: '0 0 0 2px #0d0f13' }} />
            </div>
          </div>
        </div>
      </div>

      {/* 选中镜头的检视器 */}
      {sel ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '6px 8px', background: '#121521', border: '1px solid #2a2f3a', borderRadius: 8 }}>
          <span style={{ fontSize: 11, color: '#cdd3dc', fontWeight: 600 }}>镜头{shots.indexOf(sel) + 1}</span>
          <select value={sel.cameraId ?? ''} onChange={(e) => props.onPatchShot(sel.id, { cameraId: e.target.value || undefined })} aria-label="机位"
            style={{ background: '#16181d', color: '#cdd3dc', border: '1px solid #2a2f3a', borderRadius: 6, fontSize: 11, padding: '3px 4px' }}>
            <option value="">默认机位</option>
            {cameras.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button onClick={() => cycleMove(sel)} title="切换 静态/环绕/路径" style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #2a2f3a', background: '#16181d', color: '#8b93a1', cursor: 'pointer', fontSize: 11 }}>
            运镜：{MOVE_SHORT[sel.cameraMove?.kind ?? 'static']}
          </button>
          <span style={{ fontSize: 11, color: '#6b7280' }}>时长</span>
          <input type="number" min={0.5} max={DUR_MAX} step={0.5} value={sel.durationSeconds} aria-label="时长"
            onChange={(e) => props.onPatchShot(sel.id, { durationSeconds: clampDur(Number(e.target.value) || 0.5) })}
            style={{ width: 56, background: '#16181d', color: '#cdd3dc', border: '1px solid #2a2f3a', borderRadius: 6, fontSize: 11, padding: '3px 4px' }} />
          <button onClick={() => props.onMoveShot(sel.id, Math.max(0, shots.indexOf(sel) - 1))} title="左移" style={{ padding: '3px 7px', borderRadius: 6, border: '1px solid #2a2f3a', background: '#16181d', color: '#cdd3dc', cursor: 'pointer', fontSize: 11 }}>◀</button>
          <button onClick={() => props.onMoveShot(sel.id, Math.min(shots.length - 1, shots.indexOf(sel) + 1))} title="右移" style={{ padding: '3px 7px', borderRadius: 6, border: '1px solid #2a2f3a', background: '#16181d', color: '#cdd3dc', cursor: 'pointer', fontSize: 11 }}>▶</button>
          <button onClick={() => props.onRemoveShot(sel.id)} aria-label={`删除镜头${shots.indexOf(sel) + 1}`} style={{ marginLeft: 'auto', padding: '3px 8px', borderRadius: 6, border: '1px solid #3a2a2a', background: '#1a1416', color: '#f87171', cursor: 'pointer', fontSize: 11 }}>✕ 删除</button>
        </div>
      ) : (
        <div style={{ marginTop: 8, fontSize: 11, color: '#5b6470' }}>点选时间轴上的片段编辑；拖片段右缘改时长(=运动速度)、拖片段体重排；时间轴可横向滚动、🔍 缩放。</div>
      )}
    </div>
  )
}

export default TimelinePanel
