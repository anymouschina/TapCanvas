import React from 'react'
import { IconUserPlus, IconVideoPlus, IconAspectRatio, IconCamera, IconTrash, IconArrowsMove, IconRotate, IconResize, IconPhoto, IconUsers, IconArrowBackUp, IconArrowForwardUp, IconGrid3x3 } from '@tabler/icons-react'
import type { AspectKey } from '../types'
import { BODY_TYPES, FURNITURE_TYPES, PROP_TYPES } from '../assets'
import type { CrowdInput } from '../state/crowd'

export type GizmoMode = 'translate' | 'rotate' | 'scale'

type Props = {
  busy: boolean
  aspect: AspectKey
  gizmoMode: GizmoMode
  onSetGizmoMode: (m: GizmoMode) => void
  onAddCharacter: (modelId: string) => void
  onAddCrowd: (input: CrowdInput) => void
  onUploadModel: (file: File) => void
  onSetSkybox: (file: File | null) => void
  hasSkybox: boolean
  panoConnected: boolean
  skyboxYaw: number
  onSetSkyboxYaw: (deg: number) => void
  skyboxPitch: number
  onSetSkyboxPitch: (deg: number) => void
  onAddCamera: () => void
  onSetAspect: (a: AspectKey) => void
  showThirds: boolean
  onToggleThirds: () => void
  onCapture: () => void
  onDeleteSelected?: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
}

const ASPECTS: AspectKey[] = ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']

const btn: React.CSSProperties = { background: 'transparent', border: 'none', cursor: 'pointer', padding: 8, borderRadius: 8, display: 'flex', color: '#cdd3dc' }
const btnOn: React.CSSProperties = { ...btn, background: '#2c313c', color: '#fff' }
const btnDisabled: React.CSSProperties = { ...btn, color: '#4b5563', cursor: 'default' }
const menu: React.CSSProperties = { position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', background: '#16181d', border: '1px solid #2a2f3a', borderRadius: 10, padding: 6, minWidth: 150, maxHeight: '62vh', overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }
const item: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: '#cdd3dc', padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }
const sep: React.CSSProperties = { height: 1, background: '#2a2f3a', margin: '4px 2px' }
const numInput: React.CSSProperties = { width: 44, background: '#0d0f13', color: '#e5e7eb', border: '1px solid #2a2f3a', borderRadius: 6, fontSize: 12.5, padding: '4px 6px', boxSizing: 'border-box' }

function Pop({ icon, title, children }: { icon: React.ReactNode; title: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button style={btn} title={title} onClick={() => setOpen((v) => !v)}>{icon}</button>
      {open ? (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 1 }} onClick={() => setOpen(false)} />
          <div style={{ ...menu, zIndex: 2 }}>{children(() => setOpen(false))}</div>
        </>
      ) : null}
    </div>
  )
}

