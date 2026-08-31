export type HomepagePreviewLocation =
  | { kind: 'homepage'; href: '/' }
  | { kind: 'login'; href: '/login' }
  | { kind: 'embedded'; href: string }

const PREVIEW_ORIGIN = 'https://tapcanvas.com'

export function resolveHomepagePreviewLocation(href: string): HomepagePreviewLocation | null {
  const value = href.trim()
  if (!value) return null

  let url: URL
  try {
    url = new URL(value, PREVIEW_ORIGIN)
  } catch {
    return null
  }
  if (url.origin !== PREVIEW_ORIGIN) return null

  const normalizedPath = url.pathname.replace(/\/+$/, '') || '/'
  if (normalizedPath === '/' || normalizedPath === '/home') return { kind: 'homepage', href: '/' }
  if (normalizedPath === '/login') return { kind: 'login', href: '/login' }

  return {
    kind: 'embedded',
    href: `${url.pathname}${url.search}${url.hash}`,
  }
}

export function formatHomepagePreviewLocation(location: HomepagePreviewLocation): string {
  return location.href === '/' ? 'tapcanvas.com' : `tapcanvas.com${location.href}`
}
