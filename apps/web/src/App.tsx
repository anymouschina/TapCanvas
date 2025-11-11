import React, { useState } from 'react'
import Canvas from './canvas/Canvas'
import { useRFStore } from './canvas/store'
import './styles.css'
import KeyboardShortcuts from './KeyboardShortcuts'
import NodeInspector from './inspector/NodeInspector'

export default function App(): JSX.Element {
  const addNode = useRFStore((s) => s.addNode)
  const reset = useRFStore((s) => s.reset)
  const load = useRFStore((s) => s.load)
  const state = useRFStore((s) => ({ nodes: s.nodes, edges: s.edges }))
  const runSelected = useRFStore((s) => s.runSelected)
  const runAll = useRFStore((s) => s.runAll)
  const runDag = useRFStore((s) => s.runDag)
  const [concurrency, setConcurrency] = useState(2)

  return (
    <div className="app-shell" style={{ fontFamily: 'system-ui, sans-serif', gridTemplateColumns: '260px 1fr 280px' }}>
      <aside className="sidebar">
        <h2>TapCanvas</h2>
        <div className="toolbar">
          <button
            draggable
            onDragStart={(e) => e.dataTransfer.setData('application/reactflow', JSON.stringify({ type: 'taskNode', label: '文本转图像', kind: 'textToImage' }))}
            onClick={() => addNode('taskNode', '文本转图像', { kind: 'textToImage' })}
          >+ 文本转图像</button>
          <button
            draggable
            onDragStart={(e) => e.dataTransfer.setData('application/reactflow', JSON.stringify({ type: 'taskNode', label: '视频合成', kind: 'composeVideo' }))}
            onClick={() => addNode('taskNode', '视频合成', { kind: 'composeVideo' })}
          >+ 视频合成</button>
          <button
            draggable
            onDragStart={(e) => e.dataTransfer.setData('application/reactflow', JSON.stringify({ type: 'taskNode', label: 'TTS 语音', kind: 'tts' }))}
            onClick={() => addNode('taskNode', 'TTS 语音', { kind: 'tts' })}
          >+ TTS 语音</button>
          <button
            draggable
            onDragStart={(e) => e.dataTransfer.setData('application/reactflow', JSON.stringify({ type: 'taskNode', label: '字幕对齐', kind: 'subtitleAlign' }))}
            onClick={() => addNode('taskNode', '字幕对齐', { kind: 'subtitleAlign' })}
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
            <button onClick={() => runSelected()} style={{ marginLeft: 8 }}>运行选中</button>
            <button onClick={() => runAll()} style={{ marginLeft: 6 }}>运行全部</button>
            <span style={{ marginLeft: 8, fontSize: 12 }}>并发</span>
            <input
              type="number"
              min={1}
              max={8}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              style={{ width: 56, marginLeft: 4, padding: '4px 6px', borderRadius: 6, border: '1px solid rgba(127,127,127,.3)' }}
            />
            <button onClick={() => runDag(concurrency)} style={{ marginLeft: 6 }}>运行流程(DAG)</button>
            <span style={{ fontSize: 12, opacity: .7, marginLeft: 8 }}>React Flow + TypeScript</span>
          </div>
        </div>
        <div style={{ height: 'calc(100vh - 49px)' }}>
          <Canvas />
        </div>
      </main>
      <aside className="sidebar">
        <NodeInspector />
        <div style={{ marginTop: 16 }}>
          <h2 style={{ margin: '8px 0 12px', fontSize: 16 }}>导入/导出</h2>
          <button onClick={() => {
            const data = JSON.stringify(state, null, 2)
            const blob = new Blob([data], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'tapcanvas-flow.json'
            a.click()
            URL.revokeObjectURL(url)
          }}>导出 JSON</button>
          <button onClick={() => {
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = 'application/json'
            input.onchange = async () => {
              const file = input.files?.[0]
              if (!file) return
              const text = await file.text()
              try {
                const json = JSON.parse(text)
                load(json)
              } catch {
                alert('导入失败：JSON 格式不正确')
              }
            }
            input.click()
          }} style={{ marginTop: 8 }}>导入 JSON</button>
        </div>
      </aside>
      <KeyboardShortcuts />
    </div>
  )
}