/** 群演阵列表单：行×列×间距 + 素体档，一键铺一组共享 crowdId 的群演 */
function CrowdForm({ onAdd, close }: { onAdd: (input: CrowdInput) => void; close: () => void }) {
  const [rows, setRows] = React.useState(3)
  const [columns, setColumns] = React.useState(3)
  const [spacing, setSpacing] = React.useState(1.2)
  const [modelId, setModelId] = React.useState('male')
  const clampInt = (v: number) => Math.max(1, Math.min(12, Math.round(v) || 1))
  return (
    <div style={{ minWidth: 208, padding: '4px 6px' }}>
      <div style={{ fontSize: 12, color: '#9ca3af', padding: '2px 4px 8px' }}>群演阵列（同组可统一姿势/颜色/整体挪动）</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px 8px', fontSize: 12.5, color: '#cdd3dc' }}>
        <input type="number" min={1} max={12} value={rows} onChange={(e) => setRows(clampInt(Number(e.target.value)))} style={numInput} />
        行 ×
        <input type="number" min={1} max={12} value={columns} onChange={(e) => setColumns(clampInt(Number(e.target.value)))} style={numInput} />
        列
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px 8px', fontSize: 12.5, color: '#cdd3dc' }}>
        间距
        <input type="range" min={0.6} max={3} step={0.1} value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} style={{ flex: 1 }} />
        {spacing.toFixed(1)}m
      </div>
      <div style={{ padding: '0 4px 10px' }}>
        <select value={modelId} onChange={(e) => setModelId(e.target.value)}
          style={{ width: '100%', background: '#0d0f13', border: '1px solid #2a2f3a', borderRadius: 6, color: '#e5e7eb', padding: '5px 6px', fontSize: 12.5, cursor: 'pointer' }}>
          {BODY_TYPES.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      <button
        style={{ display: 'block', width: '100%', padding: '7px 0', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}
        onClick={() => { onAdd({ modelId, rows, columns, spacing }); close() }}>
        铺 {rows}×{columns} 群演
      </button>
    </div>
  )
}

export function Toolbar({ busy, aspect, gizmoMode, onSetGizmoMode, onAddCharacter, onAddCrowd, onUploadModel, onSetSkybox, hasSkybox, panoConnected, skyboxYaw, onSetSkyboxYaw, skyboxPitch, onSetSkyboxPitch, onAddCamera, onSetAspect, showThirds, onToggleThirds, onCapture, onDeleteSelected, onUndo, onRedo, canUndo, canRedo }: Props) {
  const fileRef = React.useRef<HTMLInputElement>(null)
  const skyRef = React.useRef<HTMLInputElement>(null)
  return (
    <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: '1px solid #1c1f26' }}>
      <input ref={fileRef} type="file" accept=".glb,.gltf,model/gltf-binary" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadModel(f); e.currentTarget.value = '' }} />
      <input ref={skyRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onSetSkybox(f); e.currentTarget.value = '' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#101216', borderRadius: 14, padding: 6, border: '1px solid #1c1f26' }}>
        {/* 撤销/重做（Cmd/Ctrl+Z · Shift+Cmd/Ctrl+Z） */}
        <button style={canUndo ? btn : btnDisabled} title="撤销 (Cmd/Ctrl+Z)" disabled={!canUndo} onClick={onUndo}><IconArrowBackUp size={20} /></button>
        <button style={canRedo ? btn : btnDisabled} title="重做 (Shift+Cmd/Ctrl+Z)" disabled={!canRedo} onClick={onRedo}><IconArrowForwardUp size={20} /></button>
        <div style={{ width: 1, height: 24, background: '#2a2f3a', margin: '0 4px' }} />
        {/* 变换模式：移动/旋转/缩放 */}
        <button style={gizmoMode === 'translate' ? btnOn : btn} title="移动 (V)" onClick={() => onSetGizmoMode('translate')}><IconArrowsMove size={20} /></button>
        <button style={gizmoMode === 'rotate' ? btnOn : btn} title="旋转 (R)" onClick={() => onSetGizmoMode('rotate')}><IconRotate size={20} /></button>
        <button style={gizmoMode === 'scale' ? btnOn : btn} title="缩放 (S)" onClick={() => onSetGizmoMode('scale')}><IconResize size={20} /></button>
        <div style={{ width: 1, height: 24, background: '#2a2f3a', margin: '0 4px' }} />
        <Pop icon={<IconUserPlus size={20} />} title="添加角色">
          {(close) => (
            <>
              <button style={item} onClick={() => { fileRef.current?.click(); close() }}>本地上传…</button>
              <div style={sep} />
              {BODY_TYPES.map((m) => (
                <button key={m.id} style={item} onClick={() => { onAddCharacter(m.id); close() }}>{m.name}</button>
              ))}
              <div style={sep} />
              <div style={{ fontSize: 11, color: '#6b7280', padding: '4px 10px' }}>家具道具</div>
              {FURNITURE_TYPES.map((m) => (
                <button key={m.id} style={item} onClick={() => { onAddCharacter(m.id); close() }}>{m.name}</button>
              ))}
              <div style={sep} />
              <div style={{ fontSize: 11, color: '#6b7280', padding: '4px 10px' }}>几何模型</div>
              {PROP_TYPES.map((m) => (
                <button key={m.id} style={item} onClick={() => { onAddCharacter(m.id); close() }}>{m.name}</button>
              ))}
            </>
          )}
        </Pop>
        <Pop icon={<IconUsers size={20} />} title="群演阵列">
          {(close) => <CrowdForm onAdd={onAddCrowd} close={close} />}
        </Pop>
        <Pop icon={<IconPhoto size={20} />} title="全景背景">
          {(close) => (
            <div style={{ minWidth: 230 }}>
              <div style={{ fontSize: 12, padding: '6px 10px', color: panoConnected ? '#7fd18b' : '#8b93a1', lineHeight: 1.5 }}>
                {panoConnected ? '✓ 已连接全景图（来自连入的图片节点）' : '把图片节点连到导演台左侧输入口即可作为全景背景'}
              </div>
              <div style={sep} />
              <button style={item} onClick={() => { skyRef.current?.click(); close() }}>或本地上传全景图…</button>
              {hasSkybox ? <button style={{ ...item, color: '#d98080' }} onClick={() => { onSetSkybox(null); close() }}>清除上传的全景图</button> : null}
              {(hasSkybox || panoConnected) ? (
                <>
                  <div style={sep} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, color: '#cdd3dc' }}>
                    旋转
                    <input type="range" min={0} max={360} step={5} value={skyboxYaw}
                      onChange={(e) => onSetSkyboxYaw(Number(e.target.value))} style={{ flex: 1 }} />
                    {skyboxYaw}°
                  </div>
                  <div className="director-console-toolbar__horizon-control" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, color: '#cdd3dc' }}>
                    地平线
                    <input className="director-console-toolbar__horizon-slider" aria-label="全景地平线高度" type="range" min={-45} max={45} step={1} value={skyboxPitch}
                      onChange={(e) => onSetSkyboxPitch(Number(e.target.value))} style={{ flex: 1 }} />
                    {skyboxPitch}°
                  </div>
                  <div className="director-console-toolbar__panorama-hint" style={{ fontSize: 11, color: '#6b7280', padding: '0 10px 6px' }}>调节地平线，直到背景地面与导演网格重合</div>
                </>
              ) : null}
            </div>
          )}
        </Pop>
        <button style={btn} title="添加机位" onClick={onAddCamera}><IconVideoPlus size={20} /></button>
        <Pop icon={<IconAspectRatio size={20} />} title="选择画幅比例">
          {(close) => (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {ASPECTS.map((a) => (
                <button key={a} style={{ ...item, textAlign: 'center', background: a === aspect ? '#2c313c' : 'transparent' }} onClick={() => { onSetAspect(a); close() }}>{a === 'auto' ? 'Auto' : a}</button>
              ))}
            </div>
          )}
        </Pop>
        <button style={showThirds ? btnOn : btn} title={showThirds ? '关闭九宫格辅助线' : '开启九宫格辅助线'} onClick={onToggleThirds}><IconGrid3x3 size={20} /></button>
        <button style={{ ...btn, opacity: busy ? 0.5 : 1 }} title="截图" disabled={busy} onClick={onCapture}><IconCamera size={20} /></button>
        {onDeleteSelected ? (
          <button style={{ ...btn, color: '#d98080' }} title="删除选中" onClick={onDeleteSelected}><IconTrash size={20} /></button>
        ) : null}
      </div>
    </div>
  )
}
