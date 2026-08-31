import {
  listHomepageCarouselSlides,
  listPublishedVideos,
  type CarouselSlide,
  type PublicAssetDto,
} from '../api/server'

let carouselRequest: Promise<CarouselSlide[]> | null = null
const publishedVideoRequests = new Map<string, Promise<PublicAssetDto[]>>()

export function loadPortalCarouselSlides(): Promise<CarouselSlide[]> {
  if (carouselRequest) return carouselRequest
  const request = listHomepageCarouselSlides().finally(() => {
    if (carouselRequest === request) carouselRequest = null
  })
  carouselRequest = request
  return request
}

export function loadPortalPublishedVideos(
  authScope: string | null,
  limit: number,
  surface?: 'homepage',
): Promise<PublicAssetDto[]> {
  const key = `${authScope || 'anonymous'}:${limit}:${surface || 'all'}`
  const current = publishedVideoRequests.get(key)
  if (current) return current
  const request = listPublishedVideos(limit, surface).finally(() => {
    if (publishedVideoRequests.get(key) === request) publishedVideoRequests.delete(key)
  })
  publishedVideoRequests.set(key, request)
  return request
}
