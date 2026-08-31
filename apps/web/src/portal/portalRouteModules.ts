export const loadNeoHomePage = () => import('./NeoHomePage')
export const loadNeoTvPage = () => import('./NeoTvPage')
export const loadCanvasHubPage = () => import('./CanvasHubPage')
export const loadSkillPortalPage = () => import('./SkillPortalPage')
export const loadPromptLibraryPage = () => import('./PromptLibraryPage')
export const loadPromptDetailPage = () => import('./PromptDetailPage')

export type PortalModuleRoute = 'home' | 'neo-tv' | 'prompts' | 'projects' | 'skills'

export function preloadPortalRoute(route: PortalModuleRoute): Promise<unknown> {
  if (route === 'home') return loadNeoHomePage()
  if (route === 'neo-tv') return loadNeoTvPage()
  if (route === 'prompts') return loadPromptLibraryPage()
  if (route === 'skills') return loadSkillPortalPage()
  return loadCanvasHubPage()
}
