import React from 'react'
import { CanvasLoadingScreen } from '../ui/CanvasLoadingScreen'
import { PortalAtmosphere } from './PortalAtmosphere'
import { loadCanvasHubPage, loadNeoHomePage, loadNeoTvPage, loadPromptDetailPage, loadPromptLibraryPage, loadSkillPortalPage } from './portalRouteModules'
import './portal.css'

const NeoHomePageLazy = React.lazy(loadNeoHomePage)
const NeoTvPageLazy = React.lazy(loadNeoTvPage)
const CanvasHubPageLazy = React.lazy(loadCanvasHubPage)
const SkillPortalPageLazy = React.lazy(loadSkillPortalPage)
const PromptLibraryPageLazy = React.lazy(loadPromptLibraryPage)
const PromptDetailPageLazy = React.lazy(loadPromptDetailPage)

export type PortalPageRoute = 'home' | 'neo-tv' | 'prompts' | 'prompt-detail' | 'canvas-hub' | 'skills'

export function resolvePortalPageRoute(pathname: string): PortalPageRoute | null {
  if (pathname === '/' || pathname === '/home' || pathname === '/home/') return 'home'
  if (pathname === '/skills' || pathname === '/skills/') return 'skills'
  if (pathname === '/prompts' || pathname === '/prompts/') return 'prompts'
  if (/^\/prompts\/[^/]+\/?$/.test(pathname)) return 'prompt-detail'
  if (pathname === '/neo-tv' || pathname === '/neo-tv/' || pathname === '/projects' || pathname === '/projects/') {
    return 'neo-tv'
  }
  if (
    pathname === '/canvas'
    || pathname === '/canvas/'
  ) {
    return 'canvas-hub'
  }
  return null
}

export function PortalRouter({ route }: { route: PortalPageRoute }): JSX.Element {
  return (
    <div className={`tc-portal-shell tc-portal-shell--${route}`}>
      <PortalAtmosphere />
      <div className="tc-portal-route">
        <React.Suspense fallback={<CanvasLoadingScreen fixed />}>
          {route === 'home' ? <NeoHomePageLazy /> : null}
          {route === 'neo-tv' ? <NeoTvPageLazy /> : null}
          {route === 'canvas-hub' ? <CanvasHubPageLazy /> : null}
          {route === 'skills' ? <SkillPortalPageLazy /> : null}
          {route === 'prompts' ? <PromptLibraryPageLazy /> : null}
          {route === 'prompt-detail' ? <PromptDetailPageLazy /> : null}
        </React.Suspense>
      </div>
    </div>
  )
}
