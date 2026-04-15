import React from 'react'
import type { ResourceKind, ResourceOwnerSurface, ResourcePriority, ResourceVariantKey } from '../model/resourceTypes'
import { useImageResource } from '../hooks/useImageResource'
import { useViewportVisibility } from '../hooks/useViewportVisibility'

const TRANSPARENT_PIXEL_DATA_URL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

function resolveViewportMargin(priority: ResourcePriority): string {
  if (priority === 'critical') return '640px'
  if (priority === 'visible') return '360px'
  if (priority === 'prefetch') return '240px'
  return '120px'
}

type ManagedImageProps = {
  className: string
  src: string
  alt: string
  kind?: ResourceKind
  variantKey?: ResourceVariantKey
  priority?: ResourcePriority
  ownerNodeId?: string | null
  ownerSurface?: ResourceOwnerSurface
  ownerRequestKey?: string
  loading?: 'eager' | 'lazy'
  decoding?: 'sync' | 'async' | 'auto'
  fetchPriority?: 'high' | 'low' | 'auto'
  referrerPolicy?: React.ImgHTMLAttributes<HTMLImageElement>['referrerPolicy']
  draggable?: boolean
  style?: React.CSSProperties
  onLoad?: React.ReactEventHandler<HTMLImageElement>
  onError?: React.ReactEventHandler<HTMLImageElement>
}

export function ManagedImage(props: ManagedImageProps) {
  const {
    className,
    src,
    alt,
    kind = 'image',
    variantKey,
    priority = 'visible',
    ownerNodeId = null,
    ownerSurface,
    ownerRequestKey,
    loading = 'lazy',
    decoding = 'async',
    fetchPriority = 'low',
    referrerPolicy = 'no-referrer',
    draggable = false,
    style,
    onLoad,
    onError,
  } = props

  const visibilityGate = useViewportVisibility<HTMLImageElement>({
    enabled: Boolean(src) && priority !== 'critical',
    rootMargin: resolveViewportMargin(priority),
    freezeOnceVisible: true,
  })
  const bindImageRef = React.useCallback((node: HTMLImageElement | null) => {
    const refTarget = visibilityGate.ref as React.MutableRefObject<HTMLImageElement | null>
    refTarget.current = node
    if (!node) return
    node.setAttribute('fetchpriority', fetchPriority)
  }, [fetchPriority, visibilityGate.ref])
  const resourceEnabled = Boolean(src) && (priority === 'critical' || visibilityGate.isVisible)

  const resource = useImageResource({
    url: src,
    kind,
    variantKey,
    priority,
    enabled: resourceEnabled,
    ownerNodeId,
    ownerSurface,
    ownerRequestKey,
  })
  const renderUrl = resource.renderUrl || ''

  return (
    <img
      ref={bindImageRef}
      className={className}
      src={renderUrl || TRANSPARENT_PIXEL_DATA_URL}
      alt={alt}
      draggable={draggable}
      loading={loading}
      decoding={decoding}
      referrerPolicy={referrerPolicy}
      style={style}
      onLoad={onLoad}
      onError={onError}
    />
  )
}
