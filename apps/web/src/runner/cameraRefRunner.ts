import type { Node } from '@xyflow/react'
import { buildCameraRefPrompt, normalizeCameraRefConfig } from '../canvas/nodes/taskNode/cameraRefPrompt'

type Getter = () => any
type Setter = (fn: (s: any) => any) => void

export async function runNodeCameraRef(id: string, get: Getter, set: Setter) {
  const state = get()
  const node: Node | undefined = (state.nodes as Node[]).find((n) => n.id === id)
  if (!node) return
  const kind = (node.data as any)?.kind
  if (kind !== 'cameraRef') return

  const config = normalizeCameraRefConfig((node.data as any)?.cameraRef)
  const prompt = buildCameraRefPrompt(config)
  const setNodeStatus = state.setNodeStatus as (id: string, status: any, patch?: any) => void
  const appendLog = state.appendLog as (id: string, line: string) => void

  setNodeStatus(id, 'success', {
    progress: 100,
    prompt,
    lastResult: {
      id,
      at: Date.now(),
      kind,
      preview: { type: 'text', value: 'cameraRef ready' },
    },
  })
  appendLog(id, `[${new Date().toLocaleTimeString()}] cameraRef ready`)

  // keep zustand "set" arg used (for future extension)
  void set
}

