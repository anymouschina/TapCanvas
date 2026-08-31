import { beforeEach, describe, expect, it } from 'vitest'
import { useRFStore } from './store'

// setNodeStatus 是任务轮询（Canvas 4s tick / updateTaskPollingProgress）的高频回写口。
// 进度没变时它必须不产生新 nodes 引用——否则每次轮询都触发整画布重渲染 + 自动保存链
// （整图 fingerprint stringify + PUT + IndexedDB 快照），这是生成期间长任务的主要来源。

function videoNode(id: string, progress: number) {
  return {
    id,
    type: 'taskNode',
    position: { x: 0, y: 0 },
    data: { kind: 'video', label: id, status: 'running', progress },
  }
}

describe('setNodeStatus 无变化短路', () => {
  beforeEach(() => {
    useRFStore.setState({
      nodes: [videoNode('a', 42), videoNode('b', 10)] as any,
      edges: [],
    })
  })

  it('重复写入相同 status+patch 时 nodes 引用不变', () => {
    const { setNodeStatus } = useRFStore.getState()
    // 首次写入会补齐 sanitize 字段（lastError/httpStatus/isQuotaExceeded），允许变更
    setNodeStatus('a', 'running', { progress: 42 })
    const afterFirst = useRFStore.getState().nodes
    setNodeStatus('a', 'running', { progress: 42 })
    expect(useRFStore.getState().nodes).toBe(afterFirst)
  })

  it('进度真正变化时照常写入且只换目标节点引用', () => {
    const { setNodeStatus } = useRFStore.getState()
    setNodeStatus('a', 'running', { progress: 42 })
    const before = useRFStore.getState().nodes
    setNodeStatus('a', 'running', { progress: 43 })
    const after = useRFStore.getState().nodes
    expect(after).not.toBe(before)
    expect((after.find((n) => n.id === 'a')?.data as any).progress).toBe(43)
    // 未命中的节点保持原引用（React Flow 按节点 memo 依赖这一点）
    expect(after.find((n) => n.id === 'b')).toBe(before.find((n) => n.id === 'b'))
  })

  it('目标节点不存在时 nodes 引用不变', () => {
    const before = useRFStore.getState().nodes
    useRFStore.getState().setNodeStatus('missing', 'running', { progress: 1 })
    expect(useRFStore.getState().nodes).toBe(before)
  })

  it('状态切换（running→success）照常生效', () => {
    const { setNodeStatus } = useRFStore.getState()
    setNodeStatus('a', 'success', { progress: 100 })
    const node = useRFStore.getState().nodes.find((n) => n.id === 'a')
    expect((node?.data as any).status).toBe('success')
    expect((node?.data as any).progress).toBe(100)
  })
})
