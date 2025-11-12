import React from 'react'
import { AppShell, Button, Group, Stack, Title, Text, ScrollArea, Divider, NumberInput, Box } from '@mantine/core'
import { IconPlayerPlay, IconPlayerStop, IconRefresh, IconDeviceFloppy, IconFolderPlus, IconCheckupList } from '@tabler/icons-react'
import Canvas from './canvas/Canvas'
import { useRFStore } from './canvas/store'
import './styles.css'
import KeyboardShortcuts from './KeyboardShortcuts'
import NodeInspector from './inspector/NodeInspector'
import { applyTemplate, captureCurrentSelection, deleteTemplate, listTemplateNames, saveTemplate, renameTemplate } from './templates'
import { ToastHost, toast } from './ui/toast'
import { useUIStore } from './ui/uiStore'
import SubflowEditor from './subflow/Editor'
import LibraryEditor from './flows/LibraryEditor'
import { listFlows, saveFlow, deleteFlow as deleteLibraryFlow, renameFlow, scanCycles } from './flows/registry'

export default function App(): JSX.Element {
  const addNode = useRFStore((s) => s.addNode)
  const reset = useRFStore((s) => s.reset)
  const load = useRFStore((s) => s.load)
  const state = useRFStore((s) => ({ nodes: s.nodes, edges: s.edges }))
  const runSelected = useRFStore((s) => s.runSelected)
  const runAll = useRFStore((s) => s.runAll)
  const runDag = useRFStore((s) => s.runDag)
  const [concurrency, setConcurrency] = React.useState(2)
  const cancelAll = useRFStore((s) => s.cancelAll)
  const retryFailed = useRFStore((s) => s.retryFailed)
  const subflowNodeId = useUIStore(s => s.subflowNodeId)
  const closeSubflow = useUIStore(s => s.closeSubflow)
  const libraryFlowId = useUIStore(s => s.libraryFlowId)
  const closeLibraryFlow = useUIStore(s => s.closeLibraryFlow)
  const [refresh, setRefresh] = React.useState(0)

  return (
    <AppShell
      data-compact={compact ? 'true' : 'false'}
      header={{ height: 56 }}
      navbar={{ width: 260, breakpoint: 'sm' }}
      aside={{ width: 320, breakpoint: 'lg' }}
      padding="md"
      styles={{
        main: { paddingTop: 64, background: 'var(--mantine-color-body)' }
      }}
    >
      <AppShell.Header>
        <Group justify="space-between" p="sm">
          <Group>
            <Title order={4}>TapCanvas</Title>
          </Group>
          <Group gap="xs">
            <Button variant="subtle" leftSection={<IconRefresh size={16} />} onClick={() => window.location.reload()}>重置视图</Button>
            <Button variant="subtle" leftSection={<IconDeviceFloppy size={16} />} onClick={() => import('./canvas/store').then(m => m.persistToLocalStorage())}>保存</Button>
            <Button variant="light" leftSection={<IconPlayerPlay size={16} />} onClick={() => runSelected()}>运行选中</Button>
            <Button variant="light" leftSection={<IconPlayerPlay size={16} />} onClick={() => runAll()}>运行全部</Button>
            <NumberInput min={1} max={8} value={concurrency} onChange={(v)=>setConcurrency(Number(v)||2)} w={80} clampBehavior="strict" suffix="x" allowDecimal={false} />
            <Button variant="light" leftSection={<IconPlayerPlay size={16} />} onClick={() => runDag(concurrency)}>运行流程(DAG)</Button>
            <Button color="red" variant="subtle" leftSection={<IconPlayerStop size={16} />} onClick={() => cancelAll()}>全部停止</Button>
            <Button variant="subtle" onClick={() => retryFailed()}>重试失败</Button>
            <Switch size="sm" checked={compact} onChange={toggleCompact} label="紧凑" />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <ScrollArea h="calc(100vh - 64px)">
          <Stack gap="xs">
            <Title order={6}>工具</Title>
            <Stack gap={6}>
              <Button variant="outline" draggable onDragStart={(e)=>e.dataTransfer.setData('application/reactflow', JSON.stringify({ type: 'taskNode', label: '文本转图像', kind: 'textToImage' }))} onClick={()=>addNode('taskNode','文本转图像',{kind:'textToImage'})}>+ 文本转图像</Button>
              <Button variant="outline" draggable onDragStart={(e)=>e.dataTransfer.setData('application/reactflow', JSON.stringify({ type: 'taskNode', label: '视频合成', kind: 'composeVideo' }))} onClick={()=>addNode('taskNode','视频合成',{kind:'composeVideo'})}>+ 视频合成</Button>
              <Button variant="outline" draggable onDragStart={(e)=>e.dataTransfer.setData('application/reactflow', JSON.stringify({ type: 'taskNode', label: 'TTS 语音', kind: 'tts' }))} onClick={()=>addNode('taskNode','TTS 语音',{kind:'tts'})}>+ TTS 语音</Button>
              <Button variant="outline" draggable onDragStart={(e)=>e.dataTransfer.setData('application/reactflow', JSON.stringify({ type: 'taskNode', label: '字幕对齐', kind: 'subtitleAlign' }))} onClick={()=>addNode('taskNode','字幕对齐',{kind:'subtitleAlign'})}>+ 字幕对齐</Button>
              <Button variant="outline" draggable onDragStart={(e)=>e.dataTransfer.setData('application/reactflow', JSON.stringify({ type: 'taskNode', label: '子工作流', kind: 'subflow' }))} onClick={()=>addNode('taskNode','子工作流',{kind:'subflow'})}>+ 子工作流</Button>
              <Button variant="subtle" onClick={() => reset()}>清空画布</Button>
            </Stack>
            <Text size="xs" c="dimmed">提示：拖拽节点、连线；自动保存至本地。</Text>

            <Divider my="sm" />
            <Title order={6}>导入/导出</Title>
            <Group gap="xs">
              <Button variant="light" onClick={() => {
                const data = JSON.stringify(state, null, 2)
                const blob = new Blob([data], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = 'tapcanvas-flow.json'
                a.click()
                URL.revokeObjectURL(url)
              }}>导出 JSON</Button>
              <Button variant="light" onClick={() => {
                const input = document.createElement('input')
                input.type = 'file'
                input.accept = 'application/json'
                input.onchange = async () => {
                  const file = input.files?.[0]
                  if (!file) return
                  const text = await file.text()
                  try { const json = JSON.parse(text); load(json) } catch { alert('导入失败：JSON 格式不正确') }
                }
                input.click()
              }}>导入 JSON</Button>
            </Group>

            <Divider my="sm" />
            <Title order={6}>模板</Title>
            <Button variant="subtle" leftSection={<IconFolderPlus size={16} />} onClick={() => {
              const data = captureCurrentSelection()
              if (!data) { alert('请先选择要保存为模板的节点'); return }
              const name = prompt('模板名称：')?.trim(); if (!name) return
              saveTemplate(name, data); setRefresh(c=>c)
            }}>保存所选为模板</Button>
            <Stack gap={6}>
              {listTemplateNames().length === 0 && <Text size="xs" c="dimmed">暂无模板</Text>}
              {listTemplateNames().map(n => (
                <Group key={n} justify="space-between">
                  <Text size="sm" draggable onDragStart={(e)=> e.dataTransfer.setData('application/tap-template', n)} title="拖拽到画布以插入">{n}</Text>
                  <Group gap={6}>
                    <Button size="xs" variant="light" onClick={() => applyTemplate(n)}>插入</Button>
                    <Button size="xs" variant="subtle" onClick={() => { const next = prompt('重命名为：', n)?.trim(); if (!next || next === n) return; renameTemplate(n, next); setRefresh(c=>c) }}>重命名</Button>
                    <Button size="xs" color="red" variant="subtle" onClick={() => { deleteTemplate(n); setRefresh(c=>c) }}>删除</Button>
                  </Group>
                </Group>
              ))}
            </Stack>

            <Divider my="sm" />
            <Title order={6}>工作流库</Title>
            <Group gap="xs">
              <Button variant="light" leftSection={<IconDeviceFloppy size={16} />} onClick={() => {
                const name = prompt('将当前画布保存为工作流，命名：')?.trim()
                if (!name) return
                saveFlow({ name, nodes: state.nodes, edges: state.edges })
                toast('已保存到工作流库', 'success')
                setRefresh(r=>r+1)
              }}>保存当前为 Flow</Button>
              <Button variant="subtle" leftSection={<IconCheckupList size={16} />} onClick={() => {
                const bad = scanCycles()
                if (bad.length) toast(`发现引用环：${bad.join(', ')}`, 'error')
                else toast('未发现引用环', 'success')
              }}>检查引用环</Button>
            </Group>
            <Stack gap={6} mt="xs">
              {listFlows().length === 0 && <Text size="xs" c="dimmed">暂无工作流</Text>}
              {listFlows().map(f => (
                <Group key={f.id} justify="space-between">
                  <Text size="sm" draggable title="拖拽到画布以插入引用子工作流" onDragStart={(e)=> e.dataTransfer.setData('application/tapflow', JSON.stringify({ id: f.id, name: f.name }))}>{f.name}</Text>
                  <Group gap={6}>
                    <Button size="xs" variant="light" onClick={() => addNode('taskNode', f.name, { kind: 'subflow', subflowRef: f.id })}>引用为子工作流</Button>
                    <Button size="xs" variant="subtle" onClick={() => useUIStore.getState().openLibraryFlow(f.id)}>打开</Button>
                    <Button size="xs" variant="subtle" onClick={() => { const next = prompt('重命名：', f.name)?.trim(); if (!next || next === f.name) return; renameFlow(f.id, next); setRefresh(r=>r+1) }}>重命名</Button>
                    <Button size="xs" color="red" variant="subtle" onClick={() => { if (confirm('确认删除该 Flow?')) { deleteLibraryFlow(f.id); setRefresh(r=>r+1) } }}>删除</Button>
                  </Group>
                </Group>
              ))}
            </Stack>
          </Stack>
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main>
        <Box style={{ height: 'calc(100vh - 80px)' }}>
          <Canvas />
        </Box>
      </AppShell.Main>

      <AppShell.Aside p="sm">
        <ScrollArea h="calc(100vh - 64px)">
          <NodeInspector />
        </ScrollArea>
      </AppShell.Aside>

      <KeyboardShortcuts />
      <ToastHost />
      {subflowNodeId && (<SubflowEditor nodeId={subflowNodeId} onClose={closeSubflow} />)}
      {libraryFlowId && (<LibraryEditor flowId={libraryFlowId} onClose={closeLibraryFlow} />)}
    </AppShell>
  )
}
