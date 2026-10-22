import React, { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, Loader } from '@mantine/core'
import { useRFStore } from '../store'
import { useWorkbenchViewStore } from './workbenchViewStore'
import './workbench.css'

const CanvasWorkbench = React.lazy(() => import('./CanvasWorkbench'))

class PipelineBoundary extends React.Component<React.PropsWithChildren<{ active: boolean }>, { error: string | null }> {
  state: { error: string | null } = { error: null }

  static getDerivedStateFromError(error: Error) { return { error: error.message } }

  render() {
    if (!this.state.error) return this.props.children
    if (!this.props.active) return null
    return (
      <div className="tc-workbench-loading" role="alert">
        <strong className="tc-workbench-loading__title">流水线加载失败</strong>
        <span className="tc-workbench-loading__error">{this.state.error}</span>
        <Button className="tc-workbench-loading__back" onClick={() => useWorkbenchViewStore.getState().setView('canvas')}>返回画布</Button>
        <Button className="tc-workbench-loading__reload" variant="subtle" onClick={() => window.location.reload()}>重新加载页面</Button>
      </div>
    )
  }
}

/** Both views share one graph; the canvas keeps its viewport and execution lifecycle. */
export function CanvasWorkspace({ children }: React.PropsWithChildren): JSX.Element {
  const view = useWorkbenchViewStore((state) => state.view)
  const provenance = useRFStore((state) => state.graphProvenanceKey)
  const [visited, setVisited] = useState(view === 'workbench')
  const [settledView, setSettledView] = useState(view)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (view === 'workbench') setVisited(true)
    if (view === settledView) return
    const cube = rootRef.current?.querySelector('.tc-workspace-cube')
    const settle = () => setSettledView(view)
    const onEnd = (event: Event) => { if (event.target === cube) settle() }
    cube?.addEventListener('animationend', onEnd)
    const timer = window.setTimeout(settle, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 760)
    return () => {
      cube?.removeEventListener('animationend', onEnd)
      window.clearTimeout(timer)
    }
  }, [view, settledView])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const measure = () => root.style.setProperty('--tc-cube-depth', `${root.clientWidth / 2}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={rootRef} className="tc-canvas-workspace" data-view={view} data-turning={view !== settledView}>
      <div className="tc-workspace-cube">
        <div className="tc-workspace-face tc-workspace-face--canvas" aria-hidden={view !== 'canvas'}
          {...(view !== 'canvas' ? { inert: '' } : {})}>
          {children}
        </div>
        <div className="tc-workspace-face tc-workspace-face--pipeline" aria-hidden={view !== 'workbench'}
          {...(view !== 'workbench' ? { inert: '' } : {})}>
          {(visited || view === 'workbench') && <PipelineBoundary key={provenance} active={view === 'workbench'}>
            <Suspense fallback={<div className="tc-workbench-loading" role="status"><Loader className="tc-workbench-loading__spinner" size="sm" /><span className="tc-workbench-loading__label">正在加载流水线…</span></div>}>
              <CanvasWorkbench active={view === 'workbench'} />
            </Suspense>
          </PipelineBoundary>}
        </div>
      </div>
    </div>
  )
}
