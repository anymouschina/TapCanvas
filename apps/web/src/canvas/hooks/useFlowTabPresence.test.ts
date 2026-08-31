import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  buildFlowTabPresenceKey,
  createFlowTabPresence,
  type FlowTabPresenceScope,
  useFlowTabPresence,
} from './useFlowTabPresence'

// 极简 BroadcastChannel mock（同进程内多实例互通，jsdom 不原生支持 BroadcastChannel）。
class FakeBC {
  static channels = new Map<string, Set<FakeBC>>()
  onmessage: ((e: { data: unknown }) => void) | null = null
  constructor(public name: string) {
    if (!FakeBC.channels.has(name)) FakeBC.channels.set(name, new Set())
    FakeBC.channels.get(name)!.add(this)
  }
  postMessage(data: unknown) {
    for (const bc of FakeBC.channels.get(this.name) ?? []) if (bc !== this) bc.onmessage?.({ data })
  }
  close() {
    FakeBC.channels.get(this.name)?.delete(this)
  }
}

beforeEach(() => {
  FakeBC.channels.clear()
  ;(globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel = FakeBC
})

describe('createFlowTabPresence', () => {
  const scope = (patch: Partial<FlowTabPresenceScope> = {}): FlowTabPresenceScope => ({
    projectId: 'project-1',
    ownerType: 'project',
    ownerId: 'project-1',
    flowId: 'flow-1',
    ...patch,
  })

  it('只为完整且归属一致的画布构造 presence key', () => {
    expect(buildFlowTabPresenceKey(scope())).toBe('project-1:project:project-1:flow-1')
    expect(buildFlowTabPresenceKey(scope({ flowId: null }))).toBeNull()
    expect(buildFlowTabPresenceKey(scope({ ownerId: 'stale-project' }))).toBeNull()
  })

  it('章节和镜头画布保留项目与 owner 双重作用域', () => {
    expect(buildFlowTabPresenceKey(scope({
      ownerType: 'chapter',
      ownerId: 'chapter-1',
    }))).toBe('project-1:chapter:chapter-1:flow-1')
    expect(buildFlowTabPresenceKey(scope({
      ownerType: 'shot',
      ownerId: 'shot-1',
    }))).toBe('project-1:shot:shot-1:flow-1')
  })

  it('第二个 tab 打开同一完整画布资源后，第一个 tab 收到 true', async () => {
    const seen: boolean[] = []
    const presenceKey = buildFlowTabPresenceKey(scope())
    expect(presenceKey).not.toBeNull()
    const a = createFlowTabPresence(presenceKey!, (present) => seen.push(present))
    const b = createFlowTabPresence(presenceKey!, () => {})
    await Promise.resolve()
    expect(seen).toContain(true)
    a.dispose()
    b.dispose()
  })

  it('不同项目即使出现相同 flowId 也互不影响', async () => {
    let present = false
    const projectAKey = buildFlowTabPresenceKey(scope())
    const projectBKey = buildFlowTabPresenceKey(scope({
      projectId: 'project-2',
      ownerId: 'project-2',
    }))
    expect(projectAKey).not.toBe(projectBKey)
    const a = createFlowTabPresence(projectAKey!, (p) => {
      present = p
    })
    const b = createFlowTabPresence(projectBKey!, () => {})
    await Promise.resolve()
    expect(present).toBe(false)
    a.dispose()
    b.dispose()
  })

  it('从有冲突的项目切到另一项目时立即清除旧提示', async () => {
    const projectAScope = scope()
    const projectAKey = buildFlowTabPresenceKey(projectAScope)!
    const hook = renderHook(
      ({ activeScope }: { activeScope: FlowTabPresenceScope }) => useFlowTabPresence(activeScope),
      { initialProps: { activeScope: projectAScope } },
    )
    const otherTabRef: { current: ReturnType<typeof createFlowTabPresence> | null } = {
      current: null,
    }

    act(() => {
      otherTabRef.current = createFlowTabPresence(projectAKey, () => {})
    })
    expect(hook.result.current).toBe(true)

    act(() => {
      hook.rerender({
        activeScope: scope({
          projectId: 'project-2',
          ownerId: 'project-2',
        }),
      })
    })
    expect(hook.result.current).toBe(false)

    otherTabRef.current?.dispose()
    hook.unmount()
  })

  it('BroadcastChannel 不可用时返回 no-op dispose，不抛错', () => {
    const original = (globalThis as unknown as { BroadcastChannel?: unknown }).BroadcastChannel
    ;(globalThis as unknown as { BroadcastChannel?: unknown }).BroadcastChannel = undefined
    const p = createFlowTabPresence('project:project:project:flow', () => {})
    expect(() => p.dispose()).not.toThrow()
    ;(globalThis as unknown as { BroadcastChannel?: unknown }).BroadcastChannel = original
  })

  it('另一个 tab dispose 后广播 release，并把最后一个观察者重置为 false', async () => {
    const cb = vi.fn((present: boolean) => present)
    const presenceKey = buildFlowTabPresenceKey(scope())!
    const a = createFlowTabPresence(presenceKey, cb)
    const b = createFlowTabPresence(presenceKey, () => {})
    await Promise.resolve()
    b.dispose()
    await Promise.resolve()
    expect(cb.mock.calls.map(([present]) => present)).toEqual([true, false])
    a.dispose()
  })

  it('三个 tab 中释放一个时保持 true，最后一个释放后才变 false', async () => {
    const seen: boolean[] = []
    const presenceKey = buildFlowTabPresenceKey(scope())!
    const a = createFlowTabPresence(presenceKey, (present) => seen.push(present))
    const b = createFlowTabPresence(presenceKey, () => {})
    const c = createFlowTabPresence(presenceKey, () => {})
    await Promise.resolve()
    b.dispose()
    await Promise.resolve()
    expect(seen[seen.length - 1]).toBe(true)
    c.dispose()
    await Promise.resolve()
    expect(seen).toEqual([true, false])
    a.dispose()
  })
})
