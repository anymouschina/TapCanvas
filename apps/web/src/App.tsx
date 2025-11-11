import React from 'react'
import Canvas from './canvas/Canvas'
import { useRFStore } from './canvas/store'
import './styles.css'

export default function App(): JSX.Element {
  const addNode = useRFStore((s) => s.addNode)
  const reset = useRFStore((s) => s.reset)

  return (
    <div className="app-shell" style={{ fontFamily: 'system-ui, sans-serif' }}>
      <aside className="sidebar">
        <h2>TapCanvas</h2>
        <div className="toolbar">
          <button
            draggable
            onDragStart={(e) => e.dataTransfer.setData('application/reactflow', JSON.stringify({ type: 'taskNode', label: '文本转图像' }))}
            onClick={() => addNode('taskNode', '文本转图像')}
          >+ 文本转图像</button>
          <button
            draggable
            onDragStart={(e) => e.dataTransfer.setData('application/reactflow', JSON.stringify({ type: 'taskNode', label: '视频合成' }))}
            onClick={() => addNode('taskNode', '视频合成')}
          >+ 视频合成</button>
          <button
            draggable
            onDragStart={(e) => e.dataTransfer.setData('application/reactflow', JSON.stringify({ type: 'taskNode', label: 'TTS 语音' }))}
            onClick={() => addNode('taskNode', 'TTS 语音')}
          >+ TTS 语音</button>
          <button
            draggable
            onDragStart={(e) => e.dataTransfer.setData('application/reactflow', JSON.stringify({ type: 'taskNode', label: '字幕对齐' }))}
            onClick={() => addNode('taskNode', '字幕对齐')}
          >+ 字幕对齐</button>
        </div>
        <div style={{ marginTop: 12 }}>
          <button onClick={() => reset()}>清空画布</button>
        </div>
        <p style={{ fontSize: 12, opacity: .7, marginTop: 12 }}>
          提示：拖拽节点、连线；自动保存至本地。
        </p>
      </aside>
      <main>
        <div className="header">
          <div>画布</div>
          <div>
            <button onClick={() => window.location.reload()}>重置视图</button>
            <button onClick={() => import('./canvas/store').then(m => m.persistToLocalStorage())}>保存</button>
            <span style={{ fontSize: 12, opacity: .7, marginLeft: 8 }}>React Flow + TypeScript</span>
          </div>
        </div>
        <div style={{ height: 'calc(100vh - 49px)' }}>
          <Canvas />
        </div>
      </main>
    </div>
  )
}
