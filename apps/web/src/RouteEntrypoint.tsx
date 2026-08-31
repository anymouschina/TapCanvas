import React from 'react'
import { PortalRouter, resolvePortalPageRoute } from './portal/PortalRouter'
import { CanvasLoadingScreen } from './ui/CanvasLoadingScreen'
import { installPageMediaLifecycle } from './utils/mediaPlayback'
import { resolveCodexPreviewId } from './utils/appRoutes'

const PortalRuntimeLazy = React.lazy(() => import('./runtime/PortalRuntime'))
const WorkspaceRuntimeLazy = React.lazy(() => import('./runtime/WorkspaceRuntime'))
const CodexPreviewPageLazy = React.lazy(() => import('./preview/CodexPreviewPage'))

export default function RouteEntrypoint(): JSX.Element {
  const [, refreshRoute] = React.useReducer((value: number) => value + 1, 0)

  React.useEffect(() => {
    const handleRouteChange = () => refreshRoute()
    return installPageMediaLifecycle(handleRouteChange)
  }, [])

  const pathname = typeof window === 'undefined' ? '/' : window.location.pathname
  const previewId = resolveCodexPreviewId(pathname)
  if (previewId) {
    return (
      <React.Suspense fallback={<CanvasLoadingScreen fixed />}>
        <CodexPreviewPageLazy previewId={previewId} />
      </React.Suspense>
    )
  }
  const portalRoute = resolvePortalPageRoute(pathname)
  if (portalRoute === 'home') {
    return <PortalRouter route={portalRoute} />
  }
  if (portalRoute) {
    return (
      <React.Suspense fallback={<CanvasLoadingScreen fixed />}>
        <PortalRuntimeLazy route={portalRoute} />
      </React.Suspense>
    )
  }

  return (
    <React.Suspense fallback={<CanvasLoadingScreen fixed />}>
      <WorkspaceRuntimeLazy />
    </React.Suspense>
  )
}
