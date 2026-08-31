import React from 'react'
import { createRoot } from 'react-dom/client'
import { Viewport, type ViewportHandle } from '../src/canvas/nodes/directorConsole/scene/Viewport'
import type { DirectorConsoleData } from '../src/canvas/nodes/directorConsole/types'
import { addCharacter, addCamera, setViewpoint, patchCharacter } from '../src/canvas/nodes/directorConsole/state/scene'
import { POSE_PRESETS } from '../src/canvas/nodes/directorConsole/state/pose'
import { createDefaultDirectorConsoleData } from '../src/canvas/nodes/directorConsole/types'

function initial(): DirectorConsoleData {
  let d = createDefaultDirectorConsoleData()
  d = addCharacter(d, { id: 'c1', modelId: 'male' })
  d = addCamera(d, { id: 'k1' })
  return d
}

function Harness() {
  const [data, setData] = React.useState<DirectorConsoleData>(initial)
  const ref = React.useRef<ViewportHandle | null>(null)
  const [shot, setShot] = React.useState<string>('')
  const [log, setLog] = React.useState<string>('ready')

  const capture = () => {
    try {
      const dataUrl = ref.current?.captureView()
      if (!dataUrl) { setLog('capture returned NULL'); return }
      setShot(dataUrl)
      setLog(`capture ok: ${Math.round(dataUrl.length / 1024)}KB dataURL`)
    } catch (e: any) {
      setLog('capture ERROR: ' + (e?.message || String(e)))
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <Viewport
          ref={ref}
          scene={data.scene}
          viewpoint={data.activeViewpoint}
          selectedId={data.selectedObjectId}
          onSelect={(id) => setData((d) => ({ ...d, selectedObjectId: id }))}
          onPatchCharacter={() => {}}
          onPatchCamera={() => {}}
        />
      </div>
      <div style={{ width: 280, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, borderLeft: '1px solid #222' }}>
        <button onClick={() => setData((d) => setViewpoint(d, d.activeViewpoint === 'director' ? 'camera' : 'director'))}>
          切视角（当前：{data.activeViewpoint}）
        </button>
        <button onClick={() => setData((d) => addCamera(d, { id: 'k' + (d.scene.cameras.length + 1) }))}>加机位</button>
        <button onClick={() => setData((d) => addCharacter(d, { id: 'c' + (d.scene.characters.length + 1), modelId: 'female' }))}>加女性</button>
        <button onClick={() => setData((d) => addCharacter(d, { id: 'p' + (d.scene.characters.length + 1), modelId: 'prop-box' }))}>加立方体道具</button>
        <button onClick={() => setData((d) => patchCharacter(d, 'c1', { pose: POSE_PRESETS.find((p) => p.id === 'wave')!.pose as any }))}>姿势:招手(c1)</button>
        <button onClick={() => setData((d) => patchCharacter(d, 'c1', { pose: POSE_PRESETS.find((p) => p.id === 'sit')!.pose as any }))}>姿势:坐姿(c1)</button>
        <button onClick={capture}>截图</button>
        <div style={{ fontSize: 12, color: '#9ca3af' }}>状态：{log}</div>
        <div style={{ fontSize: 12 }}>机位数 {data.scene.cameras.length} / 角色数 {data.scene.characters.length} / 选中 {data.selectedObjectId || '无'}</div>
        {shot ? <img src={shot} alt="shot" style={{ width: '100%', border: '1px solid #333' }} /> : null}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
