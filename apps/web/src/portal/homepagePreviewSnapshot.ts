import React from 'react'

import type {
  CarouselSlide,
  HomepageDecoration,
  PublicAssetDto,
} from '../api/server'

export const HOMEPAGE_PREVIEW_QUERY_KEY = 'tcHomepagePreview'
const HOMEPAGE_PREVIEW_MESSAGE_TYPE = 'tapcanvas:homepage-preview-snapshot'

export type HomepagePreviewSnapshot = {
  slides: CarouselSlide[]
  decoration: HomepageDecoration
  showcase: PublicAssetDto[]
  templateWeights: Record<string, number>
}

type HomepagePreviewSnapshotMessage = {
  type: typeof HOMEPAGE_PREVIEW_MESSAGE_TYPE
  snapshot: HomepagePreviewSnapshot
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string'
}

function isCarouselSlide(value: unknown): value is CarouselSlide {
  return isRecord(value)
    && typeof value.imageUrl === 'string'
    && isNullableString(value.title)
    && isNullableString(value.linkUrl)
}

function isHomepageDecoration(value: unknown): value is HomepageDecoration {
  if (!isRecord(value) || !isNullableString(value.greetingSubtitle) || !isNullableString(value.heroPlaceholder)) return false
  if (!Array.isArray(value.skillCards) || !Array.isArray(value.loginVideos)) return false
  return value.skillCards.every((card) => (
    isRecord(card)
    && typeof card.title === 'string'
    && isNullableString(card.subtitle)
    && isNullableString(card.imageUrl)
    && isNullableString(card.link)
  )) && value.loginVideos.every((video) => (
    isRecord(video)
    && typeof video.url === 'string'
    && isNullableString(video.posterUrl)
    && isNullableString(video.caption)
  ))
}

function isPublicAsset(value: unknown): value is PublicAssetDto {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && (value.type === 'image' || value.type === 'video')
    && typeof value.url === 'string'
    && typeof value.createdAt === 'string'
}

function isTemplateWeights(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every((weight) => typeof weight === 'number' && Number.isFinite(weight))
}

export function readHomepagePreviewSnapshotMessage(value: unknown): HomepagePreviewSnapshot | null {
  if (!isRecord(value) || value.type !== HOMEPAGE_PREVIEW_MESSAGE_TYPE || !isRecord(value.snapshot)) return null
  const snapshot = value.snapshot
  if (!Array.isArray(snapshot.slides) || !snapshot.slides.every(isCarouselSlide)) return null
  if (!isHomepageDecoration(snapshot.decoration)) return null
  if (!Array.isArray(snapshot.showcase) || !snapshot.showcase.every(isPublicAsset)) return null
  if (!isTemplateWeights(snapshot.templateWeights)) return null
  return {
    slides: snapshot.slides,
    decoration: snapshot.decoration,
    showcase: snapshot.showcase,
    templateWeights: snapshot.templateWeights,
  }
}

export function postHomepagePreviewSnapshot(target: Window, snapshot: HomepagePreviewSnapshot): void {
  const message: HomepagePreviewSnapshotMessage = {
    type: HOMEPAGE_PREVIEW_MESSAGE_TYPE,
    snapshot,
  }
  target.postMessage(message, window.location.origin)
}

export function useHomepagePreviewSnapshot(): HomepagePreviewSnapshot | null {
  const [snapshot, setSnapshot] = React.useState<HomepagePreviewSnapshot | null>(null)

  React.useEffect(() => {
    const previewEnabled = new URLSearchParams(window.location.search).get(HOMEPAGE_PREVIEW_QUERY_KEY) === '1'
    if (!previewEnabled || window.parent === window) return

    const receiveSnapshot = (event: MessageEvent<unknown>): void => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      const nextSnapshot = readHomepagePreviewSnapshotMessage(event.data)
      if (!nextSnapshot) {
        console.error('[homepage-preview] rejected invalid temporary snapshot message')
        return
      }
      setSnapshot(nextSnapshot)
    }
    window.addEventListener('message', receiveSnapshot)
    return () => window.removeEventListener('message', receiveSnapshot)
  }, [])

  return snapshot
}
