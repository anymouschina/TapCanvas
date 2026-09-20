/** Local browser entry points share one origin so cookies and storage stay together. */
export function canonicalLocalUrl(href: string): string | null {
  const url = new URL(href)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') return null
  url.hostname = 'localhost'
  return url.href
}

export async function startAtCanonicalOrigin(
  location: Pick<Location, 'href' | 'replace'>,
  start: () => Promise<unknown>,
): Promise<void> {
  const canonicalUrl = canonicalLocalUrl(location.href)
  if (canonicalUrl) {
    location.replace(canonicalUrl)
    return
  }
  await start()
}
