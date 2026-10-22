import { useRef, useState } from 'react'
import { generateWorkbenchTargets } from './workbenchActions'
import { requireWorkbenchScope } from './workbenchScope'

export function useWorkbenchExecution() {
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [stopping, setStopping] = useState(false)
  const pending = useRef(new Set<string>())
  const operations = useRef(new Set<AbortController>())

  const run = async (ids: readonly string[]) => {
    const targets = [...new Set(ids)].filter(id => !pending.current.has(id))
    if (!targets.length) return
    setError('')
    setNotice('')
    setStopping(false)
    const controller = new AbortController()
    try {
      requireWorkbenchScope()
      targets.forEach(id => pending.current.add(id))
      setPendingIds(new Set(pending.current))
      operations.current.add(controller)
      await generateWorkbenchTargets(targets, controller.signal)
    } catch (failure: unknown) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      operations.current.delete(controller)
      targets.forEach(id => pending.current.delete(id))
      setPendingIds(new Set(pending.current))
      if (!operations.current.size) setStopping(false)
    }
  }

  const stop = () => {
    setStopping(true)
    for (const controller of operations.current) controller.abort()
    setNotice('已停止剩余目标的派发；当前目标及其前置资产链继续执行，已有结果会保留。')
  }

  return { pendingIds, notice, error, stopping, setNotice, setError, run, stop }
}
